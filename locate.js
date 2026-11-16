/**
 * 地图「定位到我」按钮。只在用户点按钮时调用一次 getCurrentPosition；打开网页时不请求，也不持续追踪（不用 watchPosition）。
 * 隐私：位置只放在本文件的内存变量里，不写 localStorage、不发到任何地方、不进分享 / 备份文件。
 * 中国大陆 + 地图用的是 GCJ-02 底图（高德）时，先把 WGS-84 转成 GCJ-02 再画；OSM 底图直接用 WGS-84。
 * 浏览器里是 window.LocateMe；node 里 require("./locate.js")。
 */
(function (root) {
  "use strict";

  var OPTIONS = { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 };
  var MSG_FAIL = "没拿到位置，可以在手机设置里允许浏览器使用定位";
  var MSG_NO_API = "这个浏览器不支持定位";
  var FLY_ZOOM = 15;

  /** 定位出错时的提示（拒绝授权和其他失败用同一句，按 IT老板定稿）。 */
  function errorMessage(err) {
    if (err === "no-api") return MSG_NO_API;
    return MSG_FAIL;
  }

  /** 错误是否是“没给权限”（按钮变灰）。 */
  function isDenied(err) {
    return !!(err && err.code === 1);
  }

  /**
   * 地图上要画的位置。tileKind: "osm"（WGS-84）或 "gcj02"（高德等）。
   * 只有在中国大陆（不含港澳台）且底图是 GCJ-02 时才转换。
   */
  function displayPoint(lat, lng, tileKind, geo) {
    geo = geo || root.GeoUtil;
    if (tileKind === "gcj02" && geo && geo.inMainlandChina(lat, lng)) {
      var p = geo.wgs84ToGcj02(lat, lng);
      return { lat: p.lat, lng: p.lng, converted: true };
    }
    return { lat: lat, lng: lng, converted: false };
  }

  /**
   * 请求一次位置。nav 是 navigator（测试时传假的）。
   * 回调 done({ ok, lat, lng, accuracy, denied, message })。
   */
  function requestPosition(nav, done) {
    var g = nav && nav.geolocation;
    if (!g || typeof g.getCurrentPosition !== "function") {
      done({ ok: false, denied: false, message: errorMessage("no-api") });
      return;
    }
    g.getCurrentPosition(
      function (pos) {
        var c = (pos && pos.coords) || {};
        done({ ok: true, lat: c.latitude, lng: c.longitude, accuracy: c.accuracy || 0 });
      },
      function (err) {
        done({ ok: false, denied: !!(err && err.code === 1), message: errorMessage(err) });
      },
      OPTIONS
    );
  }

  var api = {
    OPTIONS: OPTIONS,
    MSG_FAIL: MSG_FAIL,
    MSG_NO_API: MSG_NO_API,
    FLY_ZOOM: FLY_ZOOM,
    errorMessage: errorMessage,
    isDenied: isDenied,
    displayPoint: displayPoint,
    requestPosition: requestPosition,
    /* v5.2：导航选高德还是 Google 时，没坐标的地点参考「你现在在哪」。只读内存里的值，从不主动定位。 */
    lastPoint: function () { return lastHere ? { lat: lastHere.lat, lng: lastHere.lng } : null; },
    warmIfGranted: warmIfGranted
  };

  /**
   * v5.2：展开一张没坐标的卡片时用。只有浏览器里定位权限已经是「允许」（granted）时才取一次位置——
   * 这时系统不会弹窗；没允许过 / 拒绝过 / 不支持权限查询，就什么都不做（绝不弹定位请求）。
   * 位置只放在内存 lastHere，不保存、不上传、不进链接。每次打开页面最多试一次。
   */
  var warmTried = false;
  function warmIfGranted(onReady) {
    if (lastHere || warmTried) return;
    var nav = root.navigator;
    if (!nav || !nav.permissions || typeof nav.permissions.query !== "function" || !nav.geolocation) return;
    warmTried = true;
    nav.permissions.query({ name: "geolocation" }).then(function (st) {
      if (!st || st.state !== "granted") return;
      requestPosition(nav, function (res) {
        if (!res.ok) return;
        lastHere = { lat: res.lat, lng: res.lng };
        if (typeof onReady === "function") onReady();
      });
    }, function () {});
  }
  var lastHere = null;
  root.LocateMe = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  if (typeof document === "undefined") return;

  /* ---------- 页面接线（位置只在这几个内存变量里） ---------- */
  var dot = null;
  var ring = null;
  var busy = false;

  function btn() {
    return document.getElementById("locate-btn");
  }

  function setState(state) {
    var b = btn();
    if (!b) return;
    b.classList.remove("is-locating", "is-active", "is-denied");
    if (state) b.classList.add("is-" + state);
    b.setAttribute("aria-busy", state === "locating" ? "true" : "false");
  }

  function toast(msg) {
    if (root.TripApp && root.TripApp.toast) root.TripApp.toast(msg);
  }

  function getMap() {
    return root.TripApp && root.TripApp.getMap ? root.TripApp.getMap() : null;
  }

  function show(res) {
    var map = getMap();
    if (!map || typeof L === "undefined") return;
    var kind = root.TripApp && root.TripApp.mapTileKind ? root.TripApp.mapTileKind() : "osm";
    var p = displayPoint(res.lat, res.lng, kind);
    var ll = [p.lat, p.lng];
    if (!ring) {
      ring = L.circle(ll, { radius: res.accuracy || 0, stroke: false, fillColor: "#4C8DFF", fillOpacity: 0.15, interactive: false });
      ring.addTo(map);
    } else {
      ring.setLatLng(ll);
      ring.setRadius(res.accuracy || 0);
    }
    if (!dot) {
      dot = L.marker(ll, {
        icon: L.divIcon({ className: "me-dot-wrap", html: '<div class="me-dot"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
        keyboard: false,
        interactive: false,
        title: "我的位置"
      });
      dot.addTo(map);
    } else {
      dot.setLatLng(ll);
    }
    var reduce = false;
    try {
      reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (err) {}
    if (reduce || !map.flyTo) map.setView(ll, FLY_ZOOM);
    else map.flyTo(ll, FLY_ZOOM, { duration: 0.8 });
    setState("active");
    map.once("dragstart", function () {
      var b = btn();
      if (b && b.classList.contains("is-active")) setState("");
    });
  }

  function onTap() {
    if (busy) return;
    busy = true;
    setState("locating");
    requestPosition(window.navigator, function (res) {
      busy = false;
      if (res.ok) {
        lastHere = { lat: res.lat, lng: res.lng };
        show(res);
        return;
      }
      setState(res.denied ? "denied" : "");
      toast(res.message);
    });
  }

  function bind() {
    var b = btn();
    if (!b || b.getAttribute("data-bound") === "1") return;
    b.setAttribute("data-bound", "1");
    b.addEventListener("click", onTap);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})(typeof window !== "undefined" ? window : globalThis);
