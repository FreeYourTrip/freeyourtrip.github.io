/**
 * v6：本机数据的读写和搬家（纯逻辑，storage 由调用方传入：浏览器里是 localStorage，检查里是假的）。
 *
 * v6 数据只存一个 key（一次写入，不会写一半）：
 *   wishlist-map-data-v2 = { schema: 2, trips: [...], places: [...], activeTripId, examplesLoaded }
 * 每个行程：{ id, nameZh, nameEn?, items: [...], legs?, theme?, ...旧字段原样保留 }
 *   theme（第 4 批才有界面，这里只保留字段，不认识的子字段也不丢）：
 *   { mode: "global"|"own", themeId?, overrides?: { 板块: "#rrggbb" }, bg?: { imageId, crop, strength: "light"|"medium"|"strong" } }
 *   没有 theme = 跟随全局。
 *
 * 搬家（v5.3 → v6）：读 wishlist-map-trips-v1（再老的 wishlist-map-imported-trips-v1 也认）→
 *   先把原文复制到 wishlist-map-trips-v1-backup → 写新 key → 读回来核对行程数和条目数 → 核对通过才删 backup。
 *   旧 key 本身不改、不删（留着以防回退；清空本机数据时会一起清掉）。重复搬结果一样（地点 id 按行程 id + 条目 id 生成）。
 *   数据坏了：不崩，返回空行程，旧数据原样留着；新 key 坏了会另存一份 -corrupt 再从旧 key 重搬。
 */
(function (root) {
  "use strict";

  var Places = root.Places || (typeof require === "function" ? require("./places.js") : null);

  var KEY = "wishlist-map-data-v2";
  var V1_KEY = "wishlist-map-trips-v1";
  var V0_KEY = "wishlist-map-imported-trips-v1";
  var BACKUP_KEY = "wishlist-map-trips-v1-backup";
  var CORRUPT_KEY = "wishlist-map-data-v2-corrupt";
  var SCHEMA = 2;

  function isObj(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }
  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function normalizeTheme(theme) {
    if (!isObj(theme)) return undefined;
    var t = clone(theme);
    if (t.mode !== "own") t.mode = "global";
    return t;
  }

  /** 修好一个行程：保证有 id、名字、items 数组；坏条目（不是对象）丢掉，其它字段原样保留 */
  function normalizeTrip(trip, index, usedIds) {
    if (!isObj(trip)) return null;
    var t = clone(trip);
    var id = String(t.id == null ? "" : t.id).trim() || "trip-" + (index + 1);
    var base = id;
    var n = 1;
    while (usedIds[id]) {
      n += 1;
      id = base + "-" + n;
    }
    usedIds[id] = true;
    t.id = id;
    if (typeof t.nameZh !== "string" || !t.nameZh.trim()) t.nameZh = "我的行程";
    var seen = {};
    t.items = (Array.isArray(t.items) ? t.items : []).filter(isObj).map(function (it, k) {
      var iid = String(it.id == null ? "" : it.id).trim() || "item-" + (k + 1);
      while (seen[iid]) iid = iid + "-b";
      seen[iid] = true;
      if (it.id !== iid) it.id = iid;
      return it;
    });
    var theme = normalizeTheme(t.theme);
    if (theme) t.theme = theme;
    else delete t.theme;
    return t;
  }

  function normalizeTrips(list) {
    var used = {};
    return (Array.isArray(list) ? list : []).map(function (t, i) {
      return normalizeTrip(t, i, used);
    }).filter(Boolean);
  }

  /** 任意一份数据（v2、v1 对象、v0 数组）→ v6 内存形状。坏的返回 null。不改入参。 */
  function fromAny(parsed, opts) {
    opts = opts || {};
    var trips = null;
    var places = [];
    var active = "";
    var ex = false;
    if (Array.isArray(parsed)) {
      trips = parsed;
    } else if (isObj(parsed) && Array.isArray(parsed.trips)) {
      trips = parsed.trips;
      active = typeof parsed.activeTripId === "string" ? parsed.activeTripId : "";
      ex = !!parsed.examplesLoaded;
      if (Array.isArray(parsed.places)) places = parsed.places;
    } else {
      return null;
    }
    var state = {
      schema: SCHEMA,
      trips: normalizeTrips(trips),
      places: Places.normalizeAll(places),
      activeTripId: active,
      examplesLoaded: ex
    };
    /* 搬家从不合并地点（IT老板 19:10） */
    Places.linkAll(state.trips, state.places, { today: opts.today || "", noMerge: true });
    if (!state.trips.some(function (t) { return t.id === state.activeTripId; })) {
      state.activeTripId = state.trips.length ? state.trips[0].id : "";
    }
    return state;
  }

  function countItems(state) {
    return (state.trips || []).reduce(function (n, t) { return n + (t.items || []).length; }, 0);
  }

  function safeGet(storage, key) {
    try {
      return storage.getItem(key);
    } catch (err) {
      return null;
    }
  }
  function safeSet(storage, key, val) {
    try {
      storage.setItem(key, val);
      return true;
    } catch (err) {
      return false;
    }
  }
  function safeRemove(storage, key) {
    try {
      storage.removeItem(key);
    } catch (err) {}
  }
  function tryParse(raw) {
    if (raw == null || raw === "") return { ok: false, empty: true };
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch (err) {
      return { ok: false, empty: false };
    }
  }

  function serialize(state) {
    return JSON.stringify({
      schema: SCHEMA,
      trips: state.trips || [],
      places: state.places || [],
      activeTripId: state.activeTripId || "",
      examplesLoaded: !!state.examplesLoaded
    });
  }

  /** 写入并读回核对。返回 true / false。 */
  function save(storage, state) {
    var raw = serialize(state);
    if (!safeSet(storage, KEY, raw)) return false;
    var back = tryParse(safeGet(storage, KEY));
    return !!(back.ok && isObj(back.value) && Array.isArray(back.value.trips) &&
      back.value.trips.length === (state.trips || []).length && countItems(back.value) === countItems(state));
  }

  /**
   * 读本机数据。返回 { state|null, source: "v2"|"migrated"|"migrated-unsaved"|"none"|"corrupt", note }。
   * opts.readOnly：只读不写（不搬家、不备份），给「本机有没有行程」这类判断用。
   */
  function load(storage, opts) {
    opts = opts || {};
    var v2raw = safeGet(storage, KEY);
    var v2 = tryParse(v2raw);
    if (v2.ok) {
      var s2 = fromAny(v2.value, opts);
      if (s2) return { state: s2, source: "v2" };
    }
    if (!v2.empty && !opts.readOnly && safeGet(storage, CORRUPT_KEY) == null) safeSet(storage, CORRUPT_KEY, String(v2raw));

    var oldKey = safeGet(storage, V1_KEY) != null ? V1_KEY : safeGet(storage, V0_KEY) != null ? V0_KEY : "";
    if (!oldKey) return { state: null, source: v2.empty ? "none" : "corrupt" };
    var oldRaw = safeGet(storage, oldKey);
    var old = tryParse(oldRaw);
    var s1 = old.ok ? fromAny(old.value, opts) : null;
    if (!s1) return { state: null, source: "corrupt", note: oldKey + " 读不懂，原样留着" };
    if (Array.isArray(old.value) && s1.trips.length) s1.activeTripId = s1.trips[0].id;
    if (opts.readOnly) return { state: s1, source: "migrated-unsaved" };
    safeSet(storage, BACKUP_KEY, oldRaw);
    if (save(storage, s1)) {
      safeRemove(storage, BACKUP_KEY);
      return { state: s1, source: "migrated" };
    }
    return { state: s1, source: "migrated-unsaved", note: "新数据没写成功，备份留着，下次打开再搬" };
  }

  /**
   * 导入备份 / 分享文件（纯函数，不改入参）。cur / incoming 都是 { trips, places, activeTripId, examplesLoaded }。
   *   replace：整份换成文件里的（旧文件没有 places，条目现连地点库）。
   *   merge：文件里的每个行程都加成单独的行程（id 撞了加 -2、-3…），不并进同名行程；
   *          本机只有一个空的默认行程时，直接被导入的行程替掉；能自动认作同一个的地点用本机的。
   * 返回新的 state，外加 addedTripIds。
   */
  /** 手机上只有一个空的默认行程（导入时直接换掉它，不算重复） */
  function onlyEmptyDefault(trips) {
    return (trips || []).length === 1 && !((trips[0] && trips[0].items) || []).length;
  }
  /**
   * 合并导入前：文件里哪些行程本机已经有了（同一个 id）。返回 [{ id, name, items, localName, localItems }]。
   * 界面拿这个去问「已经有一趟『…』了」（覆盖 / 另存一份 / 取消），答案交给 importInto 的 opts.onConflict。
   */
  function tripConflicts(cur, incoming) {
    var local = (cur && cur.trips) || [];
    if (onlyEmptyDefault(local)) return [];
    return normalizeTrips(incoming && incoming.trips).filter(function (t) {
      return local.some(function (x) { return x && x.id === t.id; });
    }).map(function (t) {
      var mine = local.filter(function (x) { return x.id === t.id; })[0];
      return { id: t.id, name: t.nameZh || "", items: (t.items || []).length, localName: (mine && mine.nameZh) || "", localItems: ((mine && mine.items) || []).length };
    });
  }

  /**
   * 导入。mode "replace" 整份换掉；"merge" 每个行程单独加进来。
   * opts.onConflict：{ 行程id: "overwrite" | "copy" }，本机已有同 id 的行程时用；没写 = "copy"（另存一份，id 加 -2）。
   */
  function importInto(cur, incoming, mode, opts) {
    opts = opts || {};
    var inTrips = normalizeTrips(incoming && incoming.trips);
    var inPlaces = Places.normalizeAll(incoming && incoming.places);
    var out;
    if (mode === "replace") {
      out = { schema: SCHEMA, trips: inTrips, places: inPlaces, activeTripId: (incoming && incoming.activeTripId) || "", examplesLoaded: !!(incoming && incoming.examplesLoaded) };
      /* 整份替换 = 把备份原样搬进来，跟搬家一样不合并 */
      Places.linkAll(out.trips, out.places, { today: opts.today || "", noMerge: true });
      if (!out.trips.some(function (t) { return t.id === out.activeTripId; })) out.activeTripId = out.trips.length ? out.trips[0].id : "";
      out.addedTripIds = out.trips.map(function (t) { return t.id; });
      return out;
    }
    var base = cur ? clone({ trips: cur.trips || [], places: cur.places || [] }) : { trips: [], places: [] };
    var trips = base.trips;
    var places = base.places;
    var idMap = Places.mergeInto(places, inPlaces);
    if (onlyEmptyDefault(trips) && inTrips.length) trips = [];
    var added = [];
    var onConflict = opts.onConflict || {};
    inTrips.forEach(function (t) {
      var copy = clone(t);
      var id = copy.id;
      var fixIds = function () {
        copy.items.forEach(function (it) {
          if (it.placeId && idMap[it.placeId]) it.placeId = idMap[it.placeId];
          else if (it.placeId && !Places.byId(places, it.placeId)) delete it.placeId;
        });
      };
      var at = -1;
      trips.forEach(function (x, i) { if (x.id === id) at = i; });
      if (at !== -1 && onConflict[id] === "overwrite") {
        /* 覆盖：原位换掉本机这一趟（地点库、备注、去过记录都留着） */
        fixIds();
        trips[at] = copy;
        added.push(id);
        return;
      }
      var n = 1;
      while (trips.some(function (x) { return x.id === id; })) {
        n += 1;
        id = t.id + "-" + n;
      }
      if (id !== t.id && copy.nameZh) copy.nameZh = copy.nameZh + "（副本）";
      copy.id = id;
      fixIds();
      trips.push(copy);
      added.push(id);
    });
    Places.linkAll(trips, places, { today: opts.today || "" });
    var active = added[0] || (cur && cur.activeTripId) || "";
    if (!trips.some(function (t) { return t.id === active; })) active = trips.length ? trips[0].id : "";
    return {
      schema: SCHEMA,
      trips: trips,
      places: places,
      activeTripId: active,
      examplesLoaded: !!(cur && cur.examplesLoaded) || !!(incoming && incoming.examplesLoaded),
      addedTripIds: added
    };
  }

  function newTripId(trips) {
    var id;
    var n = 0;
    do {
      n += 1;
      id = "trip-" + Date.now().toString(36) + (n > 1 ? "-" + n : "");
    } while ((trips || []).some(function (t) { return t.id === id; }));
    return id;
  }
  /** 新建行程的默认名字：「新行程」「新行程 2」… */
  function newTripName(trips) {
    var names = (trips || []).map(function (t) { return t.nameZh; });
    if (names.indexOf("新行程") === -1) return "新行程";
    var n = 2;
    while (names.indexOf("新行程 " + n) !== -1) n += 1;
    return "新行程 " + n;
  }

  var api = {
    KEY: KEY,
    V1_KEY: V1_KEY,
    V0_KEY: V0_KEY,
    BACKUP_KEY: BACKUP_KEY,
    CORRUPT_KEY: CORRUPT_KEY,
    SCHEMA: SCHEMA,
    normalizeTrip: normalizeTrip,
    normalizeTrips: normalizeTrips,
    normalizeTheme: normalizeTheme,
    fromAny: fromAny,
    countItems: countItems,
    importInto: importInto,
    tripConflicts: tripConflicts,
    serialize: serialize,
    save: save,
    load: load,
    newTripId: newTripId,
    newTripName: newTripName
  };
  root.TripStore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
