/**
 * 单条行程的删除 / 撤销 / 修改 / 清空。纯函数，不改传入的数组，方便测试。
 * 用法：浏览器里是 window.ItemEdit；node 里 require("./item-edit.js")。
 */
(function (root) {
  "use strict";

  /* v5.2：删一条撤销 5 秒；「清空全部」仍是 10 秒 */
  var UNDO_MS = 5000;
  var CLEAR_UNDO_MS = 10000;

  function indexOfId(items, id) {
    var list = items || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return i;
    }
    return -1;
  }

  /** 删除一条。返回 { items, removed, index }；找不到时 removed 为 null，items 原样复制。 */
  function removeItem(items, id) {
    var list = (items || []).slice();
    var index = indexOfId(list, id);
    if (index === -1) return { items: list, removed: null, index: -1 };
    var removed = list.splice(index, 1)[0];
    return { items: list, removed: removed, index: index };
  }

  /** 撤销删除：放回原来的位置。同 id 已存在时不重复放入。 */
  function restoreItem(items, removed, index) {
    var list = (items || []).slice();
    if (!removed) return list;
    if (indexOfId(list, removed.id) !== -1) return list;
    var at = typeof index === "number" && index >= 0 ? Math.min(index, list.length) : list.length;
    list.splice(at, 0, removed);
    return list;
  }

  /** 清空全部。返回 { items: [], removed: 原数组副本 }，撤销时直接用 removed。 */
  function clearItems(items) {
    return { items: [], removed: (items || []).slice() };
  }

  function clean(v) {
    return String(v == null ? "" : v).trim();
  }

  function shiftIso(iso, days) {
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!p || !days) return iso;
    var d = new Date(Date.UTC(Number(p[1]), Number(p[2]) - 1, Number(p[3]) + days));
    var mm = d.getUTCMonth() + 1;
    var dd = d.getUTCDate();
    return d.getUTCFullYear() + "-" + (mm < 10 ? "0" : "") + mm + "-" + (dd < 10 ? "0" : "") + dd;
  }

  function dayDiff(a, b) {
    var pa = /^(\d{4})-(\d{2})-(\d{2})$/.exec(a || "");
    var pb = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b || "");
    if (!pa || !pb) return 0;
    return Math.round(
      (Date.UTC(+pb[1], +pb[2] - 1, +pb[3]) - Date.UTC(+pa[1], +pa[2] - 1, +pa[3])) / 86400000
    );
  }

  /** 表单里的“类型”值（与手动填写下拉框一致）。 */
  function typeValue(item) {
    if (!item) return "地点";
    if (item.type === "flight") return "机票";
    if (item.type === "hotel") return "酒店";
    if (item.subtype === "餐厅" || item.subtype === "景点" || item.subtype === "街道") return "地点/" + item.subtype;
    return "地点";
  }

  /** 把一条行程变成表单字段，用来预填。 */
  function formFields(item) {
    item = item || {};
    if (item.type === "flight") {
      return {
        type: "机票",
        name: item.flightNo || "",
        address: "",
        date: item.departDate || item.dateGuess || "",
        time: item.departTime || "",
        endDate: item.arriveDate || item.pendingTo || "",
        endTime: item.arriveTime || "",
        note: item.note || ""
      };
    }
    if (item.type === "hotel") {
      return {
        type: "酒店",
        name: item.nameZh || item.nameEn || "",
        address: item.address || "",
        date: item.checkIn || item.dateGuess || "",
        time: item.checkInTime || "",
        endDate: item.checkOut || item.pendingTo || "",
        endTime: item.checkOutTime || "",
        note: item.note || ""
      };
    }
    return {
      type: typeValue(item),
      name: item.nameZh || item.nameEn || "",
      address: item.address || "",
      date: item.date || item.dateGuess || "",
      time: item.time || "",
      endDate: "",
      endTime: "",
      note: item.note || ""
    };
  }

  function setOrDelete(obj, key, value) {
    if (value) obj[key] = value;
    else delete obj[key];
  }

  /**
   * 用表单内容生成修改后的新对象（不改原对象）。id、坐标、确认号、座位等其他字段保留。
   * 地址变了：去掉坐标，addressChanged=true，由调用方重新查位置。
   * 返回 { item, addressChanged, error }。
   */
  function applyForm(item, form) {
    form = form || {};
    var next = Object.assign({}, item);
    var name = clean(form.name);
    if (!name) return { item: item, addressChanged: false, error: "请先填写名称。" };
    var addressChanged = false;

    if (item.type === "flight") {
      next.flightNo = name;
      var oldDepart = item.departDate || "";
      var newDepart = clean(form.date);
      setOrDelete(next, "departDate", newDepart);
      setOrDelete(next, "departTime", clean(form.time));
      setOrDelete(next, "arriveTime", clean(form.endTime));
      var endDate = clean(form.endDate);
      if (endDate && endDate !== (item.arriveDate || "")) {
        next.arriveDate = endDate;
      } else if (item.arriveDate && oldDepart && newDepart && newDepart !== oldDepart) {
        next.arriveDate = shiftIso(item.arriveDate, dayDiff(oldDepart, newDepart));
      } else if (!item.arriveDate && newDepart) {
        next.arriveDate = newDepart;
      }
      setOrDelete(next, "note", clean(form.note));
      clearPendingIfDated(next);
      return { item: next, addressChanged: false, error: "" };
    }

    var type = clean(form.type) || typeValue(item);
    if (type === "机票") type = typeValue(item);
    var oldWhen = item.type === "hotel" ? item.checkIn || "" : item.date || "";
    var oldTime = item.type === "hotel" ? item.checkInTime || "" : item.time || "";
    var date = form.date != null ? clean(form.date) : oldWhen;
    var time = form.time != null ? clean(form.time) : oldTime;

    next.nameZh = name;
    var address = clean(form.address);
    if (address !== clean(item.address)) {
      addressChanged = true;
      next.address = address || name;
      delete next.lat;
      delete next.lng;
      delete next.city;
    }

    if (type === "酒店") {
      next.type = "hotel";
      delete next.subtype;
      delete next.date;
      delete next.time;
      setOrDelete(next, "checkIn", date);
      setOrDelete(next, "checkInTime", time);
      if (form.endDate != null) setOrDelete(next, "checkOut", clean(form.endDate));
      if (form.endTime != null) setOrDelete(next, "checkOutTime", clean(form.endTime));
    } else {
      next.type = "place";
      var sub = type.indexOf("/") !== -1 ? type.split("/")[1] : "";
      setOrDelete(next, "subtype", sub);
      delete next.checkIn;
      delete next.checkInTime;
      delete next.checkOut;
      delete next.checkOutTime;
      setOrDelete(next, "date", date);
      setOrDelete(next, "time", time);
    }
    setOrDelete(next, "note", clean(form.note));
    if (next.type === "flight") delete next.arriveEarlyOk;
    clearPendingIfDated(next);
    return { item: next, addressChanged: addressChanged, error: "" };
  }

  function isIso(v) {
    return /^\d{4}-\d{2}-\d{2}$/.test(v || "");
  }

  function daysBetween(a, b) {
    return dayDiff(a, b);
  }

  /** 机票落地日期早于起飞日期要标待确认。用户点「对的」后记 arriveEarlyOk，不再反复标。 */
  var FLIGHT_EARLY_LIMIT_DAYS = 0;

  /** 这条的日期是否“说得通”：酒店退房不早于入住；机票落地不早于起飞（除非用户已确认）。 */
  function rangeProblem(item) {
    if (!item) return "";
    if (item.type === "hotel" && isIso(item.checkIn) && isIso(item.checkOut) && item.checkOut < item.checkIn) return "hotel-reversed";
    if (item.type === "flight" && isIso(item.departDate) && isIso(item.arriveDate) && item.arriveDate < item.departDate) {
      if (item.arriveEarlyOk) return "";
      return "flight-reversed";
    }
    return "";
  }

  /** 「对的」：保留原来的起飞/落地日期，从待确认里拿掉。 */
  function acceptEarlyArrival(item) {
    if (!item || item.type !== "flight") return item;
    var next = Object.assign({}, item);
    if (next.pendingFrom) next.departDate = next.pendingFrom;
    if (next.pendingTo) next.arriveDate = next.pendingTo;
    next.arriveEarlyOk = true;
    PENDING_KEYS.forEach(function (k) { delete next[k]; });
    return next;
  }

  var PENDING_KEYS = ["pendingDate", "dateRaw", "dateGuess", "pendingReason", "pendingKind", "pendingFrom", "pendingTo"];

  /**
   * 「日期待确认」的条目：修改后有了有效、说得通的日期就去掉标记和原文。
   * 日期还是倒过来的：保持待确认，记下新填的两个日期（卡片上显示），并把日期字段清空，避免日期条按错的日期显示。
   */
  function clearPendingIfDated(next) {
    if (!next || !next.pendingDate) return next;
    var d = next.type === "flight" ? next.departDate : next.type === "hotel" ? next.checkIn : next.date;
    if (!isIso(d)) return next;
    var problem = rangeProblem(next);
    if (problem) {
      next.pendingKind = problem;
      if (problem === "hotel-reversed") {
        next.pendingFrom = next.checkIn;
        next.pendingTo = next.checkOut;
        next.dateGuess = next.checkIn;
        next.checkIn = "";
        next.checkOut = "";
      } else {
        next.pendingFrom = next.departDate;
        next.pendingTo = next.arriveDate;
        next.dateGuess = next.departDate;
        next.departDate = "";
        next.arriveDate = "";
      }
      return next;
    }
    PENDING_KEYS.forEach(function (k) {
      delete next[k];
    });
    return next;
  }

  /** 是否「日期待确认」。 */
  function isPendingDate(item) {
    return !!(item && item.pendingDate);
  }

  /** 原地替换同 id 的一条（位置不变）。 */
  function updateItem(items, id, nextItem) {
    var list = (items || []).slice();
    var index = indexOfId(list, id);
    if (index === -1) return list;
    list[index] = nextItem;
    return list;
  }

  /**
   * v5.2「补地址」：把搜到的地点填进同一条，只改地址和坐标；名字、日期、图标、备注等全部保留。
   * 坐标统一存 WGS-84（项目约定）：高德结果在 geocode.js 里已转成 WGS-84（coordSystem "wgs84"）；
   * 万一传进来的是 GCJ-02，就在这里转一次。到高德底图 / 高德导航时再按需转回 GCJ-02（geo.js）。
   */
  function applyFoundPlace(item, cand, address) {
    var next = JSON.parse(JSON.stringify(item || {}));
    if (!cand || !isFinite(cand.lat) || !isFinite(cand.lng)) return next;
    var lat = Number(cand.lat);
    var lng = Number(cand.lng);
    if (cand.coordSystem === "gcj02" && root.GeoUtil && typeof root.GeoUtil.gcj02ToWgs84 === "function") {
      var w = root.GeoUtil.gcj02ToWgs84(lat, lng);
      if (w && isFinite(w.lat) && isFinite(w.lng)) {
        lat = w.lat;
        lng = w.lng;
      }
    }
    next.lat = lat;
    next.lng = lng;
    var addr = String(address || cand.displayName || "").trim();
    if (addr) next.address = addr;
    /* v5.2：地图服务返回的城市，没有就删掉旧的（地址换了，旧城市不一定对） */
    var city = String(cand.city || "").trim();
    if (city) next.city = city;
    else delete next.city;
    return next;
  }

  var api = {
    applyFoundPlace: applyFoundPlace,
    UNDO_MS: UNDO_MS,
    CLEAR_UNDO_MS: CLEAR_UNDO_MS,
    indexOfId: indexOfId,
    removeItem: removeItem,
    restoreItem: restoreItem,
    clearItems: clearItems,
    typeValue: typeValue,
    formFields: formFields,
    applyForm: applyForm,
    updateItem: updateItem,
    isPendingDate: isPendingDate,
    clearPendingIfDated: clearPendingIfDated,
    rangeProblem: rangeProblem,
    FLIGHT_EARLY_LIMIT_DAYS: FLIGHT_EARLY_LIMIT_DAYS,
    acceptEarlyArrival: acceptEarlyArrival
  };
  root.ItemEdit = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
