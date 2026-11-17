/**
 * v5.3 待补地址：自动候选、bounded=1 → 0、粘贴地址、在地图上选、顶部提示、批量面板、导入规则（全部假数据，不连网）。
 * 用法：node check-v53-fix.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

let failures = 0;
const queue = [];
function check(name, fn) {
  queue.push([name, fn]);
}

/* 假 localStorage / fetch：geocode.js 的缓存和请求都落在这里 */
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
const urls = [];
let fakeByQuery = {};
globalThis.fetch = (u) => {
  urls.push(u);
  const q = decodeURIComponent((u.match(/[?&]q=([^&]*)/) || [])[1] || "").replace(/\+/g, " ");
  const bounded = (u.match(/[?&]bounded=(\d)/) || [])[1];
  const hit = fakeByQuery[q + (bounded ? "|b" + bounded : "")] || fakeByQuery[q] || [];
  return Promise.resolve({ ok: true, json: () => Promise.resolve(hit) });
};

require("./geo.js");
const TripName = require("./trip-name.js");
const Geocode = require("./geocode.js");
const ItemEdit = require("./item-edit.js");
const F = require("./fix-cand.js");
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const tl = read("timeline.js");
const html = read("index.html");
const css = read("styles.css");
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/[^\n]*/g, "$1");
const fcSrc = noComments(read("fix-cand.js"));

const nom = (name, lat, lon, city, road) => ({ lat: String(lat), lon: String(lon), display_name: name + ", " + road + ", " + city, name, address: { city, road } });

check("auto candidates: never auto-applied, even a single one; only a tap applies", async function () {
  F.clearCache();
  const item = { id: "p1", type: "place", nameZh: "示例小店", address: "", date: "2026-12-05" };
  const before = JSON.stringify(item);
  const list = await F.findCandidates(item, { city: "Kyoto", bias: { lat: 35.0, lng: 135.77 } }, {
    search: () => Promise.resolve([{ name: "示例小店", lat: 35.0037, lng: 135.7788, city: "Kyoto" }])
  });
  assert.strictEqual(list.length, 1);
  assert.strictEqual(JSON.stringify(item), before, "the item is untouched");
  assert.ok(F.getCached(item), "kept in the in-memory cache");
  /* timeline: candidates only applied from the two tap handlers */
  const calls = tl.match(/applyCandidate\(/g) || [];
  assert.ok(calls.length >= 3, "definition + card tap + panel tap still present");
  const queueFn = tl.slice(tl.indexOf("function queueCandidates"), tl.indexOf("function candRowsHtml"));
  assert.ok(queueFn.length > 100 && !/applyCandidate|applyFoundPlace|updateItem|saveAllTrips/.test(queueFn), "background search never writes the item");
  const seed = tl.slice(tl.indexOf("function seedCandidates"), tl.indexOf("function itemsNeedingFix"));
  assert.ok(!/applyCandidate|applyFoundPlace|applyChoice/.test(seed), "import candidates are only cached");
});

check("candidate queries: name + day city, then simplified name (店 / 餐厅 / Restaurant stripped), at most 3, max 3 results", async function () {
  F.clearCache();
  assert.deepStrictEqual(F.queriesFor({ nameZh: "示例拉面店" }, "Kyoto"), ["示例拉面店 Kyoto", "示例拉面 Kyoto"]);
  assert.deepStrictEqual(F.queriesFor({ nameZh: "Example Restaurant", address: "1 Sample Rd" }, "London"), ["Example Restaurant London", "Example London", "1 Sample Rd"]);
  assert.deepStrictEqual(F.queriesFor({ nameZh: "示例餐厅（总店）" }, ""), ["示例餐厅（总店）", "示例"]);
  assert.strictEqual(F.simplifyName("示例小店"), "", "short names keep 店");
  assert.deepStrictEqual(F.queriesFor({ nameZh: "示例小店" }, ""), ["示例小店"], "no city known → no text added");
  const seen = [];
  const list = await F.findCandidates({ id: "q", nameZh: "示例拉面店" }, { city: "Kyoto", bias: { lat: 35, lng: 135.8 } }, {
    search: (q, o) => {
      seen.push([q, !!(o && o.bias)]);
      return Promise.resolve(q === "示例拉面店 Kyoto" ? [] : [1, 2, 3, 4].map((n) => ({ name: "店" + n, lat: 35 + n / 100, lng: 135.8 })));
    }
  });
  assert.deepStrictEqual(seen, [["示例拉面店 Kyoto", true], ["示例拉面 Kyoto", true]], "simplified retry, both with the day's area");
  assert.strictEqual(list.length, 3, "up to 3");
});

check("Nominatim: bounded=1 inside the viewbox first; 0 results → bounded=0 fallback; results inside the box stop there", async function () {
  urls.length = 0;
  fakeByQuery = { "示例一号店|b1": [], "示例一号店|b0": [nom("示例一号店", 35.01, 135.77, "Kyoto", "Example St")] };
  const r = await Geocode.nominatimSearch("示例一号店", { bias: { lat: 35.0037, lng: 135.7788 } });
  assert.strictEqual(urls.length, 2);
  assert.ok(/bounded=1/.test(urls[0]) && /viewbox=135\.6%2C35\.2|viewbox=135\.6,35\.2/.test(urls[0]));
  assert.ok(/bounded=0/.test(urls[1]));
  assert.strictEqual(r.length, 1);
  urls.length = 0;
  fakeByQuery = { "示例二号店|b1": [nom("示例二号店", 35.02, 135.76, "Kyoto", "Sample Rd")] };
  await Geocode.nominatimSearch("示例二号店", { bias: { lat: 35.0037, lng: 135.7788 } });
  assert.strictEqual(urls.length, 1, "found inside the box → no global search");
  urls.length = 0;
  await Geocode.nominatimSearch("示例三号店");
  assert.ok(urls.length === 1 && urls[0].indexOf("viewbox") === -1 && urls[0].indexOf("bounded") === -1, "no area → plain search");
});

check("pasted address (小红书 / 微信): newlines, emoji, 地址： prefix, hashtags, links cleaned", function () {
  assert.strictEqual(F.cleanPasted("📍示例小店🍜\n地址：东京都新宿区示例 1-2-3 🚇\n电话：03-0000-0000"), "东京都新宿区示例 1-2-3");
  assert.strictEqual(F.cleanPasted("✨示例甜品✨\n示例市示例路 8 号\n#探店 #甜品"), "示例市示例路 8 号");
  assert.strictEqual(F.cleanPasted("Address: 12 Example Street, London"), "12 Example Street, London");
  assert.strictEqual(F.cleanPasted("示例小店 https://example.test/x 🍰"), "示例小店", "links dropped, never parsed");
  assert.strictEqual(F.cleanPasted("  示例小店  "), "示例小店");
  assert.ok(F.looksPasted("示例\n地址：示例路") && F.looksPasted("示例🍜") && !F.looksPasted("示例小店"));
  assert.ok(/placeholder="输入店名，或粘贴地址"/.test(html));
  const paste = tl.slice(tl.indexOf("function bindPasteSearch"), tl.indexOf("function bindFixUi"));
  assert.ok(/FixCand\.cleanPasted\(text\)/.test(paste) && /dispatchEvent\(new Event\("input"/.test(paste), "cleaned text goes through the normal search");
  assert.ok(!/goo\.gl|amap\.com|maps\.app|surl|短链/.test(fcSrc + paste), "no share-link parsing");
});

check("在地图上选: saves lat/lng only (WGS-84), no address lookup, no request; centre = day's hotel → same-day item → map view", function () {
  const item = { id: "m", type: "place", nameZh: "示例", address: "", date: "2026-12-05", city: "Old" };
  const next = F.applyMapPick(item, { lat: 35.0123456, lng: 135.7712345 }, "osm");
  assert.deepStrictEqual([next.lat, next.lng], [35.012346, 135.771235]);
  assert.strictEqual(next.address, "", "no address lookup");
  assert.ok(!("city" in next), "no guessed city");
  assert.strictEqual(next.nameZh, "示例");
  const g = F.applyMapPick(item, { lat: 31.2304, lng: 121.4737 }, "gcj02");
  assert.ok(Math.abs(g.lat - 31.2304) > 0.0005 || Math.abs(g.lng - 121.4737) > 0.0005, "GCJ-02 tiles converted back to WGS-84");
  const items = [
    { id: "h", type: "hotel", nameZh: "示例酒店", checkIn: "2026-12-04", checkOut: "2026-12-06", lat: 35.0037, lng: 135.7788 },
    { id: "s", type: "place", nameZh: "同日", date: "2026-12-07", time: "10:00", lat: 34.69, lng: 135.5 }
  ];
  assert.strictEqual(F.pickCenter(items, "2026-12-05", { excludeId: "m" }).source, "day");
  assert.deepStrictEqual([F.pickCenter(items, "2026-12-07", {}).lat], [34.69]);
  assert.strictEqual(F.pickCenter(items, "2026-12-20", {}, { lat: 51.5, lng: -0.1, zoom: 12 }).source, "map");
  assert.strictEqual(F.pickCenter([], "", {}, null), null);
  const save = tl.slice(tl.indexOf("function saveMapPick"), tl.indexOf("function bindPasteSearch"));
  assert.ok(!/Geocode|fetch\(|searchAddress/.test(save), "no search call when saving");
  assert.ok(/<button type="button" class="mp-save" id="mp-save" disabled>就放这里<\/button>/.test(html));
  assert.ok(/\.mp-save \{[^}]*height: 56px;[^}]*background: #0F9D8A;/.test(css), "56px primary button");
  assert.ok(/pickMap\.on\("contextmenu"/.test(tl) && /draggable: true/.test(tl), "long-press drops a draggable pin");
});

check("banner: unlocated counts stay; the top yellow strip is gone", function () {
  const items = [
    { id: "a", type: "place", nameZh: "A" },
    { id: "b", type: "place", nameZh: "B", lat: 1, lng: 2 },
    { id: "c", type: "hotel", nameZh: "C" },
    { id: "f", type: "flight", flightNo: "XX1" }
  ];
  assert.strictEqual(F.unlocated(items).length, 2);
  assert.strictEqual(F.bannerText(2), "2 个地点待补位置");
  assert.strictEqual(F.bannerText(0), "");
  const upd = tl.slice(tl.indexOf("function updateFixBanner"), tl.indexOf("var fixPanel = null"));
  assert.ok(/el\.hidden = true/.test(upd), "top strip stays hidden");
  assert.ok(html.indexOf('id="fix-banner"') === -1, "yellow strip markup removed");
  assert.ok(html.indexOf("去补 ›") === -1);
});

check("panel: 待补位置 i/n, choose → auto-advance after 0.3s, 跳过 keeps it counted, 都好了 only when nothing skipped", function () {
  const timers = [];
  const pages = [];
  let doneSt = null;
  const p = F.createPanel(["a", "b", "c"], { setTimeout: (fn, ms) => timers.push([fn, ms]), onPage: (st) => pages.push(st.current()), onDone: (st) => { doneSt = st; } });
  assert.strictEqual(p.title(), "待补位置 1/3");
  p.chose();
  assert.strictEqual(p.current(), "a", "not before the delay");
  assert.strictEqual(timers[0][1], 300);
  p.chose();
  assert.strictEqual(timers.length, 1, "double tap ignored while advancing");
  timers.shift()[0]();
  assert.strictEqual(p.title(), "待补位置 2/3");
  p.skip();
  assert.strictEqual(p.current(), "c");
  p.chose();
  timers.shift()[0]();
  assert.ok(doneSt && doneSt.done);
  assert.deepStrictEqual([doneSt.fixed, doneSt.skipped], [["a", "c"], ["b"]]);
  assert.strictEqual(doneSt.allFixed(), false, "skipped → quiet close, no 都补好了");
  const q = F.createPanel(["x"], { setTimeout: (fn) => fn() });
  q.chose();
  assert.ok(q.allFixed());
  const done = tl.slice(tl.indexOf("function fixPanelDone"), tl.indexOf("/* ---------- 在地图上选"));
  assert.ok(/\}, 1500\);/.test(done), "都补好了 closes after 1.5s");
  assert.ok(/<p>都补好了<\/p>/.test(html) && /<button type="button" class="fp-skip" id="fp-skip">跳过<\/button>/.test(html));
  assert.ok(/\.fix-panel \.sheet-panel \{ height: 85vh;/.test(css) && /\.fp-name \{[^}]*font-size: 18px; font-weight: 700;/.test(css) && /\.fp-meta \{[^}]*font-size: 12px; color: #6B7A8F;/.test(css));
});

check("card candidate UI matches the spec values", function () {
  assert.ok(/\.fc-head \{[^}]*font-size: 13px; color: #6B7A8F;/.test(css));
  assert.ok(/\.fc-row \{[^}]*height: 44px;[^}]*background: #fff;[^}]*border: 1px solid #D9E2E0;[^}]*border-radius: 10px;/.test(css));
  assert.ok(/\.fc-list \{[^}]*gap: 6px;/.test(css));
  assert.ok(/\.fc-row:active, \.fc-row\.is-picked \{ background: #E8F5F2; border-color: #0F9D8A; \}/.test(css));
  assert.ok(/\.fc-name \{ font-size: 14px;[^}]*color: #1F2A2E;/.test(css) && /\.fc-sub \{ font-size: 12px;[^}]*color: #6B7A8F;[^}]*text-overflow: ellipsis;/.test(css));
  assert.ok(/\.fc-none \{[^}]*font-size: 13px; color: #6B7A8F;/.test(css));
  assert.ok(/\.fc-map \{[^}]*height: 40px;[^}]*background: #fff;[^}]*border: 1px solid #D9E2E0;/.test(css));
  assert.ok(/locPinSvg\("#0F9D8A"\)/.test(tl), "teal location icon");
  assert.strictEqual(F.COPY.heading, "是这里吗？");
  assert.strictEqual(F.COPY.none, "都不是");
  assert.strictEqual(F.COPY.mapPick, "在地图上选");
  const box = tl.slice(tl.indexOf("function candBoxHtml"), tl.indexOf("function applyCandidate"));
  assert.ok(/if \(!list\.length\) return[^\n]*mapPickBtnHtml/.test(box), "no candidates → 在地图上选 directly");
  assert.ok(/candNone\[item\.id\] \? mapPickBtnHtml\(item\.id\)/.test(box), "都不是 reveals 在地图上选");
  assert.ok(/expanded\[id\] = false;\s*markJustFixed\(id\);/.test(tl) && /\}, 2000\);/.test(tl.slice(tl.indexOf("function markJustFixed"))), "collapse + 已补上 for 2s");
  assert.ok(/class="nav-fix-link" data-fix=/.test(tl), "补上地址 › link still there");
});

check("import (IT老板 a): several results → never the first, item stays 待补 with those candidates; one result > 30 km away → 待补", async function () {
  fakeByQuery = {
    "示例多店 Kyoto|b1": [nom("示例多店", 35.01, 135.77, "Kyoto", "A St"), nom("示例多店", 35.02, 135.76, "Kyoto", "B St")],
    "示例远店 Kyoto|b1": [],
    "示例远店 Kyoto|b0": [nom("示例远店", 43.06, 141.35, "Sapporo", "C St")],
    "示例近店 Kyoto|b1": [nom("示例近店", 35.011, 135.768, "Kyoto", "D St")]
  };
  const ctx = { city: "Kyoto", bias: { lat: 35.0037, lng: 135.7788 } };
  const multi = { id: "i1", type: "place", nameZh: "示例多店", address: "示例多店", date: "2026-12-05" };
  const r1 = await Geocode.resolveItem(multi, ctx);
  assert.strictEqual(r1.status, "ambiguous");
  assert.strictEqual(r1.chosen, null, "no first-result auto pick");
  assert.strictEqual(r1.candidates.length, 2);
  Geocode.applyChoice(multi, r1.chosen, r1.fromChosen);
  assert.ok(F.needsFix(multi), "stays unlocated → 待补");
  const far = { id: "i2", type: "place", nameZh: "示例远店", address: "示例远店", date: "2026-12-05" };
  const r2 = await Geocode.resolveItem(far, ctx);
  assert.strictEqual(r2.status, "far");
  assert.strictEqual(r2.chosen, null);
  assert.strictEqual(r2.candidates.length, 1, "kept as a candidate");
  const near = { id: "i3", type: "place", nameZh: "示例近店", address: "示例近店", date: "2026-12-05" };
  const r3 = await Geocode.resolveItem(near, ctx);
  assert.strictEqual(r3.status, "ok");
  /* seeding: ambiguous / far results become the card's candidates (memory only) */
  const seed = tl.slice(tl.indexOf("function seedCandidates"), tl.indexOf("function finishImport"));
  assert.ok(/res\.status === "ambiguous" \|\| res\.status === "far"/.test(seed) && /FixCand\.setCached\(cur, res\.candidates\)/.test(seed));
  assert.ok(/r\.status === "ambiguous" \|\| r\.status === "far"/.test(tl), "pick list in the add sheet shows them too");
});

check("import (IT老板 b): day city text + viewbox (bounded=1 → 0), item.city stored from the chosen result; hotels resolved first", async function () {
  urls.length = 0;
  fakeByQuery = { "示例单店 Kyoto|b1": [nom("示例单店", 35.012, 135.769, "Kyoto", "E St")] };
  const it = { id: "j1", type: "place", nameZh: "示例单店", address: "示例单店", date: "2026-12-05" };
  const res = await Geocode.resolveItem(it, { city: "Kyoto", bias: { lat: 35.0037, lng: 135.7788 } });
  const q0 = decodeURIComponent((urls[0].match(/[?&]q=([^&]*)/) || [])[1] || "");
  assert.strictEqual(q0, "示例单店 Kyoto", "name + day city first");
  assert.ok(/bounded=1/.test(urls[0]) && /viewbox=/.test(urls[0]));
  Geocode.applyChoice(it, res.chosen, res.fromChosen);
  assert.strictEqual(it.city, "Kyoto", "item.city stored");
  assert.ok(typeof it.lat === "number");
  /* resolveAll: ctxFor per item, hotels first, results in the original order */
  const order = [];
  fakeByQuery = {};
  const batch = [
    { id: "b1", type: "place", nameZh: "示例甲", address: "示例甲", date: "2026-12-05" },
    { id: "b2", type: "hotel", nameZh: "示例乙酒店", address: "示例乙酒店", checkIn: "2026-12-05", checkOut: "2026-12-06" }
  ];
  const out = await Geocode.resolveAll(batch, null, (x) => { order.push(x.id); return { city: "", bias: null }; });
  assert.deepStrictEqual(order, ["b2", "b1"], "hotel first");
  assert.deepStrictEqual(out.map((r) => r.item.id), ["b1", "b2"], "results keep the input order");
  assert.ok(/Geocode\.resolveAll\(items, null, function \(it\) \{ return dayArgsFor\(it, items\); \}\)/.test(tl), "AI import passes the day context");
  assert.ok((tl.match(/Geocode\.resolveItem\([^)]*, dayArgsFor\(/g) || []).length >= 4, "every manual resolve passes it too");
});

check("「直接添加」 items (IT老板 c) get the background candidate search too", function () {
  const fin = tl.slice(tl.indexOf("function finishDirectAdd"), tl.indexOf("var fixingId = null"));
  assert.ok(/addPlaceAndToast\(it, DIRECT_COPY\.added\);\s*queueCandidates\(real \|\| it\);/.test(fin), "v5.4: still queues candidates after the date panel");
  assert.ok(/return real;\s*\}\s*function nameOrBlank/.test(tl), "addPlaceAndToast hands back the stored item");
  assert.ok(/if \(expanded\[eid\] && eit && !isTransit\(eit\) && itemUnlocated\(eit\)\) queueCandidates\(eit\);/.test(tl), "expanding a 待补 card searches too (v6: not for transport)");
});

check("no new external hosts (same set as v5.2)", function () {
  const allowed = new Set(["freeyourtrip.github.io", "www.google.com", "uri.amap.com", "www.w3.org", "{s}.tile.openstreetmap.org", "www.openstreetmap.org", "webapi.amap.com", "restapi.amap.com", "nominatim.openstreetmap.org", "api.postcodes.io", "webrd0{s}.is.autonavi.com", "webrd0", "a.tile.openstreetmap.org", "apps.apple.com", "mobile.amap.com"]);
  const files = fs.readdirSync(__dirname).filter((f) => /\.(js|html|webmanifest|css)$/.test(f) && !/^check/.test(f));
  files.forEach((f) => {
    (read(f).match(/https?:\/\/[a-zA-Z0-9.{}-]+/g) || []).forEach((u) => {
      const host = u.replace(/^https?:\/\//, "");
      assert.ok(allowed.has(host), f + " uses a new host: " + host);
    });
  });
});

check("location never persisted: candidates and map-pick state live in memory; no LocateMe in the v5.3 code", function () {
  assert.ok(!/localStorage|sessionStorage|indexedDB|LocateMe|geolocation|lastPoint/.test(fcSrc), "fix-cand.js: memory only, no position");
  const block = tl.slice(tl.indexOf("/* ---------- v5.3 待补地址"), tl.indexOf("function openFixAddress"));
  assert.ok(block.length > 2000);
  assert.ok(!/localStorage|sessionStorage|LocateMe|geolocation|hereInMemory|lastPoint/.test(block), "v5.3 UI code never touches storage or your position");
  assert.ok(!/navigator\.geolocation/.test(tl), "no prompt");
  const days = tl.slice(tl.indexOf("function dayArgsFor"), tl.indexOf("function locPinSvg"));
  assert.ok(/TripName\.dayArea\(items, day, opts\)/.test(days), "area comes from trip items only");
  const sw = read("sw.js");
  assert.ok(sw.indexOf('"./fix-cand.js"') !== -1 && sw.indexOf('"xingcheng-map-shell-v22"') !== -1);
  assert.ok(/<script src="\.\/fix-cand\.js"><\/script>\s*/.test(html) && html.indexOf("fix-cand.js") < html.indexOf("<script src=\"./timeline.js\""));
});

check("final copy (copywriter, IT老板 approved): help tier 2, AI prompt, AI step 2 line, map-pick hint, banner / panel strings", function () {
  assert.ok(tl.indexOf('{ key: "fixplace", icon: "pin", title: "补位置", text: "卡片上写着「位置待确认」的，点它就能补，不补也不影响用" }') !== -1, "help tier 2 line");
  const starter = tl.slice(tl.indexOf("starter: {"), tl.indexOf("common: {"));
  assert.ok(starter.indexOf("补位置") === -1, "tier 1 unchanged");
  const P = require("./ai-prompt.js");
  const promptText = P.TEXT || P.text || read("ai-prompt.js");
  assert.ok(String(promptText).indexOf("不确定的部分就不写，不要猜，也不要编") !== -1, "AI prompt sentence");
  assert.ok(String(promptText).indexOf("地址尽量写完整") === -1, "the old contradicting rule is gone");
  assert.ok(tl.indexOf('step2Small: "不会截图？同时按侧边键和音量加键"') !== -1, "AI step 2 small line");
  assert.strictEqual(F.COPY.pickHint, "长按放一个图钉，可以拖动，再点『就放这里』");
  assert.ok(html.indexOf('<p class="mp-hint">长按放一个图钉，可以拖动，再点『就放这里』</p>') !== -1);
  assert.strictEqual(F.COPY.banner, "{n} 个地点待补位置");
  assert.ok(html.indexOf('id="fix-banner"') === -1, "yellow strip not in the package");
  assert.strictEqual(F.COPY.panelTitle, "待补位置 {i}/{n}");
  assert.strictEqual(F.COPY.skip, "先跳过");
  assert.strictEqual(F.COPY.allDone, "都补好了");
});

check("UI: while a card lists candidates, the grey 带我去 / 看位置 row and 「补上地址 ›」 are hidden; normal nav once fixed", function () {
  assert.ok(/if \(!needsAddr\) extra\.push\(cardLookHtml\(item\)\);/.test(tl), "unlocated cards only show 位置待确认, not 看位置 / 补上地址");
  const fn = tl.slice(tl.indexOf("function candShowing"), tl.indexOf("function candBoxHtml"));
  assert.ok(/return !!\(list && list\.length\);/.test(fn), "only when there is at least one candidate (also after 都不是)");
  F.clearCache();
  const it = { id: "z", type: "place", nameZh: "示例", address: "" };
  F.setCached(it, [{ name: "示例", lat: 1, lng: 2 }]);
  assert.ok(F.getCached(it).length === 1);
  /* fixed item: has coords → needsAddr false → nav is pushed again (the normal teal 带我去) */
  assert.ok(/var needsAddr = !isTransit\(item\) && itemUnlocated\(item\);/.test(tl));
});

check("「＋ 添加」 opens 「添加什么？」: 加机票 / 加酒店 / 加地点 + whole-trip AI button; final copy in one constant; UI values", function () {
  const C = tl.slice(tl.indexOf("var ADD_MENU_COPY = {"), tl.indexOf("var addPreset"));
  [
    'title: "添加什么？"', 'flight: "加机票"', 'flightSub: "截图交给 AI，自动整理"', 'hotel: "加酒店"', 'hotelSub: "搜酒店名，点一下加进行程"',
    'place: "加地点"', 'placeSub: "吃的、玩的、逛的"', 'whole: "有整份行程截图？交给 AI 一次整理 ›"',
    'hotelPlaceholder: "输入酒店名，或粘贴地址"', 'placePlaceholder: "输入店名，或粘贴地址"'
  ].forEach((x) => assert.ok(C.indexOf(x) !== -1, x));
  assert.ok(/\$\("add-fab"\)\.addEventListener\("click", openAddMenu\);/.test(tl), "＋ 添加 → menu");
  const open = tl.slice(tl.indexOf("function openAddFor"), tl.indexOf("function bindAddMenu"));
  assert.ok(/kind === "flight" \|\| kind === "whole"[\s\S]*?openAiWizard\(true\)/.test(open), "加机票 and the whole-trip button open the AI wizard");
  assert.ok(/setAddPreset\(kind\);\s*openSheet\("add-sheet"\);/.test(open), "加酒店 / 加地点 open the search page");
  const preset = tl.slice(tl.indexOf("function setAddPreset"), tl.indexOf("function openAddFor"));
  assert.ok(/addPreset = kind === "hotel" \? "酒店" : "";/.test(preset) && /hotelPlaceholder : ADD_MENU_COPY\.placePlaceholder/.test(preset));
  assert.ok(/addPreset \|\| guessLabel\(c\)/.test(tl), "hotel preset → the picked result is added as a hotel (existing hotel flow)");
  assert.ok(/if \(wasOpen\) setAddPreset\("place"\);/.test(tl), "preset resets when the add page closes");
  ["flight", "hotel", "place"].forEach((k) => assert.ok(new RegExp('<button type="button" class="am-row" id="am-' + k + '" data-add-kind="' + k + '">').test(html), k));
  assert.ok(/style="color:#6B7A8F;/.test(html) && /style="color:#8E5CF7;/.test(html) && /style="color:#0F9D8A;/.test(html), "ticket / bed / pin colours");
  assert.ok(/<div class="am-divider" role="separator"><\/div>\s*<button type="button" class="am-whole" id="am-whole" data-add-kind="whole">/.test(html));
  assert.ok(/data-close="add-menu" aria-label="关闭"/.test(html) && /closeSheet\("add-menu"\);\s*closeSheet\("friend-paste-sheet"\);\s*closeMapPick\(\);/.test(tl), "close button, backdrop and Esc");
  assert.ok(/\.am-row \{[^}]*height: 64px;/.test(css) && /\.am-ico \{[^}]*width: 40px; height: 40px; border-radius: 50%;/.test(css));
  assert.ok(/\.am-main \{ font-size: 16px; font-weight: 700;/.test(css) && /\.am-sub \{ font-size: 13px; color: #6B7A8F;/.test(css));
  assert.ok(/\.am-whole \{[^}]*min-height: 44px;/.test(css), "44px+ tap targets");
  assert.ok(html.indexOf("ai-entry-link") === -1 && tl.indexOf("AI_ENTRY_LINK") === -1, "the earlier link under the search box is gone");
});

check("加酒店 page: title 加酒店, ‹ back to the menu, no AI button / 手动填写, 找不到？在地图上选 › saves a hotel, purple bed rows; 加地点 page unchanged", function () {
  const C = tl.slice(tl.indexOf("var ADD_MENU_COPY = {"), tl.indexOf("var addPreset"));
  ['hotelTitle: "加酒店"', 'fallback: "找不到？换个方式加 ›"', 'fallbackMap: "在地图上选"', 'fallbackManual: "手动填地址"'].forEach((x) => assert.ok(C.indexOf(x) !== -1, x));
  assert.ok(/<button type="button" class="sheet-back" id="add-sheet-back" aria-label="[^"]+" hidden>‹<\/button>\s*<h2 id="add-sheet-title">/.test(html), "‹ before the title");
  assert.ok(/<input type="search" id="place-search"[^>]*>\s*<!--[^>]*-->\s*<button type="button" class="add-map-link" id="add-fallback" hidden>找不到？换个方式加 ›<\/button>/.test(html), "one fallback row right under the box (v6)");
  assert.ok(/\.sheet-back \{[^}]*font-size: 20px;/.test(css), "20px back arrow");
  assert.ok(/\.add-map-link \{[^}]*margin: 12px 0 4px;[^}]*font-size: 13px;[^}]*color: #0F9D8A;/.test(css), "13px teal link, 12px under the box");
  assert.ok(/#add-sheet\.is-hotel #add-search-block \{ margin-top: 8px; \}/.test(css), "8px top gap");
  assert.ok(/#add-sheet\.is-hotel #ai-big-btn,\s*#add-sheet\.is-hotel #ai-help,\s*#add-sheet\.is-hotel #manual-fold \{ display: none !important; \}/.test(css), "no AI button / wizard / 手动填写 on 加酒店");
  assert.ok(!/is-hotel #search-fallback|is-hotel #direct-add/.test(css), "直接添加 fallback stays");
  assert.ok(/\.search-hit-ico \{[^}]*color: #8E5CF7; background: #8E5CF71A;/.test(css) && /if \(hotelMode && !fixingId\)[\s\S]{0,200}HOTEL_BED_SVG/.test(tl), "purple bed icon on hotel result rows");
  const open = tl.slice(tl.indexOf("function openAddFor"), tl.indexOf("function bindAddMenu"));
  assert.ok(/setHotelMode\(kind === "hotel"\);/.test(open), "only 加酒店 gets the treatment (加地点 page unchanged)");
  assert.ok(/if \(hotelMode\) setHotelMode\(false\);/.test(tl) && /setAddPreset\("place"\);\s*setHotelMode\(false\);/.test(tl) && /if \(isEdit && hotelMode\) setHotelMode\(false\);/.test(tl), "reset on close / 补地址 / edit");
  const bind = tl.slice(tl.indexOf("function bindAddMenu"), tl.indexOf("function bindPasteSearch"));
  assert.ok(/closeSheet\("add-sheet"\);\s*openAddMenu\(\);/.test(bind), "‹ returns to 添加什么？");
  const fb = tl.slice(tl.indexOf("function openAddFallback"), tl.indexOf("function manualHotelFromSearch"));
  assert.ok(/\$\("add-fallback"\)\.addEventListener\("click", openAddFallback\)/.test(bind) && /else openMapPick\(null, null, \{ label: "酒店", name: q \|\| C\.mapHotelName \}\);/.test(fb), "v6: 在地图上选 (from the one fallback row) opens map-pick for a new hotel");
  const save = tl.slice(tl.indexOf("function saveMapPick"), tl.indexOf("function saveMapPick") + 900);
  assert.ok(/itemFromType\(spec\.name, "", spec\.label, null, selectedDateOrEmpty\(\)\);\s*fresh\.address = "";\s*fresh = FC\(\)\.applyMapPick/.test(save), "saved as a hotel, lat/lng only");
  assert.ok(/afterHotelReady\(fresh,/.test(save), "v5.4: map-pick hotel goes through the date panel before adding");
});

check("Hotel dates from the add flow (v5.4): selected day, else trip first day, else blank — never today; day city uses check-in", function () {
  const d1 = F.hotelDates("2026-12-04", ["2026-12-02", "2026-12-05"], "2026-11-16");
  assert.deepStrictEqual(d1, { checkIn: "2026-12-04", checkOut: "2026-12-05" });
  assert.deepStrictEqual(F.hotelDates("", ["2026-12-05", "2026-12-02"], "2026-11-16"), { checkIn: "2026-12-02", checkOut: "2026-12-03" });
  assert.strictEqual(F.hotelDates("all", [], "2026-11-16"), null, "no trip dates and no explicit day: blank, never today");
  assert.deepStrictEqual(F.hotelDates("2026-12-31", [], ""), { checkIn: "2026-12-31", checkOut: "2027-01-01" }, "month / year roll-over");
  assert.deepStrictEqual(F.hotelDates("2028-02-28", [], ""), { checkIn: "2028-02-28", checkOut: "2028-02-29" }, "leap day");
  assert.ok(/afterHotelReady\(item, function \(it\) \{ addPlaceAndToast\(it\); \}\)/.test(tl), "search pick goes through the date panel");
  assert.ok(/function finishDirectAdd[\s\S]*afterHotelReady\(item,/.test(tl), "直接添加 goes through the date panel");
  assert.ok(tl.indexOf("todayIso()") === -1 || !/function applyHotelDates[\s\S]{0,400}todayIso\(\)/.test(tl), "applyHotelDates does not fall back to today");
  /* day city / timeline: the new hotel covers the check-in night only and gives that day its city */
  const TN = require("./trip-name.js");
  const hotel = { id: "h", type: "hotel", nameZh: "示例酒店", city: "示例市", lat: 1, lng: 2, checkIn: d1.checkIn, checkOut: d1.checkOut };
  assert.strictEqual(TN.dayCity([hotel], "2026-12-04").query, "示例市");
  assert.strictEqual(TN.dayCity([hotel], "2026-12-04").source, "hotel");
  const next = TN.dayCity([hotel], "2026-12-05");
  assert.ok(!next || next.source !== "hotel", "check-out day is not a hotel night");
  const L = require("./legs.js");
  assert.strictEqual(L.itemDisplayDate(hotel), "2026-12-04", "timeline lists it on the check-in day");
});

check("AI wizard still reachable from 加机票 and the whole-trip link; backup import still in Settings", function () {
  assert.ok(/kind === "flight" \|\| kind === "whole"/.test(tl) && /data-add-kind="flight"/.test(html) && /data-add-kind="whole"/.test(html));
  const st = html.slice(html.indexOf('id="settings-sheet"'), html.indexOf('id="settings-sheet"') + 3000);
  assert.ok(/id="backup-import">导入<\/button>/.test(st), "导入 in Settings");
  assert.ok(/getElementById\("backup-import"\)/.test(fs.readFileSync(path.join(__dirname, "backup.js"), "utf8")), "导入 is wired (backup.js)");
});

(async function () {
  for (const [name, fn] of queue) {
    try {
      await fn();
      console.log("PASS  " + name);
    } catch (err) {
      failures += 1;
      console.log("FAIL  " + name);
      console.log("      " + (err && err.stack ? err.stack : err));
    }
  }
  if (failures) {
    console.log("\n" + failures + " check(s) failed.");
    process.exit(1);
  }
  console.log("\nAll v5.3 fix checks passed.");
})();

// v5.3 review: manual 酒店 entry uses the same check-in/out rule
(function () {
  var fs = require("fs"), assert = require("assert");
  var tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  var i = tl.indexOf('id: "hotel-" + Date.now()');
  assert.ok(i !== -1);
  var seg = tl.slice(i, i + 900);
  assert.ok(seg.indexOf("afterHotelReady(hotel") !== -1, "manual hotel goes through the date panel");
  console.log("ok manual hotel dates");
})();
