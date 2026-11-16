/**
 * 顶部日期条与月历的纯函数（不碰页面）。浏览器里是 window.TripCalendar；node 里 require("./calendar.js")。
 *
 * 规则（都写在这里，改了请同步 DESIGN.md / README）：
 * - 日期条范围：行程最早一天到最晚一天（含酒店退房日），中间没安排的日子也显示。
 *   如果今天离行程不超过 31 天，会把范围延伸到今天，好让「今天」按钮有地方可跳；更远就不延伸，「今天」按钮隐藏。
 * - 打开时默认选中：今天有安排 → 今天；否则今天之后第一个有安排的日子；都过去了 → 最后一个有安排的日子。
 * - 早于今天的日子显示为灰色。
 * - 住宿段：只按酒店算，入住日到退房日（没写退房日就到下一家酒店入住日，再没有就只算入住当天）。
 *   段名用酒店的 city 字段；没有就取地址最后一个逗号后面的部分（去掉邮编和数字）；再没有就用酒店名。
 *   整段都早于今天 → 标「已去」。
 * - 「全部」：日期条最前面一格，点了显示所有日子。
 */
(function (root) {
  "use strict";

  var WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  var EXTEND_TO_TODAY_MAX_DAYS = 31;

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function parse(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m) return null;
    return { y: +m[1], m: +m[2], d: +m[3] };
  }

  function toUtc(iso) {
    var p = parse(iso);
    return p ? Date.UTC(p.y, p.m - 1, p.d) : NaN;
  }

  function fromUtc(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }

  function addDays(iso, n) {
    return fromUtc(toUtc(iso) + n * 86400000);
  }

  function diffDays(a, b) {
    return Math.round((toUtc(b) - toUtc(a)) / 86400000);
  }

  function weekday(iso) {
    var p = parse(iso);
    if (!p) return "";
    return WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
  }

  function shortDate(iso) {
    var p = parse(iso);
    return p ? p.m + "/" + p.d : "";
  }

  function monthLabel(iso) {
    var p = parse(iso);
    return p ? p.y + "年" + p.m + "月" : "";
  }

  /** 一条行程在时间线上属于哪一天（与 legs.js 一致：机票按起飞日，酒店按入住日，其他按 date）。 */
  function displayDate(item) {
    if (!item) return "";
    if (item.type === "flight") return item.departDate || "";
    if (item.type === "hotel") return item.checkIn || "";
    return item.date || "";
  }

  /** 圆点类别：flight / hotel / place（餐厅、景点、街道都算 place，颜色由调用方按类型给）。 */
  function dotKind(item) {
    if (!item) return "place";
    if (item.type === "flight") return "flight";
    if (item.type === "hotel") return "hotel";
    return "place";
  }

  /** 每天的圆点：{ "2026-12-04": [item, item...] }，按 flight、hotel、place 顺序各取一个，最多 3 个。 */
  function itemDotDays(item) {
    var days = [];
    var d = displayDate(item);
    if (parse(d)) days.push(d);
    if (item && item.type === "hotel" && parse(item.checkIn) && parse(item.checkOut) && item.checkIn < item.checkOut) {
      if (days.indexOf(item.checkOut) === -1) days.push(item.checkOut);
    }
    return days;
  }

  function dotsByDay(items) {
    var map = {};
    (items || []).forEach(function (it) {
      itemDotDays(it).forEach(function (d) {
        if (!map[d]) map[d] = {};
        var k = dotKind(it);
        if (!map[d][k]) map[d][k] = it;
      });
    });
    var out = {};
    Object.keys(map).forEach(function (d) {
      out[d] = ["flight", "hotel", "place"].filter(function (k) { return map[d][k]; }).map(function (k) {
        return { kind: k, item: map[d][k] };
      });
    });
    return out;
  }

  function daysWithItems(items) {
    var seen = {};
    (items || []).forEach(function (it) {
      itemDotDays(it).forEach(function (d) { seen[d] = true; });
    });
    return Object.keys(seen).sort();
  }

  /** 日期条显示的连续日期。 */
  function stripDays(items, today) {
    var all = [];
    (items || []).forEach(function (it) {
      var d = displayDate(it);
      if (parse(d)) all.push(d);
      if (it && it.type === "hotel" && parse(it.checkOut)) all.push(it.checkOut);
      if (it && it.type === "flight" && parse(it.arriveDate)) all.push(it.arriveDate);
    });
    if (!all.length) return [];
    all.sort();
    var first = all[0];
    var last = all[all.length - 1];
    if (parse(today)) {
      if (today < first && diffDays(today, first) <= EXTEND_TO_TODAY_MAX_DAYS) first = today;
      if (today > last && diffDays(last, today) <= EXTEND_TO_TODAY_MAX_DAYS) last = today;
    }
    var out = [];
    var cur = first;
    var guard = 0;
    while (cur <= last && guard < 800) {
      out.push(cur);
      cur = addDays(cur, 1);
      guard += 1;
    }
    return out;
  }

  /** 打开时默认选中的日子；没有任何安排时返回 "all"。 */
  function defaultDay(items, today) {
    var withItems = daysWithItems(items);
    if (!withItems.length) return "all";
    if (!parse(today)) return withItems[0];
    if (withItems.indexOf(today) !== -1) return today;
    for (var i = 0; i < withItems.length; i++) {
      if (withItems[i] > today) return withItems[i];
    }
    return withItems[withItems.length - 1];
  }

  function isPast(iso, today) {
    return !!(parse(iso) && parse(today) && iso < today);
  }

  function cityFrom(item) {
    if (!item) return "";
    if (item.city && String(item.city).trim()) return String(item.city).trim();
    var addr = String(item.address || "").trim();
    if (addr.indexOf(",") !== -1 || addr.indexOf("，") !== -1) {
      var parts = addr.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
      for (var i = parts.length - 1; i >= 0; i--) {
        var cleaned = parts[i]
          .replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi, "")
          .replace(/\d+/g, "")
          .replace(/[-–—#/·.]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (cleaned && !/^(uk|united kingdom|japan|china|france|italy|中国|日本)$/i.test(cleaned)) return cleaned;
      }
    }
    return item.nameZh || item.nameEn || "住宿";
  }

  /**
   * 住宿段：[{ label, city, start, end, past, itemId }]，按开始日期排序。
   * end 为最后一天（含退房日），用于横条跨度。
   */
  function deriveSegments(items, today) {
    var hotels = (items || []).filter(function (it) {
      return it && it.type === "hotel" && parse(it.checkIn);
    }).slice().sort(function (a, b) {
      return a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : 0;
    });
    return hotels.map(function (h, i) {
      var end = h.checkIn;
      if (parse(h.checkOut) && h.checkOut >= h.checkIn) end = h.checkOut;
      else if (hotels[i + 1] && hotels[i + 1].checkIn > h.checkIn) end = hotels[i + 1].checkIn;
      var city = cityFrom(h);
      var range = shortDate(h.checkIn) + (end !== h.checkIn ? "–" + shortDate(end) : "");
      var past = parse(today) ? end < today : false;
      return {
        itemId: h.id,
        city: city,
        start: h.checkIn,
        end: end,
        past: past,
        label: city + " · " + range + (past ? " · 已去" : "")
      };
    });
  }

  /**
   * 月历：返回 { label, year, month, weeks: [[{ iso, day, inMonth }...7]...] }，周一开头，固定 6 行。
   */
  function monthGrid(year, month) {
    var firstIso = year + "-" + pad2(month) + "-01";
    var firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=周日
    var offset = (firstDow + 6) % 7; // 周一开头
    var start = addDays(firstIso, -offset);
    var weeks = [];
    for (var w = 0; w < 6; w++) {
      var row = [];
      for (var d = 0; d < 7; d++) {
        var iso = addDays(start, w * 7 + d);
        var p = parse(iso);
        row.push({ iso: iso, day: p.d, inMonth: p.m === month });
      }
      weeks.push(row);
    }
    return { label: year + "年" + month + "月", year: year, month: month, weeks: weeks };
  }

  function shiftMonth(year, month, delta) {
    var m = month - 1 + delta;
    var y = year + Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return { year: y, month: m + 1 };
  }

  /** 月历里点某一天：只有日期条范围内的日子能选；返回要选中的日子，不能选返回 null。 */
  function pickFromGrid(iso, days) {
    if (!parse(iso)) return null;
    return (days || []).indexOf(iso) !== -1 ? iso : null;
  }

  /**
   * 住宿段文字放不下时只截地名：返回放得下的地名（必要时末尾加「…」），日期部分不动。
   * measure(text) 返回文字像素宽；gap 是地名和「·」之间的空隙（.seg-range 的 margin-left）。
   * 用 JS 截断而不是 CSS 省略号：CSS 截断会在「…」后面留下被裁掉的半个字的空白，看起来像多了一个空格。
   */
  function fitCity(city, rest, maxW, measure, gap) {
    city = String(city || "");
    var restW = measure(rest || "");
    var avail = maxW - restW - (gap || 0);
    if (measure(city) <= avail) return city;
    var chars = Array.from ? Array.from(city) : city.split("");
    for (var n = chars.length - 1; n >= 1; n--) {
      var t = chars.slice(0, n).join("") + "…";
      if (measure(t) <= avail) return t;
    }
    return "…";
  }

  var api = {
    WEEKDAYS: WEEKDAYS,
    EXTEND_TO_TODAY_MAX_DAYS: EXTEND_TO_TODAY_MAX_DAYS,
    addDays: addDays,
    diffDays: diffDays,
    weekday: weekday,
    shortDate: shortDate,
    monthLabel: monthLabel,
    displayDate: displayDate,
    dotKind: dotKind,
    dotsByDay: dotsByDay,
    daysWithItems: daysWithItems,
    stripDays: stripDays,
    defaultDay: defaultDay,
    isPast: isPast,
    cityFrom: cityFrom,
    deriveSegments: deriveSegments,
    monthGrid: monthGrid,
    shiftMonth: shiftMonth,
    pickFromGrid: pickFromGrid,
    fitCity: fitCity
  };
  root.TripCalendar = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
