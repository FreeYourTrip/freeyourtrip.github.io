/**
 * 行程连接规则（可在 Node 里单测，不依赖 DOM）。
 *
 * - 航班「之前」的地面段，终点是出发机场；
 * - 航班「之后」的地面段，起点是到达机场；
 * - 两段航班相邻：显示不可点击的「转机」（可附中转时长）；
 */
(function (root) {
  "use strict";

  var WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  function hasCoords(p) {
    return p && typeof p.lat === "number" && typeof p.lng === "number";
  }

  function parseCivil(iso) {
    if (!iso || typeof iso !== "string") return null;
    var p = iso.split("-");
    if (p.length !== 3) return null;
    var y = Number(p[0]), m = Number(p[1]), d = Number(p[2]);
    if (!y || !m || !d) return null;
    return { y: y, m: m, d: d };
  }

  function sourceId(itemOrId) {
    if (itemOrId && typeof itemOrId === "object") {
      return itemOrId.sourceId || String(itemOrId.id || "").replace(/::checkout$/, "");
    }
    return String(itemOrId == null ? "" : itemOrId).replace(/::checkout$/, "");
  }

  function isCheckoutView(item) {
    return !!(item && item.viewRole === "checkout");
  }

  function checkoutViewId(id) {
    return String(id || "") + "::checkout";
  }

  function hasValidHotelStay(item) {
    return !!(
      item &&
      item.type === "hotel" &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(item.checkIn || "")) &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(item.checkOut || "")) &&
      item.checkIn < item.checkOut
    );
  }

  function itemDisplayDate(item) {
    if (!item) return "";
    if (isCheckoutView(item)) return item.checkOut || "";
    if (item.type === "flight") return item.departDate || "";
    if (item.type === "hotel") return item.checkIn || "";
    return item.date || "";
  }

  function itemSortKey(item) {
    if (isCheckoutView(item)) {
      var ct = item.displayTime || item.checkOutTime || "";
      return (item.checkOut || "") + "T" + (ct || "00:00");
    }
    if (item.type === "flight") {
      return (item.departDate || "") + "T" + (item.departTime || "00:00");
    }
    if (item.type === "hotel") return (item.checkIn || "") + "T" + (item.checkInTime || "15:00");
    if (item.date) return item.date + "T" + (item.time || "12:00");
    return "9999-99-99T99:99";
  }

  function cmpSortKey(a, b) {
    var ka = itemSortKey(a), kb = itemSortKey(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    var ia = String(sourceId(a)), ib = String(sourceId(b));
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  }

  function sortDayItems(dayItems) {
    var hasOrder = (dayItems || []).some(function (it) {
      return typeof it.dayOrder === "number" && !isCheckoutView(it);
    });
    if (!hasOrder) return (dayItems || []).slice().sort(cmpSortKey);
    var real = dayItems.filter(function (it) { return !isCheckoutView(it); });
    real.sort(function (a, b) {
      var oa = typeof a.dayOrder === "number" ? a.dayOrder : 1e9;
      var ob = typeof b.dayOrder === "number" ? b.dayOrder : 1e9;
      if (oa !== ob) return oa - ob;
      return cmpSortKey(a, b);
    });
    var derived = dayItems.filter(isCheckoutView).sort(cmpSortKey);
    derived.forEach(function (cv) {
      var t = parseHm(itemClock(cv));
      if (t == null) t = 12 * 60;
      var i = 0;
      for (; i < real.length; i++) {
        var ct = parseHm(itemClock(real[i]));
        if (ct != null && ct >= t) break;
      }
      real.splice(i, 0, cv);
    });
    return real;
  }

  function sortedItems(items) {
    var groups = {};
    var keys = [];
    (items || []).forEach(function (it) {
      var k = itemDisplayDate(it) || "9999-99-99";
      if (!groups[k]) {
        groups[k] = [];
        keys.push(k);
      }
      groups[k].push(it);
    });
    keys.sort();
    var out = [];
    keys.forEach(function (k) {
      out = out.concat(sortDayItems(groups[k]));
    });
    return out;
  }

  function formatDayHeader(isoDate) {
    var p = parseCivil(isoDate);
    if (!p) return isoDate || "日期待定";
    var wd = WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
    return p.m + "月" + p.d + "日 " + wd;
  }

  function departEndpoint(item) {
    if (!item || item.type !== "flight") return null;
    var pt = {
      id: item.id + ":dep",
      itemId: item.id,
      role: "depart",
      name: item.fromNameZh || item.fromAirport || "出发机场",
      nameEn: item.fromNameEn || item.fromAirport || "",
      airport: item.fromAirport || "",
      address: item.fromAirport || ""
    };
    if (typeof item.fromLat === "number" && typeof item.fromLng === "number") {
      pt.lat = item.fromLat;
      pt.lng = item.fromLng;
    }
    return pt;
  }

  function arriveEndpoint(item) {
    if (!item || item.type !== "flight") return null;
    var pt = {
      id: item.id + ":arr",
      itemId: item.id,
      role: "arrive",
      name: item.nameZh || item.toAirport || "到达机场",
      nameEn: item.nameEn || item.toAirport || "",
      airport: item.toAirport || "",
      address: item.toAirport || ""
    };
    if (typeof item.lat === "number" && typeof item.lng === "number") {
      pt.lat = item.lat;
      pt.lng = item.lng;
    }
    return pt;
  }

  function placeEndpoint(item) {
    var pt = {
      id: item.id,
      itemId: item.id,
      role: "place",
      name: item.nameZh || item.nameEn || "",
      nameEn: item.nameEn || "",
      address: item.address || ""
    };
    if (typeof item.lat === "number" && typeof item.lng === "number") {
      pt.lat = item.lat;
      pt.lng = item.lng;
    }
    return pt;
  }

  /**
   * as === "dest"：这条腿在该条目之前，落到该条目（航班则落在出发机场）。
   * as === "origin"：这条腿从该条目离开（航班则从到达机场出发）。
   */
  function endpointFor(item, as) {
    if (!item) return null;
    if (item.type === "flight") {
      return as === "dest" ? departEndpoint(item) : arriveEndpoint(item);
    }
    return placeEndpoint(item);
  }

  function minutesBetweenCivil(dateA, timeA, dateB, timeB) {
    var a = parseCivil(dateA);
    var b = parseCivil(dateB);
    if (!a || !b) return null;
    var ta = (timeA || "00:00").split(":");
    var tb = (timeB || "00:00").split(":");
    var msA = Date.UTC(a.y, a.m - 1, a.d, Number(ta[0]) || 0, Number(ta[1]) || 0);
    var msB = Date.UTC(b.y, b.m - 1, b.d, Number(tb[0]) || 0, Number(tb[1]) || 0);
    return Math.round((msB - msA) / 60000);
  }

  function layoverMinutes(flightA, flightB) {
    if (!flightA || !flightB) return null;
    return minutesBetweenCivil(flightA.arriveDate, flightA.arriveTime, flightB.departDate, flightB.departTime);
  }

  function layoverLabel(flightA, flightB) {
    var mins = layoverMinutes(flightA, flightB);
    if (mins == null || mins < 0) return "转机";
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    if (h && m) return "转机 " + h + "小时" + m + "分";
    if (h) return "转机 " + h + "小时";
    return "转机 " + m + "分钟";
  }

  function buildConnectors(items) {
    var list = sortedItems(items);
    var out = [];
    var i;
    for (i = 0; i < list.length - 1; i++) {
      var a = list[i];
      var b = list[i + 1];
      var sameDay = (itemDisplayDate(a) || "") === (itemDisplayDate(b) || "");
      if (a.type === "flight" && b.type === "flight") {
        /* 转机：即使两段航班跨日（跨午夜）也保留 */
        out.push({
          kind: "transfer",
          clickable: false,
          label: layoverLabel(a, b),
          fromItemId: a.id,
          toItemId: b.id,
          minutes: layoverMinutes(a, b),
          from: arriveEndpoint(a),
          to: departEndpoint(b),
          crossDay: !sameDay
        });
      } else if (sameDay) {
        out.push({
          kind: "nav",
          clickable: true,
          label: "↓ 怎么去",
          fromItemId: a.id,
          toItemId: b.id,
          from: endpointFor(a, "origin"),
          to: endpointFor(b, "dest"),
          crossDay: false
        });
      }
      /* 跨天的地面连接不画：次日卡片上的「带我去」已从当前位置出发 */
    }
    return out;
  }

  function firstOfDayTarget(item) {
    return endpointFor(item, "dest");
  }

  function groupByDay(items) {
    var list = sortedItems(items);
    var groups = [];
    var map = {};
    list.forEach(function (item, idx) {
      var key = itemDisplayDate(item) || "未标明日期";
      if (!map[key]) {
        map[key] = { date: key, header: key === "未标明日期" ? "日期待定" : formatDayHeader(key), items: [] };
        groups.push(map[key]);
      }
      map[key].items.push(item);
    });
    return groups.map(function (g) {
      g.firstTarget = g.items[0] ? firstOfDayTarget(g.items[0]) : null;
      return g;
    });
  }

  function numberedList(items) {
    return sortedItems(items).map(function (item, i) {
      return { n: i + 1, item: item, marker: endpointFor(item, item.type === "flight" ? "dest" : "origin") };
    });
  }


  /* ---------- v5.4：两站之间的直线距离胶囊、当晚酒店、当天拖动排序 ---------- */
  var PILL_FAR_KM = 300;

  function haversineKm(a, b) {
    if (!hasCoords(a) || !hasCoords(b)) return null;
    var R = 6371;
    var toRad = function (d) { return (d * Math.PI) / 180; };
    var dLat = toRad(b.lat - a.lat);
    var dLng = toRad(b.lng - a.lng);
    var x =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }

  function ymdOk(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  }

  /** 不到 1 公里写米，否则写公里（整数不带小数）。超过 300 公里返回 null。缺距离返回 null。 */
  function formatStraightPill(km) {
    if (km == null || !isFinite(km) || km < 0) return null;
    if (km > PILL_FAR_KM) return null;
    if (km < 1) return "直线 " + Math.round(km * 1000) + " 米 · 路线 ›";
    var rounded = Math.round(km * 10) / 10;
    var s = Math.abs(rounded - Math.round(rounded)) < 1e-9 ? String(Math.round(rounded)) : rounded.toFixed(1);
    return "直线 " + s + " 公里 · 路线 ›";
  }

  function hotelCoversNight(hotel, day) {
    return !!(
      hotel &&
      hotel.type === "hotel" &&
      ymdOk(hotel.checkIn) &&
      ymdOk(hotel.checkOut) &&
      hotel.checkIn <= day &&
      day < hotel.checkOut
    );
  }

  function nightHotel(items, day) {
    var found = null;
    (items || []).forEach(function (it) {
      if (isCheckoutView(it)) return;
      if (hotelCoversNight(it, day)) found = it;
    });
    return found;
  }

  function straightKm(fromItem, toItem) {
    var a = endpointFor(fromItem, "origin");
    var b = endpointFor(toItem, "dest");
    return haversineKm(a, b);
  }

  /**
   * 两站之间的胶囊。中间隔着航班（任一端是航班）或直线超过 300 公里：不显示。
   * 缺坐标：显示「补位置 ›」，fixId 指向先缺坐标的那一站。
   */
  function navPillSpec(fromItem, toItem) {
    if (!fromItem || !toItem) return { show: false };
    if (fromItem.type === "flight" || toItem.type === "flight") {
      return { show: false, reason: "flight", fromItemId: fromItem.id, toItemId: toItem.id };
    }
    var from = endpointFor(fromItem, "origin");
    var to = endpointFor(toItem, "dest");
    if (!hasCoords(from) || !hasCoords(to)) {
      var fixId = !hasCoords(from) ? fromItem.id : toItem.id;
      return {
        show: true,
        kind: "fix",
        label: "补位置 ›",
        fixId: fixId,
        fromItemId: fromItem.id,
        toItemId: toItem.id
      };
    }
    var km = haversineKm(from, to);
    if (km > PILL_FAR_KM) {
      return { show: false, reason: "far", km: km, fromItemId: fromItem.id, toItemId: toItem.id, from: from, to: to };
    }
    return {
      show: true,
      kind: "nav",
      label: formatStraightPill(km),
      km: km,
      from: from,
      to: to,
      fromItemId: fromItem.id,
      toItemId: toItem.id
    };
  }

  /** 已去掉每天第一站前的「从我的位置出发」胶囊（与卡片「带我去」重复）。 */
  function firstOfDayPill(item) {
    return { show: false };
  }

  /** 回酒店胶囊文案：回酒店 · 直线 1.2 公里 › / 回酒店 · 直线 850 米 › */
  function formatReturnHotelPill(km) {
    var base = formatStraightPill(km);
    if (!base) return null;
    return "回酒店 · " + base.replace(" · 路线 ›", " ›");
  }

  /**
   * 当天最后一站到当晚酒店。酒店算入 D 的规则：checkIn <= D 且 checkOut > D。
   * 退房日、当晚没有酒店：不显示。酒店已是最后一项：不显示。不做「去机场」。
   */
  function trailingHotelPill(dayItems, allItems, day) {
    var hotel = nightHotel(allItems || dayItems, day);
    if (!hotel || !dayItems || !dayItems.length) return { show: false };
    var last = dayItems[dayItems.length - 1];
    if (sourceId(last) === sourceId(hotel)) return { show: false, reason: "already-last" };
    var spec = navPillSpec(last, hotel);
    if (!spec.show) return spec;
    if (spec.kind === "nav") {
      spec.kind = "hotel";
      spec.label = formatReturnHotelPill(spec.km);
    } else if (spec.kind === "fix") {
      spec.label = "回酒店 · 补位置 ›";
    }
    return spec;
  }

  function dayPills(items, day) {
    var g = null;
    groupByDay(expandViewItems(items)).forEach(function (x) {
      if (x.date === day) g = x;
    });
    if (!g) return [];
    var out = [];
    var i;
    for (i = 0; i < g.items.length - 1; i++) {
      var spec = navPillSpec(g.items[i], g.items[i + 1]);
      if (spec.show) out.push(spec);
    }
    var trail = trailingHotelPill(g.items, items, day);
    if (trail.show) out.push(trail);
    return out;
  }

  function applyDayOrder(items, day, orderedIds) {
    var map = {};
    (orderedIds || []).forEach(function (id, idx) {
      if (String(id).indexOf("::checkout") !== -1) return;
      map[id] = idx;
    });
    (items || []).forEach(function (it) {
      if ((itemDisplayDate(it) || "") !== day) return;
      if (Object.prototype.hasOwnProperty.call(map, it.id)) it.dayOrder = map[it.id];
    });
    return items;
  }

  function parseHm(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "").trim());
    if (!m) return null;
    var h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  function formatHm(mins) {
    var n = Math.max(0, Math.min(23 * 60 + 59, Math.round(mins)));
    var h = Math.floor(n / 60);
    var m = n % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }

  function itemClock(item) {
    if (!item) return "";
    if (isCheckoutView(item)) return item.displayTime || item.checkOutTime || "";
    if (item.type === "flight") return item.departTime || "";
    if (item.type === "hotel") return item.checkInTime || "";
    return item.time || "";
  }

  function transitKind(item) {
    if (!item || isCheckoutView(item)) return "";
    if (item.type === "flight") return "flight";
    var sub = String(item.subtype || item.subType || item.kind || "");
    if (item.type === "train" || sub === "火车" || sub === "列车" || sub === "高铁" || sub === "动车") return "train";
    if (item.type === "boat" || item.type === "ferry" || item.type === "ship" ||
        /船|轮渡|游轮/.test(sub) || /^(ferry|boat|ship)$/i.test(sub)) {
      return "boat";
    }
    return "";
  }

  function transitLeadMinutes(item) {
    var k = transitKind(item);
    if (k === "flight") return 180;
    if (k === "train" || k === "boat") return 60;
    return 0;
  }

  function isDayTransit(item, day) {
    if (!transitKind(item)) return false;
    if (item.type === "flight") return (item.departDate || "") === day && parseHm(item.departTime) != null;
    return ((item.date || item.departDate || "") === day) && parseHm(item.time || item.departTime) != null;
  }

  function transitDepartTime(item) {
    if (!item) return "";
    if (item.type === "flight") return item.departTime || "";
    return item.time || item.departTime || "";
  }

  /**
   * 退房时间默认：机票出发前 3 小时，火车/船出发前 1 小时。
   * 算出的时刻晚于 12:00 则用 12:00（不算自动）。当天最早出发早于 03:00：不自动、也不填 12:00，时间留空。
   * 用户自己写的 checkOutTime 一律优先。
   * autoFromFlight 只在用了「出发前 3/1 小时」且结果不晚于 12:00 时为 true。
   */
  function suggestedCheckoutTime(items, day) {
    var cands = [];
    (items || []).forEach(function (it) {
      if (!isDayTransit(it, day)) return;
      var depart = parseHm(transitDepartTime(it));
      if (depart == null) return;
      cands.push({ depart: depart, lead: transitLeadMinutes(it) });
    });
    cands.sort(function (a, b) { return a.depart - b.depart; });
    if (!cands.length) return { time: "12:00", autoFromFlight: false };
    if (cands[0].depart < 3 * 60) return { time: "", autoFromFlight: false };
    var best = null;
    cands.forEach(function (c) {
      var t = c.depart - c.lead;
      if (t < 0) t = 0;
      if (best == null || t < best) best = t;
    });
    if (best == null) return { time: "", autoFromFlight: false };
    if (best > 12 * 60) return { time: "12:00", autoFromFlight: false };
    return { time: formatHm(best), autoFromFlight: true };
  }

  function checkoutTimeInfo(hotel, items) {
    if (hotel && hotel.checkOutTime) {
      return { time: hotel.checkOutTime, autoFromFlight: false, userSet: true };
    }
    var sug = suggestedCheckoutTime(items, hotel && hotel.checkOut);
    sug.userSet = false;
    return sug;
  }

  function expandViewItems(items) {
    var raw = items || [];
    var out = [];
    raw.forEach(function (it) {
      if (!hasValidHotelStay(it)) {
        out.push(it);
        return;
      }
      var cin = Object.assign({}, it, { viewRole: "checkin" });
      out.push(cin);
      var info = checkoutTimeInfo(it, raw);
      var cout = Object.assign({}, it, {
        viewRole: "checkout",
        id: checkoutViewId(it.id),
        sourceId: it.id,
        displayTime: info.time
      });
      delete cout.dayOrder;
      out.push(cout);
    });
    return out;
  }

  /**
   * 往返配对（只用于展示，不写回条目）：A.from==B.to 且 A.to==B.from，且 B 的日期+时间晚于 A。
   * 取最近的后一段；每张机票最多配一次。同一天只要返程更晚也可以配。
   */
  function pairRoundTrips(items) {
    function ends(it) {
      return {
        from: String(it.fromAirport || "").trim().toUpperCase(),
        to: String(it.toAirport || "").trim().toUpperCase(),
        date: it.departDate || "",
        time: it.departTime || "00:00"
      };
    }
    var list = (items || []).filter(function (it) {
      if (!it || it.type !== "flight" || isCheckoutView(it)) return false;
      var e = ends(it);
      return e.from && e.to && ymdOk(e.date);
    }).slice().sort(function (a, b) {
      var ka = (a.departDate || "") + "T" + (a.departTime || "");
      var kb = (b.departDate || "") + "T" + (b.departTime || "");
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    var used = {};
    var pairs = {};
    list.forEach(function (a, i) {
      if (used[a.id]) return;
      var ea = ends(a);
      var best = null;
      var j;
      for (j = i + 1; j < list.length; j++) {
        var b = list[j];
        if (used[b.id]) continue;
        var eb = ends(b);
        var ta = (ea.date || "") + "T" + (ea.time || "00:00");
        var tb = (eb.date || "") + "T" + (eb.time || "00:00");
        if (ea.from === eb.to && ea.to === eb.from && tb > ta) {
          best = b;
          break;
        }
      }
      if (!best) return;
      used[a.id] = true;
      used[best.id] = true;
      pairs[a.id] = { role: "out", label: "去程", otherId: best.id, otherDate: best.departDate };
      pairs[best.id] = { role: "back", label: "回程", otherId: a.id, otherDate: a.departDate };
    });
    return pairs;
  }

  function buildReturnFlight(fromItem) {
    fromItem = fromItem || {};
    return {
      type: "flight",
      flightNo: "",
      fromAirport: fromItem.toAirport || "",
      toAirport: fromItem.fromAirport || "",
      fromNameZh: fromItem.nameZh || fromItem.toNameZh || "",
      fromNameEn: fromItem.nameEn || fromItem.toNameEn || "",
      nameZh: fromItem.fromNameZh || "",
      nameEn: fromItem.fromNameEn || "",
      fromLat: fromItem.lat,
      fromLng: fromItem.lng,
      lat: fromItem.fromLat,
      lng: fromItem.fromLng,
      departDate: "",
      departTime: "",
      arriveDate: "",
      arriveTime: ""
    };
  }

  function timeFitsOrder(ordered, index) {
    var cur = parseHm(itemClock(ordered[index]));
    if (cur == null) return true;
    var i, prev = null, next = null;
    for (i = index - 1; i >= 0; i--) {
      var p = parseHm(itemClock(ordered[i]));
      if (p != null) {
        prev = p;
        break;
      }
    }
    for (i = index + 1; i < ordered.length; i++) {
      var n = parseHm(itemClock(ordered[i]));
      if (n != null) {
        next = n;
        break;
      }
    }
    if (prev != null && cur < prev) return false;
    if (next != null && cur > next) return false;
    return true;
  }

  /** 拖完后若时间不再符合顺序，给出建议时刻（如 14:30）；给不出就返回 null。 */
  function suggestTimeForMove(ordered, movedId) {
    var index = -1, i;
    for (i = 0; i < (ordered || []).length; i++) {
      if (ordered[i].id === movedId) index = i;
    }
    if (index < 0) return null;
    if (!parseHm(itemClock(ordered[index]))) return null;
    if (timeFitsOrder(ordered, index)) return null;
    var prev = null, next = null;
    for (i = index - 1; i >= 0; i--) {
      var p = parseHm(itemClock(ordered[i]));
      if (p != null) {
        prev = p;
        break;
      }
    }
    for (i = index + 1; i < ordered.length; i++) {
      var n = parseHm(itemClock(ordered[i]));
      if (n != null) {
        next = n;
        break;
      }
    }
    var sug;
    if (prev != null && next != null && next > prev) sug = Math.round((prev + next) / 2 / 5) * 5;
    else if (prev != null) sug = prev + 30;
    else if (next != null) sug = next - 30;
    else return null;
    if (prev != null && sug <= prev) sug = prev + 5;
    if (next != null && sug >= next) sug = next - 5;
    if (prev != null && next != null && !(sug > prev && sug < next)) return null;
    return formatHm(sug);
  }

  function applySuggestedTime(item, hhmm) {
    if (!item || item.type === "flight") return item;
    if (item.type === "hotel") item.checkInTime = hhmm;
    else item.time = hhmm;
    return item;
  }

  var api = {
    itemDisplayDate: itemDisplayDate,
    itemSortKey: itemSortKey,
    sortedItems: sortedItems,
    formatDayHeader: formatDayHeader,
    departEndpoint: departEndpoint,
    arriveEndpoint: arriveEndpoint,
    endpointFor: endpointFor,
    layoverMinutes: layoverMinutes,
    layoverLabel: layoverLabel,
    buildConnectors: buildConnectors,
    firstOfDayTarget: firstOfDayTarget,
    groupByDay: groupByDay,
    numberedList: numberedList,
    hasCoords: hasCoords,
    PILL_FAR_KM: PILL_FAR_KM,
    haversineKm: haversineKm,
    formatStraightPill: formatStraightPill,
    hotelCoversNight: hotelCoversNight,
    nightHotel: nightHotel,
    straightKm: straightKm,
    navPillSpec: navPillSpec,
    firstOfDayPill: firstOfDayPill,
    formatReturnHotelPill: formatReturnHotelPill,
    trailingHotelPill: trailingHotelPill,
    dayPills: dayPills,
    applyDayOrder: applyDayOrder,
    itemClock: itemClock,
    timeFitsOrder: timeFitsOrder,
    suggestTimeForMove: suggestTimeForMove,
    applySuggestedTime: applySuggestedTime,
    sourceId: sourceId,
    isCheckoutView: isCheckoutView,
    checkoutViewId: checkoutViewId,
    hasValidHotelStay: hasValidHotelStay,
    suggestedCheckoutTime: suggestedCheckoutTime,
    checkoutTimeInfo: checkoutTimeInfo,
    expandViewItems: expandViewItems,
    pairRoundTrips: pairRoundTrips,
    buildReturnFlight: buildReturnFlight
  };

  root.Legs = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
