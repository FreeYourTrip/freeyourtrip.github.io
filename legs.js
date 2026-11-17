/**
 * 行程连接规则（可在 Node 里单测，不依赖 DOM）。
 *
 * - 航班「之前」的地面段，终点是出发机场；
 * - 航班「之后」的地面段，起点是到达机场；
 * - 两段航班相邻：同机场且中转不足 24 小时、又不是往返配对时，显示不可点击的「转机」；
 * - 相邻的火车/船/大巴（或跟机票对接）间隔不足 24 小时：显示不可点击的「换乘」；
 * - 机票可选手动角色 legRole（auto / out / back / transfer），手动优先。
 */
(function (root) {
  "use strict";

  /* v6：火车 / 船 / 大巴跟机票一样按「出发 ~ 到达」处理，见 transport.js */
  var Transport = root.Transport || (typeof require === "function" ? require("./transport.js") : null);
  function isTransit(item) {
    return Transport ? Transport.isTransit(item) : !!item && item.type === "flight";
  }

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
    if (isTransit(item)) return item.departDate || "";
    if (item.type === "hotel") return item.checkIn || "";
    return item.date || "";
  }

  function itemSortKey(item) {
    if (isCheckoutView(item)) {
      var ct = item.displayTime || item.checkOutTime || "";
      return (item.checkOut || "") + "T" + (ct || "99:99");
    }
    if (isTransit(item)) {
      return (item.departDate || "") + "T" + (item.departTime || "99:99");
    }
    if (item.type === "hotel") return (item.checkIn || "") + "T" + (item.checkInTime || "99:99");
    if (item.date) return item.date + "T" + (item.time || "99:99");
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
    if (!p) return isoDate || "还没定哪天";
    var wd = WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
    return p.m + "月" + p.d + "日 " + wd;
  }

  function departEndpoint(item) {
    if (!item || !isTransit(item)) return null;
    var k = Transport && Transport.kind(item);
    var pt = {
      id: item.id + ":dep",
      itemId: item.id,
      role: "depart",
      name: item.fromNameZh || item.fromAirport || (k ? k.fromFallback : "出发机场"),
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
    if (!item || !isTransit(item)) return null;
    var k = Transport && Transport.kind(item);
    var pt = {
      id: item.id + ":arr",
      itemId: item.id,
      role: "arrive",
      name: item.nameZh || item.toAirport || (k ? k.toFallback : "到达机场"),
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
    if (isTransit(item)) {
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

  function durationLabel(prefix, mins) {
    if (mins == null || mins < 0) return prefix;
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    if (h && m) return prefix + " " + h + "小时" + m + "分";
    if (h) return prefix + " " + h + "小时";
    return prefix + " " + m + "分钟";
  }

  function layoverLabel(flightA, flightB) {
    return durationLabel("转机", layoverMinutes(flightA, flightB));
  }

  function changeLabel(itemA, itemB) {
    return durationLabel("换乘", layoverMinutes(itemA, itemB));
  }

  /** auto（缺省）/ out / back / transfer。导入不会写入。 */
  function legRoleOf(item) {
    var r = String((item && item.legRole) || "auto").trim().toLowerCase();
    if (r === "out" || r === "back" || r === "transfer") return r;
    return "auto";
  }

  function airportCode(item, key) {
    return String((item && item[key]) || "").trim().toUpperCase();
  }

  function flightMoment(it) {
    return (it && it.departDate ? it.departDate : "") + "T" + ((it && it.departTime) || "00:00");
  }

  function arePartners(pairs, a, b) {
    if (!pairs || !a || !b) return false;
    var pa = pairs[a.id];
    var pb = pairs[b.id];
    return !!(pa && pa.otherId === b.id && pb && pb.otherId === a.id);
  }

  function airportCity(code) {
    var db = typeof AirportDB !== "undefined" ? AirportDB : (root.AirportDB || null);
    var rec = db && db.lookupAirport ? db.lookupAirport(code) : null;
    if (!rec) return "";
    return String(rec.cityZh || rec.city || "").trim().toLowerCase();
  }

  /** 同一座城市、不同机场（如 LHR→LGW）：也算转机，条子上加「要换机场」。 */
  function isSameCityAirportChange(a, b, pairs, mins) {
    if (!a || !b || a.type !== "flight" || b.type !== "flight") return false;
    if (arePartners(pairs, a, b)) return false;
    if (mins == null || mins < 0 || mins >= 24 * 60) return false;
    var fromA = airportCode(a, "toAirport");
    var toB = airportCode(b, "fromAirport");
    if (!fromA || !toB || fromA === toB) return false;
    var ca = airportCity(fromA);
    var cb = airportCity(toB);
    return !!(ca && cb && ca === cb);
  }

  /** 自动认转机：只限航班接航班，同机场（或同城换机场）且 0 ≤ 间隔 < 24 小时，且不是往返配对。缺机场代码就不自动认。 */
  function isAutoLayover(a, b, pairs, mins) {
    if (!a || !b || a.type !== "flight" || b.type !== "flight") return false;
    if (arePartners(pairs, a, b)) return false;
    if (mins == null || mins < 0 || mins >= 24 * 60) return false;
    var fromA = airportCode(a, "toAirport");
    var toB = airportCode(b, "fromAirport");
    if (!fromA || !toB) return false;
    if (fromA === toB) return true;
    return isSameCityAirportChange(a, b, pairs, mins);
  }

  function isManualLayover(a, b) {
    return !!(a && b && a.type === "flight" && b.type === "flight" && legRoleOf(b) === "transfer");
  }

  function stationKey(item, which) {
    if (!item) return "";
    if (which === "arrive") return String(item.nameZh || item.nameEn || item.toNameZh || "").trim();
    return String(item.fromNameZh || item.fromNameEn || "").trim();
  }

  function sameStation(a, b) {
    var fromA = stationKey(a, "arrive");
    var toB = stationKey(b, "depart");
    if (!fromA || !toB) return false;
    return fromA.toLowerCase() === toB.toLowerCase();
  }

  function isGroundTransit(item) {
    var k = transitKind(item);
    return k === "train" || k === "boat" || k === "bus";
  }

  /* 换乘：只限火车/船/大巴之间，间隔不足 24 小时且到站 = 下一程出发站。缺站名或跟机票对接都不画。 */
  function isChangeover(a, b, mins) {
    if (!isGroundTransit(a) || !isGroundTransit(b)) return false;
    if (mins == null || mins < 0 || mins >= 24 * 60) return false;
    return sameStation(a, b);
  }

  function transferBar(kindLabel, a, b, sameDay, mins, extra) {
    extra = extra || {};
    return {
      kind: "transfer",
      clickable: false,
      label: kindLabel,
      changeAirport: !!extra.changeAirport,
      fromItemId: a.id,
      toItemId: b.id,
      minutes: mins,
      from: arriveEndpoint(a),
      to: departEndpoint(b),
      crossDay: !sameDay
    };
  }

  function buildConnectors(items) {
    var list = sortedItems(items);
    var pairs = pairRoundTrips(list);
    var out = [];
    var i;
    for (i = 0; i < list.length - 1; i++) {
      var a = list[i];
      var b = list[i + 1];
      var sameDay = (itemDisplayDate(a) || "") === (itemDisplayDate(b) || "");
      var mins = layoverMinutes(a, b);
      if (isManualLayover(a, b) || isAutoLayover(a, b, pairs, mins)) {
        var changeAp = isSameCityAirportChange(a, b, pairs, mins);
        out.push(transferBar(durationLabel("转机", mins), a, b, sameDay, mins, { changeAirport: changeAp }));
      } else if (isChangeover(a, b, mins)) {
        out.push(transferBar(changeLabel(a, b), a, b, sameDay, mins));
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

  function autoRoleHintText(role) {
    if (role === "out") return "已自动识别为：去程";
    if (role === "back") return "已自动识别为：返程";
    if (role === "transfer") return "已自动识别为：转机";
    return "没认出来，可以自己选";
  }

  /**
   * 自动识别当前这条机票会是去程、返程还是转机（不算任何人手选的 legRole）。
   */
  function autoRoleFor(items, id) {
    var cloned = (items || []).map(function (it) {
      if (!it || it.type !== "flight") return it;
      var c = Object.assign({}, it);
      delete c.legRole;
      return c;
    });
    var pairs = pairRoundTrips(cloned);
    if (pairs[id] && pairs[id].role) return pairs[id].role;
    var list = sortedItems(cloned);
    var i;
    for (i = 1; i < list.length; i++) {
      if (list[i].id !== id) continue;
      var prev = list[i - 1];
      var cur = list[i];
      if (isAutoLayover(prev, cur, pairs, layoverMinutes(prev, cur))) return "transfer";
    }
    return "";
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
        map[key] = { date: key, header: key === "未标明日期" ? "还没定哪天" : formatDayHeader(key), items: [] };
        groups.push(map[key]);
      }
      map[key].items.push(item);
    });
    return groups.map(function (g) {
      g.firstTarget = g.items[0] ? firstOfDayTarget(g.items[0]) : null;
      return g;
    });
  }


  /** 这一项有没有钟点（没有就把卡片归进「没定时间」，地图针脚也不编号） */
  function itemHasTime(item) {
    return !!itemClock(item);
  }

  function itemHasCoords(item) {
    if (!item) return false;
    if (typeof item.lat === "number" && typeof item.lng === "number") return true;
    if (typeof item.fromLat === "number" && typeof item.fromLng === "number") return true;
    return false;
  }

  /**
   * 某一视图里该出现哪些卡片：列表、计数、地图都只用这一份。
   * day 为 "all" 或 YYYY-MM-DD。
   */
  function viewItems(rawItems, day, opts) {
    opts = opts || {};
    var expand = opts.expand !== false && typeof expandViewItems === "function";
    var raw = rawItems || [];
    var pending = [];
    var dated = [];
    raw.forEach(function (it) {
      if (!it) return;
      if (it.pendingDate) pending.push(it);
      else dated.push(it);
    });
    var cards = expand ? expandViewItems(dated) : dated.slice();
    var undated = [];
    var byDay = {};
    var dayOrder = [];
    cards.forEach(function (it) {
      var d = itemDisplayDate(it) || "";
      if (!d) {
        undated.push(it);
        return;
      }
      if (!byDay[d]) {
        byDay[d] = { date: d, timed: [], untimed: [] };
        dayOrder.push(d);
      }
      if (itemHasTime(it)) byDay[d].timed.push(it);
      else byDay[d].untimed.push(it);
    });
    dayOrder.sort();
    if (day && day !== "all") {
      pending = []; /* 单日不把待补日期混进这一天的计数，待补走横幅 */
      var g = byDay[day] || { date: day, timed: [], untimed: [] };
      undated = [];
      dayOrder = g.timed.length || g.untimed.length ? [day] : [];
      byDay = {};
      if (dayOrder.length) byDay[day] = g;
    }
    var visible = [];
    if (!(day && day !== "all")) visible = visible.concat(pending);
    dayOrder.forEach(function (d) {
      visible = visible.concat(byDay[d].timed, byDay[d].untimed);
    });
    if (!(day && day !== "all")) visible = visible.concat(undated);
    var located = [];
    var unlocated = [];
    visible.forEach(function (it) {
      if (itemHasCoords(it)) located.push(it);
      else unlocated.push(it);
    });
    /* 地图针脚：先有时间的（带编号），再没定时间的（不编号） */
    var pins = [];
    var n = 0;
    function pushPin(it, numbered) {
      if (!itemHasCoords(it)) return;
      var marker = endpointFor(it, isTransit(it) ? "dest" : "origin");
      if (!marker || typeof marker.lat !== "number") return;
      n += numbered ? 1 : 0;
      pins.push({ item: it, marker: marker, n: numbered ? n : 0, timed: numbered });
    }
    if (day && day !== "all") {
      var one = byDay[day];
      if (one) {
        one.timed.forEach(function (it) { pushPin(it, true); });
        one.untimed.forEach(function (it) { pushPin(it, false); });
      }
    } else {
      dayOrder.forEach(function (d) {
        byDay[d].timed.forEach(function (it) { pushPin(it, true); });
      });
      dayOrder.forEach(function (d) {
        byDay[d].untimed.forEach(function (it) { pushPin(it, false); });
      });
      undated.forEach(function (it) { pushPin(it, false); });
    }
    return {
      pending: pending,
      days: dayOrder.map(function (d) { return byDay[d]; }),
      undated: undated,
      visible: visible,
      count: visible.length,
      located: located,
      unlocated: unlocated,
      pins: pins,
      dayCount: dayOrder.length
    };
  }

  function numberedList(items) {
    return sortedItems(items).map(function (item, i) {
      return { n: i + 1, item: item, marker: endpointFor(item, isTransit(item) ? "dest" : "origin") };
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

  var HOW_TO_GO = "↓ 怎么去";

  function pointNavigable(pt) {
    if (!pt) return false;
    if (hasCoords(pt)) return true;
    return !!(String(pt.name || "").trim() || String(pt.address || "").trim() || String(pt.airport || "").trim());
  }

  /**
   * 同一天前后两段之间的『↓ 怎么去』：从上一站到达处导航到下一站出发处。
   * 机票 / 火车 / 大巴 / 船也显示。跨天不由这里画（调用方只传入同一天的相邻两项）。
   * 任一端没有名称、地址或坐标时不显示，也不再改成「补位置 ›」。
   */
  function navPillSpec(fromItem, toItem) {
    if (!fromItem || !toItem) return { show: false };
    var from = endpointFor(fromItem, "origin");
    var to = endpointFor(toItem, "dest");
    if (!pointNavigable(from) || !pointNavigable(to)) {
      return { show: false, reason: "nDest", fromItemId: fromItem && fromItem.id, toItemId: toItem && toItem.id };
    }
    var km = hasCoords(from) && hasCoords(to) ? haversineKm(from, to) : null;
    return {
      show: true,
      kind: "nav",
      label: HOW_TO_GO,
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
    if (spec.kind !== "nav") return { show: false, reason: "no-label", fromItemId: last && last.id, toItemId: hotel && hotel.id };
    spec.kind = "hotel";
    spec.label = formatReturnHotelPill(spec.km);
    if (!spec.label) return { show: false, reason: "no-label", fromItemId: last.id, toItemId: hotel.id };
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

  var GROUP_UNDATED = "未标明日期";
  var GROUP_PENDING = "待补";

  /** 落点 / 分组键：没日期和「未标明日期」都是 ""；日期待确认是「待补」。 */
  function normalizeDropDay(day) {
    var d = day == null ? "" : String(day);
    if (!d || d === GROUP_UNDATED || d === "还没定哪天") return "";
    if (d === GROUP_PENDING || d === "待确认日期") return GROUP_PENDING;
    return d;
  }

  function itemGroupKey(it) {
    if (!it) return "";
    if (it.pendingDate) return GROUP_PENDING;
    return itemDisplayDate(it) || "";
  }

  function applyDayOrder(items, day, orderedIds) {
    var key = normalizeDropDay(day);
    var map = {};
    (orderedIds || []).forEach(function (id, idx) {
      if (String(id).indexOf("::checkout") !== -1) return;
      map[id] = idx;
    });
    (items || []).forEach(function (it) {
      if (itemGroupKey(it) !== key) return;
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
    if (isTransit(item)) return item.departTime || "";
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
    if (item.type === "bus" || sub === "大巴" || sub === "巴士" || /^(bus|coach)$/i.test(sub)) return "bus";
    return "";
  }

  function transitLeadMinutes(item) {
    var k = transitKind(item);
    if (k === "flight") return 180;
    if (k === "train" || k === "boat" || k === "bus") return 60;
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
   * 退房时间默认：机票出发前 3 小时，火车/船/大巴出发前 1 小时。
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
      if (legRoleOf(it) === "transfer") return false;
      return ymdOk(it.departDate || "");
    }).slice().sort(function (a, b) {
      var ka = flightMoment(a);
      var kb = flightMoment(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    var used = {};
    var pairs = {};
    function bind(a, b) {
      used[a.id] = true;
      used[b.id] = true;
      pairs[a.id] = { role: "out", label: "去程", otherId: b.id, otherDate: b.departDate };
      pairs[b.id] = { role: "back", label: "返程", otherId: a.id, otherDate: a.departDate };
    }

    /* 手动返程：跟最近的更早未配对航班配成返程，优先已经标成去程的，机场不一样也可以（开口程）。 */
    list.forEach(function (b) {
      if (used[b.id] || legRoleOf(b) !== "back") return;
      var bestOut = null;
      var bestAny = null;
      var j;
      for (j = 0; j < list.length; j++) {
        var a = list[j];
        if (a.id === b.id || used[a.id]) continue;
        if (flightMoment(a) >= flightMoment(b)) continue;
        if (legRoleOf(a) === "back") continue;
        if (!bestAny || flightMoment(a) > flightMoment(bestAny)) bestAny = a;
        if (legRoleOf(a) === "out") {
          if (!bestOut || flightMoment(a) > flightMoment(bestOut)) bestOut = a;
        }
      }
      var pick = bestOut || bestAny;
      if (pick) bind(pick, b);
    });

    /* 手动去程：跟最近的更晚手动返程配对，没有则用机场对得上的自动返程。 */
    list.forEach(function (a) {
      if (used[a.id] || legRoleOf(a) !== "out") return;
      var ea = ends(a);
      var bestBack = null;
      var bestAuto = null;
      var j;
      for (j = 0; j < list.length; j++) {
        var b = list[j];
        if (b.id === a.id || used[b.id]) continue;
        if (flightMoment(b) <= flightMoment(a)) continue;
        if (legRoleOf(b) === "back" && !bestBack) bestBack = b;
        var eb = ends(b);
        if (ea.from && ea.to && eb.from && eb.to && ea.from === eb.to && ea.to === eb.from && !bestAuto) {
          bestAuto = b;
        }
      }
      var pick = bestBack || bestAuto;
      if (pick) bind(a, pick);
    });

    /* 其余按出发/到达机场自动配对，取最近的后一段。 */
    list.forEach(function (a, i) {
      if (used[a.id]) return;
      var ea = ends(a);
      if (!ea.from || !ea.to) return;
      var best = null;
      var j;
      for (j = i + 1; j < list.length; j++) {
        var b = list[j];
        if (used[b.id]) continue;
        var eb = ends(b);
        if (ea.from === eb.to && ea.to === eb.from && flightMoment(b) > flightMoment(a)) {
          best = b;
          break;
        }
      }
      if (best) bind(a, best);
    });

    /* 手动去程/返程即使没配上对家，卡片上也标出来（样式跟自动识别一样）。 */
    list.forEach(function (it) {
      if (pairs[it.id]) return;
      if (legRoleOf(it) === "out") pairs[it.id] = { role: "out", label: "去程" };
      if (legRoleOf(it) === "back") pairs[it.id] = { role: "back", label: "返程" };
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
    if (!item || isTransit(item)) return item;
    if (item.type === "hotel") item.checkInTime = hhmm;
    else item.time = hhmm;
    return item;
  }

  var api = {
    itemDisplayDate: itemDisplayDate,
    normalizeDropDay: normalizeDropDay,
    itemGroupKey: itemGroupKey,
    GROUP_PENDING: GROUP_PENDING,
    GROUP_UNDATED: GROUP_UNDATED,
    itemSortKey: itemSortKey,
    sortedItems: sortedItems,
    sortDayItems: sortDayItems,
    formatDayHeader: formatDayHeader,
    departEndpoint: departEndpoint,
    arriveEndpoint: arriveEndpoint,
    endpointFor: endpointFor,
    layoverMinutes: layoverMinutes,
    layoverLabel: layoverLabel,
    changeLabel: changeLabel,
    legRoleOf: legRoleOf,
    autoRoleFor: autoRoleFor,
    autoRoleHintText: autoRoleHintText,
    buildConnectors: buildConnectors,
    firstOfDayTarget: firstOfDayTarget,
    groupByDay: groupByDay,
    numberedList: numberedList,
    itemHasTime: itemHasTime,
    itemHasCoords: itemHasCoords,
    viewItems: viewItems,
    hasCoords: hasCoords,
    PILL_FAR_KM: PILL_FAR_KM,
    haversineKm: haversineKm,
    formatStraightPill: formatStraightPill,
    hotelCoversNight: hotelCoversNight,
    nightHotel: nightHotel,
    straightKm: straightKm,
    HOW_TO_GO: HOW_TO_GO,
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
