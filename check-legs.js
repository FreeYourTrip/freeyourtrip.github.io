/**
 * 航班连接规则校验。用法：node check-legs.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
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

check("v5.2 nav: Google gets name + address; a unit like 'Suite X01' is never the name; no address → lat,lng; nothing → 待补地址", function () {
  const G = require("./geo.js");
  /* 全是假数据：假餐厅名 + 带楼内单元号的完整英国地址（含邮编） */
  const from = { name: "Example Hall", address: "1 Sample Square, London WC1H 0XX", lat: 51.5246, lng: -0.1281 };
  const shop = { name: "Example Hotpot", address: "Suite X01, 10 Example Park Royal Road, London W3 6XX", lat: 51.53, lng: -0.26 };
  const url = G.buildFlexibleNavLinks(from, shop, "公共交通").href;
  assert.ok(url.indexOf("destination=" + encodeURIComponent("Example Hotpot, " + shop.address)) !== -1, url);
  assert.ok(url.indexOf("origin=" + encodeURIComponent("Example Hall, " + from.address)) !== -1, "origin by name + address too");
  assert.ok(url.indexOf("destination=51.") === -1, "never bare coords when there is a name and address");
  const unitNamed = { name: "Suite X01", address: shop.address };
  assert.strictEqual(G.isUnitLikeName("Suite X01"), true);
  assert.strictEqual(G.isUnitLikeName("12"), true);
  assert.strictEqual(G.isUnitLikeName("Example Hotpot"), false);
  assert.ok(G.buildFlexibleNavLinks(null, unitNamed, "公共交通").href.indexOf("destination=" + encodeURIComponent(shop.address) + "&") !== -1, "unit-like name dropped, address kept");
  const fromMe = G.buildFlexibleNavLinks(null, shop, "公共交通").href;
  assert.ok(fromMe.indexOf("origin=") === -1, "default origin omitted = current location");
  const coordsOnly = { name: "Example Corner", lat: 51.5, lng: -0.12 };
  assert.strictEqual(G.pointUsable(coordsOnly), true, "coords without address navigate normally");
  assert.ok(G.buildFlexibleNavLinks(null, coordsOnly, "公共交通").href.indexOf("destination=51.500000%2C-0.120000") !== -1, "no address → lat,lng (never name + city)");
  assert.strictEqual(G.pointUsable({ name: "Only a name" }), false, "neither address nor coords → grey + 待补地址");
  assert.ok(G.buildPlaceLink(shop).href.indexOf("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("Example Hotpot, " + shop.address)) === 0, "看位置 = place search, not a route");
});

check("v5.2 provider: Amap only for coordinates inside mainland China; names never decide", function () {
  const G = require("./geo.js");
  const P = { 大阪: [34.69, 135.5], 东京: [35.68, 139.69], 首尔: [37.57, 126.98], 香港: [22.32, 114.17], 台北: [25.03, 121.56], 澳门: [22.19, 113.54], 福冈: [33.59, 130.4], 平壤: [39.03, 125.75] };
  Object.keys(P).forEach((k) => {
    const p = { name: k, lat: P[k][0], lng: P[k][1] };
    assert.strictEqual(G.inMainlandChina(p.lat, p.lng), false, k);
    assert.strictEqual(G.buildFlexibleNavLinks(null, p, "公共交通").recommended, "google", k + " → Google");
    assert.deepStrictEqual(G.amapCoord(p.lat, p.lng), { lat: p.lat, lng: p.lng }, k + ": no GCJ shift");
    assert.ok(G.buildPlaceLink(p).href.indexOf("https://www.google.com/") === 0, k + " 看位置 → Google");
  });
  ["大阪", "东京", "首尔", "上海"].forEach((k) => {
    assert.strictEqual(G.buildFlexibleNavLinks(null, { name: k, address: k }, "公共交通").recommended, "google", k + " without coords → Google, whatever the name");
    assert.strictEqual(G.buildFlexibleNavLinks(null, { name: k, address: k }, "公共交通", { lat: 51.5, lng: -0.12 }).recommended, "google", k + ": you are outside the mainland → Google");
  });
  /* 没坐标的地点按「你现在在哪」：在中国大陆选高德（只用内存里的位置） */
  assert.strictEqual(G.buildFlexibleNavLinks(null, { name: "外滩", address: "上海市黄浦区中山东一路" }, "公共交通", { lat: 31.23, lng: 121.47 }).recommended, "amap");
  assert.strictEqual(G.buildFlexibleNavLinks(null, { name: "外滩", address: "上海市黄浦区中山东一路" }, "公共交通", { lat: 35.68, lng: 139.69 }).recommended, "google", "you are in Japan → Google");
  const loc = fs.readFileSync(__dirname + "/locate.js", "utf8");
  assert.ok(/lastPoint: function \(\) \{ return lastHere \?/.test(loc), "current position comes from memory only");
  const tlx = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  assert.ok(tlx.indexOf('noCoords: "在中国大陆选高德，其他地方选 Google"') !== -1);
  assert.ok(tlx.slice(tlx.indexOf("function hereInMemory"), tlx.indexOf("function hereInMemory") + 400).indexOf("getCurrentPosition") === -1, "never locates just for navigation");
  const M = { 上海: [31.23, 121.47], 北京: [39.9, 116.4], 成都: [30.66, 104.06], 深圳: [22.54, 114.06], 三亚: [18.25, 109.5] };
  Object.keys(M).forEach((k) => {
    const p = { name: k, lat: M[k][0], lng: M[k][1] };
    assert.strictEqual(G.buildFlexibleNavLinks(null, p, "公共交通").recommended, "amap", k + " → Amap");
    const g = G.amapCoord(p.lat, p.lng);
    assert.ok(Math.abs(g.lat - p.lat) > 0.0005 || Math.abs(g.lng - p.lng) > 0.0005, k + " GCJ applied");
    assert.ok(G.buildPlaceLink(p).href.indexOf("https://uri.amap.com/marker?") === 0, k + " 看位置 → Amap marker");
  });
  assert.strictEqual(G.buildFlexibleNavLinks({ name: "x", lat: 35.68, lng: 139.69 }, { name: "y", lat: 31.23, lng: 121.47 }, "公共交通").recommended, "google", "origin outside the mainland → Google");
  const geo = fs.readFileSync(__dirname + "/geo.js", "utf8");
  const rec = geo.slice(geo.indexOf("function recommendFlexible"), geo.indexOf("function buildPlaceNavLinks"));
  assert.ok(rec.indexOf("looksChineseMainlandQuery") === -1 && rec.indexOf("pointLabel") === -1, "no Han-character heuristic for the provider");
});

check("v5.2 nav UI copy and styles", function () {
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  assert.ok(tl.indexOf('go: "带我去"') !== -1 && tl.indexOf('look: "看位置"') !== -1 && tl.indexOf('noAddr: "待补地址"') !== -1);
  assert.ok(tl.indexOf('far: "这两站之间要坐飞机或火车"') !== -1 && tl.indexOf('transitTip: "公交算不出来就换成驾车试试"') !== -1);
  assert.ok(/var NAV_FAR_KM = 300;/.test(tl) && /buildFlexibleNavLinks\(null, dest/.test(tl), "v5.4: card 带我去 always starts from the current location");
  assert.ok(tl.indexOf("在地图上看位置") === -1, "wording is 看位置");
  const css = fs.readFileSync(__dirname + "/styles.css", "utf8");
  assert.ok(/\.nav-go \{ flex: 6 1 0; background: #0F9D8A; color: #fff; \}/.test(css) && /\.nav-look \{ flex: 4 1 0; background: #fff; color: #16332F; border: 1px solid #D9E2E0; \}/.test(css));
  assert.ok(/\.nav-pair \{ display: flex; gap: 8px;/.test(css) && /height: 40px;/.test(css) && /\.nav-line \{[^}]*font-size: 12px; color: #8A9099;/.test(css));
});

if (failures) {
  console.log("\n" + failures + " failure(s)");
  process.exit(1);
}
console.log("\nAll leg checks passed.");
