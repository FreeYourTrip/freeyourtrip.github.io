#!/usr/bin/env node
"use strict";
/**
 * v6.1 item 20: one view model drives the list, the count, and the map.
 * Matrix: date yes/no × time yes/no × location yes/no × type.
 */
const assert = require("assert");
const Legs = require("./legs.js");

let failed = 0;
function check(name, fn) {
  try { fn(); console.log("  ok  " + name); }
  catch (err) {
    failed += 1;
    console.error("  FAIL  " + name);
    console.error("    " + (err && err.message));
  }
}

function place(id, opts) {
  opts = opts || {};
  const it = { id: id, type: opts.type || "place", nameZh: opts.name || id };
  if (opts.date) it.date = opts.date;
  if (opts.time) it.time = opts.time;
  if (opts.lat != null) { it.lat = opts.lat; it.lng = opts.lng; }
  if (opts.address) it.address = opts.address;
  if (opts.checkIn) {
    it.type = "hotel";
    it.checkIn = opts.checkIn;
    it.checkOut = opts.checkOut;
    if (opts.checkInTime) it.checkInTime = opts.checkInTime;
    if (opts.checkOutTime) it.checkOutTime = opts.checkOutTime;
  }
  if (opts.departDate) {
    it.type = opts.type || "flight";
    it.departDate = opts.departDate;
    it.arriveDate = opts.arriveDate || opts.departDate;
    if (opts.departTime) it.departTime = opts.departTime;
    if (opts.fromLat != null) { it.fromLat = opts.fromLat; it.fromLng = opts.fromLng; }
    if (opts.lat != null) { it.toLat = opts.lat; it.toLng = opts.lng; }
  }
  return it;
}

const day = "2026-11-17";
const items = [
  place("p-timed-loc", { date: day, time: "10:00", lat: 51.5, lng: -0.12, name: "有时间有位置" }),
  place("p-timed-noloc", { date: day, time: "11:00", name: "有时间没位置" }),
  place("p-untimed-loc", { date: day, lat: 51.51, lng: -0.13, name: "没时间有位置" }),
  place("p-untimed-noloc", { date: day, name: "没时间没位置" }),
  place("p-nodate-loc", { lat: 51.52, lng: -0.14, name: "没日期有位置" }),
  place("p-nodate-noloc", { name: "没日期没位置" }),
  place("h1", { checkIn: day, checkOut: "2026-11-18", checkInTime: "15:00", checkOutTime: "11:00", lat: 51.50, lng: -0.11, name: "酒店" }),
  place("f1", { type: "flight", departDate: day, departTime: "08:00", fromLat: 51.47, fromLng: -0.45, lat: 48.72, lng: 2.27, name: "BA123" }),
  place("c1", { type: "place", subtype: "custom", date: day, time: "18:00", lat: 51.503, lng: -0.12, name: "自定义分类" })
];

check("viewItems is exported and is the single source of truth", function () {
  assert.equal(typeof Legs.viewItems, "function");
  assert.equal(typeof Legs.itemHasTime, "function");
});

check("day view: visible count equals cards; untimed after timed; unlocated counted but not pinned", function () {
  const v = Legs.viewItems(items, day);
  /* hotel check-in + flight + 4 places that day + custom = 7 raw on that day; hotel checkout is the 18th */
  const ids = v.visible.map((it) => it.id);
  assert.ok(ids.indexOf("p-timed-loc") !== -1);
  assert.ok(ids.indexOf("p-untimed-loc") !== -1);
  assert.ok(ids.indexOf("p-untimed-noloc") !== -1);
  assert.ok(ids.indexOf("p-nodate-loc") === -1, "undated stay out of a single day");
  assert.strictEqual(v.count, v.visible.length);
  const timedIds = v.days[0].timed.map((it) => it.id);
  const untimedIds = v.days[0].untimed.map((it) => it.id);
  assert.ok(timedIds.indexOf("p-timed-loc") !== -1);
  assert.ok(untimedIds.indexOf("p-untimed-loc") !== -1);
  assert.ok(untimedIds.indexOf("p-untimed-noloc") !== -1);
  /* unlocated appear in visible and unlocated, not in pins */
  assert.ok(v.unlocated.some((it) => it.id === "p-timed-noloc"));
  assert.ok(v.unlocated.some((it) => it.id === "p-untimed-noloc"));
  assert.ok(!v.pins.some((p) => p.item.id === "p-timed-noloc"));
  /* untimed pins have no number and come after timed */
  const pinIds = v.pins.map((p) => p.item.id);
  const tPin = pinIds.indexOf("p-timed-loc");
  const uPin = pinIds.indexOf("p-untimed-loc");
  assert.ok(tPin !== -1 && uPin !== -1 && tPin < uPin, "untimed pins after timed");
  const untimedPin = v.pins.find((p) => p.item.id === "p-untimed-loc");
  assert.strictEqual(untimedPin.n, 0, "untimed pins have no number badge");
  const timedPin = v.pins.find((p) => p.item.id === "p-timed-loc");
  assert.ok(timedPin.n >= 1);
});

check("all view: undated at the end; count equals visible; hotel expands to check-in + checkout", function () {
  const v = Legs.viewItems(items, "all");
  assert.strictEqual(v.count, v.visible.length);
  const lastTwo = v.visible.slice(-2).map((it) => it.id);
  assert.ok(lastTwo.indexOf("p-nodate-loc") !== -1);
  assert.ok(lastTwo.indexOf("p-nodate-noloc") !== -1);
  const hotelCards = v.visible.filter((it) => it.id === "h1" || (it.sourceId === "h1") || it._checkout || it.view === "checkout" || (it.type === "hotel" && it.date === "2026-11-18") || Legs.isCheckoutView(it));
  /* expandViewItems should produce a checkout card */
  const checkout = v.visible.filter((it) => Legs.isCheckoutView && Legs.isCheckoutView(it));
  assert.ok(checkout.length >= 1, "hotel checkout appears as its own card in 全部");
  /* count must be greater than raw item length because of checkout */
  assert.ok(v.count > items.length, "count is visible cards not raw items: " + v.count + " vs " + items.length);
});

check("sort key puts untimed after timed on the same day (root cause of the 12:00 slot)", function () {
  const timed = place("a", { date: day, time: "16:00" });
  const untimed = place("b", { date: day });
  const keyT = Legs.itemSortKey(timed);
  const keyU = Legs.itemSortKey(untimed);
  assert.ok(keyT < keyU, keyT + " should be before " + keyU);
});

check("timeline and map both call viewItems (source of truth hooked up)", function () {
  const tl = require("fs").readFileSync(__dirname + "/timeline.js", "utf8");
  assert.ok(tl.indexOf("Legs.viewItems") !== -1);
  assert.ok(tl.indexOf("没定时间") !== -1);
  assert.ok(tl.indexOf("项还没位置") !== -1);
  assert.ok(tl.indexOf("function currentViewItems") !== -1);
  assert.ok(tl.indexOf("updateListHead") !== -1 && tl.indexOf("viewItems(items, selectedDay).count") !== -1);
});

if (failed) {
  console.error("\n" + failed + " failed");
  process.exit(1);
}
console.log("\nall passed");
