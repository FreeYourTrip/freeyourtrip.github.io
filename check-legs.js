/**
 * 航班连接规则校验。用法：node check-legs.js
 */
"use strict";
const assert = require("assert");
const Legs = require("./legs.js");

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log("PASS  " + name);
  } catch (err) {
    failures += 1;
    console.log("FAIL  " + name);
    console.log("      " + (err && err.stack ? err.stack : err));
  }
}

const hotel = {
  id: "h1",
  type: "hotel",
  nameZh: "伦敦酒店",
  lat: 51.51,
  lng: -0.12,
  checkIn: "2026-12-01"
};
const f1 = {
  id: "f1",
  type: "flight",
  flightNo: "BA300",
  fromAirport: "LHR",
  toAirport: "CDG",
  fromNameZh: "希思罗机场",
  nameZh: "戴高乐机场",
  fromLat: 51.47002,
  fromLng: -0.454295,
  lat: 49.0097,
  lng: 2.5479,
  departDate: "2026-12-02",
  departTime: "10:00",
  arriveDate: "2026-12-02",
  arriveTime: "12:00"
};
const f2 = {
  id: "f2",
  type: "flight",
  flightNo: "AZ332",
  fromAirport: "CDG",
  toAirport: "FCO",
  fromNameZh: "戴高乐机场",
  nameZh: "菲乌米奇诺机场",
  fromLat: 49.0097,
  fromLng: 2.5479,
  lat: 41.800278,
  lng: 12.238889,
  departDate: "2026-12-02",
  departTime: "14:30",
  arriveDate: "2026-12-02",
  arriveTime: "16:30"
};
const rome = {
  id: "h2",
  type: "hotel",
  nameZh: "罗马酒店",
  lat: 41.9,
  lng: 12.5,
  checkIn: "2026-12-02",
  checkInTime: "18:00"
};

check("leg BEFORE a flight ends at the departure airport", function () {
  const sameDayHotel = Object.assign({}, hotel, { checkIn: "2026-12-02", checkInTime: "08:00" });
  const legs = Legs.buildConnectors([sameDayHotel, f1]);
  assert.strictEqual(legs.length, 1);
  assert.strictEqual(legs[0].kind, "nav");
  assert.strictEqual(legs[0].from.name, "伦敦酒店");
  assert.strictEqual(legs[0].to.role, "depart");
  assert.strictEqual(legs[0].to.airport, "LHR");
  assert.strictEqual(legs[0].to.name, "希思罗机场");
  assert.strictEqual(legs[0].to.lat, 51.47002);
  assert.ok(legs[0].to.lat !== f1.lat, "must not use arrival coords");
});

check("leg AFTER a flight starts at the arrival airport", function () {
  const legs = Legs.buildConnectors([f1, rome]);
  assert.strictEqual(legs[0].from.role, "arrive");
  assert.strictEqual(legs[0].from.airport, "CDG");
  assert.strictEqual(legs[0].from.name, "戴高乐机场");
  assert.strictEqual(legs[0].from.lat, 49.0097);
  assert.strictEqual(legs[0].to.name, "罗马酒店");
});

check("two adjacent flights get a non-clickable 转机 label with layover", function () {
  const legs = Legs.buildConnectors([f1, f2]);
  assert.strictEqual(legs.length, 1);
  assert.strictEqual(legs[0].kind, "transfer");
  assert.strictEqual(legs[0].clickable, false);
  assert.strictEqual(legs[0].minutes, 150);
  assert.strictEqual(legs[0].label, "转机 2小时30分");
});

check("hotel-flight-flight-hotel uses depart/arrive and 转机 in the middle", function () {
  const sameDayHotel = Object.assign({}, hotel, { checkIn: "2026-12-02", checkInTime: "08:00" });
  const legs = Legs.buildConnectors([sameDayHotel, f1, f2, rome]);
  assert.strictEqual(legs.length, 3);
  assert.strictEqual(legs[0].to.airport, "LHR");
  assert.strictEqual(legs[1].kind, "transfer");
  assert.strictEqual(legs[1].clickable, false);
  assert.ok(legs[1].label.indexOf("转机") === 0);
  assert.strictEqual(legs[2].from.airport, "FCO");
  assert.strictEqual(legs[2].to.name, "罗马酒店");
});

check("no 带我去 connector between the last item of one day and the first of the next", function () {
  const legs = Legs.buildConnectors([hotel, f1, f2, rome]);
  /* hotel is Dec 1, flights/hotel are Dec 2 — skip the cross-day nav */
  assert.strictEqual(legs.length, 2);
  assert.ok(!legs.some((c) => c.kind === "nav" && c.fromItemId === "h1" && c.toItemId === "f1"));
  assert.strictEqual(legs[0].kind, "transfer");
  assert.strictEqual(legs[1].kind, "nav");
  assert.strictEqual(legs[1].from.airport, "FCO");
});

check("keep 转机 when two adjacent flights span midnight", function () {
  const overnight = Object.assign({}, f1, {
    id: "f-night",
    departDate: "2026-12-05",
    departTime: "22:00",
    arriveDate: "2026-12-06",
    arriveTime: "01:30"
  });
  const nextMorning = Object.assign({}, f2, {
    id: "f-morn",
    fromAirport: "CDG",
    toAirport: "FCO",
    departDate: "2026-12-06",
    departTime: "08:00",
    arriveDate: "2026-12-06",
    arriveTime: "10:00"
  });
  const legs = Legs.buildConnectors([overnight, nextMorning]);
  assert.strictEqual(legs.length, 1);
  assert.strictEqual(legs[0].kind, "transfer");
  assert.strictEqual(legs[0].clickable, false);
  assert.strictEqual(legs[0].crossDay, true);
  assert.strictEqual(legs[0].minutes, 390);
  assert.strictEqual(legs[0].label, "转机 6小时30分");
});

check("first-of-day bar to a flight targets the departure airport", function () {
  const t = Legs.firstOfDayTarget(f1);
  assert.strictEqual(t.role, "depart");
  assert.strictEqual(t.airport, "LHR");
  assert.strictEqual(t.name, "希思罗机场");
  assert.strictEqual(t.lat, 51.47002);
  const groups = Legs.groupByDay([hotel, f1, f2, rome]);
  const day2 = groups.find((g) => g.date === "2026-12-02");
  assert.ok(day2);
  assert.strictEqual(day2.header, "12月2日 周三");
  assert.strictEqual(day2.firstTarget.airport, "LHR");
  assert.strictEqual(day2.firstTarget.role, "depart");
});

check("first-of-day to a hotel targets the hotel itself", function () {
  const t = Legs.firstOfDayTarget(hotel);
  assert.strictEqual(t.name, "伦敦酒店");
  assert.strictEqual(t.lat, 51.51);
  assert.ok(!t.role || t.role === "place");
});

if (failures) {
  console.log("\n" + failures + " failure(s)");
  process.exit(1);
}
console.log("\nAll leg checks passed.");
