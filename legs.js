/**
 * 行程连接规则（可在 Node 里单测，不依赖 DOM）。
 *
 * - 航班「之前」的地面段，终点是出发机场；
 * - 航班「之后」的地面段，起点是到达机场；
 * - 两段航班相邻：显示不可点击的「转机」（可附中转时长）；
 * - 当天第一段「从我的位置出发」若指向航班，目标是出发机场。
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

  function itemDisplayDate(item) {
    if (!item) return "";
    if (item.type === "flight") return item.departDate || "";
    if (item.type === "hotel") return item.checkIn || "";
    return item.date || "";
  }

  function itemSortKey(item) {
    if (item.type === "flight") {
      return (item.departDate || "") + "T" + (item.departTime || "00:00");
    }
    if (item.type === "hotel") return (item.checkIn || "") + "T" + (item.checkInTime || "15:00");
    if (item.date) return item.date + "T" + (item.time || "12:00");
    return "9999-99-99T99:99";
  }

  function sortedItems(items) {
    return (items || []).slice().sort(function (a, b) {
      var ka = itemSortKey(a), kb = itemSortKey(b);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      return 0;
    });
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
      /* 跨天的地面「带我去」不画：次日已有「从我的位置 带我去」 */
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
    hasCoords: hasCoords
  };

  root.Legs = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
