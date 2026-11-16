/**
 * v5.2 搜不到直接添加 / 补地址 / 按当天城市再搜一次（全部假数据）。用法：node check-fix-address.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");

let failures = 0;
const queue = [];
function check(name, fn) {
  queue.push([name, fn]);
}
const ItemEdit = require("./item-edit.js");
require("./geo.js");
const TripName = require("./trip-name.js");
const Geocode = require("./geocode.js");

const TRIP = [
  { id: "f1", type: "flight", flightNo: "XX101", fromAirport: "LHR", toAirport: "HND", departDate: "2026-12-01", departTime: "09:00" },
  { id: "h1", type: "hotel", nameZh: "示例酒店 A", address: "示例 1-1", city: "Tokyo", checkIn: "2026-12-02", checkOut: "2026-12-04", lat: 35.69, lng: 139.70 },
  { id: "h2", type: "hotel", nameZh: "示例旅馆 B", address: "示例町 2", city: "Kyoto", checkIn: "2026-12-04", checkOut: "2026-12-06", lat: 35.0037, lng: 135.7788 },
  { id: "h3", type: "hotel", nameZh: "示例酒店 C", address: "示例 3-3", city: "Osaka", checkIn: "2026-12-06", checkOut: "2026-12-08" },
  { id: "p1", type: "place", nameZh: "示例小店", date: "2026-12-05", time: "15:00", address: "", icon: "dessert", note: "下午去" }
];

check("fix-up keeps the SAME item: name, date, time, icon and notes kept; address + lat/lng filled", function () {
  const before = JSON.parse(JSON.stringify(TRIP[4]));
  const cand = { lat: 35.0037, lng: 135.7788, displayName: "示例小店, 示例町 9, 东山区, 京都市, 日本", coordSystem: "wgs84" };
  const next = ItemEdit.applyFoundPlace(TRIP[4], cand, "示例町 9, 东山区, 京都市");
  assert.deepStrictEqual(TRIP[4], before, "original object untouched (undo keeps a clean copy)");
  assert.strictEqual(next.id, "p1");
  assert.strictEqual(next.nameZh, "示例小店");
  assert.strictEqual(next.date, "2026-12-05");
  assert.strictEqual(next.time, "15:00");
  assert.strictEqual(next.icon, "dessert");
  assert.strictEqual(next.note, "下午去");
  assert.strictEqual(next.lat, 35.0037);
  assert.strictEqual(next.lng, 135.7788);
  assert.strictEqual(next.address, "示例町 9, 东山区, 京都市");
  const list = ItemEdit.updateItem(TRIP, "p1", next);
  assert.strictEqual(list.length, TRIP.length, "no new item");
  assert.strictEqual(list[4].lat, 35.0037);
});

check("fix-up coordinates are stored as WGS-84 (a GCJ-02 result is converted once)", function () {
  const G = require("./geo.js");
  const gcj = G.wgs84ToGcj02(31.2304, 121.4737);
  const next = ItemEdit.applyFoundPlace({ id: "x", nameZh: "示例" }, { lat: gcj.lat, lng: gcj.lng, coordSystem: "gcj02" }, "上海市示例路 1 号");
  assert.ok(Math.abs(next.lat - 31.2304) < 1e-5 && Math.abs(next.lng - 121.4737) < 1e-5, JSON.stringify(next));
  const keep = ItemEdit.applyFoundPlace({ id: "y" }, { lat: 51.5, lng: -0.12 }, "");
  assert.strictEqual(keep.lat, 51.5);
});

check("day city, multi-city trip: Tokyo → Kyoto → Osaka; a Kyoto-day item searches Kyoto", function () {
  const k = TripName.dayCity(TRIP, "2026-12-05", { excludeId: "p1", time: "15:00" });
  assert.deepStrictEqual([k.query, k.source], ["Kyoto", "hotel"], "city comes from the hotel's stored item.city");
  assert.strictEqual(TripName.dayCity(TRIP, "2026-12-03").query, "Tokyo");
  assert.strictEqual(TripName.dayCity(TRIP, "2026-12-04").query, "Kyoto", "check-out day belongs to the next hotel");
  assert.strictEqual(TripName.dayCity(TRIP, "2026-12-07").query, "Osaka");
});

check("day city: no hotel that day → nearest-in-time same-day item with a city; otherwise nothing (no trip-city fallback)", function () {
  const items = [
    { id: "a", type: "place", nameZh: "早上的点", date: "2026-12-20", time: "09:00", address: "Example Street 1", city: "Oxford", lat: 51.752, lng: -1.2577 },
    { id: "b", type: "place", nameZh: "下午的点", date: "2026-12-20", time: "16:00", address: "Example Road 2", city: "London", lat: 51.5072, lng: -0.1276 },
    { id: "c", type: "place", nameZh: "没坐标", date: "2026-12-20", time: "16:30", address: "" },
    { id: "f", type: "flight", flightNo: "XX9", fromAirport: "LHR", toAirport: "HND", departDate: "2026-12-19", departTime: "10:00" }
  ];
  const r = TripName.dayCity(items, "2026-12-20", { excludeId: "c", time: "16:30" });
  assert.deepStrictEqual([r.query, r.source], ["London", "same-day"]);
  assert.strictEqual(TripName.dayCity(items, "2026-12-20", { excludeId: "c", time: "08:30" }).query, "Oxford");
  assert.strictEqual(TripName.dayCity(items, "2026-12-21", {}), null, "nothing that day → append nothing, even though the trip city is known");
  assert.strictEqual(TripName.dayCity(items, "", {}), null);
});

check("city retry: no results → also search 'name + day city'; fix-up prefers city results; no double city", async function () {
  const calls = [];
  const fake = (q) => {
    calls.push(q);
    if (q === "示例小店") return Promise.resolve([]);
    if (q === "示例小店 Kyoto") return Promise.resolve([{ name: "示例小店", lat: 35.0037, lng: 135.7788 }]);
    if (q === "Example Cafe") return Promise.resolve([{ name: "Example Cafe", lat: 40.7, lng: -74.0 }]);
    if (q === "Example Cafe London") return Promise.resolve([{ name: "Example Cafe", lat: 51.51, lng: -0.13 }, { name: "Example Cafe", lat: 40.7, lng: -74.0 }]);
    return Promise.resolve([]);
  };
  let r = await Geocode.searchWithCity("示例小店", "Kyoto", { search: fake });
  assert.deepStrictEqual(calls, ["示例小店", "示例小店 Kyoto"]);
  assert.strictEqual(r.results.length, 1);
  assert.strictEqual(r.usedCity, true);
  calls.length = 0;
  r = await Geocode.searchWithCity("Example Cafe", "London", { search: fake });
  assert.deepStrictEqual(calls, ["Example Cafe"], "plain results found → no retry for a normal add");
  calls.length = 0;
  r = await Geocode.searchWithCity("Example Cafe", "London", { search: fake, prefer: true });
  assert.deepStrictEqual(calls, ["Example Cafe", "Example Cafe London"], "fix-up always tries the city too");
  assert.deepStrictEqual(r.results.map((x) => x.lat), [51.51, 40.7], "city results first, duplicates merged");
  calls.length = 0;
  await Geocode.searchWithCity("Example Cafe London", "London", { search: fake, prefer: true });
  assert.deepStrictEqual(calls, ["Example Cafe London"], "city already in the query");
  calls.length = 0;
  await Geocode.searchWithCity("示例小店", "", { search: fake });
  assert.deepStrictEqual(calls, ["示例小店"], "no day city → nothing appended");
  assert.strictEqual(Geocode.cityQuery("示例小店", "Kyoto"), "示例小店 Kyoto");
});

check("UI: 「＋ 直接添加「xxx」」 + small line, icon step, toast, card 「待补地址」 button (44px), prefilled fix-up search, 手动填地址", function () {
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  const css = fs.readFileSync(__dirname + "/styles.css", "utf8");
  assert.ok(tl.indexOf('btn: "＋ 直接添加「{q}」"') !== -1 && tl.indexOf('sub: "没有地图位置，也能放进行程"') !== -1);
  assert.ok(html.indexOf('<span class="sf-sub">没有地图位置，也能放进行程</span>') !== -1);
  assert.ok(html.indexOf("找不到？直接用这个名字添加") === -1 && tl.indexOf("找不到？直接用这个名字添加") === -1, "old label gone");
  assert.ok(/id="direct-icon-picker"/.test(html) && /renderIconPicker\("direct-icon-picker", directIcon\)/.test(tl), "icon-pick step");
  assert.ok(tl.indexOf('added: "已添加。点卡片上的『位置待确认』，就能出现在地图上"') !== -1);
  assert.ok(/addPlaceAndToast\((item|it), DIRECT_COPY\.added\)/.test(tl), "direct-add still toasts and can go through the hotel date panel");
  const di = tl.slice(tl.indexOf("function directItem"), tl.indexOf("function finishDirectAdd"));
  assert.ok(/item\.address = "";/.test(di) && /itemFromType\(name, "", addPreset \|\| "地点", null, date\)/.test(di), "no address, no coords (v5.3: 加酒店 keeps the hotel type)");
  assert.ok(tl.indexOf('fixBtn: "位置待确认"') !== -1 && tl.indexOf("位置待确认 ›") !== -1);
  assert.ok(/\.fix-addr::before \{ content: ""; position: absolute; left: -4px; right: -4px; top: -10px; bottom: -10px; \}/.test(css) && /min-height: 24px;/.test(css), "24px + 2×10px = 44px tap target");
  assert.ok(/\.fix-dot \{[^}]*background: #B8BEC6;/.test(css), "grey dot");
  const of = tl.slice(tl.indexOf("function openFixAddress"), tl.indexOf("function exitFixMode"));
  assert.ok(/\$\("place-search"\)\.value = q;/.test(of) && /runLiveSearch\(q\)/.test(of), "search opens with the item's name prefilled");
  assert.ok(/prefer: !!fixingId/.test(tl), "fix-up search retries with the day city");
  assert.ok(/if \(fixingId\) \{\s*fixItemFromHit\(c, name\);/.test(tl), "picking a result updates that item");
  assert.ok(/ItemEdit\.applyFoundPlace\(old, c,/.test(tl) && /showToast\(DIRECT_COPY\.fixDone, function \(\) \{/.test(tl), "undo restores the old item");
  assert.ok(tl.indexOf('fixManual: "手动填地址"') !== -1 && /enterEditMode\(id\);/.test(tl.slice(tl.indexOf("function fixManually"))), "manual address fallback opens the edit form");
  assert.ok(/#add-sheet\.is-fixing #search-fallback/.test(css), "no direct-add inside the fix-up");
  assert.ok(!/maps\.app\.goo\.gl|粘贴地图链接/.test(tl), "no map-link pasting");
});

check("coordinate-only items with no stored city add no text (no coordinate → city guessing, no city table)", function () {
  const at = (lat, lng) => TripName.cityOfItem({ lat, lng });
  assert.strictEqual(at(34.9858, 135.7588), "");
  assert.strictEqual(at(51.5074, -0.1278), "");
  assert.strictEqual(TripName.cityOfItem({ address: "京都府京都市东山区示例町 2" }), "", "address text is not parsed for the retry");
  const items = [
    { id: "k", type: "place", nameZh: "示例寺", date: "2026-12-05", time: "10:00", lat: 35.0394, lng: 135.7292 },
    { id: "x", type: "place", nameZh: "没坐标", date: "2026-12-05", time: "11:00", address: "" }
  ];
  assert.strictEqual(TripName.dayCity(items, "2026-12-05", { excludeId: "x", time: "11:00" }), null);
  assert.deepStrictEqual(TripName.dayArea(items, "2026-12-05", { excludeId: "x" }), { lat: 35.0394, lng: 135.7292 }, "coords still give an area bias");
  const tn = fs.readFileSync(__dirname + "/trip-name.js", "utf8");
  assert.ok(!/EXTRA_CIT|CITY_CENTRE|function km\(/.test(tn), "city table and nearest-airport guessing removed");
});

check("Kyoto-day fix-up: viewbox around ~35.0,135.8 (1 decimal) + text retry 'Kyoto'; London still fine", async function () {
  const area = TripName.dayArea(TRIP, "2026-12-05", { excludeId: "p1", time: "15:00" });
  assert.deepStrictEqual(area, { lat: 35.0037, lng: 135.7788 }, "the day's hotel coords (local only)");
  const box = Geocode.biasArea(area);
  assert.deepStrictEqual([box.lat, box.lng], [35.0, 135.8], "centre rounded to 1 decimal");
  assert.strictEqual(box.viewbox, "135.6,35.2,136.0,34.8", "~20 km box, every number 1 decimal");
  const calls = [];
  const fake = (q, so) => {
    calls.push([q, so ? Geocode.biasArea(so.bias).viewbox : null]);
    return Promise.resolve(q === "示例小店 Kyoto" ? [{ name: "示例小店", lat: 35.0037, lng: 135.7788, city: "Kyoto" }] : []);
  };
  const city = TripName.dayCity(TRIP, "2026-12-05", { excludeId: "p1" }).query;
  const r = await Geocode.searchWithCity("示例小店", city, { search: fake, prefer: true, bias: area });
  assert.deepStrictEqual(calls, [["示例小店", null], ["示例小店 Kyoto", "135.6,35.2,136.0,34.8"]], "plain first, then city text + area");
  assert.strictEqual(r.results.length, 1);
  /* no city known but an area → same words again with the area only */
  calls.length = 0;
  await Geocode.searchWithCity("示例小店", "", { search: fake, bias: { lat: 51.5072, lng: -0.1276 } });
  assert.deepStrictEqual(calls, [["示例小店", null], ["示例小店", "-0.4,51.7,0.2,51.3"]]);
  /* picking the result stores the map service's city */
  const next = ItemEdit.applyFoundPlace(TRIP[4], { lat: 35.0037, lng: 135.7788, displayName: "x", city: "Kyoto" }, "示例町 9");
  assert.strictEqual(next.city, "Kyoto");
  const mapped = Geocode.mapResults([{ lat: "51.5", lon: "-0.1", display_name: "x", address: { town: "Example Town", suburb: "S" } }]);
  assert.strictEqual(mapped[0].city, "Example Town", "Nominatim city/town/village");
  assert.strictEqual(Geocode.mapAmapJsPois([{ name: "示例", location: { lng: 121.47, lat: 31.23 }, cityname: "上海市" }])[0].city, "上海市", "Amap cityname");
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
  console.log("\nAll fix-address checks passed.");
})();
