/**
 * v6.1.3 行程分享链接 / 文字块。
 * ENABLED 为开关：文案和版本公告尚未全部定稿时，关掉则「分享我的行程」仍导出文件。
 * 浏览器是 window.ShareLink；node 里 require("./share-link.js")。
 */
(function (root) {
  "use strict";

  var ENABLED = true;
  var BASE = "https://freeyourtrip.github.io";
  var MAX_LINK_CHARS = 4000;
  var MAX_LINK_PLACES = 80;
  var MAX_DECODED_BYTES = 64 * 1024;
  var MAX_LINK_DATA_CHARS = 8000;
  var MAX_PASTE_BYTES = 1024 * 1024;
  var lastInflateBytes = 0;
  var HEADER = "【Free Your Trip】";
  var SEEN_KEY = "wishlist-map-share-seen-v1";
  var TEXT_TOAST = "行程太长，已改成一段文字，复制发给同行的人就行";
  var LINK_COPY_TOAST = "链接已复制，发给同行的人就行";
  var TEXT_COPY_TOAST = "文字已复制，发给同行的人就行";
  var COPY = {
    hint: "拿到链接的人都能看到这趟行程",
    notes: "把备注也分享出去",
    sendLink: "发链接",
    sendText: "改发文字",
    altHint: "链接打不开时用这个",
    friendTitle: "朋友分享了一趟行程",
    save: "存到我的行程",
    decline: "不要",
    saved: "已存到你的行程",
    dup: "这趟行程已经存过了",
    brokenTitle: "这个链接打不开",
    brokenBody: "这个链接没发完整，打不开。请对方分享时点『改发文字』，再发你一次",
    brokenOk: "知道了"
  };

  function utf8Bytes(str) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
    var buf = typeof Buffer !== "undefined" ? Buffer.from(str, "utf8") : null;
    if (buf) return new Uint8Array(buf);
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 128) out.push(c);
      else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
        out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63));
      } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
    }
    return new Uint8Array(out);
  }

  function bytesToB64url(u8) {
    if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
      return Buffer.from(u8).toString("base64url");
    }
    var s = "";
    var i;
    for (i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    var b64 = btoa(s);
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function b64urlToBytes(s) {
    var t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
    while (t.length % 4) t += "=";
    if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
      return new Uint8Array(Buffer.from(t, "base64"));
    }
    var bin = atob(t);
    var out = new Uint8Array(bin.length);
    var i;
    for (i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function zlibApi() {
    if (typeof require === "function") {
      try { return require("zlib"); } catch (err) { return null; }
    }
    return null;
  }

  function encodeSync(payload) {
    var z = zlibApi();
    if (!z) throw new Error("deflate-raw needs zlib or CompressionStream");
    var raw = z.deflateRawSync(Buffer.from(JSON.stringify(payload), "utf8"));
    return bytesToB64url(raw);
  }

  function maxDecodedBytes(limits) {
    return (limits && limits.maxBytes) ? limits.maxBytes : MAX_DECODED_BYTES;
  }

  function isLinkDataTooLong(data) {
    return String(data || "").length > MAX_LINK_DATA_CHARS;
  }

  function isPasteTooLong(text) {
    return utf8Bytes(String(text || "")).length > MAX_PASTE_BYTES;
  }

  function throwTooLarge() {
    var over = new Error("too-large");
    over.code = "too-large";
    throw over;
  }

  function decodeSync(data, limits) {
    var z = zlibApi();
    if (!z) throw new Error("inflate-raw needs zlib or DecompressionStream");
    var maxOut = maxDecodedBytes(limits);
    lastInflateBytes = 0;
    var buf;
    try {
      buf = z.inflateRawSync(Buffer.from(b64urlToBytes(data)), { maxOutputLength: maxOut });
      lastInflateBytes = buf.length;
    } catch (err) {
      var msg = String((err && err.code) || err || "");
      if (/ERR_BUFFER_TOO_LARGE|maxOutputLength|too large/i.test(msg)) {
        lastInflateBytes = maxOut;
        throwTooLarge();
      }
      var e = new Error("decode-failed");
      e.code = "decode-failed";
      throw e;
    }
    if (buf.length > maxOut) throwTooLarge();
    try {
      return JSON.parse(buf.toString("utf8"));
    } catch (err) {
      var bad = new Error("decode-failed");
      bad.code = "decode-failed";
      throw bad;
    }
  }

  function encode(payload) {
    try {
      return Promise.resolve(encodeSync(payload));
    } catch (err) {
      if (typeof CompressionStream === "undefined") return Promise.reject(err);
      var stream = new Blob([JSON.stringify(payload)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      return new Response(stream).arrayBuffer().then(function (ab) {
        return bytesToB64url(new Uint8Array(ab));
      });
    }
  }

  function inflateRawLimited(bytes, maxOut) {
    lastInflateBytes = 0;
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    var reader = stream.getReader();
    var chunks = [];
    var total = 0;
    function pump() {
      return reader.read().then(function (part) {
        if (part.done) {
          var out = new Uint8Array(total);
          var off = 0;
          var i;
          for (i = 0; i < chunks.length; i++) {
            out.set(chunks[i], off);
            off += chunks[i].length;
          }
          lastInflateBytes = total;
          return out;
        }
        var chunk = part.value;
        var n = chunk && chunk.length ? chunk.length : 0;
        total += n;
        lastInflateBytes = total;
        if (total > maxOut) {
          try { if (reader.cancel) reader.cancel(); } catch (err) {}
          throwTooLarge();
        }
        if (n) chunks.push(chunk);
        return pump();
      });
    }
    return pump();
  }

  function decode(data, limits) {
    var maxOut = maxDecodedBytes(limits);
    try {
      return Promise.resolve(decodeSync(data, limits));
    } catch (err) {
      if (err && (err.code === "too-large" || err.code === "decode-failed")) return Promise.reject(err);
      if (typeof DecompressionStream === "undefined") return Promise.reject(err);
      return inflateRawLimited(b64urlToBytes(data), maxOut).then(function (u8) {
        return JSON.parse(new TextDecoder("utf-8").decode(u8));
      }, function (err2) {
        if (err2 && err2.code === "too-large") throw err2;
        var bad = new Error("decode-failed");
        bad.code = "decode-failed";
        throw bad;
      });
    }
  }

  function stripNotes(payload) {
    var out = JSON.parse(JSON.stringify(payload || {}));
    function zap(obj) {
      if (!obj || typeof obj !== "object") return;
      if (Object.prototype.hasOwnProperty.call(obj, "note")) delete obj.note;
    }
    (out.trips || []).forEach(function (t) {
      zap(t);
      (t.items || []).forEach(zap);
      if (Array.isArray(t.legs)) t.legs.forEach(zap);
    });
    (out.places || []).forEach(zap);
    if (out.legs && typeof out.legs === "object" && !Array.isArray(out.legs)) {
      Object.keys(out.legs).forEach(function (k) { zap(out.legs[k]); });
    }
    return out;
  }

  function buildSharePayload(state, opts) {
    var B = root.BackupUtil || (typeof require === "function" ? require("./backup.js") : null);
    if (!B || !B.redactForShare) throw new Error("BackupUtil.redactForShare missing");
    state = state || {};
    opts = opts || {};
    var tripId = state.activeTripId;
    var trips = (state.trips || []).filter(function (t) { return t && t.id === tripId; });
    if (!trips.length && (state.trips || []).length) trips = [state.trips[0]];
    var slim = {
      app: "行程地图",
      version: B.FORMAT_VERSION || 2,
      trips: trips,
      places: state.places || [],
      activeTripId: trips[0] ? trips[0].id : "",
      examplesLoaded: !!state.examplesLoaded,
      legs: state.legs || {},
      statuses: {},
      wishlistLoaded: false
    };
    var out = B.redactForShare(slim);
    if (!opts.includeNotes) out = stripNotes(out);
    delete out.geocodeCache;
    delete out.exportedAt;
    return out;
  }

  function itemList(payload) {
    var list = [];
    (payload && payload.trips || []).forEach(function (t) {
      (t.items || []).forEach(function (it) { list.push(it); });
    });
    return list;
  }

  function placeCount(payload) {
    return itemList(payload).length;
  }

  function isYmd(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ""))) return false;
    var p = String(s).split("-");
    var y = Number(p[0]), mo = Number(p[1]), d = Number(p[2]);
    var dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  }

  function validCoordPair(lat, lng) {
    return typeof lat === "number" && typeof lng === "number" && isFinite(lat) && isFinite(lng) &&
      lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }

  function hasCoordFields(it) {
    return it && (it.lat != null && it.lat !== "") || (it.lng != null && it.lng !== "");
  }

  function dateFields(it) {
    if (!it) return [];
    return [it.date, it.checkIn, it.checkOut, it.departDate, it.arriveDate, it.endDate].filter(function (d) {
      return d != null && String(d).trim() !== "";
    });
  }

  var DATE_KEYS = ["date", "checkIn", "checkOut", "departDate", "arriveDate", "endDate"];
  var COORD_PAIRS = [["lat", "lng"], ["fromLat", "fromLng"], ["toLat", "toLng"], ["hintLat", "hintLng"]];

  function fieldPresent(v) {
    return v != null && String(v).trim() !== "";
  }

  /* 字段是否有问题（给测试用）。接收时不再因此丢掉整条，见 repairItem。 */
  function itemHasInvalid(it) {
    var i, pair, hasA, hasB;
    if (!it) return false;
    for (i = 0; i < COORD_PAIRS.length; i++) {
      pair = COORD_PAIRS[i];
      hasA = fieldPresent(it[pair[0]]);
      hasB = fieldPresent(it[pair[1]]);
      if ((hasA || hasB) && !validCoordPair(Number(it[pair[0]]), Number(it[pair[1]]))) return true;
    }
    for (i = 0; i < DATE_KEYS.length; i++) {
      if (fieldPresent(it[DATE_KEYS[i]]) && !isYmd(it[DATE_KEYS[i]])) return true;
    }
    return false;
  }

  /* 没名字且没地址、没航班/车次号，才视为没有可用内容，整条跳过。只有城市或类型不够。 */
  function itemHasUsableContent(it) {
    if (!it || typeof it !== "object") return false;
    var name = String(it.nameZh || it.name || it.nameEn || it.title || "").trim();
    var address = String(it.address || "").trim();
    var number = String(it.flightNo || it.flight || it.trainNo || it.number || "").trim();
    return !!(name || address || number);
  }

  function stripInvalidCoords(it) {
    var i, pair, hasA, hasB, stripped = false;
    for (i = 0; i < COORD_PAIRS.length; i++) {
      pair = COORD_PAIRS[i];
      hasA = fieldPresent(it[pair[0]]);
      hasB = fieldPresent(it[pair[1]]);
      if (!hasA && !hasB) continue;
      if (!validCoordPair(Number(it[pair[0]]), Number(it[pair[1]]))) {
        delete it[pair[0]];
        delete it[pair[1]];
        stripped = true;
      }
    }
    return stripped;
  }

  /* 只清掉写了但无法识别或不是真实日历日的日期，整条留下并标待补（与导入认不出日期时相同）。缺日期不标、不改。 */
  function stripInvalidDates(it) {
    var i, k, raw = [];
    for (i = 0; i < DATE_KEYS.length; i++) {
      k = DATE_KEYS[i];
      if (!fieldPresent(it[k])) continue;
      if (isYmd(it[k])) continue;
      raw.push(String(it[k]).trim());
      it[k] = "";
    }
    if (!raw.length) return false;
    it.pendingDate = true;
    if (!it.dateRaw) it.dateRaw = raw.join(" ");
    return true;
  }

  function repairItem(it) {
    var copy = sanitizeItem(it);
    stripInvalidCoords(copy);
    stripInvalidDates(copy);
    return copy;
  }

  function escapeText(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sanitizeValue(v) {
    if (v == null) return v;
    if (typeof v === "number" || typeof v === "boolean") return v;
    return String(v);
  }

  function sanitizeItem(it) {
    var copy = JSON.parse(JSON.stringify(it || {}));
    ["nameZh", "name", "nameEn", "title", "address", "note", "city"].forEach(function (k) {
      if (copy[k] != null) copy[k] = sanitizeValue(copy[k]);
    });
    return copy;
  }

  function sanitizePayload(payload) {
    var out = JSON.parse(JSON.stringify(payload || {}));
    out.trips = (out.trips || []).map(function (t) {
      var trip = Object.assign({}, t);
      if (trip.nameZh != null) trip.nameZh = sanitizeValue(trip.nameZh);
      if (trip.name != null) trip.name = sanitizeValue(trip.name);
      trip.items = (trip.items || []).filter(itemHasUsableContent).map(repairItem);
      return trip;
    }).filter(function (t) { return t; });
    out.places = (out.places || []).filter(itemHasUsableContent).map(repairItem);
    return out;
  }

  function escapedFields(payload) {
    var names = [];
    itemList(payload).forEach(function (it) {
      names.push(escapeText(it.nameZh || it.name || ""));
      names.push(escapeText(it.address || ""));
      names.push(escapeText(it.note || ""));
    });
    (payload.trips || []).forEach(function (t) { names.push(escapeText(t.nameZh || t.name || "")); });
    return names;
  }

  function cityOf(payload) {
    var TN = root.TripName || (typeof require === "function" ? require("./trip-name.js") : null);
    var items = itemList(payload);
    var counts = {};
    var best = "";
    var bestN = 0;
    items.forEach(function (it) {
      var c = "";
      if (TN && TN.cityOfItem) c = TN.cityOfItem(it) || "";
      if (!c && it && it.city) c = String(it.city).trim();
      if (!c && TN && TN.cityOfAddress) c = TN.cityOfAddress(it && it.address) || "";
      if (!c) return;
      counts[c] = (counts[c] || 0) + 1;
      if (counts[c] > bestN) { best = c; bestN = counts[c]; }
    });
    return best;
  }

  function itemDates(it) {
    return dateFields(it).filter(isYmd);
  }

  function ymdUtc(s) {
    var p = String(s).split("-");
    return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  /** 日历跨度：所有带日期条目的最晚一天 − 最早一天 + 1。没有日期则返回 0。 */
  function calendarDays(payload) {
    var dates = [];
    itemList(payload).forEach(function (it) {
      itemDates(it).forEach(function (d) { dates.push(d); });
    });
    if (!dates.length) return 0;
    dates.sort();
    return Math.round((ymdUtc(dates[dates.length - 1]) - ymdUtc(dates[0])) / 86400000) + 1;
  }

  function uniqueDays(payload) {
    return calendarDays(payload);
  }

  function summarize(payload) {
    var items = placeCount(payload);
    var days = calendarDays(payload);
    var city = cityOf(payload) || "行程";
    var parts = [city];
    if (days) parts.push(days + " 天");
    parts.push(items + " 项");
    return {
      city: city,
      days: days,
      places: items,
      items: items,
      line: parts.join(" · ")
    };
  }

  function makeLink(data) {
    return BASE + "/#s=" + data;
  }

  function textHeader(summary) {
    return HEADER + "朋友分享了一趟行程：" + summary.line + "。把这整段复制下来，打开 freeyourtrip.github.io，点底部『＋ 添加』，再点『粘贴朋友发来的行程』，最后点『粘贴并导入』就能存好。";
  }

  function makeTextBlock(summary, data) {
    return textHeader(summary) + "\n" + data;
  }

  /* 旧版文字块说明是「点『粘贴并导入』就能存好。」；新旧开头都是【Free Your Trip】，parseTextBlock 两种都认。 */
  var OLD_TEXT_HEADER_TAIL = "把这整段复制下来，打开 freeyourtrip.github.io，点『粘贴并导入』就能存好。";

  function parseTextBlock(text) {
    var t = String(text || "").replace(/^\uFEFF/, "").trim();
    if (t.indexOf(HEADER) === -1) return null;
    var lines = t.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var data = "";
    var i;
    for (i = lines.length - 1; i >= 0; i--) {
      if (/^[A-Za-z0-9_-]{16,}$/.test(lines[i])) { data = lines[i]; break; }
    }
    if (!data) return null;
    return { kind: "text", data: data };
  }

  function parseHash(hash) {
    var h = String(hash || "");
    if (h.charAt(0) === "#") h = h.slice(1);
    if (h.indexOf("s=") !== 0) return null;
    return { kind: "link", data: h.slice(2) };
  }

  function clearHash(loc, hist) {
    loc = loc || (typeof location !== "undefined" ? location : null);
    hist = hist || (typeof history !== "undefined" ? history : null);
    if (!loc) return "";
    var prev = loc.hash || "";
    if (hist && typeof hist.replaceState === "function") {
      var path = (loc.pathname || "/") + (loc.search || "");
      hist.replaceState(null, "", path);
    } else {
      loc.hash = "";
    }
    return prev;
  }

  function consumeHash(loc, hist) {
    loc = loc || (typeof location !== "undefined" ? location : null);
    var parsed = loc ? parseHash(loc.hash) : null;
    var prev = clearHash(loc, hist);
    return { parsed: parsed, prev: prev };
  }

  function canonical(payload) {
    function normItem(it) {
      return {
        type: it.type || "",
        name: it.nameZh || it.name || "",
        address: it.address || "",
        date: it.date || it.checkIn || it.departDate || "",
        end: it.checkOut || it.arriveDate || it.endDate || "",
        time: it.time || it.checkInTime || it.departTime || "",
        lat: it.lat == null ? null : it.lat,
        lng: it.lng == null ? null : it.lng,
        note: it.note || ""
      };
    }
    var trips = (payload && payload.trips || []).map(function (t) {
      var items = (t.items || []).map(normItem);
      items.sort(function (a, b) {
        return (a.date + a.time + a.name).localeCompare(b.date + b.time + b.name);
      });
      return { name: t.nameZh || t.name || "", items: items };
    });
    trips.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return JSON.stringify({ trips: trips });
  }

  function contentHash(payload) {
    var s = canonical(payload);
    if (typeof require === "function") {
      try { return require("crypto").createHash("sha256").update(s, "utf8").digest("hex"); } catch (err) {}
    }
    var h = 2166136261;
    var i;
    for (i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ("00000000" + (h >>> 0).toString(16)).slice(-8) + ":" + s.length.toString(16);
  }

  function readSeen(store) {
    store = store || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store) return [];
    try {
      var v = JSON.parse(store.getItem(SEEN_KEY) || "[]");
      return Array.isArray(v) ? v : [];
    } catch (err) { return []; }
  }

  function hasSeen(hash, store) {
    return readSeen(store).indexOf(hash) !== -1;
  }

  function markSeen(hash, store) {
    store = store || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store || !hash) return;
    var list = readSeen(store);
    if (list.indexOf(hash) !== -1) return;
    list.push(hash);
    try { store.setItem(SEEN_KEY, JSON.stringify(list)); } catch (err) {}
  }

  function linkLimits() {
    return { maxPlaces: MAX_LINK_PLACES, maxBytes: MAX_DECODED_BYTES };
  }

  function finalizeIncoming(kind, payload) {
    if (kind === "link" && placeCount(payload) > MAX_LINK_PLACES) {
      return { ok: false, error: "too-many-places" };
    }
    payload = sanitizePayload(payload);
    if (!payload.trips || !payload.trips.length) return { ok: false, error: "empty" };
    return { ok: true, payload: payload, summary: summarize(payload), hash: contentHash(payload) };
  }

  function incomingLimits(kind) {
    return kind === "link" ? linkLimits() : { maxBytes: MAX_PASTE_BYTES };
  }

  function rejectIncomingEarly(kind, data) {
    if (kind === "link" && isLinkDataTooLong(data)) return { ok: false, error: "too-large" };
    if (kind === "text" && isPasteTooLong(data)) return { ok: false, error: "too-large" };
    return null;
  }

  function decodeIncoming(kind, data) {
    var early = rejectIncomingEarly(kind, data);
    if (early) return early;
    var limits = incomingLimits(kind);
    try {
      return finalizeIncoming(kind, decodeSync(data, limits));
    } catch (err) {
      return { ok: false, error: (err && err.code) || "decode-failed" };
    }
  }

  function decodeIncomingAsync(kind, data) {
    var early = rejectIncomingEarly(kind, data);
    if (early) return Promise.resolve(early);
    var limits = incomingLimits(kind);
    return decode(data, limits).then(function (payload) {
      return finalizeIncoming(kind, payload);
    }, function (err) {
      return { ok: false, error: (err && err.code) || "decode-failed" };
    });
  }

  function shouldFallbackToText(payload, link) {
    return !!(link && link.length > MAX_LINK_CHARS) || placeCount(payload) > MAX_LINK_PLACES;
  }

  /* ---------- UI (browser only) ---------- */
  function toast(msg) {
    if (root.TripApp && typeof root.TripApp.toast === "function") root.TripApp.toast(msg);
  }

  function closeSheet(id) {
    var el = typeof document !== "undefined" ? document.getElementById(id) : null;
    if (el) el.hidden = true;
  }
  function openEl(id) {
    var el = typeof document !== "undefined" ? document.getElementById(id) : null;
    if (el) el.hidden = false;
    return el;
  }

  function notesOn() {
    var el = document.getElementById("share-link-notes");
    return !!(el && el.checked);
  }

  function currentState() {
    if (root.TripApp && typeof root.TripApp.exportState === "function") return root.TripApp.exportState();
    return { trips: [], places: [], activeTripId: "" };
  }

  function shareOrCopy(kind, value, fallbackToast) {
    var nav = typeof navigator !== "undefined" ? navigator : null;
    var payload = kind === "url" ? { title: "Free Your Trip", url: value } : { title: "Free Your Trip", text: value };
    function copy() {
      var text = value;
      var okp;
      if (nav && nav.clipboard && nav.clipboard.writeText) {
        okp = nav.clipboard.writeText(text);
      } else {
        okp = Promise.resolve(false);
      }
      return Promise.resolve(okp).then(function (ok) {
        if (ok === undefined || ok) {
          if (fallbackToast) toast(fallbackToast);
          return "copied";
        }
        try {
          var ta = document.createElement("textarea");
          ta.value = text;
          ta.setAttribute("readonly", "");
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          var done = document.execCommand && document.execCommand("copy");
          document.body.removeChild(ta);
          if (done && fallbackToast) toast(fallbackToast);
          return done ? "copied" : "failed";
        } catch (err) { return "failed"; }
      }, function () { return copyLegacy(); });
    }
    function copyLegacy() {
      try {
        var ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        var done = document.execCommand && document.execCommand("copy");
        document.body.removeChild(ta);
        if (done && fallbackToast) toast(fallbackToast);
        return Promise.resolve(done ? "copied" : "failed");
      } catch (err) { return Promise.resolve("failed"); }
    }
    if (nav && typeof nav.share === "function") {
      var can = true;
      if (typeof nav.canShare === "function") {
        try { can = nav.canShare(payload); } catch (err) { can = false; }
      }
      if (can) {
        return Promise.resolve()
          .then(function () { return nav.share(payload); })
          .then(function () { return "shared"; }, function (err) {
            if (err && (err.name === "AbortError" || err.name === "InvalidStateError")) return "cancelled";
            return copy();
          });
      }
    }
    return copy();
  }

  function prepareOutgoing(forceText) {
    var payload = buildSharePayload(currentState(), { includeNotes: notesOn() });
    var summary = summarize(payload);
    return encode(payload).then(function (data) {
      var link = makeLink(data);
      var text = makeTextBlock(summary, data);
      var asText = !!forceText || shouldFallbackToText(payload, link);
      return { payload: payload, summary: summary, data: data, link: link, text: text, asText: asText };
    });
  }

  function openComposer() {
    if (typeof document === "undefined") return;
    closeSheet("settings-sheet");
    var hint = document.getElementById("share-link-hint");
    if (hint) hint.textContent = COPY.hint;
    var lab = document.querySelector("label[for='share-link-notes']") || document.getElementById("share-link-notes-label");
    if (lab) {
      var span = lab.querySelector("span") || lab;
      if (span) span.textContent = COPY.notes;
    }
    var go = document.getElementById("share-link-go");
    if (go) go.textContent = COPY.sendLink;
    var alt = document.getElementById("share-link-text");
    if (alt) alt.textContent = COPY.sendText;
    var altHint = document.getElementById("share-link-alt-hint");
    if (altHint) altHint.textContent = COPY.altHint;
    openEl("share-link-sheet");
  }

  function onSendLink() {
    prepareOutgoing(false).then(function (out) {
      if (out.asText) {
        toast(TEXT_TOAST);
        return shareOrCopy("text", out.text, TEXT_TOAST);
      }
      return shareOrCopy("url", out.link, LINK_COPY_TOAST);
    });
  }

  function onSendText() {
    prepareOutgoing(true).then(function (out) {
      return shareOrCopy("text", out.text, TEXT_COPY_TOAST);
    });
  }

  function hideFriend() {
    var a = document.getElementById("friend-share-sheet");
    var b = document.getElementById("share-broken-sheet");
    if (a) a.hidden = true;
    if (b) b.hidden = true;
  }

  var pendingIncoming = null;

  function showBroken() {
    pendingIncoming = null;
    hideFriend();
    var title = document.getElementById("share-broken-title");
    var body = document.getElementById("share-broken-body");
    var ok = document.getElementById("share-broken-ok");
    if (title) title.textContent = COPY.brokenTitle;
    if (body) body.textContent = COPY.brokenBody;
    if (ok) ok.textContent = COPY.brokenOk;
    openEl("share-broken-sheet");
  }

  function showFriend(result) {
    pendingIncoming = result;
    hideFriend();
    var title = document.getElementById("friend-share-title");
    var sub = document.getElementById("friend-share-sub");
    var save = document.getElementById("friend-share-save");
    var no = document.getElementById("friend-share-no");
    if (title) title.textContent = COPY.friendTitle;
    if (sub) sub.textContent = result.summary.line;
    if (save) save.textContent = COPY.save;
    if (no) no.textContent = COPY.decline;
    openEl("friend-share-sheet");
  }

  function acceptIncoming() {
    var result = pendingIncoming;
    if (!result || !result.ok) { hideFriend(); return; }
    if (hasSeen(result.hash)) {
      toast(COPY.dup);
      hideFriend();
      pendingIncoming = null;
      return;
    }
    if (root.TripApp && typeof root.TripApp.acceptSharedTrip === "function") {
      var added = root.TripApp.acceptSharedTrip(result.payload);
      if (added === false) {
        toast(COPY.dup);
        hideFriend();
        pendingIncoming = null;
        return;
      }
    }
    markSeen(result.hash);
    toast(COPY.saved);
    hideFriend();
    pendingIncoming = null;
  }

  function declineIncoming() {
    pendingIncoming = null;
    hideFriend();
  }

  function handleIncoming(kind, data) {
    if (!data) { if (kind === "link") showBroken(); return Promise.resolve({ ok: false }); }
    return decodeIncomingAsync(kind, data).then(function (result) {
      if (!result.ok) {
        if (kind === "link") showBroken();
        return result;
      }
      showFriend(result);
      return result;
    });
  }

  function consumeIncoming() {
    if (typeof location === "undefined") return;
    var got = consumeHash(location, typeof history !== "undefined" ? history : null);
    if (!got.parsed) return;
    handleIncoming("link", got.parsed.data);
  }

  function handlePastedText(text) {
    if (isPasteTooLong(text)) return Promise.resolve({ ok: false, error: "too-large" });
    var parsed = parseTextBlock(text);
    if (!parsed) return Promise.resolve(null);
    return handleIncoming("text", parsed.data);
  }

  function bindUi() {
    if (typeof document === "undefined") return;
    var go = document.getElementById("share-link-go");
    if (go) go.addEventListener("click", onSendLink);
    var alt = document.getElementById("share-link-text");
    if (alt) alt.addEventListener("click", onSendText);
    var save = document.getElementById("friend-share-save");
    if (save) save.addEventListener("click", acceptIncoming);
    var no = document.getElementById("friend-share-no");
    if (no) no.addEventListener("click", declineIncoming);
    var ok = document.getElementById("share-broken-ok");
    if (ok) ok.addEventListener("click", function () { hideFriend(); });
    ["share-link-sheet", "friend-share-sheet", "share-broken-sheet"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("click", function (ev) {
        var t = ev.target;
        if (t && t.getAttribute && t.getAttribute("data-close") === id) {
          if (id === "share-link-sheet") closeSheet(id);
          else { pendingIncoming = null; hideFriend(); }
        }
      });
    });
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindUi);
    else bindUi();
  }

  var api = {
    ENABLED: ENABLED,
    BASE: BASE,
    MAX_LINK_CHARS: MAX_LINK_CHARS,
    MAX_LINK_PLACES: MAX_LINK_PLACES,
    MAX_DECODED_BYTES: MAX_DECODED_BYTES,
    MAX_LINK_DATA_CHARS: MAX_LINK_DATA_CHARS,
    MAX_PASTE_BYTES: MAX_PASTE_BYTES,
    HEADER: HEADER,
    TEXT_TOAST: TEXT_TOAST,
    LINK_COPY_TOAST: LINK_COPY_TOAST,
    TEXT_COPY_TOAST: TEXT_COPY_TOAST,
    COPY: COPY,
    SEEN_KEY: SEEN_KEY,
    encodeSync: encodeSync,
    decodeSync: decodeSync,
    encode: encode,
    decode: decode,
    buildSharePayload: buildSharePayload,
    stripNotes: stripNotes,
    sanitizePayload: sanitizePayload,
    escapeText: escapeText,
    escapedFields: escapedFields,
    placeCount: placeCount,
    summarize: summarize,
    calendarDays: calendarDays,
    makeLink: makeLink,
    makeTextBlock: makeTextBlock,
    textHeader: textHeader,
    OLD_TEXT_HEADER_TAIL: OLD_TEXT_HEADER_TAIL,
    parseTextBlock: parseTextBlock,
    parseHash: parseHash,
    clearHash: clearHash,
    consumeHash: consumeHash,
    contentHash: contentHash,
    canonical: canonical,
    hasSeen: hasSeen,
    markSeen: markSeen,
    decodeIncoming: decodeIncoming,
    decodeIncomingAsync: decodeIncomingAsync,
    isLinkDataTooLong: isLinkDataTooLong,
    isPasteTooLong: isPasteTooLong,
    getLastInflateBytes: function () { return lastInflateBytes; },
    finalizeIncoming: finalizeIncoming,
    shouldFallbackToText: shouldFallbackToText,
    itemHasInvalid: itemHasInvalid,
    itemHasUsableContent: itemHasUsableContent,
    repairItem: repairItem,
    openComposer: openComposer,
    consumeIncoming: consumeIncoming,
    handlePastedText: handlePastedText,
    handleIncoming: handleIncoming
  };
  root.ShareLink = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
