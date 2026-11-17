/**
 * 地理编码：默认使用 OpenStreetMap Nominatim（无需 API Key）。
 * 若 config.js 填写了 AMAP_JS_KEY 和 AMAP_SECURITY_CODE，且查询词像中国大陆地址，
 * 则按需加载高德 JS API（webapi.amap.com：AMap.PlaceSearch / AMap.AutoComplete），
 * 返回的 GCJ-02 只转换一次成 WGS-84 再入库。两项都为空时不会请求高德、也不会加载脚本。
 * 脚本加载失败、超时或没有结果时，静默退回现有查找链（Nominatim）。不会发送用户自己的位置。
 * 应用打开时不加载高德脚本，只在用户实际搜国内地点时才加载。
 * 限制：Nominatim 每秒最多 1 次；超时 8 秒；结果缓存在 localStorage。
 * 机票优先查本地机场表，找不到再搜「<IATA> airport」。
 * 请求中只包含名称、地址或 IATA，不会发送确认号、座位或备注。
 * 浏览器页面里的 fetch 不能自定义 User-Agent；Nominatim 请求带 Accept 与
 * Accept-Language，Referer / User-Agent 由浏览器自动附带。
 */
(function (root) {
  "use strict";

  var CACHE_KEY = "wishlist-map-geocode-v1";
  var Transport = root.Transport || (typeof require === "function" ? require("./transport.js") : null);
  function isGround(item) {
    return !!(Transport && Transport.isGround(item));
  }
  var NOMINATIM = "https://nominatim.openstreetmap.org/search";
  var AMAP_JS = "https://webapi.amap.com/maps";
  var MIN_INTERVAL_MS = 1000;
  var REQUEST_TIMEOUT_MS = 8000;
  /* v5.2：没位置时「带我去」不一定能用，别再说「不影响导航」 */
  var FRIENDLY_NOT_FOUND = "没搜到，换个名字试试，或点『找不到？换个方式加』";
  var lastRequestAt = 0;
  var chain = Promise.resolve();
  var amapLoader = null;

  function amapJsKey() {
    var cfg = root.AppConfig || {};
    return String(cfg.AMAP_JS_KEY || "").trim();
  }

  function amapSecurityCode() {
    var cfg = root.AppConfig || {};
    return String(cfg.AMAP_SECURITY_CODE || "").trim();
  }

  function amapConfigured() {
    return !!(amapJsKey() && amapSecurityCode());
  }

  function amapRestKey() {
    var cfg = root.AppConfig || {};
    return String(cfg.AMAP_REST_KEY || "").trim();
  }

  function amapRestConfigured() {
    return !!amapRestKey();
  }

  var AMAP_REST = "https://restapi.amap.com/v3";

  function chineseCityHint(text) {
    var t = String(text || "");
    var m = t.match(/(北京|天津|上海|重庆)/) || t.match(/([\u3400-\u9fff]{1,8}?(?:省|市|自治区|自治州|地区|盟))/);
    if (!m) return "";
    var city = m[1] || m[0];
    if (/香港|澳门|澳門/.test(city)) return "";
    return city;
  }

  function parseAmapLocation(loc) {
    if (loc == null || loc === "" || loc === "[]") return null;
    if (Array.isArray(loc)) {
      if (loc.length < 2) return null;
      return gcjResultToWgs(Number(loc[1]), Number(loc[0]));
    }
    var s = String(loc).trim();
    var parts = s.split(",");
    if (parts.length < 2) return null;
    var lng = parseFloat(parts[0]);
    var lat = parseFloat(parts[1]);
    return gcjResultToWgs(lat, lng);
  }

  function mapAmapRestPois(pois, q) {
    var list = [];
    (pois || []).forEach(function (poi) {
      if (!poi) return;
      var pt = parseAmapLocation(poi.location);
      if (!pt) return;
      var name = String(poi.name || "").trim();
      var addr = String(poi.address || poi.district || "").trim();
      list.push({
        lat: pt.lat,
        lng: pt.lng,
        displayName: (name && addr ? name + ", " + addr : name || addr || q || "").trim(),
        name: name,
        class: "",
        type: poi.type || poi.typecode || "",
        city: String(poi.cityname || poi.city || "").trim(),
        source: "amap",
        coordSystem: "wgs84"
      });
    });
    return list;
  }

  function mapAmapRestTips(tips, q) {
    var list = [];
    (tips || []).forEach(function (tip) {
      if (!tip) return;
      var pt = parseAmapLocation(tip.location);
      if (!pt) return;
      var name = String(tip.name || "").trim();
      var addr = String(tip.address || tip.district || "").trim();
      list.push({
        lat: pt.lat,
        lng: pt.lng,
        displayName: (name && addr ? name + ", " + addr : name || addr || q || "").trim(),
        name: name,
        class: "",
        type: tip.type || tip.typecode || "",
        city: String(tip.cityname || tip.adname || "").trim(),
        source: "amap",
        coordSystem: "wgs84"
      });
    });
    return list;
  }

  function mapAmapRestGeocodes(geocodes, q) {
    var list = [];
    (geocodes || []).forEach(function (g) {
      if (!g) return;
      var pt = parseAmapLocation(g.location);
      if (!pt) return;
      var addr = String(g.formatted_address || g.address || q || "").trim();
      list.push({
        lat: pt.lat,
        lng: pt.lng,
        displayName: addr,
        name: addr,
        class: "",
        type: g.level || "",
        city: String(g.city || g.province || "").trim(),
        source: "amap",
        coordSystem: "wgs84"
      });
    });
    return list;
  }

  /* 请求失败、超时、空 Key、空结果一律返回 []，不把 Key 放进错误信息。不发送用户位置。 */
  function amapRestGet(path, params) {
    if (!amapRestConfigured()) return Promise.resolve([]);
    var key;
    var qs = [];
    params = params || {};
    for (key in params) {
      if (Object.prototype.hasOwnProperty.call(params, key) && params[key]) {
        qs.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(params[key])));
      }
    }
    qs.push("key=" + encodeURIComponent(amapRestKey()));
    qs.push("output=json");
    var url = AMAP_REST + path + "?" + qs.join("&");
    return fetchWithTimeout(url, { headers: { Accept: "application/json" } })
      .then(function (res) {
        if (!res || !res.ok) return null;
        return typeof res.json === "function" ? res.json() : res;
      })
      .catch(function () {
        return null;
      });
  }

  function amapRestPlaceText(keywords, city) {
    var q = sanitizeGeocodeQuery(keywords);
    if (!q) return Promise.resolve([]);
    var params = { keywords: q, offset: "5", page: "1", extensions: "base" };
    if (city) params.city = city;
    return amapRestGet("/place/text", params).then(function (data) {
      if (!data || String(data.status) !== "1") return [];
      return mapAmapRestPois(data.pois, q);
    });
  }

  function amapRestInputTips(keywords, city) {
    var q = sanitizeGeocodeQuery(keywords);
    if (!q) return Promise.resolve([]);
    var params = { keywords: q };
    if (city) params.city = city;
    return amapRestGet("/assistant/inputtips", params).then(function (data) {
      if (!data || String(data.status) !== "1") return [];
      return mapAmapRestTips(data.tips, q);
    });
  }

  function amapRestGeocode(address, city) {
    var q = sanitizeGeocodeQuery(address);
    if (!q) return Promise.resolve([]);
    var params = { address: q };
    if (city) params.city = city;
    return amapRestGet("/geocode/geo", params).then(function (data) {
      if (!data || String(data.status) !== "1") return [];
      return mapAmapRestGeocodes(data.geocodes, q);
    });
  }

  function firstAmapHit(list) {
    if (!list || !list.length) return null;
    var x = list[0];
    if (!x || !isFinite(x.lat) || !isFinite(x.lng)) return null;
    return x;
  }

  /**
   * 国内手动搜索：地点文本 → 输入提示 → 地理编码。不带 location / 用户坐标。
   * 失败或空结果返回 []，由调用方退回现有链。
   */
  function amapRestSearch(query, opts) {
    var q = sanitizeGeocodeQuery(query);
    if (!amapRestConfigured() || !q) return Promise.resolve([]);
    var city = "";
    if (opts && opts.city && typeof opts.city === "string") city = chineseCityHint(opts.city);
    if (!city) city = chineseCityHint(q);
    return amapRestPlaceText(q, city)
      .then(function (list) {
        if (list && list.length) return list;
        return amapRestInputTips(q, city).then(function (tips) {
          if (tips && tips.length) return tips;
          return amapRestGeocode(q, city);
        });
      })
      .catch(function () {
        return [];
      });
  }

  /**
   * 导入查找：先按地址地理编码，再按店名或地址做地点搜索 / 输入提示。
   * 不发送用户位置。没有点则返回 null，继续原来的查找链。
   */
  function amapRestLookupItem(item, ctx) {
    if (!amapRestConfigured() || !item) return Promise.resolve(null);
    var name = String(item.nameZh || item.nameEn || item.name || "").trim();
    var addr = String(item.address || "").trim();
    var blob = (addr + " " + name).trim();
    if (!looksMainland(blob)) return Promise.resolve(null);
    var city = "";
    if (ctx && ctx.city && typeof ctx.city === "string") city = chineseCityHint(ctx.city);
    if (!city) city = chineseCityHint(addr) || chineseCityHint(name);
    var steps = [];
    if (addr) steps.push(function () { return amapRestGeocode(addr, city); });
    if (name || addr) steps.push(function () { return amapRestPlaceText(name || addr, city); });
    if (name) steps.push(function () { return amapRestInputTips(name, city); });
    function next(i) {
      if (i >= steps.length) return Promise.resolve(null);
      return steps[i]().then(function (list) {
        var hit = firstAmapHit(list);
        if (hit) return hit;
        return next(i + 1);
      }).catch(function () {
        return next(i + 1);
      });
    }
    return next(0);
  }


  function looksMainland(text) {
    if (root.GeoUtil && typeof root.GeoUtil.looksChineseMainlandQuery === "function") {
      return root.GeoUtil.looksChineseMainlandQuery(text);
    }
    return /[\u3400-\u9fff]/.test(String(text || ""));
  }

  function fetchWithTimeout(url, options) {
    var ms = REQUEST_TIMEOUT_MS;
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var opts = {};
    var key;
    options = options || {};
    for (key in options) {
      if (Object.prototype.hasOwnProperty.call(options, key)) opts[key] = options[key];
    }
    if (ctrl) opts.signal = ctrl.signal;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        if (ctrl) ctrl.abort();
        reject(new Error("timeout"));
      }, ms);
      fetch(url, opts).then(
        function (res) {
          clearTimeout(timer);
          resolve(res);
        },
        function (err) {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  function now() {
    return Date.now();
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function loadCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function saveCache(cache) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (err) {
      /* 配额满时忽略 */
    }
  }

  function getCache() {
    return loadCache();
  }

  function setCacheAll(obj) {
    saveCache(obj && typeof obj === "object" ? obj : {});
  }

  function normalizeQuery(q) {
    return String(q || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function cacheGet(query) {
    var key = normalizeQuery(query);
    if (!key) return null;
    var cache = loadCache();
    return cache[key] || null;
  }

  function cacheSet(query, results) {
    var key = normalizeQuery(query);
    if (!key) return;
    var cache = loadCache();
    cache[key] = {
      savedAt: new Date().toISOString(),
      results: results
    };
    saveCache(cache);
  }

  function mapResults(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (r) {
      return {
        lat: Number(r.lat),
        lng: Number(r.lon),
        displayName: r.display_name || "",
        name: r.name || "",
        /* v5.2：店名优先用 namedetails；地址分项用来拼「城市 邮编 · 街道」 */
        nameDetail: (r.namedetails && (r.namedetails.name || r.namedetails["name:zh"] || r.namedetails["name:en"])) || "",
        address: r.address && typeof r.address === "object" ? {
          house_number: r.address.house_number || "",
          road: r.address.road || r.address.pedestrian || "",
          city: r.address.city || r.address.town || r.address.village || r.address.suburb || r.address.county || "",
          postcode: r.address.postcode || ""
        } : null,
        /* v5.2：地图服务给的城市（city/town/village），选中后存进 item.city，给「那天在哪个城市」用 */
        city: (r.address && (r.address.city || r.address.town || r.address.village)) || "",
        class: r.class || r.category || "",
        type: r.type || "",
        importance: typeof r.importance === "number" ? r.importance : 0
      };
    }).filter(function (r) {
      return isFinite(r.lat) && isFinite(r.lng);
    });
  }

  function enqueue(task) {
    var run = chain.then(function () {
      var wait = Math.max(0, MIN_INTERVAL_MS - (now() - lastRequestAt));
      return delay(wait).then(function () {
        lastRequestAt = now();
        return task();
      });
    });
    chain = run.then(
      function () {},
      function () {}
    );
    return run;
  }

  /**
   * 只把地名/地址/IATA 发给 Nominatim，去掉可能夹带的确认号、座位、备注字样。
   */
  function sanitizeGeocodeQuery(query) {
    return String(query == null ? "" : query)
      .replace(/确认号\s*[:：]?\s*\S+/g, " ")
      .replace(/座位\s*[:：]?\s*\S+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * v5.2 区域偏好：拿那天酒店（或同一天别的条目）的坐标，先四舍五入到 1 位小数（约 10 km），
   * 再往外扩约 20 km 拼成 Nominatim 的 viewbox。只发这个大概范围，不发酒店精确坐标，也绝不发用户自己的位置。
   * 返回 { lat, lng, viewbox: "左,上,右,下" }（全部 1 位小数），坐标不对返回 null。
   */
  var BIAS_DEG = 0.2;
  function round1(n) {
    return Math.round(Number(n) * 10) / 10;
  }
  function fmt1(n) {
    var v = round1(n);
    return (Object.is(v, -0) ? 0 : v).toFixed(1);
  }
  function biasArea(center) {
    if (!center || !isFinite(center.lat) || !isFinite(center.lng)) return null;
    var lat = round1(center.lat);
    var lng = round1(center.lng);
    if (Math.abs(lat) > 85 || Math.abs(lng) > 180) return null;
    var dLng = round1(BIAS_DEG / Math.max(0.3, Math.cos((lat * Math.PI) / 180)));
    return {
      lat: lat,
      lng: lng,
      viewbox: [fmt1(lng - dLng), fmt1(lat + BIAS_DEG), fmt1(lng + dLng), fmt1(lat - BIAS_DEG)].join(",")
    };
  }

  function nominatimSearch(query, opts) {
    var q = sanitizeGeocodeQuery(query);
    if (!q) return Promise.resolve([]);
    var area = opts && opts.bias ? biasArea(opts.bias) : null;
    /* v5.3（旅行顾问）：有区域时先 bounded=1 只在框里找；0 个结果再 bounded=0（只是优先这片区域，等于全局） */
    if (area && !opts.unbounded) {
      return nominatimRequest(q, area, 1).then(function (list) {
        if (list && list.length) return list;
        return nominatimRequest(q, area, 0);
      });
    }
    return nominatimRequest(q, area, 0);
  }

  function nominatimRequest(q, area, bounded) {
    var cacheKey = area ? q + " @" + area.viewbox + (bounded ? " b1" : "") : q;
    var hit = cacheGet(cacheKey);
    if (hit && Array.isArray(hit.results)) {
      return Promise.resolve(hit.results);
    }

    return enqueue(function () {
      var url =
        NOMINATIM +
        "?format=jsonv2&limit=5&addressdetails=1&namedetails=1&accept-language=" +
        encodeURIComponent("zh,en") +
        "&q=" +
        encodeURIComponent(q) +
        (area ? "&viewbox=" + area.viewbox + "&bounded=" + (bounded ? 1 : 0) : "");
      return fetchWithTimeout(url, {
          headers: { Accept: "application/json", "Accept-Language": "zh,en" }
        }).then(function (res) {
        if (!res.ok) {
          throw new Error("timeout-or-http");
        }
        return res.json();
      }).then(function (data) {
        var results = mapResults(data);
        cacheSet(cacheKey, results);
        return results;
      });
    });
  }

  /**
   * Nominatim 结构化查询：只发 street / city / postalcode，不带店名。
   * 导入必须走这一条，禁止用 q=店名。
   */
  function nominatimStructured(parts, opts) {
    parts = parts || {};
    var street = String(parts.street || "").trim();
    var city = String(parts.city || "").trim();
    var postal = String(parts.postalcode || "").trim();
    if (!street && !city && !postal) return Promise.resolve([]);
    var cacheKey = "struct:" + street + "|" + city + "|" + postal;
    var hit = cacheGet(cacheKey);
    if (hit && Array.isArray(hit.results)) return Promise.resolve(hit.results);
    return enqueue(function () {
      var url = NOMINATIM + "?format=jsonv2&limit=5&addressdetails=1&namedetails=1&accept-language=" + encodeURIComponent("zh,en");
      if (street) url += "&street=" + encodeURIComponent(street);
      if (city) url += "&city=" + encodeURIComponent(city);
      if (postal) url += "&postalcode=" + encodeURIComponent(postal);
      return fetchWithTimeout(url, {
        headers: { Accept: "application/json", "Accept-Language": "zh,en" }
      }).then(function (res) {
        if (!res.ok) throw new Error("timeout-or-http");
        return res.json();
      }).then(function (data) {
        var results = mapResults(data);
        cacheSet(cacheKey, results);
        return results;
      });
    });
  }

  /**
   * 高德 JS API 返回的是 GCJ-02。入库只做这一次转换，得到 WGS-84。
   * 不要对已经转过的结果再调用一次。
   */
  function gcjResultToWgs(lat, lng) {
    lat = Number(lat);
    lng = Number(lng);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (root.GeoUtil && typeof root.GeoUtil.gcj02ToWgs84 === "function") {
      return root.GeoUtil.gcj02ToWgs84(lat, lng);
    }
    return { lat: lat, lng: lng };
  }

  function readAmapLngLat(loc) {
    if (!loc) return null;
    var lng = typeof loc.getLng === "function" ? loc.getLng() : loc.lng;
    var lat = typeof loc.getLat === "function" ? loc.getLat() : loc.lat;
    if (lng == null && Array.isArray(loc) && loc.length >= 2) {
      lng = loc[0];
      lat = loc[1];
    }
    return gcjResultToWgs(lat, lng);
  }

  function mapAmapJsPois(pois, q) {
    var list = [];
    (pois || []).forEach(function (poi) {
      if (!poi) return;
      var pt = readAmapLngLat(poi.location);
      if (!pt) return;
      var name = String(poi.name || "").trim();
      var addr = String(poi.address || poi.district || "").trim();
      list.push({
        lat: pt.lat,
        lng: pt.lng,
        displayName: (name && addr ? name + ", " + addr : name || addr || q || "").trim(),
        name: name,
        class: "",
        type: poi.type || poi.typecode || "",
        city: String(poi.cityname || "").trim(),
        source: "amap",
        coordSystem: "wgs84"
      });
    });
    return list;
  }

  function mapAmapJsTips(tips, q) {
    var list = [];
    (tips || []).forEach(function (tip) {
      if (!tip) return;
      var pt = readAmapLngLat(tip.location);
      if (!pt) return;
      var name = String(tip.name || "").trim();
      var addr = String(tip.address || tip.district || "").trim();
      list.push({
        lat: pt.lat,
        lng: pt.lng,
        displayName: (name && addr ? name + ", " + addr : name || addr || q || "").trim(),
        name: name,
        class: "",
        type: tip.type || tip.typecode || "",
        source: "amap",
        coordSystem: "wgs84"
      });
    });
    return list;
  }

  function ensureAmapJs() {
    if (!amapConfigured()) return Promise.reject(new Error("amap-not-configured"));
    if (root.AMap && (root.AMap.PlaceSearch || root.AMap.plugin)) {
      return Promise.resolve(root.AMap);
    }
    if (typeof document === "undefined") return Promise.reject(new Error("amap-no-document"));
    if (amapLoader) return amapLoader;
    try {
      root._AMapSecurityConfig = { securityJsCode: amapSecurityCode() };
    } catch (err) {}
    amapLoader = new Promise(function (resolve, reject) {
      var done = false;
      function finish(err, value) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (err) {
          amapLoader = null;
          reject(err);
        } else {
          resolve(value);
        }
      }
      var timer = setTimeout(function () {
        finish(new Error("timeout"));
      }, REQUEST_TIMEOUT_MS);
      root.__onAmapReady = function () {
        if (root.AMap) finish(null, root.AMap);
        else finish(new Error("amap-missing"));
      };
      var script = document.createElement("script");
      script.src =
        AMAP_JS +
        "?v=2.0&key=" +
        encodeURIComponent(amapJsKey()) +
        "&plugin=AMap.PlaceSearch,AMap.AutoComplete&callback=__onAmapReady";
      script.async = true;
      script.onerror = function () {
        finish(new Error("amap-load"));
      };
      try {
        document.head.appendChild(script);
      } catch (err) {
        finish(err || new Error("amap-load"));
      }
    });
    return amapLoader;
  }

  function amapPluginSearch(AMapCtor, pluginName, runner) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error("timeout"));
      }, REQUEST_TIMEOUT_MS);
      function go() {
        try {
          runner(function (doneErr, list) {
            clearTimeout(timer);
            if (doneErr) reject(doneErr);
            else resolve(list || []);
          });
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      }
      if (AMapCtor[pluginName]) {
        go();
        return;
      }
      if (typeof AMapCtor.plugin === "function") {
        AMapCtor.plugin(pluginName, function () {
          go();
        });
        return;
      }
      clearTimeout(timer);
      reject(new Error("amap-plugin"));
    });
  }

  function amapPlaceSearch(AMapCtor, q, area) {
    return amapPluginSearch(AMapCtor, "AMap.PlaceSearch", function (done) {
      var searcher = new AMapCtor.PlaceSearch({ pageSize: 5, pageIndex: 1, extensions: "base" });
      var cb = function (status, result) {
        if (status === "complete" && result && result.poiList) {
          done(null, mapAmapJsPois(result.poiList.pois || [], q));
          return;
        }
        if (status === "no_data") {
          done(null, []);
          return;
        }
        done(new Error(status || "amap-search"));
      };
      /* 区域偏好：同样只用 1 位小数的大概中心，20 km 内找；GCJ-02 偏移（<1 km）比四舍五入还小，不另转换 */
      if (area && typeof searcher.searchNearBy === "function") searcher.searchNearBy(q, [area.lng, area.lat], 20000, cb);
      else searcher.search(q, cb);
    });
  }

  function amapAutoComplete(AMapCtor, q) {
    return amapPluginSearch(AMapCtor, "AMap.AutoComplete", function (done) {
      var auto = new AMapCtor.AutoComplete({});
      auto.search(q, function (status, result) {
        if (status === "complete" && result && result.tips) {
          done(null, mapAmapJsTips(result.tips, q));
          return;
        }
        if (status === "no_data") {
          done(null, []);
          return;
        }
        done(new Error(status || "amap-auto"));
      });
    });
  }

  /**
   * 大陆查询在已配置 JS Key 时走高德 PlaceSearch，空结果再试 AutoComplete。
   * 失败、超时或配额错误由调用方回退 Nominatim。
   */
  function amapSearch(query, opts) {
    var q = sanitizeGeocodeQuery(query);
    if (!amapConfigured() || !q) return Promise.resolve([]);
    var area = opts && opts.bias ? biasArea(opts.bias) : null;
    var cacheQ = "amap:" + q + (area ? " @" + area.viewbox : "");
    var hit = cacheGet(cacheQ);
    if (hit && Array.isArray(hit.results)) return Promise.resolve(hit.results);
    return ensureAmapJs()
      .then(function (AMapCtor) {
        return amapPlaceSearch(AMapCtor, q, area).then(function (list) {
          if (list && list.length) return list;
          if (area) return amapPlaceSearch(AMapCtor, q, null).then(function (l2) { return l2 && l2.length ? l2 : amapAutoComplete(AMapCtor, q); });
          return amapAutoComplete(AMapCtor, q);
        });
      })
      .then(function (list) {
        var out = list || [];
        if (out.length) cacheSet(cacheQ, out);
        return out;
      });
  }

  /**
   * 统一搜索：已配置高德且查询像大陆地址时先走 JS API，失败或无结果再退回 Nominatim。
   * 两个配置都为空时只使用 Nominatim，不会加载 webapi.amap.com。
   */
  /** opts.bias = { lat, lng }：只来自行程里的条目（酒店 / 同一天的地点），由 biasArea 先四舍五入 */
  /**
   * 导入查找：先按地址搜，再按店名搜。走 JS API（PlaceSearch / AutoComplete）。
   * 不发送用户位置。没有点则返回 null，继续原来的查找链。
   */
  function amapLookupItem(item, ctx) {
    if (!amapConfigured() || !item) return Promise.resolve(null);
    var name = String(item.nameZh || item.nameEn || item.name || "").trim();
    var addr = String(item.address || "").trim();
    var blob = (addr + " " + name).trim();
    if (!looksMainland(blob)) return Promise.resolve(null);
    var queries = [];
    if (addr) queries.push(addr);
    if (name && name !== addr) queries.push(name);
    if (!queries.length) return Promise.resolve(null);
    var opts = ctx && ctx.city ? { city: ctx.city } : {};
    function next(i) {
      if (i >= queries.length) return Promise.resolve(null);
      return amapSearch(queries[i], opts).then(function (list) {
        var hit = firstAmapHit(list);
        if (hit) return hit;
        return next(i + 1);
      }).catch(function () {
        return next(i + 1);
      });
    }
    return next(0);
  }

  function searchAddress(query, opts) {
    var q = sanitizeGeocodeQuery(query);
    if (!q) return Promise.resolve([]);
    if (amapConfigured() && looksMainland(q)) {
      return amapSearch(q, opts)
        .then(function (list) {
          if (list && list.length) return list;
          return nominatimSearch(q, opts);
        })
        .catch(function () {
          return nominatimSearch(q, opts);
        });
    }
    return nominatimSearch(q, opts);
  }

  /** 结果名字和要找的名字是否对得上（忽略大小写、空格、标点；有一半以上的词相同也算） */
  function nameMatches(want, cand) {
    var norm = function (s) { return String(s || "").toLowerCase().replace(/[\s,.'’\-·()（）]/g, ""); };
    var w = norm(want);
    var unit = root.GeoUtil && root.GeoUtil.isUnitLikeName ? root.GeoUtil.isUnitLikeName : function () { return false; };
    /* 只比名字（店名、namedetails、display_name 第一段且不是单元号），不拿街道地址来凑 */
    var rawNames = [cand && cand.name, cand && cand.nameDetail, cand && String(cand.displayName || "").split(",")[0]]
      .map(function (s) { return String(s || "").trim(); })
      .filter(function (s) { return s && !unit(s); });
    var names = rawNames.map(norm).filter(Boolean);
    if (!w || !names.length) return false;
    for (var i = 0; i < names.length; i++) {
      if (names[i].indexOf(w) !== -1 || w.indexOf(names[i]) !== -1) return true;
    }
    var words = String(want).toLowerCase().split(/[\s,]+/).filter(function (x) { return x.length > 1; });
    if (!words.length) return false;
    var hay = rawNames.join(" ").toLowerCase();
    var hit = words.filter(function (x) { return hay.indexOf(x) !== -1; }).length;
    return hit / words.length >= 0.5;
  }

  function lookupIata(code) {
    if (root.AirportDB && typeof root.AirportDB.lookupAirport === "function") {
      return root.AirportDB.lookupAirport(code);
    }
    return null;
  }

  /**
   * 解析一条行程的坐标。
   * 返回 Promise<{
   *   item, status: 'ok'|'ambiguous'|'none'|'error',
   *   query, candidates: [...],
   *   chosen: {lat,lng,displayName,source}|null,
   *   fromChosen?: same (机票出发机场),
   *   message?: string
   * }>
   */
  /** 两点距离（公里），给「离当天其他地点太远」用 */
  function kmBetween(a, b) {
    var R = 6371;
    var dLat = ((b.lat - a.lat) * Math.PI) / 180;
    var dLng = ((b.lng - a.lng) * Math.PI) / 180;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  var FAR_KM = 50; /* v6.1：当天其他点 50 公里内才自动认 */

  function chosenFrom(r) {
    return { lat: r.lat, lng: r.lng, displayName: r.displayName, city: r.city || "", source: r.source || "nominatim" };
  }

  /**
   * ctx（v5.3，IT老板）：{ city, bias } —— 当天城市文字（item.city）和当天大概区域（酒店 / 同一天条目的坐标）。
   * 只用来搜：名字后补城市、Nominatim viewbox（bounded=1 → 0）。
   * 结果多于 1 个：不替用户选第一个，留在待补，候选给卡片用；只有 1 个但离当天其他地点 > 30 km：也留在待补。
   */
  function resolveItem(item, ctx) {
    ctx = ctx || {};
    var sopts = ctx.bias ? { bias: ctx.bias } : undefined;
    var out = {
      item: item,
      status: "ok",
      query: "",
      candidates: [],
      chosen: null,
      fromChosen: null,
      message: ""
    };

    function already(lat, lng, label, source) {
      if (typeof lat === "number" && typeof lng === "number") {
        return { lat: lat, lng: lng, displayName: label || "", source: source || "stored" };
      }
      return null;
    }

    if (item.type === "flight") {
      var fromHit = lookupIata(item.fromAirport);
      var toHit = lookupIata(item.toAirport);
      if (fromHit) {
        out.fromChosen = {
          lat: fromHit.lat,
          lng: fromHit.lng,
          displayName: fromHit.nameZh || fromHit.name,
          source: "iata"
        };
      }
      if (fromHit) {
        item.fromNameZh = fromHit.nameZh || item.fromNameZh;
        item.fromNameEn = fromHit.name || item.fromNameEn;
        item.fromLat = fromHit.lat;
        item.fromLng = fromHit.lng;
      }
      if (toHit) {
        item.nameZh = toHit.nameZh || item.nameZh;
        item.nameEn = toHit.name || item.nameEn;
        out.chosen = {
          lat: toHit.lat,
          lng: toHit.lng,
          displayName: toHit.nameZh || toHit.name,
          source: "iata"
        };
        out.status = "ok";
        out.query = item.toAirport;
        if (fromHit) return Promise.resolve(out);
      }

      var pending = [];
      if (!fromHit && item.fromAirport) {
        pending.push(
          nominatimSearch(item.fromAirport + " airport").then(function (list) {
            return { end: "from", list: list, code: item.fromAirport };
          })
        );
      }
      if (!toHit && item.toAirport) {
        pending.push(
          nominatimSearch(item.toAirport + " airport").then(function (list) {
            return { end: "to", list: list, code: item.toAirport };
          })
        );
      }
      if (!pending.length) return Promise.resolve(out);

      return Promise.all(
        pending.map(function (p) {
          return p.catch(function (err) {
            return { error: err, end: "to" };
          });
        })
      ).then(function (parts) {
        parts.forEach(function (part) {
          if (!part || part.error) {
            if (!out.message && part && part.error) out.message = FRIENDLY_NOT_FOUND;
            return;
          }
          var list = part.list || [];
          if (part.end === "from") {
            out.fromCandidates = list;
            /* v5.3：多个结果不替用户选 */
            if (list.length === 1) {
              var f = list[0];
              if (f) {
                out.fromChosen = {
                  lat: f.lat,
                  lng: f.lng,
                  displayName: f.displayName,
                  source: "nominatim"
                };
              }
            }
            if (list.length !== 1 && !fromHit) {
              /* 出发机场不确定不影响本条作为到达点的导入 */
            }
          } else {
            out.candidates = list;
            out.query = part.code + " airport";
            if (list.length === 1) {
              out.chosen = {
                lat: list[0].lat,
                lng: list[0].lng,
                displayName: list[0].displayName,
                source: "nominatim"
              };
              out.status = "ok";
            } else if (list.length > 1) {
              out.status = "ambiguous";
              out.message = "找到 " + list.length + " 个候选，请确认到达机场";
            } else if (!out.chosen) {
              out.status = "none";
              out.message = "未找到机场「" + part.code + "」的坐标";
            }
          }
        });
        return out;
      });
    }

    if (isGround(item)) return resolveGround(item, ctx, out);

    /* 酒店 / 地点：已有坐标则直接用；否则按地址或名称搜索 */
    if (typeof item.lat === "number" && typeof item.lng === "number") {
      out.chosen = already(item.lat, item.lng, item.address || item.nameZh || "", "stored");
      return Promise.resolve(out);
    }

    function pushQuery(arr, q) {
      q = String(q || "").replace(/\s+/g, " ").trim();
      if (q && arr.indexOf(q) === -1) arr.push(q);
    }
    function stripPostcode(addr) {
      return String(addr || "")
        .replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi, "")
        .replace(/,\s*,/g, ",")
        .replace(/[\s,]+$/g, "")
        .trim();
    }
    var name = (item.nameZh || item.nameEn || "").trim();
    var addr = (item.address && String(item.address).trim()) || "";
    /* v6.1 导入：统一走 Lookup（地点库 → 结构化地址 → 邮编 → 附带的点）。绝不按店名搜。 */
    if (root.Lookup && typeof root.Lookup.lookup === "function") {
      return root.Lookup.lookup(item, ctx).then(function (res) {
        if (res && res.needsConfirm) {
          out.status = "none";
          out.chosen = null;
          out.message = "";
          return out;
        }
        if (res && isFinite(res.lat) && isFinite(res.lng)) {
          out.chosen = { lat: res.lat, lng: res.lng, displayName: res.address || addr || name, source: res.source || "lookup" };
          out.status = "ok";
          out.autoLocated = false;
          item.locSource = res.source || "";
          return out;
        }
        out.status = "none";
        out.message = "";
        return out;
      });
    }

    var queries = [];
    if (name && addr) pushQuery(queries, name + ", " + addr);
    function stripArticle(n) {
      return String(n || "").replace(/^(the|le|la|el|les|los|an|a)\s+/i, "").trim();
    }
    if (item.type === "hotel" && name && !/hotel|饭店|酒店|旅館|旅馆/i.test(name)) {
      var bare = stripArticle(name) || name;
      [name, bare].forEach(function (n) {
        if (!n) return;
        pushQuery(queries, n + " Hotel, " + addr);
        pushQuery(queries, n + " Hotel, " + stripPostcode(addr));
        pushQuery(queries, n + " Hotel " + stripPostcode(addr));
      });
    }
    if (addr) pushQuery(queries, addr);
    if (addr && stripPostcode(addr) !== addr) {
      pushQuery(queries, stripPostcode(addr));
      if (name) pushQuery(queries, name + ", " + stripPostcode(addr));
    }
    /* 只有名字（地址就是名字）时，先搜「名字 + 当天城市」 */
    if (name && ctx.city && (!addr || addr === name)) {
      var cq = cityQuery(name, ctx.city);
      if (cq) {
        /* 「名字 + 城市」排第一，去掉「名字, 名字」这种没用的组合 */
        queries = [cq].concat(queries.filter(function (q) { return q !== name && q !== addr && q !== name + ", " + addr; }));
      }
    }
    if (name) pushQuery(queries, name);
    if (item.type === "hotel" && name && !/hotel|饭店|酒店/i.test(name)) {
      pushQuery(queries, name + " Hotel");
      var bare2 = name.replace(/^(the|le|la|el|les|los|an|a)\s+/i, "").trim();
      if (bare2 && bare2 !== name) pushQuery(queries, bare2 + " Hotel");
    }
    out.query = queries[0] || "";
    if (!queries.length) {
      out.status = "none";
      out.message = "没有可供搜索的地址或名称";
      return Promise.resolve(out);
    }

    function searchNext(i) {
      if (i >= queries.length) {
        return Promise.resolve([]);
      }
      out.query = queries[i];
      return searchAddress(queries[i], sopts).then(function (list) {
        if (list && list.length) return list;
        return searchNext(i + 1);
      });
    }

    return searchNext(0).then(function (list) {
      out.candidates = list;
      /* v6.1：唯一且对得上才自动用；拿不准（多个、太远、名字或城市对不上）才问。 */
      var F = root.FixCand;
      var itemForMatch = item;
      var classified = null;
      if (F && F.classifyCandidates) {
        classified = F.classifyCandidates(itemForMatch, list, ctx);
      }
      if (classified && classified.kind === "auto") {
        out.candidates = classified.list;
        out.chosen = chosenFrom(classified.chosen);
        out.status = "ok";
        out.autoLocated = true;
      } else if (classified && classified.kind === "far") {
        out.candidates = classified.list;
        out.chosen = null;
        out.status = "far";
        out.message = "";
      } else if (classified && classified.kind === "ask") {
        out.candidates = classified.list;
        out.chosen = null;
        out.status = "ambiguous";
        out.message = "";
      } else if (list.length === 1 && name && !nameMatches(name, list[0])) {
        out.chosen = null;
        out.status = "ambiguous";
        out.message = "";
      } else if (list.length === 1 && ctx.bias && isFinite(ctx.bias.lat) && kmBetween(ctx.bias, list[0]) > FAR_KM) {
        out.chosen = null;
        out.status = "far";
        out.message = "";
      } else if (list.length === 1) {
        out.chosen = chosenFrom(list[0]);
        out.status = "ok";
        out.autoLocated = true;
      } else if (list.length > 1) {
        out.chosen = null;
        out.status = "ambiguous";
        out.message = "";
      } else {
        out.status = "none";
        out.message = FRIENDLY_NOT_FOUND;
      }
      return out;
    }).catch(function () {
      out.status = "none";
      out.message = FRIENDLY_NOT_FOUND;
      return out;
    });
  }

  /**
   * v6 火车 / 船 / 大巴：按站名搜。出发站带上当天城市和当天区域；到达站多半在别的城市，只搜站名。
   * 只有 1 个结果，或几个结果都挤在 2 公里内，才用；否则只留名字（地图上不画这一段）。
   * 永远返回 status "ok"：交通没有导航按钮，不进「待补」，不催用户。
   */
  function pickStation(list) {
    if (!list || !list.length) return null;
    var first = list[0];
    var close = list.every(function (r) { return kmBetween(first, r) <= 2; });
    return list.length === 1 || close ? first : null;
  }
  function searchStation(name, city, bias) {
    var n = String(name || "").trim();
    if (!n) return Promise.resolve(null);
    var opts = bias ? { bias: bias } : undefined;
    var cq = city ? cityQuery(n, city) : "";
    var first = cq ? searchAddress(cq, opts) : searchAddress(n, opts);
    return first.then(function (list) {
      var hit = pickStation(list);
      if (hit || !cq) return hit;
      return searchAddress(n, opts).then(pickStation);
    }).catch(function () {
      return null;
    });
  }
  function resolveGround(item, ctx, out) {
    var needFrom = typeof item.fromLat !== "number";
    var needTo = typeof item.lat !== "number";
    var fromP = needFrom ? searchStation(item.fromNameZh, ctx.city, ctx.bias) : Promise.resolve(null);
    return fromP.then(function (f) {
      if (f) out.fromChosen = { lat: f.lat, lng: f.lng, displayName: f.displayName, source: f.source || "nominatim" };
      return needTo ? searchStation(item.nameZh, "", null) : null;
    }).then(function (t) {
      if (t) out.chosen = { lat: t.lat, lng: t.lng, displayName: t.displayName, source: t.source || "nominatim" };
      out.status = "ok";
      out.message = "";
      return out;
    }, function () {
      out.status = "ok";
      out.message = "";
      return out;
    });
  }

  function applyChoice(item, chosen, fromChosen) {
    if (chosen && typeof chosen.lat === "number") {
      item.lat = chosen.lat;
      item.lng = chosen.lng;
      if (item.type !== "flight" && !isGround(item) && chosen.city && String(chosen.city).trim()) item.city = String(chosen.city).trim();
    }
    if ((item.type === "flight" || isGround(item)) && fromChosen && typeof fromChosen.lat === "number") {
      item.fromLat = fromChosen.lat;
      item.fromLng = fromChosen.lng;
    }
    return item;
  }

  /**
   * ctxFor(item)（v5.3）：每条搜之前现算当天城市 + 区域；酒店先搜，后面的地点就能用上刚找到的酒店位置。
   * 返回的结果顺序和 items 一样。
   */
  function resolveAll(items, onEach, ctxFor) {
    var list = items || [];
    var results = new Array(list.length);
    var order = list.map(function (it, k) { return k; });
    order.sort(function (a, b) {
      var ha = list[a] && list[a].type === "hotel" ? 0 : 1;
      var hb = list[b] && list[b].type === "hotel" ? 0 : 1;
      return ha - hb || a - b;
    });
    var i = 0;
    function next() {
      if (i >= order.length) return Promise.resolve(results);
      var idx = order[i];
      var item = list[idx];
      i += 1;
      var ctx = null;
      try {
        ctx = typeof ctxFor === "function" ? ctxFor(item) : null;
      } catch (err) {
        ctx = null;
      }
      return resolveItem(item, ctx)
        .then(function (res) {
          if (res.chosen) applyChoice(item, res.chosen, res.fromChosen);
          results[idx] = res;
          if (typeof onEach === "function") onEach(res, idx, list.length);
          return next();
        })
        .catch(function (err) {
          var fail = {
            item: item,
            status: "none",
            query: "",
            candidates: [],
            chosen: null,
            message: FRIENDLY_NOT_FOUND
          };
          results[idx] = fail;
          if (typeof onEach === "function") onEach(fail, idx, list.length);
          return next();
        });
    }
    return next();
  }

  /* ---------- v5.2 搜不到时自动补上这趟的城市再搜 ---------- */
  /** 「名字 + 城市」；名字里已经有这个城市就返回空（不重复搜） */
  function cityQuery(query, city) {
    var q = String(query || "").trim();
    var c = String(city || "").trim();
    if (!q || !c) return "";
    if (q.toLowerCase().indexOf(c.toLowerCase()) !== -1) return "";
    return q + " " + c;
  }

  /** 合并两次搜索结果，按坐标去重；prefer=true 时带城市的结果排前面 */
  function mergeCityResults(plain, withCity, preferCity) {
    var first = preferCity ? withCity || [] : plain || [];
    var second = preferCity ? plain || [] : withCity || [];
    var seen = {};
    var out = [];
    first.concat(second).forEach(function (r) {
      if (!r || !isFinite(r.lat) || !isFinite(r.lng)) return;
      var k = Number(r.lat).toFixed(4) + "," + Number(r.lng).toFixed(4);
      if (seen[k]) return;
      seen[k] = true;
      out.push(r);
    });
    return out;
  }

  /**
   * 先搜原词；没结果（或 opts.prefer：补地址时）再搜一次，合并：
   * 第二次用「原词 + 那天的城市」（知道城市才加），并带上那天的大概区域 opts.bias（知道才带）。两样都没有就不重搜。
   * opts.search 可替换搜索函数（检查脚本用假数据）。返回 { results, usedCity, cityQuery }。
   */
  function searchWithCity(query, city, opts) {
    opts = opts || {};
    /* 运行时再取 api.searchAddress，方便检查 / 截图时换成假数据 */
    var search = opts.search || function (q, so) { return api.searchAddress(q, so); };
    var area = opts.bias ? biasArea(opts.bias) : null;
    var cq = cityQuery(query, city) || (area ? String(query || "").trim() : "");
    var safe = function (q, so) {
      try {
        return Promise.resolve(so ? search(q, so) : search(q)).then(function (l) { return l || []; }, function () { return null; });
      } catch (err) {
        return Promise.resolve(null);
      }
    };
    return safe(query).then(function (plain) {
      var failed = plain === null;
      plain = plain || [];
      if (!cq || (!opts.prefer && plain.length)) {
        if (failed && !cq) return Promise.reject(new Error("search failed"));
        return { results: plain, usedCity: false, cityQuery: "" };
      }
      return safe(cq, area ? { bias: { lat: area.lat, lng: area.lng } } : null).then(function (wc) {
        if (failed && wc === null) return Promise.reject(new Error("search failed"));
        wc = wc || [];
        return { results: mergeCityResults(plain, wc, !!opts.prefer), usedCity: wc.length > 0, cityQuery: cq };
      });
    });
  }

  var api = {
    cityQuery: cityQuery,
    FAR_KM: FAR_KM,
    kmBetween: kmBetween,
    mergeCityResults: mergeCityResults,
    searchWithCity: searchWithCity,
    biasArea: biasArea,
    CACHE_KEY: CACHE_KEY,
    nominatimSearch: nominatimSearch,
    nominatimStructured: nominatimStructured,
    searchAddress: searchAddress,
    amapSearch: amapSearch,
    amapConfigured: amapConfigured,
    looksMainland: looksMainland,
    amapLookupItem: amapLookupItem,
    amapRestConfigured: amapRestConfigured,
    amapRestSearch: amapRestSearch,
    amapRestLookupItem: amapRestLookupItem,
    amapRestPlaceText: amapRestPlaceText,
    amapRestInputTips: amapRestInputTips,
    amapRestGeocode: amapRestGeocode,
    parseAmapLocation: parseAmapLocation,
    chineseCityHint: chineseCityHint,
    gcjResultToWgs: gcjResultToWgs,
    mapAmapJsPois: mapAmapJsPois,
    FRIENDLY_NOT_FOUND: FRIENDLY_NOT_FOUND,
    sanitizeGeocodeQuery: sanitizeGeocodeQuery,
    lookupIata: lookupIata,
    resolveItem: resolveItem,
    nameMatches: nameMatches,
    mapResults: mapResults,
    resolveAll: resolveAll,
    applyChoice: applyChoice,
    guessType: function (input, typ) {
      return root.GuessType && GuessType.guessType ? GuessType.guessType(input, typ) : "地点";
    },
    cacheGet: cacheGet,
    getCache: getCache,
    setCacheAll: setCacheAll
  };

  root.Geocode = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
