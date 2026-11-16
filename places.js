/**
 * v6：统一的地点库（纯函数，不碰 localStorage / 网络 / DOM）。收藏、记忆（备注跟着地点走）、去过、附近收藏都用它。
 *
 * 地点：
 *   { id, name, nameEn, type: "food"|"hotel"|"sight"|"street"|"place", subtype, tags: [],
 *     lat?, lng?, poiId?, city, country, address, note,
 *     wish: null | { savedAt: "YYYY-MM-DD" },                       // 收藏·想去
 *     visits: [{ id, date, tripId, nights?, cancelled? }],          // 去过；住一次酒店 = 1 次，记几晚；「没去成」= cancelled
 *     createdAt, updatedAt }
 * 小类 tags：饭店可选「堂食」「外卖」（可都选，可不选）；酒店「酒店」或「民宿」，默认「酒店」。
 * 行程条目用 item.placeId 指向地点。只有酒店和地点会连到地点库；交通不连。
 *
 * 认同一个地点（IT老板 17:49 定两档；19:10 补：批量导入也按这个来）：
 *   自动：同一个地图 POI id（不看距离），或规范化后名字完全一样并且相距 100 米以内；
 *   问「是上次那家吗？」：名字完全一样、相距 100 米–1 公里；或名字一个包含另一个、中文名 / 英文名有一个相同（1 公里以内）；
 *   超过 1 公里：当新地点；
 *   没坐标：名字一样 + 城市一样 → 也只问，不自动合并。
 *   旧数据搬家（linkAll 的 noMerge）从不合并：每条各建一个地点。
 */
(function (root) {
  "use strict";

  var AUTO_RADIUS_M = 100;
  /* 猜的（待确认）：有坐标时「问一句」只问 1 公里以内的，免得连锁店（同名、不同城）每次都问 */
  var ASK_RADIUS_M = 1000; /* 19:10 IT老板 定：同名 100 米–1 公里问，超过 1 公里算新地点 */
  var FOOD_TAGS = ["堂食", "外卖"];
  var HOTEL_TAGS = ["酒店", "民宿"];

  var PUNCT_RE = /[\s~`!@#$%^&*()\-_=+\[\]{}\\|;:'",.<>\/?·•・、，。！？；：‘’“”（）【】《》「」『』〈〉—–…]+/g;

  function str(v) {
    return v == null ? "" : String(v);
  }
  function toHalfWidth(s) {
    return str(s).replace(/[\uFF01-\uFF5E]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
    }).replace(/\u3000/g, " ");
  }
  /** 规范化名字：全角转半角、小写、去掉空格和标点 */
  function normName(s) {
    return toHalfWidth(s).toLowerCase().replace(PUNCT_RE, "");
  }
  function normCity(s) {
    return normName(s).replace(/(市|区|県|县)$/, "");
  }
  function hasCoords(p) {
    return !!p && typeof p.lat === "number" && typeof p.lng === "number" && isFinite(p.lat) && isFinite(p.lng);
  }
  /** 两点距离（米） */
  function distanceM(a, b) {
    var R = 6371000;
    var dLat = ((b.lat - a.lat) * Math.PI) / 180;
    var dLng = ((b.lng - a.lng) * Math.PI) / 180;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function namesOf(p) {
    var out = [];
    [p && p.name, p && p.nameEn, p && p.nameZh].forEach(function (n) {
      var k = normName(n);
      if (k && out.indexOf(k) === -1) out.push(k);
    });
    return out;
  }
  /** "equal"：任意两个名字规范化后完全一样；"contains"：一个包含另一个（短的至少 2 个字）；否则 "" */
  function nameRelation(a, b) {
    var na = namesOf(a);
    var nb = namesOf(b);
    var rel = "";
    na.forEach(function (x) {
      nb.forEach(function (y) {
        if (x === y) rel = "equal";
        else if (rel !== "equal" && Math.min(x.length, y.length) >= 2 && (x.indexOf(y) !== -1 || y.indexOf(x) !== -1)) rel = "contains";
      });
    });
    return rel;
  }
  function family(type) {
    return type === "hotel" ? "hotel" : "other";
  }

  /**
   * 给一个候选（地点形状，至少有 name）在库里找同一个地点。
   * 返回 { kind: "auto"|"ask"|"new", place?, reason? }。opts.exclude = 不再问的地点 id 列表。
   */
  function match(cand, places, opts) {
    opts = opts || {};
    var exclude = opts.exclude || [];
    var best = { kind: "new" };
    var bestD = Infinity;
    var askD = Infinity;
    (places || []).forEach(function (p) {
      if (!p || exclude.indexOf(p.id) !== -1) return;
      if (family(p.type) !== family(cand.type)) return;
      var rel = nameRelation(cand, p);
      var samePoi = !!(cand.poiId && p.poiId && str(cand.poiId) === str(p.poiId));
      /* 同一个地图 POI：就是同一个地方，不看距离 */
      if (samePoi) {
        var dp = hasCoords(cand) && hasCoords(p) ? distanceM(cand, p) : 0;
        if (best.kind !== "auto" || dp < bestD) {
          best = { kind: "auto", place: p, reason: "poi", distanceM: Math.round(dp) };
          bestD = dp;
        }
        return;
      }
      if (hasCoords(cand) && hasCoords(p)) {
        var d = distanceM(cand, p);
        if (d <= AUTO_RADIUS_M && rel === "equal") {
          if (best.kind !== "auto" || d < bestD) {
            best = { kind: "auto", place: p, reason: "name", distanceM: Math.round(d) };
            bestD = d;
          }
          return;
        }
        if (best.kind === "auto") return;
        if (d <= ASK_RADIUS_M && rel) {
          if (d < askD) {
            best = { kind: "ask", place: p, reason: rel, distanceM: Math.round(d) };
            askD = d;
          }
        }
        return;
      }
      if (best.kind === "auto") return;
      /* 有一方没坐标：名字一样 + 城市一样 → 问 */
      if (rel === "equal" && normCity(cand.city) && normCity(cand.city) === normCity(p.city) && askD === Infinity) {
        best = { kind: "ask", place: p, reason: "name-city" };
        askD = 1e12;
      }
    });
    return best;
  }

  /* ---------- 从行程条目建地点 ---------- */

  var FOOD_RE = /餐厅|餐馆|饭店|美食|小吃|咖啡|酒吧|茶|restaurant|food|cafe|dining|bar/i;
  var SIGHT_RE = /景点|博物馆|公园|寺|神社|美术馆|attraction|museum|landmark|scenic|gallery|park/i;
  var STREET_RE = /街道|马路|步行街|大街|street|road/i;

  function placeTypeOf(item) {
    if (!item) return "place";
    if (item.type === "hotel") return "hotel";
    var s = str(item.subtype);
    if (FOOD_RE.test(s) || item.icon === "restaurant") return "food";
    if (STREET_RE.test(s) || item.icon === "street") return "street";
    if (SIGHT_RE.test(s) || item.icon === "attraction") return "sight";
    return "place";
  }
  /** 行程里能连到地点库的条目：酒店和地点（交通、机票不连） */
  function linkable(item) {
    return !!item && (item.type === "hotel" || item.type === "place") && !!(item.nameZh || item.nameEn);
  }
  function defaultTags(type, item) {
    if (type === "hotel") return [/民宿|guesthouse|b&b|airbnb/i.test(str(item && (item.nameZh || "") + " " + (item.nameEn || "") + " " + (item.subtype || ""))) ? "民宿" : "酒店"];
    return [];
  }
  function cleanTags(type, tags) {
    var list = Array.isArray(tags) ? tags.map(str) : [];
    if (type === "hotel") {
      var h = list.filter(function (t) { return HOTEL_TAGS.indexOf(t) !== -1; });
      return [h[0] || "酒店"];
    }
    if (type === "food") {
      return FOOD_TAGS.filter(function (t) { return list.indexOf(t) !== -1; });
    }
    return [];
  }
  function candidateFromItem(item) {
    var type = placeTypeOf(item);
    var c = {
      type: type,
      name: str(item.nameZh || item.nameEn).trim(),
      nameEn: str(item.nameEn).trim(),
      city: str(item.city).trim(),
      poiId: item.poiId ? str(item.poiId) : ""
    };
    if (hasCoords(item)) {
      c.lat = item.lat;
      c.lng = item.lng;
    }
    return c;
  }
  function placeFromItem(item, id, today) {
    var c = candidateFromItem(item);
    var p = {
      id: id,
      name: c.name,
      nameEn: c.nameEn,
      type: c.type,
      subtype: str(item.subtype),
      tags: defaultTags(c.type, item),
      city: c.city,
      country: str(item.country),
      address: str(item.address),
      note: str(item.note),
      wish: null,
      visits: [],
      createdAt: today || "",
      updatedAt: today || ""
    };
    if (c.poiId) p.poiId = c.poiId;
    if (hasCoords(c)) {
      p.lat = c.lat;
      p.lng = c.lng;
    }
    return p;
  }

  /** 修好一个可能残缺的地点（坏数据不让页面崩）；不是对象返回 null */
  function normalizePlace(p) {
    if (!p || typeof p !== "object" || Array.isArray(p)) return null;
    var out = Object.assign({}, p);
    out.id = str(p.id).trim();
    if (!out.id) return null;
    out.name = str(p.name);
    out.nameEn = str(p.nameEn);
    out.type = ["food", "hotel", "sight", "street", "place"].indexOf(p.type) !== -1 ? p.type : "place";
    out.tags = cleanTags(out.type, p.tags);
    out.city = str(p.city);
    out.country = str(p.country);
    out.address = str(p.address);
    out.note = str(p.note);
    if (!hasCoords(p)) {
      delete out.lat;
      delete out.lng;
    }
    out.wish = p.wish && typeof p.wish === "object" ? { savedAt: str(p.wish.savedAt) } : null;
    out.visits = (Array.isArray(p.visits) ? p.visits : []).filter(function (v) {
      return v && typeof v === "object";
    }).map(function (v) {
      var o = { id: str(v.id), date: str(v.date), tripId: str(v.tripId) };
      if (typeof v.nights === "number" && v.nights >= 0) o.nights = v.nights;
      if (v.cancelled) o.cancelled = true;
      return o;
    });
    return out;
  }
  function normalizeAll(list) {
    var seen = {};
    return (Array.isArray(list) ? list : []).map(normalizePlace).filter(function (p) {
      if (!p || seen[p.id]) return false;
      seen[p.id] = true;
      return true;
    });
  }

  function byId(places, id) {
    var i;
    for (i = 0; i < (places || []).length; i++) {
      if (places[i] && places[i].id === id) return places[i];
    }
    return null;
  }

  /** 备注跟着地点走：连上已有地点时，条目没写备注就用地点的；地点没备注就用条目的；两边都有且不同，各自保留 */
  function syncNoteOnLink(item, place) {
    if (!item.note && place.note) item.note = place.note;
    else if (item.note && !place.note) place.note = item.note;
  }
  /** 地点缺的坐标 / 城市 / 地址，用条目补（不覆盖已有的） */
  function fillFromItem(place, item) {
    if (!hasCoords(place) && hasCoords(item)) {
      place.lat = item.lat;
      place.lng = item.lng;
    }
    if (!place.city && item.city) place.city = str(item.city);
    if (!place.address && item.address) place.address = str(item.address);
    if (!place.poiId && item.poiId) place.poiId = str(item.poiId);
  }

  /**
   * 把一个条目连到地点库（会改 item 和 places）。
   * opts.idFor(item) → 新地点 id；opts.onAsk = "new"（导入、搬家：要问的也先建新的，不自动合并）或 "defer"（返回 ask，交给界面问）。
   * 返回 { action: "linked"|"auto"|"ask"|"new"|"skip", place? }。
   */
  function linkItem(item, places, opts) {
    opts = opts || {};
    if (!linkable(item)) return { action: "skip" };
    if (item.placeId && byId(places, item.placeId)) {
      fillFromItem(byId(places, item.placeId), item);
      return { action: "linked", place: byId(places, item.placeId) };
    }
    var m = opts.noMerge ? { kind: "new" } : match(candidateFromItem(item), places, { exclude: opts.exclude });
    if (m.kind === "auto") {
      item.placeId = m.place.id;
      syncNoteOnLink(item, m.place);
      fillFromItem(m.place, item);
      return { action: "auto", place: m.place };
    }
    if (m.kind === "ask" && opts.onAsk === "defer") return { action: "ask", place: m.place, reason: m.reason };
    var id = opts.idFor ? opts.idFor(item) : newId();
    while (byId(places, id)) id = id + "-b";
    var p = placeFromItem(item, id, opts.today);
    places.push(p);
    item.placeId = id;
    return { action: "new", place: p };
  }
  /** 用户答「是上次那家」：连到这个地点 */
  function linkTo(item, place) {
    item.placeId = place.id;
    syncNoteOnLink(item, place);
    fillFromItem(place, item);
    return place;
  }
  /**
   * 给所有行程的酒店 / 地点连地点库（搬家、导入用；要问的都先建新的）。重复跑结果不变。
   * opts.noMerge：旧数据搬家用，从不合并，每条各建一个地点（已有 placeId 的照旧连）。
   */
  function linkAll(trips, places, opts) {
    var stats = { linked: 0, auto: 0, created: 0 };
    (trips || []).forEach(function (t) {
      (t && Array.isArray(t.items) ? t.items : []).forEach(function (it) {
        var r = linkItem(it, places, {
          onAsk: "new",
          noMerge: !!(opts && opts.noMerge),
          today: opts && opts.today,
          idFor: function (item) { return "pl-" + slug(t.id) + "-" + slug(item.id); }
        });
        if (r.action === "linked") stats.linked += 1;
        else if (r.action === "auto") stats.auto += 1;
        else if (r.action === "new") stats.created += 1;
      });
    });
    return stats;
  }

  /** 改备注：改地点，并同步到所有行程里连着这个地点的条目。返回改了几条。 */
  function setNote(places, trips, placeId, note, today) {
    var p = byId(places, placeId);
    if (!p) return 0;
    p.note = str(note);
    if (today) p.updatedAt = today;
    var n = 0;
    (trips || []).forEach(function (t) {
      (t && t.items || []).forEach(function (it) {
        if (it && it.placeId === placeId) {
          if (p.note) it.note = p.note;
          else delete it.note;
          n += 1;
        }
      });
    });
    return n;
  }

  function setTags(place, tags) {
    place.tags = cleanTags(place.type, tags);
    return place.tags;
  }
  function setWish(place, savedAt) {
    place.wish = { savedAt: str(savedAt) };
    return place;
  }
  function clearWish(place) {
    place.wish = null;
    return place;
  }

  function dayDiff(a, b) {
    var pa = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(a));
    var pb = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(b));
    if (!pa || !pb) return null;
    return Math.round((Date.UTC(+pb[1], +pb[2] - 1, +pb[3]) - Date.UTC(+pa[1], +pa[2] - 1, +pa[3])) / 86400000);
  }
  /** 一个条目算一次到访：酒店住一次 = 1 次（记几晚），地点 = 1 次 */
  function visitFromItem(item, tripId) {
    if (!linkable(item)) return null;
    if (item.type === "hotel") {
      var nights = dayDiff(item.checkIn, item.checkOut);
      var v = { date: str(item.checkIn), tripId: str(tripId) };
      if (nights != null && nights >= 0) v.nights = nights;
      return v;
    }
    return { date: str(item.date), tripId: str(tripId) };
  }
  /** 记一次「去过」；同一行程同一天已有（且没取消）就不重复记 */
  function addVisit(place, visit) {
    if (!place.visits) place.visits = [];
    var dup = place.visits.filter(function (v) {
      return !v.cancelled && v.tripId === visit.tripId && v.date === visit.date;
    })[0];
    if (dup) return dup;
    var v = { id: visit.id || "v-" + (place.visits.length + 1) + "-" + str(visit.date).replace(/-/g, ""), date: str(visit.date), tripId: str(visit.tripId) };
    if (typeof visit.nights === "number") v.nights = visit.nights;
    place.visits.push(v);
    return v;
  }
  /** 「没去成」：取消这一次到访（留着记录，不算次数） */
  function cancelVisit(place, visitId) {
    var hit = (place.visits || []).filter(function (v) { return v.id === visitId; })[0];
    if (hit) hit.cancelled = true;
    return !!hit;
  }
  function visitCount(place) {
    return (place && place.visits || []).filter(function (v) { return !v.cancelled; }).length;
  }
  /** 删行程时勾了「同时删掉这趟的足迹」：去掉这个行程的到访记录。返回删了几条。 */
  function removeTripVisits(places, tripId) {
    var n = 0;
    (places || []).forEach(function (p) {
      var before = (p.visits || []).length;
      p.visits = (p.visits || []).filter(function (v) { return v.tripId !== tripId; });
      n += before - p.visits.length;
    });
    return n;
  }

  function tripVisitCount(places, tripId) {
    var n = 0;
    (places || []).forEach(function (p) {
      (p.visits || []).forEach(function (v) {
        if (!v.cancelled && str(v.tripId) === str(tripId)) n += 1;
      });
    });
    return n;
  }

  /** 条目对得上这个地点：优先 placeId，没有就比名字。 */
  function placeMatchesItem(place, item) {
    if (!place || !item) return false;
    if (item.placeId) return place.id === item.placeId;
    var a = normName(place.nameZh || place.name || "");
    var b = normName(item.nameZh || item.name || "");
    return !!(a && b && a === b);
  }

  /** 同一行程、同一天（酒店用入住日）的到访记录，算这一条的足迹。 */
  function visitMatchesItem(visit, item, tripId) {
    if (!visit || !item) return false;
    if (str(visit.tripId) !== str(tripId)) return false;
    var expected = visitFromItem(item, tripId);
    var d = expected && expected.date ? expected.date : "";
    if (d) return str(visit.date) === d;
    return true;
  }

  function itemHasVisit(places, item, tripId) {
    return (places || []).some(function (p) {
      if (!placeMatchesItem(p, item)) return false;
      return (p.visits || []).some(function (v) {
        return !v.cancelled && visitMatchesItem(v, item, tripId);
      });
    });
  }

  /** 删条目时勾了「同时删掉这里的足迹」：按行程 + 日期 + 地点去掉这一条的到访。返回删了几条。 */
  function removeItemVisits(places, tripId, item) {
    var n = 0;
    (places || []).forEach(function (p) {
      if (!placeMatchesItem(p, item)) return;
      var before = (p.visits || []).length;
      p.visits = (p.visits || []).filter(function (v) { return !visitMatchesItem(v, item, tripId); });
      n += before - p.visits.length;
    });
    return n;
  }

  /** 分享用：只要这些行程用到的地点，去掉收藏和去过 */
  function forShare(places, trips) {
    var used = {};
    (trips || []).forEach(function (t) {
      (t && t.items || []).forEach(function (it) {
        if (it && it.placeId) used[it.placeId] = true;
      });
    });
    return (places || []).filter(function (p) { return p && used[p.id]; }).map(function (p) {
      var c = JSON.parse(JSON.stringify(p));
      c.wish = null;
      c.visits = [];
      return c;
    });
  }

  /**
   * 把文件里的地点并进本机地点库（合并导入用）。能自动认作同一个的用本机的（本机没备注时用文件的备注）；
   * 其余加进来，id 撞了就换。返回 idMap：文件里的 id → 本机 id，调用方据此改条目的 placeId。
   */
  function mergeInto(local, incoming, opts) {
    var idMap = {};
    normalizeAll(incoming).forEach(function (p) {
      var m = match(p, local);
      if (m.kind === "auto") {
        idMap[p.id] = m.place.id;
        if (!m.place.note && p.note) m.place.note = p.note;
        if (!m.place.wish && p.wish) m.place.wish = p.wish;
        (p.visits || []).forEach(function (v) { addVisit(m.place, v); });
        return;
      }
      var id = p.id;
      var n = 1;
      while (byId(local, id)) {
        n += 1;
        id = p.id + "-" + n;
      }
      var copy = Object.assign({}, p, { id: id });
      local.push(copy);
      idMap[p.id] = id;
    });
    return idMap;
  }

  var seq = 0;
  function newId() {
    seq += 1;
    return "pl-" + Date.now().toString(36) + "-" + seq.toString(36) + Math.floor(Math.random() * 1296).toString(36);
  }
  function slug(s) {
    return str(s).replace(/[^\w\u4e00-\u9fff-]+/g, "_").slice(0, 40) || "x";
  }

  var api = {
    AUTO_RADIUS_M: AUTO_RADIUS_M,
    ASK_RADIUS_M: ASK_RADIUS_M,
    FOOD_TAGS: FOOD_TAGS,
    HOTEL_TAGS: HOTEL_TAGS,
    ASK_TITLE: "是上次那家吗？",
    normName: normName,
    distanceM: distanceM,
    nameRelation: nameRelation,
    match: match,
    placeTypeOf: placeTypeOf,
    linkable: linkable,
    candidateFromItem: candidateFromItem,
    placeFromItem: placeFromItem,
    normalizePlace: normalizePlace,
    normalizeAll: normalizeAll,
    byId: byId,
    linkItem: linkItem,
    linkTo: linkTo,
    linkAll: linkAll,
    fillFromItem: fillFromItem,
    setNote: setNote,
    setTags: setTags,
    cleanTags: cleanTags,
    setWish: setWish,
    clearWish: clearWish,
    visitFromItem: visitFromItem,
    addVisit: addVisit,
    cancelVisit: cancelVisit,
    visitCount: visitCount,
    removeTripVisits: removeTripVisits,
    tripVisitCount: tripVisitCount,
    itemHasVisit: itemHasVisit,
    removeItemVisits: removeItemVisits,
    forShare: forShare,
    mergeInto: mergeInto,
    newId: newId
  };
  root.Places = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
