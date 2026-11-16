/**
 * 地图底图：先试 OpenStreetMap，8 秒内没有一块瓦片就改用高德栅格瓦片（不需要 Key）。
 * 选过的底图记在 localStorage，下次打开还用。只有 OSM 和高德都失败时才出现「地图没加载出来」卡片。
 * 高德瓦片是 GCJ-02：大陆境内的点要做 WGS-84→GCJ-02，境外和 OSM 都不转。
 */
(function (root) {
  "use strict";

  var OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  var OSM_ATTR = "&copy; OpenStreetMap";
  var AMAP_URL = "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}";
  var AMAP_SUBDOMAINS = ["1", "2", "3", "4"];
  var AMAP_ATTR = "&copy; 高德地图";
  var PREF_KEY = "wishlist-map-tiles-v1";
  var OSM_OK_KEY = "wishlist-map-osm-ok-v1";
  var WAIT_MS = 8000;
  var ERROR_LIMIT = 4;

  function now() {
    return Date.now();
  }

  function readPref() {
    try {
      var raw = JSON.parse(localStorage.getItem(PREF_KEY) || "null");
      if (!raw || typeof raw !== "object") return { provider: "auto", savedAt: 0 };
      var p = raw.provider === "amap" || raw.provider === "osm" || raw.provider === "auto" ? raw.provider : "auto";
      return { provider: p, savedAt: Number(raw.savedAt) || 0, lastUsed: raw.lastUsed || "" };
    } catch (err) {
      return { provider: "auto", savedAt: 0 };
    }
  }

  function writePref(next) {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(next));
    } catch (err) {}
  }

  function preferred() {
    return readPref().provider || "auto";
  }

  function setPreferred(provider) {
    var cur = readPref();
    cur.provider = provider === "amap" || provider === "osm" || provider === "auto" ? provider : "auto";
    cur.savedAt = now();
    if (provider === "osm" || provider === "amap") cur.lastUsed = provider;
    writePref(cur);
    notify();
  }

  function lastUsed() {
    var cur = readPref();
    if (cur.provider === "osm" || cur.provider === "amap") return cur.provider;
    return cur.lastUsed === "amap" ? "amap" : "osm";
  }

  function rememberUsed(provider) {
    var cur = readPref();
    cur.lastUsed = provider;
    cur.savedAt = cur.savedAt || now();
    writePref(cur);
  }

  function setOsmAvailable(ok) {
    try {
      localStorage.setItem(OSM_OK_KEY, JSON.stringify({ ok: !!ok, at: now() }));
    } catch (err) {}
  }

  function osmAvailableRecently() {
    try {
      var raw = JSON.parse(localStorage.getItem(OSM_OK_KEY) || "null");
      return !!(raw && raw.ok);
    } catch (err) {
      return false;
    }
  }

  var listeners = [];
  function notify() {
    var p = activeProvider();
    listeners.slice().forEach(function (fn) {
      try { fn(p); } catch (err) {}
    });
  }
  function onChange(fn) {
    listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (x) { return x !== fn; });
    };
  }

  var currentProvider = "osm";
  function activeProvider() {
    return currentProvider;
  }

  function usingAmap() {
    return currentProvider === "amap";
  }

  function displayLatLng(lat, lng) {
    lat = Number(lat);
    lng = Number(lng);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (currentProvider !== "amap") return { lat: lat, lng: lng };
    var G = root.GeoUtil;
    if (!G) return { lat: lat, lng: lng };
    if (G.outOfChinaBBox && G.outOfChinaBBox(lat, lng)) return { lat: lat, lng: lng };
    if (G.inMainlandChina && !G.inMainlandChina(lat, lng)) return { lat: lat, lng: lng };
    return G.wgs84ToGcj02(lat, lng);
  }

  function storageLatLng(lat, lng) {
    lat = Number(lat);
    lng = Number(lng);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (currentProvider !== "amap") return { lat: lat, lng: lng };
    var G = root.GeoUtil;
    if (!G || !G.gcj02ToWgs84) return { lat: lat, lng: lng };
    if (G.outOfChinaBBox && G.outOfChinaBBox(lat, lng)) return { lat: lat, lng: lng };
    if (G.inMainlandChina) {
      /* 点击落在 GCJ 坐标上：先按 GCJ 判断会偏，用转换后再判断是否在境内 */
      var wgs = G.gcj02ToWgs84(lat, lng);
      if (!G.inMainlandChina(wgs.lat, wgs.lng)) return { lat: lat, lng: lng };
      return wgs;
    }
    return G.gcj02ToWgs84(lat, lng);
  }

  function osmLayer() {
    return L.tileLayer(OSM_URL, {
      attribution: OSM_ATTR,
      maxZoom: 19,
      crossOrigin: true
    });
  }

  function amapLayer() {
    return L.tileLayer(AMAP_URL, {
      attribution: AMAP_ATTR,
      maxZoom: 18,
      subdomains: AMAP_SUBDOMAINS,
      crossOrigin: true
    });
  }

  function makeFailCard() {
    var el = document.createElement("div");
    el.className = "map-fail-card";
    el.hidden = true;
    el.innerHTML =
      "<div class=\"map-fail-inner\">" +
      "<p class=\"map-fail-title\">地图没加载出来</p>" +
      "<p class=\"map-fail-text\">网络不好时会这样，行程在『列表』里照常能看</p>" +
      "<button type=\"button\" class=\"primary-btn map-fail-retry\">重试</button>" +
      "</div>";
    return el;
  }

  /**
   * 给一张 Leaflet 地图接上底图切换和失败卡片。
   * 返回 { layer, provider, retry, destroy }.
   */
  function attach(map, hostEl) {
    if (!map || typeof L === "undefined") return null;
    var state = {
      layer: null,
      provider: "osm",
      loaded: 0,
      errors: 0,
      timer: null,
      failEl: null,
      destroyed: false,
      triedAmap: false,
      triedOsm: false
    };

    function clearTimer() {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
    }

    function showFail(on) {
      if (!state.failEl) return;
      state.failEl.hidden = !on;
    }

    function bindLayer(layer, provider) {
      state.loaded = 0;
      state.errors = 0;
      layer.on("tileload", function () {
        state.loaded += 1;
        if (state.loaded > 0) {
          showFail(false);
          clearTimer();
          if (provider === "osm") setOsmAvailable(true);
        }
      });
      layer.on("tileerror", function () {
        state.errors += 1;
        if (state.loaded === 0 && state.errors >= ERROR_LIMIT) {
          onTimeout();
        }
      });
    }

    function setLayer(provider) {
      var next = provider === "amap" ? amapLayer() : osmLayer();
      if (state.layer) {
        try { map.removeLayer(state.layer); } catch (err) {}
      }
      state.layer = next;
      state.provider = provider;
      currentProvider = provider;
      rememberUsed(provider);
      if (provider === "amap") state.triedAmap = true;
      if (provider === "osm") state.triedOsm = true;
      bindLayer(next, provider);
      next.addTo(map);
      clearTimer();
      state.timer = setTimeout(onTimeout, WAIT_MS);
      notify();
      if (typeof syncOsmBack === "function") syncOsmBack();
    }

    function bothTried() {
      return state.triedOsm && state.triedAmap;
    }

    function onTimeout() {
      if (state.destroyed) return;
      if (state.loaded > 0) {
        showFail(false);
        return;
      }
      if (state.provider === "osm" && !state.triedAmap) {
        setLayer("amap");
        return;
      }
      if (state.provider === "amap" && !state.triedOsm) {
        setLayer("osm");
        return;
      }
      if (bothTried()) showFail(true);
    }

    function retry() {
      if (state.destroyed) return;
      showFail(false);
      state.triedOsm = false;
      state.triedAmap = false;
      var start = preferred() === "amap" ? "amap" : "osm";
      if (preferred() === "auto" && lastUsed() === "amap") start = "amap";
      /* 重试时先再试一遍 OSM，不行再回高德 */
      start = "osm";
      setLayer(start);
    syncOsmBack();
    }

    function syncOsmBack() {
      if (!state.backEl) return;
      state.backEl.hidden = state.provider !== "amap";
    }
    if (hostEl) {
      var existing = hostEl.querySelector(".map-fail-card");
      state.failEl = existing || makeFailCard();
      if (!existing) hostEl.appendChild(state.failEl);
      var btn = state.failEl.querySelector(".map-fail-retry");
      if (btn) btn.addEventListener("click", retry);
      state.backEl = hostEl.querySelector(".map-osm-back");
      if (!state.backEl) {
        state.backEl = document.createElement("button");
        state.backEl.type = "button";
        state.backEl.className = "map-osm-back";
        state.backEl.textContent = "改回 OpenStreetMap";
        hostEl.appendChild(state.backEl);
      }
      state.backEl.addEventListener("click", function () {
        setPreferred("osm");
        setLayer("osm");
        syncOsmBack();
      });
    }

    var start = "osm";
    var pref = preferred();
    if (pref === "amap") start = "amap";
    else if (pref === "osm") start = "osm";
    else if (lastUsed() === "amap") start = "amap";
    setLayer(start);

    /* 记着高德时，隔一天在后台探一下 OSM 是否恢复（不自动改回去，设置里会提示） */
    if (start === "amap") {
      setTimeout(function () {
        probeOsm(function (ok) { setOsmAvailable(ok); });
      }, 2000);
    }

    return {
      layer: function () { return state.layer; },
      provider: function () { return state.provider; },
      retry: retry,
      destroy: function () {
        state.destroyed = true;
        clearTimer();
        if (state.layer) {
          try { map.removeLayer(state.layer); } catch (err) {}
        }
      }
    };
  }

  function probeOsm(cb) {
    var done = false;
    var img = new Image();
    var t = setTimeout(function () {
      if (done) return;
      done = true;
      cb(false);
    }, WAIT_MS);
    img.onload = function () {
      if (done) return;
      done = true;
      clearTimeout(t);
      cb(true);
    };
    img.onerror = function () {
      if (done) return;
      done = true;
      clearTimeout(t);
      cb(false);
    };
    /* 任意一块公开的 OSM 瓦片，只用来探能不能加载 */
    img.referrerPolicy = "no-referrer";
    img.src = "https://a.tile.openstreetmap.org/0/0/0.png?ts=" + now();
  }

  var api = {
    OSM_URL: OSM_URL,
    AMAP_URL: AMAP_URL,
    AMAP_SUBDOMAINS: AMAP_SUBDOMAINS,
    PREF_KEY: PREF_KEY,
    WAIT_MS: WAIT_MS,
    preferred: preferred,
    setPreferred: setPreferred,
    lastUsed: lastUsed,
    activeProvider: activeProvider,
    usingAmap: usingAmap,
    displayLatLng: displayLatLng,
    storageLatLng: storageLatLng,
    attach: attach,
    probeOsm: probeOsm,
    osmAvailableRecently: osmAvailableRecently,
    onChange: onChange,
    setOsmAvailable: setOsmAvailable
  };

  root.MapTiles = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
