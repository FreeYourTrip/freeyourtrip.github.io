/**
 * 地理与导航链接工具（无路线计算；高德地理编码 Key 在 config.js，导航链接仍不需要 Key）。
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

  /*
   * v5.2：中国大陆的简化边界多边形（[经度, 纬度]，约 120 个点，精度几十公里，不是官方行政区界线）。
   * 以前只用包围盒，福冈、首尔、平壤等也落在盒子里；现在先过多边形，再排除港澳台。
   */
  var MAINLAND_POLY = [
    [135.1, 48.4], [133.9, 45.6], [132.9, 45.0], [131.1, 44.8], [130.9, 42.6], [130.6, 42.3], [129.7, 42.4],
    [128.9, 42.0], [128.0, 41.5], [126.9, 41.8], [125.4, 40.6], [124.3, 39.85], [121.0, 38.6], [122.2, 40.7],
    [121.1, 40.8], [119.6, 39.9], [118.5, 39.1], [117.7, 38.9], [117.6, 38.4], [119.1, 37.8], [119.9, 37.2],
    [121.4, 37.6], [122.6, 37.4], [122.7, 37.0], [120.4, 36.0], [119.5, 35.3], [119.5, 34.6], [120.9, 33.4],
    [121.9, 32.0], [122.0, 31.6], [122.0, 30.9], [122.4, 29.9], [121.9, 28.6], [121.2, 27.8], [120.5, 27.0],
    [119.9, 26.0], [119.4, 25.2], [118.4, 24.4], [116.9, 23.2], [115.5, 22.7], [114.4, 22.4], [113.6, 22.1],
    [111.9, 21.5], [110.6, 20.9], [110.2, 20.2], [109.7, 20.9], [109.1, 21.4], [108.3, 21.5], [107.9, 21.5],
    [106.7, 22.0], [106.6, 22.9], [105.3, 23.3], [103.9, 22.5], [102.4, 22.6], [101.7, 21.1], [101.1, 21.6],
    [100.1, 21.5], [99.2, 22.1], [99.5, 22.9], [98.6, 24.1], [97.5, 23.9], [97.7, 25.0], [98.7, 25.9],
    [98.7, 27.6], [97.4, 28.3], [95.4, 29.0], [92.0, 27.8], [89.6, 28.2], [88.8, 27.3], [88.1, 27.9],
    [86.0, 27.9], [84.1, 28.6], [82.2, 30.1], [81.1, 30.0], [79.0, 31.0], [78.4, 32.6], [78.3, 34.0],
    [79.0, 35.5], [77.8, 35.5], [76.2, 35.8], [75.0, 36.9], [74.9, 38.4], [73.6, 39.4], [73.9, 39.8],
    [75.5, 40.6], [76.8, 41.0], [78.1, 41.4], [80.2, 42.1], [80.8, 43.2], [80.4, 44.6], [79.9, 44.9],
    [81.6, 45.4], [82.5, 45.6], [83.0, 47.2], [85.6, 47.1], [85.8, 48.4], [87.3, 49.1], [88.9, 48.0],
    [90.4, 47.4], [91.0, 46.0], [90.7, 45.4], [93.5, 44.9], [95.4, 44.3], [96.4, 42.7], [100.0, 42.6],
    [101.8, 42.5], [104.7, 41.7], [106.9, 42.3], [109.3, 42.4], [110.4, 42.8], [111.9, 43.7], [113.6, 44.8],
    [116.7, 46.4], [118.4, 46.7], [119.9, 46.7], [118.5, 47.9], [115.6, 47.9], [116.5, 49.9], [117.9, 49.7],
    [119.9, 51.0], [120.8, 52.4], [122.4, 53.4], [125.0, 53.2], [126.6, 52.0], [127.8, 50.0], [130.6, 48.9],
    [132.5, 47.7], [134.7, 48.3]
  ];
  var HAINAN_POLY = [[108.6, 19.1], [109.5, 18.15], [110.6, 18.4], [111.1, 19.6], [110.6, 20.15], [109.6, 20.05], [108.6, 19.3]];

  function inPoly(lng, lat, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /**
   * 是否在中国大陆（用于推荐高德、以及是否做 GCJ-02 转换）。
   * 简化多边形 + 排除香港、澳门、台湾；日本、韩国、朝鲜、蒙古、越南等都在多边形外。
   */
  function inMainlandChina(lat, lng) {
    if (typeof lat !== "number" || typeof lng !== "number" || !isFinite(lat) || !isFinite(lng)) return false;
    if (lng < 73.4 || lng > 135.2 || lat < 18.0 || lat > 53.6) return false;
    if (!inPoly(lng, lat, MAINLAND_POLY) && !inPoly(lng, lat, HAINAN_POLY)) return false;
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

  /**
   * 标准 GCJ-02 → WGS-84（迭代求逆）。高德返回的是 GCJ-02，入库前要转回 WGS-84。
   * 不在转换范围内则原样返回。
   */
  function gcj02ToWgs84(lat, lng) {
    if (outOfChinaBBox(lat, lng)) {
      return { lat: lat, lng: lng };
    }
    var wgsLat = lat;
    var wgsLng = lng;
    var i;
    for (i = 0; i < 6; i++) {
      var got = wgs84ToGcj02(wgsLat, wgsLng);
      wgsLat -= got.lat - lat;
      wgsLng -= got.lng - lng;
    }
    return { lat: wgsLat, lng: wgsLng };
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
  /**
   * 粗略判断查询词是否像中国大陆地址（含汉字，且不含港澳台常见词）。
   * 用于决定要不要走高德地理编码。
   */
  function looksChineseMainlandQuery(text) {
    var t = String(text || "");
    if (!/[\u3400-\u9fff]/.test(t)) return false;
    if (/香港|澳门|澳門|台湾|台灣|台北|高雄|台中|台南|台东|台東|新北|基隆|九龙|九龍|新界|旺角|铜锣湾|銅鑼灣/.test(t)) {
      return false;
    }
    return true;
  }

  function hasPointCoords(p) {
    return !!(p && typeof p.lat === "number" && typeof p.lng === "number");
  }

  /** 显示用的名字（高德导航终点名等）。 */
  function pointLabel(p) {
    if (!p) return "";
    return String(p.name || p.address || p.airport || "");
  }

  /**
   * v5.2 发给 Google 的地点文字：地址优先。
   * 只发名字（如「Suite X01」这类楼内单元名）或只发坐标（落在某栋楼的某个单元上）时，Google 公交常算不出路线。
   * 顺序：地址 → 坐标 lat,lng → 名字（最后才用）。
   */
  /** 「Suite X01」「Unit 3」「Flat 2B」「12」这类楼内单元 / 门牌号，不能当地点名 */
  function isUnitLikeName(name) {
    var n = String(name || "").trim();
    if (!n) return false;
    if (/^(suite|unit|flat|apt\.?|apartment|room|rm\.?|floor|fl\.?|level|block|bldg\.?|building|no\.?|#)\s*[\w-]{1,6}$/i.test(n)) return true;
    if (/^\d+[a-z]?(\s*[-–]\s*\d+[a-z]?)?$/i.test(n)) return true;
    return false;
  }

  function pointQuery(p) {
    if (!p) return "";
    var addr = String(p.address || "").trim();
    var name = String(p.name || "").trim();
    if (isUnitLikeName(name)) name = "";
    /* 名字 + 地址，让 Google 自己去找这家店（连锁店不会跑去别的分店）。不用「名字 + 城市」。 */
    if (addr && name && addr.toLowerCase().indexOf(name.toLowerCase()) === -1) return name + ", " + addr;
    if (addr) return addr;
    /* 没有地址：用坐标 */
    if (hasPointCoords(p)) return formatCoord(p.lat) + "," + formatCoord(p.lng);
    return name || String(p.airport || "").trim();
  }

  /** 有没有能导航的信息（地址或坐标；机场代码也算） */
  function pointUsable(p) {
    return !!(p && (String(p.address || "").trim() || hasPointCoords(p) || String(p.airport || "").trim()));
  }

  function googleDirUrl(origin, dest, modeId) {
    var info = modeInfo(modeId);
    var url = "https://www.google.com/maps/dir/?api=1";
    /* 不给起点 = 从我现在的位置出发 */
    if (origin && pointQuery(origin)) url += "&origin=" + encodeURIComponent(pointQuery(origin));
    url += "&destination=" + encodeURIComponent(pointQuery(dest));
    url += "&travelmode=" + info.google;
    return url;
  }

  /** v5.2「看位置」：只打开这个地方，不是路线。中国大陆用高德标点 / 搜索，其余用 Google 搜索。 */
  function buildPlaceLink(p, here) {
    if (!p) return { href: "#", app: "google" };
    if (!hasPointCoords(p) && here && hasPointCoords(here) && inMainlandChina(here.lat, here.lng)) {
      return { app: "amap", href: "https://uri.amap.com/search?keyword=" + encodeURIComponent(pointQuery(p)) + "&callnative=1" };
    }
    /* 和导航一样：只有坐标在中国大陆才用高德 */
    if (hasPointCoords(p) && inMainlandChina(p.lat, p.lng)) {
      var g = amapCoord(p.lat, p.lng);
      return {
        app: "amap",
        href: "https://uri.amap.com/marker?position=" + formatCoord(g.lng) + "," + formatCoord(g.lat) +
          "&name=" + encodeURIComponent(pointLabel(p)) + "&callnative=1"
      };
    }
    return { app: "google", href: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(pointQuery(p)) };
  }

  function amapNavUrl(origin, dest, modeId) {
    var info = modeInfo(modeId);
    if (!hasPointCoords(dest)) {
      return (
        "https://uri.amap.com/search?keyword=" +
        encodeURIComponent(pointQuery(dest) || pointLabel(dest)) +
        "&callnative=1"
      );
    }
    var to = amapCoord(dest.lat, dest.lng);
    var url = "https://uri.amap.com/navigation?";
    if (origin && hasPointCoords(origin)) {
      var from = amapCoord(origin.lat, origin.lng);
      url +=
        "from=" +
        formatCoord(from.lng) +
        "," +
        formatCoord(from.lat) +
        "," +
        encodeURIComponent(pointLabel(origin)) +
        "&";
    }
    url +=
      "to=" +
      formatCoord(to.lng) +
      "," +
      formatCoord(to.lat) +
      "," +
      encodeURIComponent(pointLabel(dest)) +
      "&mode=" +
      info.amap +
      "&callnative=1";
    return url;
  }

  /*
   * v5.2：只有「终点有坐标且在中国大陆」（有起点时起点也要在大陆）才用高德；没有坐标一律 Google，
   * 不再看名字里有没有汉字（以前「大阪」「东京」「首尔」没坐标时会因为是汉字而打开高德）。
   */
  /**
   * v5.2 没坐标的地点怎么导航：知道你在哪（内存里的位置）→ "auto"，自动选高德或 Google；
   * 不知道 → "choose"，给「Google 地图」「高德」两个按钮 + 提示。有坐标的地点总是 "auto"。
   */
  function navChoice(dest, here) {
    if (hasPointCoords(dest)) return "auto";
    return here && hasPointCoords(here) ? "auto" : "choose";
  }

  function recommendFlexible(origin, dest, here) {
    /* 终点没坐标：看「你现在在哪」（只用内存里已有的位置，不主动定位）；在中国大陆选高德，其他地方 / 不知道选 Google */
    if (!hasPointCoords(dest)) return here && hasPointCoords(here) && inMainlandChina(here.lat, here.lng) ? "amap" : "google";
    if (!inMainlandChina(dest.lat, dest.lng)) return "google";
    if (origin && hasPointCoords(origin) && !inMainlandChina(origin.lat, origin.lng)) return "google";
    return "amap";
  }

  /** 带我去 / 从我的位置出发：可只有终点；无坐标时用名称或地址文本。 */
  function buildPlaceNavLinks(dest, modeId) {
    return buildFlexibleNavLinks(null, dest, modeId);
  }

  /** 两点连接；任一点缺坐标时退回文本导航。 */
  function buildFlexibleNavLinks(origin, dest, modeId, here) {
    var rec = recommendFlexible(origin, dest, here);
    var google = googleDirUrl(origin, dest, modeId);
    var amap = amapNavUrl(origin, dest, modeId);
    return {
      google: google,
      amap: amap,
      recommended: rec,
      href: rec === "amap" ? amap : google
    };
  }

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
    gcj02ToWgs84: gcj02ToWgs84,
    navChoice: navChoice,
    recommendFlexible: recommendFlexible,
    amapCoord: amapCoord,
    looksChineseMainlandQuery: looksChineseMainlandQuery,
    hasPointCoords: hasPointCoords,
    buildPlaceNavLinks: buildPlaceNavLinks,
    buildFlexibleNavLinks: buildFlexibleNavLinks,
    formatCoord: formatCoord,
    buildGoogleMapsUrl: buildGoogleMapsUrl,
    buildAmapUrl: buildAmapUrl,
    recommendApp: recommendApp,
    buildNavLinks: buildNavLinks,
    haversineKm: haversineKm,
    pointQuery: pointQuery,
    isUnitLikeName: isUnitLikeName,
    pointUsable: pointUsable,
    buildPlaceLink: buildPlaceLink
  };

  root.GeoUtil = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
