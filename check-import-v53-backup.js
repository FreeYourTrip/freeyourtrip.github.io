/**
 * IT老板 的关键验收：拿一份 v5.3「完整备份」（假数据：机票、酒店、地点、备注、交通段备注、待补、日期待确认、好几天）导进 v6，
 * 逐字段对比一条不少、备注一字不差；再测 v6 新格式（version 2）的导出 / 导入来回不丢、分享去掉隐私。用法：node check-import-v53-backup.js
 */
"use strict";
const assert = require("assert");
const Store = require("./trip-store.js");
const Places = require("./places.js");
const FX = require("./fixture-v53.js");

const ls = {};
globalThis.localStorage = {
  getItem: (k) => (k in ls ? ls[k] : null),
  setItem: (k, v) => { ls[k] = String(v); },
  removeItem: (k) => { delete ls[k]; },
  get length() { return Object.keys(ls).length; },
  key: (i) => Object.keys(ls)[i]
};
const Backup = require("./backup.js");

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

/* 模拟 timeline.js 的 TripApp：importState / exportState 走和网页里同一个 TripStore.importInto */
let device;
let deviceLegs;
function freshDevice(state) {
  device = state || { trips: [{ id: "my-trip", nameZh: "我的行程", items: [], legs: [], imported: true }], places: [], activeTripId: "my-trip", examplesLoaded: false };
  deviceLegs = {};
}
globalThis.TripApp = {
  importState(state, mode, opts) {
    device = Store.importInto(device, state, mode === "replace" ? "replace" : "merge", { today: "2026-11-16", onConflict: (opts && opts.onConflict) || {} });
    deviceLegs = mode === "replace" ? Object.assign({}, state.legs) : Object.assign(deviceLegs, state.legs);
  },
  exportState() {
    return { trips: device.trips, places: device.places, activeTripId: device.activeTripId, examplesLoaded: device.examplesLoaded, legs: deviceLegs };
  }
};
function viaFile(obj) {
  return JSON.parse(JSON.stringify(obj));
}
function stripPlaceId(item) {
  const c = Object.assign({}, item);
  delete c.placeId;
  return c;
}
function assertSameTrips(orig, got) {
  assert.strictEqual(got.length, orig.length, "trip count");
  orig.forEach((t, i) => {
    Object.keys(t).forEach((k) => {
      if (k !== "items") assert.deepStrictEqual(got[i][k], t[k], t.id + "." + k);
    });
    assert.strictEqual(got[i].items.length, t.items.length, t.id + " items");
    t.items.forEach((it, j) => {
      Object.keys(it).forEach((k) => assert.deepStrictEqual(got[i].items[j][k], it[k], it.id + "." + k));
      assert.deepStrictEqual(stripPlaceId(got[i].items[j]), it, it.id + ": no extra or missing field");
    });
  });
}

check("v5.3 full backup → 整份替换: every trip / item / field kept, notes intact (multi-line, links), 待补 and 日期待确认 kept", function () {
  freshDevice();
  const file = viaFile(FX.fullBackup());
  const r = Backup.applyBackup(file, "replace");
  assert.strictEqual(r.tripCount, 2);
  assertSameTrips(FX.trips(), device.trips);
  const items = device.trips[0].items;
  assert.strictEqual(items.find((x) => x.id === "ba300").note, "提前 2 小时到机场\n行李 23kg");
  assert.strictEqual(items.find((x) => x.id === "museum").note, "免费，建议预约 https://www.openstreetmap.org/booking");
  const shop = items.find((x) => x.id === "little-shop");
  assert.ok(typeof shop.lat !== "number" && shop.address === "", "待补 stays 待补");
  assert.strictEqual(items.find((x) => x.id === "pending-date").dateRaw, "下周三上午");
  assert.strictEqual(items.find((x) => x.id === "rome-hotel").pendingKind, "hotel-reversed");
  assert.strictEqual(device.activeTripId, "my-trip");
  const days = new Set(items.map((x) => x.date || x.checkIn || x.departDate).filter(Boolean));
  assert.ok(days.size >= 4, "several days");
});

check("transport notes (legs), wishlist statuses and the geocode cache come through untouched", function () {
  freshDevice();
  Backup.applyBackup(viaFile(FX.fullBackup()), "replace");
  assert.deepStrictEqual(deviceLegs, FX.legs());
  assert.strictEqual(deviceLegs["dishoom>museum"].note, "坐 24 路公交，座位 随便 确认号 FAKE-LEG");
  assert.deepStrictEqual(JSON.parse(ls["wishlist-map-status-v1"]), { tokyo: "planned", paris: "visited" });
  assert.ok(JSON.parse(ls["wishlist-map-geocode-v1"])["dishoom covent garden"]);
});

check("old backup gets a place store on import: hotels / places linked, their notes copied to the place, flights not linked", function () {
  freshDevice();
  Backup.applyBackup(viaFile(FX.fullBackup()), "replace");
  device.trips.forEach((t) => t.items.forEach((it) => {
    if (it.type === "flight") assert.ok(!it.placeId);
    else {
      const p = Places.byId(device.places, it.placeId);
      assert.ok(p, "linked " + it.id);
      assert.strictEqual(p.note, it.note || "", "place note = item note for " + it.id);
    }
  }));
});

check("合并 into a phone that only has the empty default trip: the empty one is replaced, nothing else changes", function () {
  freshDevice();
  Backup.applyBackup(viaFile(FX.fullBackup()), "merge");
  assertSameTrips(FX.trips(), device.trips);
  assert.deepStrictEqual(device.addedTripIds, ["my-trip", "imported-2"]);
});

check("合并 into a phone with its own trip, user picks 另存一份 (the default): imported trip is added SEPARATELY (my-trip-2, name +「（副本）」), local trip and its notes untouched, same place reused", function () {
  const local = {
    trips: [{ id: "my-trip", nameZh: "我自己的伦敦", items: [{ id: "mine", type: "place", subtype: "餐厅", nameZh: "Dishoom Covent Garden", lat: 51.5116, lng: -0.1268, note: "" }] }],
    places: [],
    activeTripId: "my-trip"
  };
  Places.linkAll(local.trips, local.places, {});
  const localCopy = JSON.parse(JSON.stringify(local.trips));
  freshDevice(local);
  Backup.applyBackup(viaFile(FX.fullBackup()), "merge");
  assert.deepStrictEqual(device.trips.map((t) => t.id), ["my-trip", "my-trip-2", "imported-2"]);
  assert.deepStrictEqual(device.trips[0], localCopy[0], "local trip untouched");
  assert.strictEqual(device.trips[1].nameZh, FX.trips()[0].nameZh + "（副本）");
  assertSameTrips(FX.trips(), [Object.assign({}, device.trips[1], { id: "my-trip", nameZh: FX.trips()[0].nameZh }), device.trips[2]]);
  const imported = device.trips[1].items.find((x) => x.id === "dishoom");
  assert.strictEqual(imported.placeId, device.trips[0].items[0].placeId, "100 m + same name = same place automatically");
  assert.strictEqual(device.activeTripId, "my-trip-2", "switches to what was just imported");
});

check("same trip id already on the phone: tripConflicts lists it (not for a lone empty default trip); 覆盖 replaces it in place, nothing else touched", function () {
  const TripStore = require("./trip-store.js");
  const local = {
    trips: [
      { id: "other", nameZh: "别的行程", items: [{ id: "o1", type: "place", nameZh: "别处", note: "别处的备注" }] },
      { id: "my-trip", nameZh: "我自己的伦敦", items: [{ id: "mine", type: "place", nameZh: "旧的", note: "旧备注" }] }
    ],
    places: [],
    activeTripId: "other"
  };
  Places.linkAll(local.trips, local.places, {});
  const clashes = TripStore.tripConflicts(local, FX.fullBackup());
  assert.deepStrictEqual(clashes.map((c) => [c.id, c.localName, c.localItems]), [["my-trip", "我自己的伦敦", 1]]);
  assert.deepStrictEqual(TripStore.tripConflicts({ trips: [{ id: "my-trip", items: [] }] }, FX.fullBackup()), [], "empty default is just replaced");
  const before = JSON.parse(JSON.stringify(local.trips[0]));
  freshDevice(local);
  Backup.applyBackup(viaFile(FX.fullBackup()), "merge", { onConflict: { "my-trip": "overwrite" } });
  assert.deepStrictEqual(device.trips.map((t) => t.id), ["other", "my-trip", "imported-2"], "overwritten in place, no copy");
  assert.deepStrictEqual(device.trips[0], before, "other trip untouched");
  assertSameTrips(FX.trips(), [device.trips[1], device.trips[2]]);
  assert.ok(device.places.some((p) => p.note === "旧备注"), "the old trip's place and note stay in the place library");
});

check("import dialog: 「已经有一趟『…』了」, 覆盖 / 另存一份 / 取消; 取消 or tapping outside imports nothing", function () {
  const fs = require("fs");
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  const bk = fs.readFileSync(__dirname + "/backup.js", "utf8");
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  assert.ok(/return "已经有一趟『" \+ \(name \|\| "我的行程"\) \+ "』了";/.test(tl));
  assert.ok(tl.indexOf('{ sub: "覆盖会换掉原来的内容", overwrite: "覆盖", copy: "另存一份", cancel: "取消" }') !== -1);
  assert.ok(/onClose: function \(\) \{\s*if \(answered\) next\(\);\s*else done\(null\);/.test(tl), "not answered → done(null)");
  assert.ok(/app\.askTripConflicts\(clashes, function \(answers\) \{\s*if \(answers\) run\(answers\);/.test(bk), "done(null) → nothing imported");
  assert.ok(/id="confirm-alt" hidden/.test(html), "third button in the confirm box");
  assert.ok(tl.indexOf("这趟已经有了，覆盖还是另存一份") === -1, "old wording gone");
});

check("v6 full backup round trip (version 2): trips, places incl. 收藏 / 去过, theme all come back identical", function () {
  freshDevice();
  Backup.applyBackup(viaFile(FX.fullBackup()), "replace");
  const p = device.places[0];
  Places.setWish(p, "2026-11-16");
  Places.addVisit(p, { date: "2026-12-04", tripId: "my-trip", nights: 2 });
  device.trips[0].theme = { mode: "own", themeId: "sakura", overrides: {}, bg: { imageId: "img-1", crop: null, strength: "medium" } };
  const before = JSON.parse(JSON.stringify({ trips: device.trips, places: device.places }));
  const payload = viaFile(Object.assign(Backup.collect({ includeGeocodeCache: true }), { kind: "full" }));
  assert.strictEqual(payload.version, 2);
  assert.strictEqual(payload.places.length, before.places.length);
  freshDevice();
  Backup.applyBackup(payload, "replace");
  assert.deepStrictEqual(JSON.parse(JSON.stringify({ trips: device.trips, places: device.places })), before);
});

check("v6 share file: only places the shared trips use, no 收藏 / 去过, no confirmation numbers or seats, notes cleaned, trip colours kept", function () {
  freshDevice();
  Backup.applyBackup(viaFile(FX.fullBackup()), "replace");
  device.places.push({ id: "fav-only", name: "只是收藏的店", type: "food", tags: ["外卖"], city: "London", note: "确认号 SECRET1", wish: { savedAt: "2026-11-01" }, visits: [] });
  device.places[0].wish = { savedAt: "2026-11-02" };
  device.places[0].visits = [{ id: "v1", date: "2026-12-03", tripId: "my-trip", nights: 2 }];
  device.places[0].note = "要护照登记 确认号 FAKE-SAV-0002";
  device.trips[0].theme = { mode: "own", themeId: "sakura" };
  const share = Backup.redactForShare(Backup.collect({ includeGeocodeCache: false }));
  const json = JSON.stringify(share);
  assert.strictEqual(share.kind, "share");
  assert.strictEqual(share.version, 2);
  assert.ok(!/FAKE-BA-0001|FAKE-SAV-0002|FAKE-LEG|SECRET1|"seat"|"confirmationNo"/.test(json), "nothing private");
  assert.ok(!share.places.some((p) => p.id === "fav-only"), "收藏-only places are not shared");
  share.places.forEach((p) => {
    assert.strictEqual(p.wish, null);
    assert.deepStrictEqual(p.visits, []);
  });
  assert.strictEqual(share.places.length, device.places.length - 1);
  assert.deepStrictEqual(share.trips[0].theme, { mode: "own", themeId: "sakura" }, "trip colours travel with the share");
  assert.ok(!("geocodeCache" in share));
});

check("a v6 share file imported (合并) by someone else becomes its own trip and keeps the notes", function () {
  freshDevice();
  Backup.applyBackup(viaFile(FX.fullBackup()), "replace");
  const share = viaFile(Backup.redactForShare(Backup.collect({})));
  freshDevice({ trips: [{ id: "my-trip", nameZh: "朋友自己的", items: [{ id: "x", type: "place", nameZh: "别处", note: "朋友的备注" }] }], places: [], activeTripId: "my-trip" });
  Backup.applyBackup(share, "merge");
  assert.strictEqual(device.trips.length, 3);
  assert.strictEqual(device.trips[0].items[0].note, "朋友的备注");
  assert.strictEqual(device.trips[1].items.find((x) => x.id === "dishoom").note, "印度早餐，建议早去排队");
  assert.ok(!device.trips[1].items.some((x) => x.confirmationNo || x.seat));
});

check("not a backup file → friendly error, nothing changed", function () {
  freshDevice();
  const before = JSON.stringify(device);
  assert.throws(() => Backup.applyBackup({ hello: 1 }, "merge"), /不是一份有效的 Free Your Trip 备份或分享文件/);
  assert.strictEqual(JSON.stringify(device), before);
});

check("old backup with wishlistLoaded=true does not try to build the removed wishlist map (whole import used to fail in the browser)", function () {
  const src = require("fs").readFileSync(require("path").join(__dirname, "app.js"), "utf8");
  assert.ok(/if \(state && state\.loaded && \$\("map"\)\) loadWishlistExamples\(\);/.test(src));
});

console.log("\n" + passes + " passed, " + failures + " failed");
if (failures) process.exit(1);
console.log("All v5.3-backup import checks passed.");
