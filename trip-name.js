/**
 * v5.2 行程名：默认名、起名建议（只在本机算，不联网）、「只问一次」的状态键。
 * 起名建议的城市来源，按顺序：去程航班的到达机场（airports.js 的 cityZh）→ 第一家酒店地址里能可靠认出的城市 → 只用日期。
 * 只有用户点「就用这个」才会改名，这里只给文字。
 */
(function (root) {
  "use strict";
  /* v6：火车 / 船 / 大巴跟机票一样按「出发 ~ 到达」处理，见 transport.js */
  var Transport = root.Transport || (typeof require === "function" ? require("./transport.js") : null);
  function isTransit(item) {
    return Transport ? Transport.isTransit(item) : !!item && item.type === "flight";
  }

  var DEFAULT_NAME = "我的行程";
  var ASKED_KEY = "wishlist-map-name-suggest-asked-v1";
  var RENAMED_KEY = "wishlist-map-trip-renamed-v1";
  var COPY = {
    hint: "点这里起名",
    ask: "给这趟起个名字：{name}？",
    yes: "就用这个",
    self: "我自己改",
    done: "完成"
  };

  function airports() {
    if (root.AirportDB && root.AirportDB.AIRPORTS) return root.AirportDB.AIRPORTS;
    try {
      if (typeof require === "function") return require("./airports.js").AIRPORTS;
    } catch (err) {}
    return {};
  }

  function isDefaultName(name) {
    var n = String(name == null ? "" : name).trim();
    return !n || n === DEFAULT_NAME;
  }

  function isYmd(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  }

  function itemDates(it) {
    if (!it || it.pendingDate) return [];
    var out = [];
    if (isTransit(it)) out.push(it.departDate, it.arriveDate);
    else if (it.type === "hotel") out.push(it.checkIn, it.checkOut);
    else out.push(it.date);
    return out.filter(isYmd);
  }

  function tripRange(items) {
    var all = [];
    (items || []).forEach(function (it) { all = all.concat(itemDates(it)); });
    if (!all.length) return null;
    all.sort();
    return { from: all[0], to: all[all.length - 1] };
  }

  function md(ymd) {
    return { m: Number(ymd.slice(5, 7)), d: Number(ymd.slice(8, 10)) };
  }

  /** 12月1日–10日；跨月 12月28日–1月3日；同一天 12月1日 */
  function rangeText(r) {
    if (!r) return "";
    var a = md(r.from);
    var b = md(r.to);
    var head = a.m + "月" + a.d + "日";
    if (r.from === r.to) return head;
    if (a.m === b.m && r.from.slice(0, 4) === r.to.slice(0, 4)) return head + "–" + b.d + "日";
    return head + "–" + b.m + "月" + b.d + "日";
  }

  function outboundCity(items) {
    var flights = (items || []).filter(function (it) {
      return it && it.type === "flight" && !it.pendingDate && isYmd(it.departDate);
    });
    if (!flights.length) return "";
    flights.sort(function (x, y) {
      var a = x.departDate + " " + (x.departTime || "");
      var b = y.departDate + " " + (y.departTime || "");
      return a < b ? -1 : a > b ? 1 : 0;
    });
    var code = String(flights[0].toAirport || "").trim().toUpperCase();
    var ap = airports()[code];
    return (ap && ap.cityZh) || "";
  }

  var ZH_CITY_RE = /^(?:中国|日本|韩国)?(?:[\u4e00-\u9fa5]{2,6}?(?:省|自治区))?([\u4e00-\u9fa5]{2,4}?)(?:都|府|市)(?=[\u4e00-\u9fa5]|$)/;

  /** 第一家酒店（按入住日期）地址里的城市；认不准就返回空 */
  function hotelCity(items) {
    var hotels = (items || []).filter(function (it) { return it && it.type === "hotel" && it.address; });
    if (!hotels.length) return "";
    hotels.sort(function (x, y) {
      var a = x.checkIn || "9999";
      var b = y.checkIn || "9999";
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return cityOfAddress(hotels[0].address);
  }

  function enByZh() {
    var out = {};
    var A = airports();
    Object.keys(A).forEach(function (k) {
      if (A[k].city && A[k].cityZh && !out[A[k].cityZh]) out[A[k].cityZh] = A[k].city;
    });
    return out;
  }

  /** 地址里的城市（中文名）；中文看「XX都/府/市」，英文按逗号拆开、某段正好是已知城市英文名才算；认不准返回空 */
  function cityOfAddress(address) {
    var addr = String(address || "").trim();
    if (!addr) return "";
    var m = addr.match(ZH_CITY_RE);
    if (m && m[1] && !/[区县町村]$/.test(m[1])) return m[1];
    var byEn = {};
    var E = enByZh();
    Object.keys(E).forEach(function (zh) { byEn[E[zh].toLowerCase()] = zh; });
    var parts = addr.split(/[,，]/).map(function (p) {
      return p.replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i, "").replace(/\d+/g, "").trim().toLowerCase();
    });
    for (var i = parts.length - 1; i >= 0; i--) {
      if (byEn[parts[i]]) return byEn[parts[i]];
    }
    return "";
  }

  function hasCoords(it) {
    return it && typeof it.lat === "number" && typeof it.lng === "number" && isFinite(it.lat) && isFinite(it.lng);
  }

  /** 一条的城市：只认地图服务存下的 item.city（v5.2）。不再按坐标猜城市（不查最近机场、也没有城市表）；没有就返回空 */
  function cityOfItem(it) {
    return it && typeof it.city === "string" ? it.city.trim() : "";
  }

  function minutes(t) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(t || ""));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  function hotelOfDay(list, day, opts) {
    return list.filter(function (it) {
      return it && it.type === "hotel" && it.id !== opts.excludeId && isYmd(it.checkIn) && it.checkIn <= day &&
        (isYmd(it.checkOut) ? day < it.checkOut : day === it.checkIn);
    });
  }

  /** 同一天的其他地点（不含航班、酒店），时间离 opts.time 最近的排前面 */
  function sameDayItems(list, day, opts, keep) {
    var want = minutes(opts.time);
    var same = list.filter(function (it) {
      return it && it.id !== opts.excludeId && !isTransit(it) && it.type !== "hotel" && it.date === day && keep(it);
    });
    same.sort(function (x, y) {
      var a = minutes(x.time);
      var b = minutes(y.time);
      var da = want == null || a == null ? 9999 : Math.abs(a - want);
      var db = want == null || b == null ? 9999 : Math.abs(b - want);
      return da - db;
    });
    return same;
  }

  /**
   * v5.2 某一天所在的城市（给搜索重试补文字用）。城市只来自地图服务存下的 item.city：
   * 1. 那天住的酒店（入住 ≤ 当天 < 退房）的 city
   * 2. 同一天其他带 city 的条目（时间最接近的优先）
   * 都没有就返回 null（什么都不补；猜错城市比不补更糟，IT老板 定）。
   * opts: { excludeId, time }。返回 { query, source } 或 null。
   */
  function dayCity(items, day, opts) {
    opts = opts || {};
    var list = items || [];
    if (!isYmd(day)) return null;
    var hotels = hotelOfDay(list, day, opts);
    for (var h = 0; h < hotels.length; h++) {
      var hc = cityOfItem(hotels[h]);
      if (hc) return { query: hc, source: "hotel" };
    }
    var same = sameDayItems(list, day, opts, function (it) { return !!cityOfItem(it); });
    if (same.length) return { query: cityOfItem(same[0]), source: "same-day" };
    return null;
  }

  /**
   * v5.2 某一天的大概区域中心（给搜索的区域偏好用）：那天酒店的坐标，否则同一天时间最近的带坐标条目。
   * 这里返回原坐标，只在本机用；发出去之前 Geocode.biasArea 会四舍五入到 1 位小数。没有返回 null。
   */
  function dayArea(items, day, opts) {
    opts = opts || {};
    var list = items || [];
    if (!isYmd(day)) return null;
    var hotel = hotelOfDay(list, day, opts).filter(hasCoords)[0];
    var it = hotel || sameDayItems(list, day, opts, hasCoords)[0];
    return it ? { lat: it.lat, lng: it.lng } : null;
  }

  /** 起名建议。返回 { name, text, city, source } 或 null（没有日期时不建议）。 */
  function suggestName(items) {
    var r = tripRange(items);
    if (!r) return null;
    var range = rangeText(r);
    var city = outboundCity(items);
    var source = city ? "flight" : "";
    if (!city) {
      city = hotelCity(items);
      if (city) source = "hotel";
    }
    var name = city ? city + " · " + range : range + "的旅行";
    return { name: name, text: COPY.ask.replace("{name}", name), city: city, source: source || "dates" };
  }

  /** 只在「第一次导入加了东西、名字还是默认、从没问过」时问一次。 */
  function shouldAsk(state) {
    state = state || {};
    if (state.asked) return false;
    if (!(Number(state.addedCount) > 0)) return false;
    return isDefaultName(state.name);
  }

  /**
   * v5.2 搜索补城市：这趟的城市，给地理编码用。
   * 来源同起名建议：去程到达机场 → 第一家酒店地址。返回 { zh, en, query }，query 优先用英文 / 当地名（机场表 city）。认不出返回 null。
   */
  function tripSearchCity(items) {
    var A = airports();
    var zh = outboundCity(items);
    var en = "";
    if (zh) {
      var flights = (items || []).filter(function (it) { return it && it.type === "flight" && !it.pendingDate && isYmd(it.departDate); });
      flights.sort(function (x, y) {
        var a = x.departDate + " " + (x.departTime || "");
        var b = y.departDate + " " + (y.departTime || "");
        return a < b ? -1 : a > b ? 1 : 0;
      });
      var ap = A[String(flights[0].toAirport || "").trim().toUpperCase()];
      en = (ap && ap.city) || "";
    } else {
      zh = hotelCity(items);
      if (!zh) return null;
      en = enByZh()[zh] || "";
    }
    return { zh: zh, en: en, query: en || zh };
  }

  var api = {
    tripSearchCity: tripSearchCity,
    dayCity: dayCity,
    dayArea: dayArea,
    cityOfAddress: cityOfAddress,
    cityOfItem: cityOfItem,
    DEFAULT_NAME: DEFAULT_NAME,
    ASKED_KEY: ASKED_KEY,
    RENAMED_KEY: RENAMED_KEY,
    COPY: COPY,
    isDefaultName: isDefaultName,
    tripRange: tripRange,
    rangeText: rangeText,
    outboundCity: outboundCity,
    hotelCity: hotelCity,
    suggestName: suggestName,
    shouldAsk: shouldAsk
  };
  root.TripName = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
