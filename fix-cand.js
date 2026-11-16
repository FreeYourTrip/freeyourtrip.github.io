/**
 * v5.3 待补地址的自动候选 / 批量补位置 / 粘贴地址清理 / 在地图上选（纯逻辑，界面在 timeline.js）。
 * 规则（IT老板）：
 *   - 唯一且对得上（名字、城市或地址、50 公里内）就自动填；拿不准才问，候选只放在内存里。
 *   - 搜索用当天城市文字（item.city）+ 当天大概区域（Geocode.biasArea 先四舍五入），再试一次去掉「店 / 餐厅 / Restaurant」的简化名。
 *   - 候选只存内存（本文件的 cache），不写 localStorage、不进备份 / 分享。
 *   - 不解析地图分享短链。
 * 浏览器里是 window.FixCand；node 里 require("./fix-cand.js")。
 */
(function (root) {
  "use strict";
  /* v6：火车 / 船 / 大巴跟机票一样按「出发 ~ 到达」处理，见 transport.js */
  var Transport = root.Transport || (typeof require === "function" ? require("./transport.js") : null);
  function isTransit(item) {
    return Transport ? Transport.isTransit(item) : !!item && item.type === "flight";
  }

  var MAX = 3;

  var COPY = {
    heading: "是这里吗？",
    none: "都不是",
    mapPick: "在地图上选",
    loading: "正在找附近的候选…",
    fixed: "已补上",
    banner: "{n} 个地点待补位置",
    bannerGo: "去补 ›",
    panelTitle: "待补位置 {i}/{n}",
    skip: "先跳过",
    allDone: "都补好了",
    pickHint: "长按放一个图钉，可以拖动，再点『就放这里』",
    pickSave: "就放这里",
    pickClose: "关闭",
    placeholder: "输入店名，或粘贴地址",
    askMany: "“{name}”找到 {n} 个，点对的那个",
    askFar: "是这里吗？",
    remain: "还有 {n} 个要确认",
  };
  var CLEAR_KM = 50;

  function normText(s) {
    return String(s || "").toLowerCase().replace(/[\s,.'’\-·()（）]/g, "");
  }

  function itemName(item) {
    return String((item && (item.nameZh || item.nameEn || item.name)) || "").trim();
  }

  function candNames(c) {
    var unit = root.GeoUtil && root.GeoUtil.isUnitLikeName ? root.GeoUtil.isUnitLikeName : function () { return false; };
    return [c && c.name, c && c.nameDetail, c && String(c.displayName || "").split(/[,，]/)[0]]
      .map(function (s) { return String(s || "").trim(); })
      .filter(function (s) { return s && !unit(s); });
  }

  function nameMatches(item, cand) {
    var w = normText(itemName(item));
    var names = candNames(cand).map(normText).filter(Boolean);
    if (!w || !names.length) return false;
    var i;
    for (i = 0; i < names.length; i++) {
      if (names[i].indexOf(w) !== -1 || w.indexOf(names[i]) !== -1) return true;
    }
    return false;
  }

  function candCityAddr(c) {
    var city = String((c && (c.city || (c.address && c.address.city))) || "").trim();
    var addr = "";
    if (c && c.address && typeof c.address === "object") {
      addr = [c.address.road, c.address.suburb, c.address.city, c.address.country, c.address.postcode].filter(Boolean).join(" ");
    }
    if (!addr) addr = String((c && (c.displayName || c.address || "")) || "");
    return { city: city, addr: addr, blob: (city + " " + addr + " " + String((c && c.displayName) || "")).toLowerCase() };
  }

  function cityOrAddressMatches(item, cand, ctx) {
    ctx = ctx || {};
    var info = candCityAddr(cand);
    var needles = [item && item.city, ctx.city, item && item.address].map(function (s) { return String(s || "").trim(); }).filter(Boolean);
    /* 地址就是名字时，不当作地址来比 */
    var nm = itemName(item);
    needles = needles.filter(function (s) { return s && s !== nm; });
    if (!needles.length) return true;
    var blob = info.blob;
    var i;
    for (i = 0; i < needles.length; i++) {
      var n = needles[i].toLowerCase();
      if (n && blob.indexOf(n) !== -1) return true;
    }
    return false;
  }

  function kmBetween(a, b) {
    if (!a || !b || !isFinite(a.lat) || !isFinite(b.lat) || !isFinite(a.lng) || !isFinite(b.lng)) return null;
    if (root.GeoUtil && root.GeoUtil.haversineKm) return root.GeoUtil.haversineKm(a, b);
    var R = 6371;
    var dLat = ((b.lat - a.lat) * Math.PI) / 180;
    var dLng = ((b.lng - a.lng) * Math.PI) / 180;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function withinArea(cand, ctx) {
    ctx = ctx || {};
    if (!ctx.bias || !isFinite(ctx.bias.lat) || !isFinite(cand && cand.lat)) return true;
    var km = kmBetween(ctx.bias, cand);
    return km == null || km <= CLEAR_KM;
  }

  /** 唯一且对得上：名字对、城市或地址对、离当天其他点不超过 50 公里 → 自动用，不问。 */
  function isClearMatch(item, cand, ctx) {
    if (!item || !cand || typeof cand.lat !== "number") return false;
    return nameMatches(item, cand) && cityOrAddressMatches(item, cand, ctx) && withinArea(cand, ctx);
  }

  function scoreCandidate(item, cand, ctx) {
    var s = 0;
    if (nameMatches(item, cand)) s += 10;
    var names = candNames(cand).map(normText);
    var w = normText(itemName(item));
    if (w && names.indexOf(w) !== -1) s += 6;
    if (cityOrAddressMatches(item, cand, ctx)) s += 8;
    var km = ctx && ctx.bias ? kmBetween(ctx.bias, cand) : null;
    if (km != null) s += Math.max(0, 8 - km / 5);
    return s;
  }

  function rankCandidates(item, list, ctx) {
    return (list || []).slice().sort(function (a, b) {
      return scoreCandidate(item, b, ctx) - scoreCandidate(item, a, ctx);
    });
  }

  function classifyCandidates(item, list, ctx) {
    var ranked = rankCandidates(item, list, ctx);
    if (!ranked.length) return { kind: "none", chosen: null, list: [] };
    if (ranked.length === 1 && isClearMatch(item, ranked[0], ctx)) {
      return { kind: "auto", chosen: ranked[0], list: ranked };
    }
    if (ranked.length === 1 && !withinArea(ranked[0], ctx)) {
      return { kind: "far", chosen: null, list: ranked };
    }
    return { kind: "ask", chosen: null, list: ranked };
  }

  function askTitle(item, list, kind) {
    if (kind === "far" || (list || []).length === 1) return COPY.askFar;
    var name = itemName(item) || "这里";
    return COPY.askMany.replace("{name}", name).replace("{n}", String((list || []).length));
  }

  function remainText(n) {
    return COPY.remain.replace("{n}", String(n));
  }

  function tileXY(lat, lng, z) {
    var n = Math.pow(2, z);
    var x = Math.floor((Number(lng) + 180) / 360 * n);
    var latRad = Number(lat) * Math.PI / 180;
    var y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { x: x, y: y, z: z };
  }

  /** 静态小地图：只用当前底图的图块，不加新域名。 */
  function staticMapUrl(lat, lng, z) {
    z = z || 15;
    var p = { lat: Number(lat), lng: Number(lng) };
    var T = root.MapTiles;
    if (T && T.usingAmap && T.usingAmap() && T.displayLatLng) {
      var d = T.displayLatLng(p.lat, p.lng);
      if (d) p = d;
      var xy = tileXY(p.lat, p.lng, z);
      var s = ((xy.x + xy.y) % 4) + 1;
      return "https://webrd0" + s + ".is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=" + xy.x + "&y=" + xy.y + "&z=" + xy.z;
    }
    var osm = tileXY(p.lat, p.lng, z);
    var sub = ["a", "b", "c"][(osm.x + osm.y) % 3];
    return "https://" + sub + ".tile.openstreetmap.org/" + osm.z + "/" + osm.x + "/" + osm.y + ".png";
  }

  function staticMapHtml(lat, lng) {
    if (!isFinite(lat) || !isFinite(lng)) return "";
    return '<div class="cand-mini" aria-hidden="true"><img alt="" src="' + staticMapUrl(lat, lng, 15) + '"><span class="cand-pin"></span></div>';
  }

  function fullAddress(c) {
    var info = candCityAddr(c);
    var line = String((c && c.displayName) || info.addr || "").trim();
    if (info.city && line.toLowerCase().indexOf(info.city.toLowerCase()) === -1) line = line ? line + "，" + info.city : info.city;
    return line;
  }

  /* ---------- 简化名：去掉常见后缀 ---------- */
  var SUFFIX_RE = [
    /\s*[（(][^）)]*[）)]\s*$/, /* 末尾括号：（总店）(Soho) */
    /(?:餐厅|餐馆|饭馆|酒家|酒楼|总店|本店|旗舰店|分店|门店|咖啡馆|咖啡厅)$/,
    /\s+(?:restaurant|restaurants|cafe|café|bar|bistro|diner|eatery|shop|store)$/i,
    /^(?:restaurant|café|cafe)\s+/i
  ];

  function simplifyName(name) {
    var s = String(name || "").replace(/\s+/g, " ").trim();
    var prev;
    do {
      prev = s;
      SUFFIX_RE.forEach(function (re) { s = s.replace(re, "").trim(); });
      /* 单个「店」字：前面至少 3 个字才去，免得「示例小店」变「示例小」 */
      if (/^[\s\S]{3,}店$/.test(s) && !/小店$/.test(s)) s = s.slice(0, -1).trim();
    } while (s !== prev && s);
    return s && s !== String(name || "").trim() ? s : "";
  }

  /* ---------- 粘贴来的地址（小红书 / 微信）清理 ---------- */
  var EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;
  var LABEL_RE = /^(?:详细)?(?:地址|地點|位置|地点|address|addr|location)\s*[:：]\s*/i;
  var NOISE_LINE_RE = /^(?:电话|電話|tel|phone|营业时间|營業時間|时间|人均|价格|推荐|tips?|#)[\s:：]/i;

  var ADDR_HINT_RE = /[路街道巷弄号號区區市町丁目番地]|\b(?:road|rd|street|st|avenue|ave|lane|ln|way|place|square|sq|blvd)\b/i;

  function cleanPasted(text) {
    var raw = String(text == null ? "" : text).replace(EMOJI_RE, " ").replace(/\r/g, "");
    var lines = raw.split(/\n+/).map(function (l) {
      return l.replace(/[\t\u00A0\u3000]+/g, " ").replace(/\s+/g, " ").trim();
    }).filter(Boolean);
    if (!lines.length) return "";
    /* 有「地址：」那一行就只用那一行 */
    for (var i = 0; i < lines.length; i++) {
      if (LABEL_RE.test(lines[i])) return tidy(lines[i].replace(LABEL_RE, ""));
    }
    lines = lines.map(tidy).filter(function (l) { return l && !NOISE_LINE_RE.test(l); });
    /* 多行又没写「地址：」：挑最像地址的一行（有门牌数字 + 路 / 街 / 号 / 丁目 / Road…） */
    if (lines.length > 1) {
      var addrLike = lines.filter(function (l) { return ADDR_HINT_RE.test(l) && /\d/.test(l); });
      if (addrLike.length) return addrLike[0];
    }
    return tidy(lines.join(" "));
  }

  function tidy(s) {
    return String(s || "")
      .replace(/#[^\s#]+/g, " ") /* 话题标签 */
      .replace(/https?:\/\/\S+/gi, " ") /* 链接一律丢掉，不解析 */
      .replace(/^[\s,，.。:：;；\-–—·|]+|[\s,，.。:：;；\-–—·|]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** 粘贴的内容像「复制来的地址」吗（有换行、emoji、「地址：」、话题标签） */
  function looksPasted(text) {
    var t = String(text || "");
    EMOJI_RE.lastIndex = 0;
    return /\n/.test(t) || EMOJI_RE.test(t) || /(?:^|\n)\s*(?:详细)?(?:地址|地點|位置|address)\s*[:：]/i.test(t) || /#[^\s#]+/.test(t);
  }

  /* ---------- 哪些条目待补 ---------- */
  function needsFix(it) {
    if (!it || isTransit(it)) return false;
    return !(typeof it.lat === "number" && typeof it.lng === "number" && isFinite(it.lat) && isFinite(it.lng));
  }

  function unlocated(items) {
    return (items || []).filter(needsFix);
  }

  function bannerText(n) {
    return n > 0 ? COPY.banner.replace("{n}", String(n)) : "";
  }

  /* ---------- 候选缓存（只在内存） ---------- */
  var cache = {};

  function cacheKey(it) {
    return it ? String(it.id) + "|" + String(it.nameZh || it.nameEn || "") + "|" + String(it.address || "") : "";
  }
  function getCached(it) {
    var k = cacheKey(it);
    return k && Object.prototype.hasOwnProperty.call(cache, k) ? cache[k] : null;
  }
  function setCached(it, list) {
    var k = cacheKey(it);
    if (k) cache[k] = dedupe(list || []).slice(0, MAX);
    return k ? cache[k] : [];
  }
  function clearCache() {
    cache = {};
  }

  function dedupe(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (r) {
      if (!r || !isFinite(r.lat) || !isFinite(r.lng)) return;
      var k = Number(r.lat).toFixed(4) + "," + Number(r.lng).toFixed(4);
      if (seen[k]) return;
      seen[k] = true;
      out.push(r);
    });
    return out;
  }

  /** 要搜的词：「名字 + 当天城市」→ 简化名 + 城市 → 地址（和名字不同时）。最多 3 个 */
  function queriesFor(item, city) {
    var name = String((item && (item.nameZh || item.nameEn)) || "").trim();
    var addr = String((item && item.address) || "").trim();
    var c = String(city || "").trim();
    var out = [];
    function add(q) {
      q = String(q || "").replace(/\s+/g, " ").trim();
      if (q && out.indexOf(q) === -1) out.push(q);
    }
    function withCity(q) {
      if (!q) return "";
      return c && q.toLowerCase().indexOf(c.toLowerCase()) === -1 ? q + " " + c : q;
    }
    if (name) add(withCity(name));
    var simple = simplifyName(name);
    if (simple) add(withCity(simple));
    if (addr && addr !== name) add(addr);
    return out.slice(0, 3);
  }

  /**
   * 找候选：deps.search(q, { bias }) 返回 Promise<结果列表>；ctx = { city, bias }。
   * 依次搜，凑够 3 个（按坐标去重）就停；全部失败也只是返回空列表。结果进内存缓存。
   * 永远只返回候选，不改条目。
   */
  function findCandidates(item, ctx, deps) {
    ctx = ctx || {};
    var cached = getCached(item);
    if (cached) return Promise.resolve(cached);
    var search = deps && deps.search;
    var qs = queriesFor(item, ctx.city);
    if (!search || !qs.length) return Promise.resolve(setCached(item, []));
    var got = [];
    var sopts = ctx.bias ? { bias: ctx.bias } : undefined;
    function step(i) {
      if (i >= qs.length || dedupe(got).length >= MAX) return Promise.resolve(setCached(item, got));
      var p;
      try {
        p = Promise.resolve(search(qs[i], sopts));
      } catch (err) {
        p = Promise.resolve([]);
      }
      return p.then(function (l) { return l || []; }, function () { return []; }).then(function (l) {
        got = got.concat(l);
        return step(i + 1);
      });
    }
    return step(0);
  }

  /* ---------- 批量面板（状态机，不碰界面） ---------- */
  function createPanel(ids, opts) {
    opts = opts || {};
    var later = opts.setTimeout || (typeof setTimeout === "function" ? setTimeout : function (f) { f(); });
    var st = {
      ids: (ids || []).slice(),
      index: 0,
      fixed: [],
      skipped: [],
      done: false,
      advancing: false
    };
    function finish() {
      st.done = true;
      if (typeof opts.onDone === "function") opts.onDone(st);
    }
    function go() {
      st.index += 1;
      st.advancing = false;
      if (st.index >= st.ids.length) finish();
      else if (typeof opts.onPage === "function") opts.onPage(st);
    }
    st.current = function () {
      return st.done ? null : st.ids[st.index];
    };
    st.title = function () {
      return COPY.panelTitle.replace("{i}", String(Math.min(st.index + 1, st.ids.length))).replace("{n}", String(st.ids.length));
    };
    /** 选好一个：0.3 秒后自动下一页 */
    st.chose = function () {
      if (st.done || st.advancing) return;
      st.fixed.push(st.ids[st.index]);
      st.advancing = true;
      later(go, 300);
    };
    st.skip = function () {
      if (st.done || st.advancing) return;
      st.skipped.push(st.ids[st.index]);
      go();
    };
    st.allFixed = function () {
      return st.done && !st.skipped.length;
    };
    if (!st.ids.length) finish();
    return st;
  }

  /* ---------- 在地图上选 ---------- */
  /** 地图中心：那天酒店 → 同一天其他带坐标的条目 → 当前地图视野；都没有返回 null */
  function pickCenter(items, day, opts, mapCenter) {
    var T = root.TripName;
    var c = T && T.dayArea ? T.dayArea(items || [], day, opts || {}) : null;
    if (c) return { lat: c.lat, lng: c.lng, zoom: 15, source: "day" };
    if (mapCenter && isFinite(mapCenter.lat) && isFinite(mapCenter.lng)) {
      return { lat: mapCenter.lat, lng: mapCenter.lng, zoom: mapCenter.zoom || 13, source: "map" };
    }
    return null;
  }

  /** 「就放这里」：只写坐标（WGS-84；tiles = "gcj02" 时先转回），不查地址、不发任何请求 */
  function applyMapPick(item, latlng, tiles) {
    var next = JSON.parse(JSON.stringify(item || {}));
    if (!latlng || !isFinite(latlng.lat) || !isFinite(latlng.lng)) return next;
    var lat = Number(latlng.lat);
    var lng = Number(latlng.lng);
    var G = root.GeoUtil;
    if (tiles === "gcj02" && G && G.gcj02ToWgs84 && (!G.inMainlandChina || G.inMainlandChina(lat, lng))) {
      var w = G.gcj02ToWgs84(lat, lng);
      if (w && isFinite(w.lat)) {
        lat = w.lat;
        lng = w.lng;
      }
    }
    next.lat = Math.round(lat * 1e6) / 1e6;
    next.lng = Math.round(lng * 1e6) / 1e6;
    delete next.city; /* 地图上选的点不知道城市，不猜 */
    return next;
  }

  /** 候选行第二行：城市 + 街道 */
  function candidateLines(c) {
    var a = (c && c.address) || {};
    var name = String((c && (c.nameDetail || c.name)) || "").trim() || String((c && c.displayName) || "").split(/[,，]/)[0].trim();
    var street = [a.road, a.house_number].filter(Boolean).join(" ").trim();
    var city = String(a.city || (c && c.city) || "").trim();
    var sub = [city, street].filter(Boolean).join(" · ");
    if (!sub) {
      var parts = String((c && c.displayName) || "").split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean);
      sub = parts.slice(1, 3).join(", ");
    }
    return { name: name || "未命名地点", sub: sub };
  }

  /* ---------- v5.4（IT老板）：入住 = 用户自己点过的那天，没点过就用行程第一天；行程里一个日期都没有则两格都空。绝不填今天。退房 = 入住 + 1 天 ---------- */
  function ymdOk(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  }
  function nextYmd(s) {
    var p = String(s).split("-");
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + 1)).toISOString().slice(0, 10);
  }
  function hotelNights(checkIn, checkOut) {
    if (!ymdOk(checkIn) || !ymdOk(checkOut)) return null;
    var a = String(checkIn).split("-");
    var b = String(checkOut).split("-");
    var msA = Date.UTC(+a[0], +a[1] - 1, +a[2]);
    var msB = Date.UTC(+b[0], +b[1] - 1, +b[2]);
    var n = Math.round((msB - msA) / 86400000);
    return n > 0 ? n : null;
  }
  /** selected 只在用户明确点过某一天时传入；today 参数忽略，保留签名以免旧调用报错。 */
  function hotelDates(selected, tripDays, today) {
    var first = (tripDays || []).filter(ymdOk).sort()[0];
    var inDay = ymdOk(selected) ? selected : first || "";
    if (!inDay) return null;
    return { checkIn: inDay, checkOut: nextYmd(inDay) };
  }
  function hotelDateState(checkIn, checkOut) {
    if (!ymdOk(checkIn) || !ymdOk(checkOut)) {
      return { ok: false, reason: "blank", hint: "先选入住和退房日期", nights: null };
    }
    if (checkOut <= checkIn) {
      return { ok: false, reason: "invalid", hint: "退房要晚于入住", nights: null };
    }
    return { ok: true, reason: "", hint: "", nights: hotelNights(checkIn, checkOut) };
  }

  var api = {
    hotelDates: hotelDates,
    hotelNights: hotelNights,
    hotelDateState: hotelDateState,
    COPY: COPY,
    CLEAR_KM: CLEAR_KM,
    nameMatches: nameMatches,
    cityOrAddressMatches: cityOrAddressMatches,
    isClearMatch: isClearMatch,
    rankCandidates: rankCandidates,
    classifyCandidates: classifyCandidates,
    askTitle: askTitle,
    remainText: remainText,
    staticMapUrl: staticMapUrl,
    staticMapHtml: staticMapHtml,
    fullAddress: fullAddress,
    kmBetween: kmBetween,
    MAX: MAX,
    simplifyName: simplifyName,
    cleanPasted: cleanPasted,
    looksPasted: looksPasted,
    needsFix: needsFix,
    unlocated: unlocated,
    bannerText: bannerText,
    queriesFor: queriesFor,
    findCandidates: findCandidates,
    getCached: getCached,
    setCached: setCached,
    clearCache: clearCache,
    createPanel: createPanel,
    pickCenter: pickCenter,
    applyMapPick: applyMapPick,
    candidateLines: candidateLines
  };
  root.FixCand = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
