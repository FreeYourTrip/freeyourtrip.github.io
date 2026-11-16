/**
 * 地理与导航链接工具（无路线计算、无 API Key）。
 * - 坐标在数据里一律按 WGS-84 存放。
 * - 高德链接在中国大陆点上先转成 GCJ-02；境外点保持 WGS-84。
 * - 推荐应用：两端都在中国大陆（不含港澳台）用高德，否则用谷歌地图。
 */
(function (root) {
  "use strict";

  var PI = 3.14159265358979324;
  var A = 6378245.0;
  var EE = 0.00669342162296594323;

  var MODES = [
    { id: "公共交通", google: "transit", amap: "bus" },
    { id: "驾车", google: "driving", amap: "car" },
    { id: "步行", google: "walking", amap: "walk" },
    /* 打车：谷歌无 taxi travelmode，用 driving；高德官方 URI 无 taxi，用 car */
    { id: "打车", google: "driving", amap: "car" }
  ];

  function modeInfo(modeId) {
    var i;
    for (i = 0; i < MODES.length; i++) {
      if (MODES[i].id === modeId) return MODES[i];
    }
    return MODES[0];
  }

  function outOfChinaBBox(lat, lng) {
    return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
  }

  /**
   * 粗略判断是否在中国大陆（用于推荐高德、以及是否做 GCJ-02 转换）。
   * 使用简单包围盒，并排除香港、澳门、台湾；不是官方行政区多边形。
   */
  function inMainlandChina(lat, lng) {
    if (typeof lat !== "number" || typeof lng !== "number") return false;
    if (lng < 73.66 || lng > 135.05 || lat < 18.16 || lat > 53.55) return false;
    /* 台湾 */
    if (lat >= 20.5 && lat <= 25.4 && lng >= 119.3 && lng <= 122.05) return false;
    /* 香港（北界避开深圳市区） */
    if (lat >= 22.13 && lat <= 22.52 && lng >= 113.82 && lng <= 114.5) return false;
    /* 澳门 */
    if (lat >= 22.09 && lat <= 22.25 && lng >= 113.52 && lng <= 113.65) return false;
    return true;
  }

  function transformLat(lng, lat) {
    var ret =
      -100.0 +
      2.0 * lng +
      3.0 * lat +
      0.2 * lat * lat +
      0.1 * lng * lat +
      0.2 * Math.sqrt(Math.abs(lng));
    ret += ((20.0 * Math.sin(6.0 * lng * PI) + 20.0 * Math.sin(2.0 * lng * PI)) * 2.0) / 3.0;
    ret += ((20.0 * Math.sin(lat * PI) + 40.0 * Math.sin((lat / 3.0) * PI)) * 2.0) / 3.0;
    ret += ((160.0 * Math.sin((lat / 12.0) * PI) + 320 * Math.sin((lat * PI) / 30.0)) * 2.0) / 3.0;
    return ret;
  }

  function transformLng(lng, lat) {
    var ret =
      300.0 +
      lng +
      2.0 * lat +
      0.1 * lng * lng +
      0.1 * lng * lat +
      0.1 * Math.sqrt(Math.abs(lng));
    ret += ((20.0 * Math.sin(6.0 * lng * PI) + 20.0 * Math.sin(2.0 * lng * PI)) * 2.0) / 3.0;
    ret += ((20.0 * Math.sin(lng * PI) + 40.0 * Math.sin((lng / 3.0) * PI)) * 2.0) / 3.0;
    ret += ((150.0 * Math.sin((lng / 12.0) * PI) + 300.0 * Math.sin((lng / 30.0) * PI)) * 2.0) / 3.0;
    return ret;
  }

  /** 标准 WGS-84 → GCJ-02。不在转换范围内则原样返回。 */
  function wgs84ToGcj02(lat, lng) {
    if (outOfChinaBBox(lat, lng)) {
      return { lat: lat, lng: lng };
    }
    var dLat = transformLat(lng - 105.0, lat - 35.0);
    var dLng = transformLng(lng - 105.0, lat - 35.0);
    var radLat = (lat / 180.0) * PI;
    var magic = Math.sin(radLat);
    magic = 1 - EE * magic * magic;
    var sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
    dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
    return { lat: lat + dLat, lng: lng + dLng };
  }

  function formatCoord(n) {
    return Number(n).toFixed(6);
  }

  /** 高德单点：中国大陆先转 GCJ-02，其余保持 WGS-84。 */
  function amapCoord(lat, lng) {
    if (inMainlandChina(lat, lng)) return wgs84ToGcj02(lat, lng);
    return { lat: lat, lng: lng };
  }

  function buildGoogleMapsUrl(origin, dest, modeId) {
    var info = modeInfo(modeId);
    return (
      "https://www.google.com/maps/dir/?api=1" +
      "&origin=" +
      formatCoord(origin.lat) +
      "," +
      formatCoord(origin.lng) +
      "&destination=" +
      formatCoord(dest.lat) +
      "," +
      formatCoord(dest.lng) +
      "&travelmode=" +
      info.google
    );
  }

  function buildAmapUrl(origin, dest, modeId) {
    var info = modeInfo(modeId);
    var from = amapCoord(origin.lat, origin.lng);
    var to = amapCoord(dest.lat, dest.lng);
    return (
      "https://uri.amap.com/navigation?from=" +
      formatCoord(from.lng) +
      "," +
      formatCoord(from.lat) +
      "," +
      encodeURIComponent(origin.name || "") +
      "&to=" +
      formatCoord(to.lng) +
      "," +
      formatCoord(to.lat) +
      "," +
      encodeURIComponent(dest.name || "") +
      "&mode=" +
      info.amap +
      "&callnative=1"
    );
  }

  function recommendApp(origin, dest) {
    if (inMainlandChina(origin.lat, origin.lng) && inMainlandChina(dest.lat, dest.lng)) {
      return "amap";
    }
    return "google";
  }

  function buildNavLinks(origin, dest, modeId) {
    return {
      google: buildGoogleMapsUrl(origin, dest, modeId),
      amap: buildAmapUrl(origin, dest, modeId),
      recommended: recommendApp(origin, dest)
    };
  }

  /** 两点直线距离（公里）。不是路线距离，页面不得据此当导航路线。 */
  function haversineKm(a, b) {
    var R = 6371;
    var toRad = function (d) {
      return (d * Math.PI) / 180;
    };
    var dLat = toRad(b.lat - a.lat);
    var dLng = toRad(b.lng - a.lng);
    var s =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  var api = {
    MODES: MODES,
    modeInfo: modeInfo,
    inMainlandChina: inMainlandChina,
    wgs84ToGcj02: wgs84ToGcj02,
    amapCoord: amapCoord,
    formatCoord: formatCoord,
    buildGoogleMapsUrl: buildGoogleMapsUrl,
    buildAmapUrl: buildAmapUrl,
    recommendApp: recommendApp,
    buildNavLinks: buildNavLinks,
    haversineKm: haversineKm
  };

  root.GeoUtil = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
