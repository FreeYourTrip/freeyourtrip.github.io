/**
 * v6 搬家：v5.3 本机数据 → 多行程 + 地点库（trip-store.js）。
 * 一条不丢、备注一字不差、重复搬结果一样、写失败留备份、坏数据不崩。全部假数据。用法：node check-migrate.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const Store = require("./trip-store.js");
const Places = require("./places.js");
const FX = require("./fixture-v53.js");

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

function fakeStorage(init, opts) {
  const data = Object.assign({}, init || {});
  opts = opts || {};
  return {
    data,
    writes: [],
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem(k, v) {
      if (opts.failKey === k) throw new Error("QuotaExceededError");
      this.writes.push(k);
      data[k] = String(v);
    },
    removeItem: (k) => { delete data[k]; }
  };
}
function stripPlaceId(item) {
  const c = Object.assign({}, item);
  delete c.placeId;
  return c;
}
/** 逐个行程、逐条、逐字段对比：除了新加的 placeId，什么都不能变 */
function assertNoLoss(origTrips, migratedTrips) {
  assert.strictEqual(migratedTrips.length, origTrips.length, "trip count");
  origTrips.forEach((t, i) => {
    const m = migratedTrips[i];
    Object.keys(t).forEach((k) => {
      if (k !== "items") assert.deepStrictEqual(m[k], t[k], "trip field " + k);
    });
    assert.strictEqual(m.items.length, t.items.length, t.id + " item count");
    t.items.forEach((it, j) => {
      assert.deepStrictEqual(stripPlaceId(m.items[j]), it, "item " + it.id + " unchanged field by field");
      if (it.note) assert.strictEqual(m.items[j].note, it.note, "note intact: " + it.id);
    });
  });
}

check("v5.3 localStorage → v6: every trip, item and field kept; hotels / places linked to the place store; transport not", function () {
  const st = fakeStorage(FX.localStorageV53());
  const res = Store.load(st, { today: "2026-11-16" });
  assert.strictEqual(res.source, "migrated");
  assertNoLoss(FX.trips(), res.state.trips);
  assert.strictEqual(res.state.activeTripId, "my-trip");
  const all = res.state.trips.reduce((a, t) => a.concat(t.items), []);
  all.forEach((it) => {
    if (it.type === "hotel" || it.type === "place") assert.ok(it.placeId && Places.byId(res.state.places, it.placeId), "linked: " + it.id);
    else assert.ok(!it.placeId, "transport is not a place: " + it.id);
  });
  assert.strictEqual(res.state.places.length, all.filter((it) => it.type !== "flight").length, "one place per place-like item (no two items are the same place in the fixture)");
  const savoy = res.state.places.find((p) => p.name === "萨沃伊酒店");
  assert.strictEqual(savoy.note, "要护照登记\n早餐 7 点开始", "multi-line note copied to the place");
  assert.deepStrictEqual(savoy.tags, ["酒店"]);
  assert.deepStrictEqual(savoy.visits, [], "batch 1 does not invent visits");
});

check("migration writes ONE new key, keeps the old key byte-for-byte, removes the temporary backup only after a verified write", function () {
  const init = FX.localStorageV53();
  const st = fakeStorage(init);
  Store.load(st, { today: "2026-11-16" });
  assert.strictEqual(st.data[Store.V1_KEY], init[Store.V1_KEY], "old key untouched");
  assert.strictEqual(st.data["wishlist-map-legs-v1"], init["wishlist-map-legs-v1"], "legs (transport notes) untouched");
  assert.ok(st.writes.indexOf(Store.BACKUP_KEY) !== -1 && st.writes.indexOf(Store.BACKUP_KEY) < st.writes.indexOf(Store.KEY), "backup written BEFORE the new data");
  assert.ok(!(Store.BACKUP_KEY in st.data), "backup removed after success");
  assert.ok(Store.KEY.indexOf("wishlist-map") === 0 && Store.BACKUP_KEY.indexOf("wishlist-map") === 0, "清空本机数据 (prefix) still clears everything");
  const v2 = JSON.parse(st.data[Store.KEY]);
  assert.strictEqual(v2.schema, 2);
});

check("idempotent: opening again reads v2 unchanged; migrating again from scratch gives the identical result", function () {
  const st = fakeStorage(FX.localStorageV53());
  const first = Store.load(st, { today: "2026-11-16" });
  const saved = st.data[Store.KEY];
  const again = Store.load(st, { today: "2026-11-17" });
  assert.strictEqual(again.source, "v2");
  assert.strictEqual(Store.serialize(again.state), saved, "second open changes nothing");
  delete st.data[Store.KEY];
  const redo = Store.load(st, { today: "2026-11-16" });
  assert.strictEqual(redo.source, "migrated");
  assert.strictEqual(Store.serialize(redo.state), Store.serialize(first.state), "same ids, same places");
  const thrice = Store.fromAny(JSON.parse(saved), { today: "2027-01-01" });
  assert.strictEqual(Store.serialize(thrice), saved, "normalising v2 again is a no-op");
});

check("write fails (storage full): app still gets all data in memory, backup + old key stay, next open retries", function () {
  const init = FX.localStorageV53();
  const st = fakeStorage(init, { failKey: Store.KEY });
  const res = Store.load(st, { today: "2026-11-16" });
  assert.strictEqual(res.source, "migrated-unsaved");
  assertNoLoss(FX.trips(), res.state.trips);
  assert.strictEqual(st.data[Store.BACKUP_KEY], init[Store.V1_KEY], "backup kept");
  assert.strictEqual(st.data[Store.V1_KEY], init[Store.V1_KEY], "old key kept");
  const ok = fakeStorage(st.data);
  assert.strictEqual(Store.load(ok, { today: "2026-11-16" }).source, "migrated", "retry works");
});

check("readOnly load (used for 「本机有没有行程」) never writes", function () {
  const st = fakeStorage(FX.localStorageV53());
  const res = Store.load(st, { readOnly: true });
  assert.strictEqual(res.state.trips.length, 2);
  assert.deepStrictEqual(st.writes, []);
});

check("oldest key (wishlist-map-imported-trips-v1, plain array) migrates too", function () {
  const st = fakeStorage({ [Store.V0_KEY]: JSON.stringify(FX.trips()) });
  const res = Store.load(st, {});
  assert.strictEqual(res.source, "migrated");
  assertNoLoss(FX.trips(), res.state.trips);
  assert.strictEqual(res.state.activeTripId, "my-trip");
});

check("empty storage → nothing, no writes", function () {
  const st = fakeStorage({});
  const res = Store.load(st, {});
  assert.strictEqual(res.state, null);
  assert.strictEqual(res.source, "none");
  assert.deepStrictEqual(st.writes, []);
});

check("corrupt old data (not JSON / wrong shape) does not crash and is left exactly as it was", function () {
  ["{not json", "42", "null", '"text"', '{"trips":"x"}', "[1,2", "true"].forEach((raw) => {
    const st = fakeStorage({ [Store.V1_KEY]: raw });
    let res;
    assert.doesNotThrow(() => { res = Store.load(st, {}); }, raw);
    assert.strictEqual(st.data[Store.V1_KEY], raw, "left as is: " + raw);
    assert.ok(!(Store.KEY in st.data), "nothing written over it: " + raw);
    assert.ok(res.state === null || Array.isArray(res.state.trips), raw);
  });
});

check("half-broken data: junk items / trips dropped, good ones kept, missing and duplicate ids repaired", function () {
  const raw = JSON.stringify({
    trips: [
      null,
      "x",
      { nameZh: "没有 id", items: [null, 7, "s", { type: "place", nameZh: "好的地点", note: "留着" }, { id: "dup", type: "place", nameZh: "A" }, { id: "dup", type: "place", nameZh: "B" }] },
      { id: "t", items: "not a list" },
      { id: "t", nameZh: 5, items: [] }
    ],
    activeTripId: 99
  });
  const res = Store.load(fakeStorage({ [Store.V1_KEY]: raw }), {});
  const t = res.state.trips;
  assert.strictEqual(t.length, 3);
  assert.deepStrictEqual(t.map((x) => x.id), ["trip-3", "t", "t-2"]);
  assert.deepStrictEqual(t[0].items.map((x) => x.nameZh), ["好的地点", "A", "B"]);
  assert.strictEqual(t[0].items[0].note, "留着");
  assert.notStrictEqual(t[0].items[1].id, t[0].items[2].id, "duplicate item ids made unique");
  assert.deepStrictEqual(t[1].items, []);
  assert.strictEqual(t[2].nameZh, "我的行程");
  assert.strictEqual(res.state.activeTripId, "trip-3");
});

check("corrupt NEW key: a copy is kept aside, data re-migrated from the untouched old key", function () {
  const init = FX.localStorageV53();
  init[Store.KEY] = "{broken";
  const st = fakeStorage(init);
  const res = Store.load(st, {});
  assert.strictEqual(res.source, "migrated");
  assert.strictEqual(st.data[Store.CORRUPT_KEY], "{broken");
  assertNoLoss(FX.trips(), res.state.trips);
});

check("per-trip theme field (batch 4) is kept as-is, unknown sub-fields too; bad theme dropped; no theme = follow global", function () {
  const trips = FX.trips();
  trips[0].theme = { mode: "own", themeId: "sakura", overrides: { hotel: "#8E5CF7" }, bg: { imageId: "img-1", crop: { x: 0.1, y: 0.2, w: 0.8, h: 0.6 }, strength: "medium" }, future: { a: 1 } };
  trips[1].theme = "pink";
  const res = Store.load(fakeStorage({ [Store.V1_KEY]: JSON.stringify({ trips }) }), {});
  assert.deepStrictEqual(res.state.trips[0].theme, trips[0].theme);
  assert.ok(!("theme" in res.state.trips[1]));
  assert.strictEqual(Store.normalizeTheme({}).mode, "global");
});

check("new trip helpers: unique id, 新行程 / 新行程 2 …", function () {
  const trips = [{ id: "a", nameZh: "新行程" }];
  const id = Store.newTripId(trips);
  assert.ok(/^trip-/.test(id) && id !== "a");
  assert.strictEqual(Store.newTripName(trips), "新行程 2");
  assert.strictEqual(Store.newTripName([]), "新行程");
});

check("trip-store.js only touches the storage it is given; timeline uses it and no longer writes the old key", function () {
  const src = fs.readFileSync(__dirname + "/trip-store.js", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/localStorage|fetch\(|XMLHttpRequest|document\./.test(src));
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  assert.ok(tl.indexOf("wishlist-map-trips-v1") === -1 || !/setItem\([^)]*trips-v1/.test(tl), "old key never written by the app");
  assert.ok(/TripStore\.load\(localStorage/.test(tl) && /TripStore\.save\(localStorage/.test(tl));
  const sw = fs.readFileSync(__dirname + "/sw.js", "utf8");
  ["./transport.js", "./places.js", "./trip-store.js"].forEach((f) => assert.ok(sw.indexOf('"' + f + '"') !== -1, "precached: " + f));
  assert.ok(sw.indexOf('"xingcheng-map-shell-v22"') !== -1);
  assert.ok(sw.indexOf("fixture-v53") === -1, "test data is not shipped to phones");
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  assert.ok(html.indexOf('src="./trip-store.js"') < html.indexOf('src="./timeline.js"') && html.indexOf('src="./places.js"') < html.indexOf('src="./trip-store.js"'));
});

console.log("\n" + passes + " passed, " + failures + " failed");
if (failures) process.exit(1);
console.log("All migration checks passed.");
