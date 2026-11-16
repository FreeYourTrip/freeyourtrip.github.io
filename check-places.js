/**
 * v6 地点库（places.js）：两档匹配规则、建地点、备注跟着走、去过、分享 / 合并。全部假数据。用法：node check-places.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const P = require("./places.js");

let failures = 0;
let passes = 0;
function check(name, fn) {
  try {
    fn();
    passes += 1;
    console.log("PASS  " + name);
  } catch (err) {
    failures += 1;
    console.log("FAIL  " + name);
    console.log("      " + (err && err.stack ? err.stack : err));
  }
}

/* 伦敦附近的假坐标：每 0.0009° 纬度约 100 米 */
const BASE = { lat: 51.5, lng: -0.12 };
function off(m) {
  return { lat: BASE.lat + m / 111195, lng: BASE.lng };
}
function place(id, name, extra) {
  return Object.assign({ id, name, nameEn: "", type: "food", tags: [], city: "London", note: "", wish: null, visits: [] }, extra || {});
}

check("normName: full-width, case, spaces and punctuation ignored", function () {
  assert.strictEqual(P.normName("Dishoom  Covent-Garden"), P.normName("dishoom covent garden"));
  assert.strictEqual(P.normName("ＤＩＳＨＯＯＭ（考文特花园）"), P.normName("dishoom 考文特花园"));
  assert.strictEqual(P.normName("一兰拉面·新宿店"), "一兰拉面新宿店");
});

check("distanceM is about right (100 m north)", function () {
  const d = P.distanceM(BASE, off(100));
  assert.ok(d > 99 && d < 101, d);
});

check("AUTO: same normalised name within 100 m", function () {
  const lib = [place("a", "Dishoom Covent Garden", off(0))];
  const m = P.match(Object.assign({ name: "dishoom covent-garden", type: "food" }, off(80)), lib);
  assert.strictEqual(m.kind, "auto");
  assert.strictEqual(m.place.id, "a");
});

check("AUTO: same map POI id within 100 m even if the name differs", function () {
  const lib = [place("a", "Dishoom", Object.assign({ poiId: "osm:node/1" }, off(0)))];
  const m = P.match(Object.assign({ name: "印度早餐店", type: "food", poiId: "osm:node/1" }, off(50)), lib);
  assert.strictEqual(m.kind, "auto");
  assert.strictEqual(m.reason, "poi");
});

check("not AUTO past 100 m: same name 150 m away → ASK (within 1 km)", function () {
  const lib = [place("a", "Dishoom", off(0))];
  const m = P.match(Object.assign({ name: "Dishoom", type: "food" }, off(150)), lib);
  assert.strictEqual(m.kind, "ask");
});

check("ASK: one name contains the other (close by), never auto", function () {
  const lib = [place("a", "一兰拉面", off(0))];
  const m = P.match(Object.assign({ name: "一兰拉面 新宿店", type: "food" }, off(20)), lib);
  assert.strictEqual(m.kind, "ask");
  assert.strictEqual(m.reason, "contains");
});

check("ASK: Chinese name or English name matches (the other differs)", function () {
  const lib = [place("a", "大英博物馆", Object.assign({ nameEn: "British Museum", type: "sight" }, off(0)))];
  const m = P.match(Object.assign({ name: "British Museum Great Court", nameEn: "British Museum", type: "sight" }, off(300)), lib);
  assert.strictEqual(m.kind, "ask");
});

check("NEW: close by but a completely different name", function () {
  const lib = [place("a", "Dishoom", off(0))];
  assert.strictEqual(P.match(Object.assign({ name: "Flat Iron", type: "food" }, off(10)), lib).kind, "new");
});

check("NEW (guessed rule): same name but over 1 km apart = probably another branch", function () {
  const lib = [place("a", "Pret A Manger", off(0))];
  assert.strictEqual(P.match(Object.assign({ name: "Pret A Manger", type: "food" }, off(5000)), lib).kind, "new");
});

check("no coords: same name + same city → ASK, never auto-merge", function () {
  const lib = [place("a", "Dishoom", { city: "London" })];
  const m = P.match({ name: "DISHOOM", city: "london", type: "food" }, lib);
  assert.strictEqual(m.kind, "ask");
  assert.strictEqual(m.reason, "name-city");
});

check("no coords: same name, other city (or no city) → NEW", function () {
  const lib = [place("a", "Dishoom", { city: "London" })];
  assert.strictEqual(P.match({ name: "Dishoom", city: "Manchester", type: "food" }, lib).kind, "new");
  assert.strictEqual(P.match({ name: "Dishoom", city: "", type: "food" }, lib).kind, "new");
});

check("one side has coords, the other not: same name + same city → ASK", function () {
  const lib = [place("a", "Dishoom", { city: "London" })];
  assert.strictEqual(P.match(Object.assign({ name: "Dishoom", city: "London", type: "food" }, off(0)), lib).kind, "ask");
});

check("hotels only match hotels", function () {
  const lib = [place("a", "The Savoy", Object.assign({ type: "food" }, off(0)))];
  assert.strictEqual(P.match(Object.assign({ name: "The Savoy", type: "hotel" }, off(0)), lib).kind, "new");
});

check("auto beats ask; the nearest auto wins; excluded places are skipped", function () {
  const lib = [place("far", "Dishoom", off(90)), place("near", "Dishoom", off(5)), place("ask", "Dishoom Shoreditch", off(1))];
  const m = P.match(Object.assign({ name: "Dishoom", type: "food" }, off(0)), lib);
  assert.strictEqual(m.kind, "auto");
  assert.strictEqual(m.place.id, "near");
  assert.strictEqual(P.match(Object.assign({ name: "Dishoom", type: "food" }, off(0)), lib, { exclude: ["near", "far"] }).kind, "ask");
});

check("placeFromItem: types, default tags (hotel 酒店, 民宿 by name), fields", function () {
  const h = P.placeFromItem({ id: "h", type: "hotel", nameZh: "示例酒店", address: "Example St 1", lat: 1, lng: 2, note: "多行\n备注" }, "pl-h", "2026-11-16");
  assert.deepStrictEqual([h.type, h.tags, h.note, h.lat, h.lng, h.address, h.createdAt], ["hotel", ["酒店"], "多行\n备注", 1, 2, "Example St 1", "2026-11-16"]);
  assert.deepStrictEqual(P.placeFromItem({ type: "hotel", nameZh: "京都示例民宿" }, "x").tags, ["民宿"]);
  assert.strictEqual(P.placeFromItem({ type: "place", subtype: "餐厅", nameZh: "x" }, "x").type, "food");
  assert.strictEqual(P.placeFromItem({ type: "place", subtype: "景点", nameZh: "x" }, "x").type, "sight");
  assert.strictEqual(P.placeFromItem({ type: "place", nameZh: "x" }, "x").wish, null);
  assert.ok(!P.linkable({ type: "flight", flightNo: "BA1" }) && !P.linkable({ type: "train", number: "G1" }), "transport is never a place");
});

check("tags: food 堂食/外卖 optional + both; hotel exactly one, default 酒店", function () {
  assert.deepStrictEqual(P.cleanTags("food", []), []);
  assert.deepStrictEqual(P.cleanTags("food", ["外卖", "堂食", "乱写"]), ["堂食", "外卖"]);
  assert.deepStrictEqual(P.cleanTags("hotel", []), ["酒店"]);
  assert.deepStrictEqual(P.cleanTags("hotel", ["民宿"]), ["民宿"]);
  assert.deepStrictEqual(P.cleanTags("sight", ["外卖"]), []);
});

check("linkItem: auto link brings the old note into the new trip (note follows the place)", function () {
  const lib = [];
  const a = { id: "a", type: "place", subtype: "餐厅", nameZh: "Dishoom", lat: off(0).lat, lng: off(0).lng, note: "印度早餐，建议早去排队" };
  assert.strictEqual(P.linkItem(a, lib, { idFor: () => "pl-1" }).action, "new");
  const b = { id: "b", type: "place", subtype: "餐厅", nameZh: "dishoom", lat: off(30).lat, lng: off(30).lng };
  const r = P.linkItem(b, lib, {});
  assert.strictEqual(r.action, "auto");
  assert.strictEqual(b.placeId, "pl-1");
  assert.strictEqual(b.note, "印度早餐，建议早去排队");
  assert.strictEqual(lib.length, 1);
  assert.strictEqual(P.linkItem(b, lib, {}).action, "linked", "running again changes nothing");
});

check("linkItem: ask-tier is deferred to the UI or (imports) creates a separate place, never merges", function () {
  const lib = [place("p", "一兰拉面", off(0))];
  const it = { id: "x", type: "place", subtype: "餐厅", nameZh: "一兰拉面 新宿店", lat: off(10).lat, lng: off(10).lng };
  const d = P.linkItem(Object.assign({}, it), lib, { onAsk: "defer" });
  assert.strictEqual(d.action, "ask");
  assert.strictEqual(lib.length, 1, "nothing created while waiting for the answer");
  const copy = Object.assign({}, it);
  assert.strictEqual(P.linkItem(copy, lib, { onAsk: "new", idFor: () => "pl-new" }).action, "new");
  assert.strictEqual(copy.placeId, "pl-new");
  const yes = Object.assign({ note: "" }, it);
  lib[0].note = "要排队";
  P.linkTo(yes, lib[0]);
  assert.strictEqual(yes.placeId, "p");
  assert.strictEqual(yes.note, "要排队");
});

check("setNote: editing a note updates the place and every linked item in every trip", function () {
  const lib = [place("p", "Dishoom", { note: "旧" })];
  const trips = [
    { id: "t1", items: [{ id: "a", type: "place", nameZh: "Dishoom", placeId: "p", note: "旧" }] },
    { id: "t2", items: [{ id: "b", type: "place", nameZh: "Dishoom", placeId: "p", note: "旧" }, { id: "c", type: "place", nameZh: "别的" }] }
  ];
  assert.strictEqual(P.setNote(lib, trips, "p", "第一行\n第二行 https://example.com", "2026-11-16"), 2);
  assert.strictEqual(trips[1].items[0].note, "第一行\n第二行 https://example.com");
  assert.strictEqual(trips[1].items[1].note, undefined);
  P.setNote(lib, trips, "p", "");
  assert.ok(!("note" in trips[0].items[0]), "deleting the note removes it everywhere");
});

check("visits: hotel stay = 1 visit with nights; 没去成 cancels; dedupe; delete-trip removes only that trip", function () {
  const p = place("h", "示例酒店", { type: "hotel", tags: ["酒店"] });
  const v = P.visitFromItem({ type: "hotel", nameZh: "示例酒店", checkIn: "2026-12-04", checkOut: "2026-12-07" }, "t1");
  assert.deepStrictEqual(v, { date: "2026-12-04", tripId: "t1", nights: 3 });
  const added = P.addVisit(p, v);
  P.addVisit(p, v);
  assert.strictEqual(p.visits.length, 1, "same trip + same day is not counted twice");
  P.addVisit(p, { date: "2027-05-01", tripId: "t2", nights: 1 });
  assert.strictEqual(P.visitCount(p), 2);
  assert.ok(P.cancelVisit(p, added.id));
  assert.strictEqual(P.visitCount(p), 1, "没去成 no longer counts");
  assert.strictEqual(p.visits.length, 2, "but the record stays");
  assert.strictEqual(P.removeTripVisits([p], "t2"), 1);
  assert.deepStrictEqual(p.visits.map((x) => x.tripId), ["t1"]);
});

check("wish: 想去 with saved date, can be cleared", function () {
  const p = place("a", "x");
  P.setWish(p, "2026-11-16");
  assert.deepStrictEqual(p.wish, { savedAt: "2026-11-16" });
  P.clearWish(p);
  assert.strictEqual(p.wish, null);
});

check("forShare: only places used by the shared trips, no 收藏 / 去过", function () {
  const lib = [
    place("used", "Dishoom", { wish: { savedAt: "2026-11-01" }, visits: [{ id: "v", date: "2026-12-04", tripId: "t1" }], note: "好吃" }),
    place("fav", "只是收藏", { wish: { savedAt: "2026-11-02" } })
  ];
  const out = P.forShare(lib, [{ id: "t1", items: [{ id: "a", placeId: "used" }] }]);
  assert.deepStrictEqual(out.map((p) => p.id), ["used"]);
  assert.strictEqual(out[0].wish, null);
  assert.deepStrictEqual(out[0].visits, []);
  assert.strictEqual(out[0].note, "好吃");
  assert.ok(lib[0].wish && lib[0].visits.length === 1, "the local store is not changed");
});

check("mergeInto: auto-same places reuse the local id; others are added with a fresh id on clash", function () {
  const local = [place("pl-1", "Dishoom", off(0)), place("pl-2", "Flat Iron", off(500))];
  const incoming = [place("pl-9", "dishoom", Object.assign({ note: "文件里的备注" }, off(10))), place("pl-2", "Monmouth Coffee", off(2000))];
  const map = P.mergeInto(local, incoming);
  assert.strictEqual(map["pl-9"], "pl-1");
  assert.strictEqual(local[0].note, "文件里的备注", "local had no note → take the file's");
  assert.strictEqual(map["pl-2"], "pl-2-2");
  assert.strictEqual(local.length, 3);
});

check("normalizePlace / normalizeAll: corrupt entries dropped, fields repaired, no crash", function () {
  const out = P.normalizeAll([null, 5, "x", [], { name: "no id" }, { id: "ok", type: "weird", tags: "x", visits: [null, { date: 1 }], lat: "1" }, { id: "ok", name: "dup" }]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].type, "place");
  assert.deepStrictEqual(out[0].tags, []);
  assert.strictEqual(out[0].visits.length, 1);
  assert.ok(!("lat" in out[0]), "string coords are not coords");
  assert.deepStrictEqual(P.normalizeAll("garbage"), []);
});

check("places.js is pure: no storage, network or DOM", function () {
  const src = fs.readFileSync(__dirname + "/places.js", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/localStorage|sessionStorage|fetch\(|XMLHttpRequest|document\.|indexedDB|geolocation/.test(src));
});

console.log("\n" + passes + " passed, " + failures + " failed");
if (failures) process.exit(1);
console.log("All place checks passed.");
