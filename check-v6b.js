/**
 * v6 第 1 批（合并 v5.4 之后的这一轮）：同一趟导入时问、批量导入的地点匹配、搬家不合并、空行程、清空这趟、
 * 「我的行程」样式、火车 / 船上锁、火车 / 船到达比出发早进待补、火车 / 船前 1 小时退房、sw v18。
 * 全部假数据，不连网。用法：node check-v6b.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");

const T = require("./transport.js");
const P = require("./places.js");
const Store = require("./trip-store.js");
const I = require("./import.js");
const E = require("./item-edit.js");
const Legs = require("./legs.js");

const read = (f) => fs.readFileSync(__dirname + "/" + f, "utf8");
const tl = read("timeline.js");
const css = read("styles.css");
const html = read("index.html");

let passes = 0;
let failures = 0;
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

/* 伦敦一点，往北挪 x 米 */
const LAT = 51.5116, LNG = -0.1268;
const north = (m) => LAT + m / 111320;
const lib = (extra) => [Object.assign({ id: "p1", type: "food", name: "Dishoom Covent Garden", lat: LAT, lng: LNG, city: "London" }, extra || {})];
const cand = (m, extra) => Object.assign({ type: "food", name: "Dishoom Covent Garden", lat: north(m), lng: LNG, city: "London" }, extra || {});

check("matching: same POI → auto at any distance; same name ≤100 m auto, 100 m–1 km ask, >1 km new", function () {
  assert.strictEqual(P.match(cand(5000, { poiId: "osm:1" }), lib({ poiId: "osm:1" })).kind, "auto", "same POI, 5 km apart");
  assert.strictEqual(P.match(cand(50), lib()).kind, "auto");
  assert.strictEqual(P.match(cand(99), lib()).kind, "auto");
  assert.strictEqual(P.match(cand(150), lib()).kind, "ask");
  assert.strictEqual(P.match(cand(900), lib()).kind, "ask");
  assert.strictEqual(P.match(cand(1500), lib()).kind, "new");
  assert.strictEqual(P.AUTO_RADIUS_M, 100);
  assert.strictEqual(P.ASK_RADIUS_M, 1000);
});

check("batch import asks too: every 「像是上次那家」 item is queued, none merged silently", function () {
  assert.ok(/var asks = linkAddedItems\(added\);/.test(tl) && /askSamePlaces\(asks\);/.test(tl));
  assert.ok(/Places\.linkItem\(it, places, \{ onAsk: "defer", today: todayIso\(\) \}\)/.test(tl), "always defer, not only for a single item");
  assert.ok(/function askSamePlaces\(queue\) \{[\s\S]*?askSamePlace\(a\.item, a\.place, function \(\) \{ askSamePlaces\(queue\); \}\);/.test(tl), "one after another");
  const places = lib();
  const items = [
    { id: "a", type: "place", subtype: "餐厅", nameZh: "Dishoom Covent Garden", lat: north(40), lng: LNG },
    { id: "b", type: "place", subtype: "餐厅", nameZh: "Dishoom Covent Garden", lat: north(400), lng: LNG },
    { id: "c", type: "place", subtype: "餐厅", nameZh: "Dishoom Covent Garden", lat: north(3000), lng: LNG }
  ];
  const r = items.map((it) => P.linkItem(it, places, { onAsk: "defer", today: "2026-11-16" }).action);
  assert.deepStrictEqual(r, ["auto", "ask", "new"]);
  assert.strictEqual(items[1].placeId, undefined, "the asked one waits for the answer");
});

check("migration never merges: same name, same spot → still two places", function () {
  const v1 = { trips: [{ id: "my-trip", nameZh: "伦敦", items: [
    { id: "x1", type: "place", subtype: "餐厅", nameZh: "Dishoom Covent Garden", lat: LAT, lng: LNG, note: "第一次" },
    { id: "x2", type: "place", subtype: "餐厅", nameZh: "Dishoom Covent Garden", lat: LAT, lng: LNG, note: "第二次" }
  ] }], activeTripId: "my-trip" };
  const mem = {};
  const ls = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  ls.setItem(Store.V1_KEY, JSON.stringify(v1));
  const res = Store.load(ls, { today: "2026-11-16" });
  assert.strictEqual(res.source, "migrated");
  const got = res.state;
  const its = got.trips[0].items;
  assert.notStrictEqual(its[0].placeId, its[1].placeId);
  assert.strictEqual(got.places.length, 2);
  assert.deepStrictEqual(its.map((i) => i.note), ["第一次", "第二次"], "notes untouched");
  const again = Store.load(ls, { today: "2026-11-16" });
  assert.strictEqual(again.source, "v2");
  assert.strictEqual(again.state.places.length, 2, "idempotent");
});

check("same trip id on import: 覆盖 / 另存一份 / 取消 (pure part); 另存一份 → id -2 and 「（副本）」", function () {
  const cur = { trips: [{ id: "t1", nameZh: "东京", items: [{ id: "i", type: "place", nameZh: "旧" }] }], places: [] };
  const inc = { trips: [{ id: "t1", nameZh: "东京", items: [{ id: "j", type: "place", nameZh: "新" }] }], places: [] };
  assert.deepStrictEqual(Store.tripConflicts(cur, inc).map((c) => c.id), ["t1"]);
  const copy = Store.importInto(cur, inc, "merge", { onConflict: { t1: "copy" } });
  assert.deepStrictEqual(copy.trips.map((t) => [t.id, t.nameZh]), [["t1", "东京"], ["t1-2", "东京（副本）"]]);
  const over = Store.importInto(cur, inc, "merge", { onConflict: { t1: "overwrite" } });
  assert.deepStrictEqual(over.trips.map((t) => [t.id, t.items[0].nameZh]), [["t1", "新"]]);
  assert.deepStrictEqual(cur.trips[0].items[0].nameZh, "旧", "pure: input not changed");
});

check("empty trip: 「这趟还是空的」 + 「点『＋ 添加』，加这趟的第一个地方」", function () {
  assert.ok(tl.indexOf('var EMPTY_TRIP_COPY = { title: "这趟还是空的", hint: "点『＋ 添加』，加这趟的第一个地方" };') !== -1);
  assert.ok(tl.indexOf("点＋添加你的第一个地方") === -1, "old line gone");
  assert.ok(/\.empty-state p \{/.test(css));
});

check("清空这趟: button text, confirm 「清空『<行程名>』里的所有内容吗？」「其他行程不受影响」, only the current trip", function () {
  assert.ok(html.indexOf('id="clear-all-btn">清空这趟</button>') !== -1 && html.indexOf("清空全部") === -1);
  const ask = tl.slice(tl.indexOf("function askClearAll"), tl.indexOf("function clearAllNow"));
  assert.ok(ask.indexOf('"清空『" + (trip.nameZh || "我的行程") + "』里的所有内容吗？"') !== -1 && ask.indexOf('sub: "其他行程不受影响"') !== -1);
  const now = tl.slice(tl.indexOf("function clearAllNow"), tl.indexOf("function setAddMode"));
  assert.ok(/var trip = currentTrip\(\);/.test(now) && !/trips\s*=/.test(now), "touches only currentTrip().items");
});

check("我的行程 panel: rows inset 24 px on the left, 正在看 background fills the whole row", function () {
  assert.ok(/\.trips-list \{ list-style: none; margin: 0; padding: 0; \}/.test(css));
  assert.ok(/\.trip-row \{[^}]*padding: 10px 16px 10px 24px;/.test(css));
  assert.ok(/\.trip-row\.is-current \{ background: #E6F5F2; \}/.test(css));
  assert.ok(!/\.trip-row\.is-current \.trip-row-main \{ background/.test(css), "not just the name block");
});

check("trains, boats and buses get the flight lock; same toast 「有固定时间，不能拖」", function () {
  assert.deepStrictEqual(["flight", "train", "boat", "bus", "place", "hotel"].map((t) => T.isFixedTime({ type: t })), [true, true, true, true, false, false]);
  assert.ok(/var LOCK_COPY = \{ fixed: "有固定时间，不能拖"/.test(tl) && /if \(isFixedTime\(item\)\) return LOCK_COPY\.fixed;/.test(tl), "same text as flights");
  assert.ok(/\(lockText \? flightLockSvg\(lockText\) : ""\)/.test(tl), "lock icon");
  assert.ok(/if \(locked\) \{[\s\S]{0,300}showToast\(locked/.test(tl), "long-press refuses with the lock text (v6c checks the hotel text)");
  assert.ok(/!lockReason\(all\[ti\]\)/.test(tl), "drag tip never sits on a locked card");
});

check("train / boat arriving before departing → 待补, asks 「到达比出发早，日期对吗？」; 对的 keeps the dates", function () {
  ["火车 | G1 | 北京南 - 上海虹桥 | 2026-12-08 09:00 ~ 2026-12-07 13:28 |", "船 | | Dover - Calais | 2026-12-08 09:00 ~ 2026-12-06 10:00 |"].forEach((row) => {
    const it = I.parseImport(row).items[0];
    assert.ok(it.pendingDate, row);
    assert.strictEqual(it.pendingKind, "flight-reversed");
    assert.deepStrictEqual([it.departDate, it.arriveDate], ["", ""]);
    const ok = E.acceptEarlyArrival(it);
    assert.ok(!ok.pendingDate && ok.arriveEarlyOk && ok.departDate === it.pendingFrom && ok.arriveDate === it.pendingTo);
    assert.strictEqual(E.rangeProblem(ok), "", "accepted → no more asking");
    assert.strictEqual(E.rangeProblem(Object.assign({}, ok, { arriveEarlyOk: false })), "flight-reversed");
  });
  const fine = I.parseImport("火车 | G1 | 北京南 - 上海虹桥 | 2026-12-08 09:00 ~ 13:28 |").items[0];
  assert.ok(!fine.pendingDate, "same-day short form is fine");
  assert.ok(tl.indexOf('return isGround(item) ? "到达比出发早，日期对吗？" : "落地比起飞早，日期对吗？";') !== -1);
  assert.ok(/<p class="pending-ask-q">' \+ escapeHtml\(reversedQuestion\(item\)\)/.test(tl), "same 对的 / 改日期 card as flights");
});

check("checkout before a train, boat or bus: 1 h (flight 3 h, cap 12:00, before 03:00 → blank)", function () {
  const d = "2026-12-07";
  const tr = (type, t) => ({ id: type + t, type, number: "X", fromNameZh: "A", nameZh: "B", departDate: d, departTime: t, arriveDate: d, arriveTime: "23:00" });
  assert.deepStrictEqual(Legs.suggestedCheckoutTime([tr("train", "10:30")], d), { time: "09:30", autoFromFlight: true });
  assert.deepStrictEqual(Legs.suggestedCheckoutTime([tr("boat", "08:00")], d), { time: "07:00", autoFromFlight: true });
  assert.deepStrictEqual(Legs.suggestedCheckoutTime([tr("bus", "10:30")], d), { time: "09:30", autoFromFlight: true }, "bus is 1 h like train/boat");
  assert.deepStrictEqual(Legs.suggestedCheckoutTime([tr("train", "15:00")], d), { time: "12:00", autoFromFlight: false });
  assert.deepStrictEqual(Legs.suggestedCheckoutTime([tr("boat", "02:30")], d), { time: "", autoFromFlight: false });
  const fl = { id: "f", type: "flight", flightNo: "BA1", departDate: d, departTime: "11:00", arriveDate: d, arriveTime: "14:00" };
  assert.deepStrictEqual(Legs.suggestedCheckoutTime([fl, tr("train", "10:30")], d), { time: "08:00", autoFromFlight: true }, "earliest wins");
  assert.deepStrictEqual(Legs.suggestedCheckoutTime([], d), { time: "12:00", autoFromFlight: false });
});

check("train / boat / bus also get 怎么去 between same-day legs; sw v19", function () {
  const st = { id: "s", type: "train", number: "G1", fromNameZh: "A", nameZh: "B", fromLat: 51.5, fromLng: -0.1, lat: 51.51, lng: -0.11, departDate: "2026-12-07", departTime: "10:00" };
  const pl = { id: "p", type: "place", nameZh: "X", lat: 51.512, lng: -0.112, date: "2026-12-07" };
  assert.strictEqual(Legs.navPillSpec(st, pl).show, true);
  assert.strictEqual(Legs.navPillSpec(st, pl).label, "↓ 怎么去");
  assert.strictEqual(Legs.navPillSpec(pl, Object.assign({}, st, { type: "bus" })).show, true);
  assert.ok(read("sw.js").indexOf('var CACHE = "xingcheng-map-shell-v20";') !== -1);
});

console.log("\n" + passes + " passed, " + failures + " failed");
if (failures) process.exit(1);
console.log("All v6b checks passed.");
