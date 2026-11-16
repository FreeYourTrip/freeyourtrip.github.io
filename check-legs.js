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

check("round trip with no hotel in between is not 转机 (LHR-CDG then CDG-LHR days later)", function () {
  const out = {
    id: "rt-out", type: "flight", flightNo: "EA321",
    fromAirport: "LHR", toAirport: "CDG",
    departDate: "2026-12-03", departTime: "09:30",
    arriveDate: "2026-12-03", arriveTime: "11:50"
  };
  const back = {
    id: "rt-back", type: "flight", flightNo: "EA322",
    fromAirport: "CDG", toAirport: "LHR",
    departDate: "2026-12-08", departTime: "18:00",
    arriveDate: "2026-12-08", arriveTime: "18:20"
  };
  const pairs = Legs.pairRoundTrips([out, back]);
  assert.strictEqual(pairs["rt-out"].label, "去程");
  assert.strictEqual(pairs["rt-back"].label, "返程");
  const legs = Legs.buildConnectors([out, back]);
  assert.ok(!legs.some((c) => c.kind === "transfer" && String(c.label).indexOf("转机") === 0), JSON.stringify(legs));
  assert.strictEqual(legs.filter((c) => c.fromItemId === "rt-out" && c.toItemId === "rt-back").length, 0, "cross-day return has no bar");
});

check("LHR-DXB then DXB-HND 2h30 is still 转机", function () {
  const a = {
    id: "dxb1", type: "flight", flightNo: "XX1",
    fromAirport: "LHR", toAirport: "DXB",
    departDate: "2026-12-01", departTime: "08:00",
    arriveDate: "2026-12-01", arriveTime: "18:00"
  };
  const b = {
    id: "dxb2", type: "flight", flightNo: "XX2",
    fromAirport: "DXB", toAirport: "HND",
    departDate: "2026-12-01", departTime: "20:30",
    arriveDate: "2026-12-02", arriveTime: "12:00"
  };
  const legs = Legs.buildConnectors([a, b]);
  assert.strictEqual(legs.length, 1);
  assert.strictEqual(legs[0].kind, "transfer");
  assert.strictEqual(legs[0].clickable, false);
  assert.strictEqual(legs[0].label, "转机 2小时30分");
});

check("mismatched airports are not 转机; 30h gap is not 转机", function () {
  const a = Object.assign({}, f1, { id: "m1", fromAirport: "LHR", toAirport: "CDG", arriveDate: "2026-12-02", arriveTime: "12:00" });
  const b = Object.assign({}, f2, { id: "m2", fromAirport: "LHR", toAirport: "JFK", departDate: "2026-12-02", departTime: "14:30" });
  const mismatch = Legs.buildConnectors([a, b]);
  assert.ok(!mismatch.some((c) => String(c.label).indexOf("转机") === 0), "same-day mismatch is not 转机: " + JSON.stringify(mismatch.map((c) => c.label)));
  assert.strictEqual(mismatch[0] && mismatch[0].kind, "nav", "same day falls back to nav");

  const later = Object.assign({}, f2, {
    id: "m3", fromAirport: "CDG", toAirport: "FCO",
    departDate: "2026-12-03", departTime: "18:00",
    arriveDate: "2026-12-03", arriveTime: "20:00"
  });
  /* 12:00 → next day 18:00 = 30 hours, same airport */
  const longGap = Legs.buildConnectors([a, later]);
  assert.ok(!longGap.some((c) => c.kind === "transfer"), "30h is not 转机: " + JSON.stringify(longGap));
});

check("train then bus under 24h is 换乘, not 转机", function () {
  const tr = {
    id: "tr1", type: "train", number: "G1",
    fromNameZh: "北京南", nameZh: "上海虹桥",
    departDate: "2026-12-04", departTime: "08:00",
    arriveDate: "2026-12-04", arriveTime: "12:28"
  };
  const bus = {
    id: "bus1", type: "bus", number: "X90",
    fromNameZh: "上海虹桥", nameZh: "杭州",
    departDate: "2026-12-04", departTime: "14:00",
    arriveDate: "2026-12-04", arriveTime: "16:00"
  };
  const legs = Legs.buildConnectors([tr, bus]);
  assert.strictEqual(legs.length, 1);
  assert.strictEqual(legs[0].kind, "transfer");
  assert.strictEqual(legs[0].clickable, false);
  assert.strictEqual(legs[0].label, "换乘 1小时32分");
  assert.ok(legs[0].label.indexOf("转机") === -1);
});

check("ES9014 (12/5) then BA301 (12/8) has no 转机 or 换乘 bar", function () {
  const tr = {
    id: "es1", type: "train", number: "ES9014",
    fromNameZh: "St Pancras", nameZh: "Paris Nord",
    departDate: "2026-12-05", departTime: "10:30",
    arriveDate: "2026-12-05", arriveTime: "13:47"
  };
  const fl = {
    id: "ba301", type: "flight", flightNo: "BA301",
    fromAirport: "CDG", toAirport: "LHR",
    departDate: "2026-12-08", departTime: "18:00",
    arriveDate: "2026-12-08", arriveTime: "18:20"
  };
  const legs = Legs.buildConnectors([tr, fl]);
  assert.deepStrictEqual(legs, [], JSON.stringify(legs));
});

check("same-day train then flight with a short gap is not 转机 or 换乘", function () {
  const tr = {
    id: "tr-same", type: "train", number: "G1",
    fromNameZh: "北京南", nameZh: "上海虹桥",
    departDate: "2026-12-04", departTime: "08:00",
    arriveDate: "2026-12-04", arriveTime: "12:28"
  };
  const fl = {
    id: "fl-same", type: "flight", flightNo: "MU1",
    fromAirport: "SHA", toAirport: "PEK",
    departDate: "2026-12-04", departTime: "14:00",
    arriveDate: "2026-12-04", arriveTime: "16:00"
  };
  const legs = Legs.buildConnectors([tr, fl]);
  assert.ok(!legs.some((c) => /转机|换乘/.test(c.label || "")), JSON.stringify(legs));
  assert.strictEqual(legs[0] && legs[0].kind, "nav", "mixed modes fall through to 怎么去");
});

check("train then bus at a different station is not 换乘", function () {
  const tr = {
    id: "tr-diff", type: "train", number: "G1",
    fromNameZh: "北京南", nameZh: "上海虹桥",
    departDate: "2026-12-04", departTime: "08:00",
    arriveDate: "2026-12-04", arriveTime: "12:28"
  };
  const bus = {
    id: "bus-diff", type: "bus", number: "X90",
    fromNameZh: "上海站", nameZh: "杭州",
    departDate: "2026-12-04", departTime: "14:00",
    arriveDate: "2026-12-04", arriveTime: "16:00"
  };
  const legs = Legs.buildConnectors([tr, bus]);
  assert.ok(!legs.some((c) => String(c.label).indexOf("换乘") === 0 || String(c.label).indexOf("转机") === 0), JSON.stringify(legs));
  assert.strictEqual(legs[0] && legs[0].kind, "nav");
});

check("flight then flight with a missing airport code is not auto 转机", function () {
  const a = {
    id: "miss-a", type: "flight", flightNo: "XX1",
    fromAirport: "LHR", toAirport: "DXB",
    departDate: "2026-12-01", departTime: "08:00",
    arriveDate: "2026-12-01", arriveTime: "18:00"
  };
  const b = {
    id: "miss-b", type: "flight", flightNo: "XX2",
    fromAirport: "", toAirport: "HND",
    departDate: "2026-12-01", departTime: "20:30",
    arriveDate: "2026-12-02", arriveTime: "12:00"
  };
  const legs = Legs.buildConnectors([a, b]);
  assert.ok(!legs.some((c) => String(c.label).indexOf("转机") === 0), JSON.stringify(legs));
});

check("open-jaw manual back pairs as 返程 even when airports differ", function () {
  const out = {
    id: "oj-out", type: "flight", flightNo: "BA1",
    fromAirport: "LHR", toAirport: "HND",
    departDate: "2026-12-01", departTime: "09:30",
    arriveDate: "2026-12-02", arriveTime: "07:00"
  };
  const back = {
    id: "oj-back", type: "flight", flightNo: "BA2",
    fromAirport: "KIX", toAirport: "LHR",
    departDate: "2026-12-10", departTime: "11:00",
    arriveDate: "2026-12-10", arriveTime: "16:00",
    legRole: "back"
  };
  const auto = Legs.pairRoundTrips([Object.assign({}, out), Object.assign({}, back, { legRole: undefined })]);
  assert.deepStrictEqual(auto, {}, "without a manual role, open-jaw does not auto-pair");
  const pairs = Legs.pairRoundTrips([out, back]);
  assert.strictEqual(pairs["oj-out"].label, "去程");
  assert.strictEqual(pairs["oj-out"].otherId, "oj-back");
  assert.strictEqual(pairs["oj-back"].label, "返程");
  assert.strictEqual(pairs["oj-back"].otherId, "oj-out");
});

check("manual transfer shows 转机 across different airports and any gap", function () {
  const a = {
    id: "hnd", type: "flight", flightNo: "NH1",
    fromAirport: "LHR", toAirport: "HND",
    departDate: "2026-12-01", departTime: "09:30",
    arriveDate: "2026-12-02", arriveTime: "07:00"
  };
  const b = {
    id: "nrt", type: "flight", flightNo: "NH2",
    fromAirport: "NRT", toAirport: "SFO",
    departDate: "2026-12-04", departTime: "11:00",
    arriveDate: "2026-12-04", arriveTime: "05:00",
    legRole: "transfer"
  };
  const legs = Legs.buildConnectors([a, b]);
  assert.strictEqual(legs.length, 1);
  assert.strictEqual(legs[0].kind, "transfer");
  assert.strictEqual(legs[0].clickable, false);
  assert.ok(legs[0].label.indexOf("转机") === 0, legs[0].label);
  /* 07:00 on 12/2 → 11:00 on 12/4 = 52 hours */
  assert.strictEqual(legs[0].label, "转机 52小时");
});

check("manual out/back suppress 转机 with their partner, even under 24h at the same airport", function () {
  const out = {
    id: "sd-out", type: "flight", flightNo: "BA7",
    fromAirport: "LHR", toAirport: "EDI",
    departDate: "2026-12-04", departTime: "07:00",
    arriveDate: "2026-12-04", arriveTime: "08:30",
    legRole: "out"
  };
  const back = {
    id: "sd-back", type: "flight", flightNo: "BA8",
    fromAirport: "EDI", toAirport: "LHR",
    departDate: "2026-12-04", departTime: "11:00",
    arriveDate: "2026-12-04", arriveTime: "12:30",
    legRole: "back"
  };
  const legs = Legs.buildConnectors([out, back]);
  assert.ok(!legs.some((c) => String(c.label).indexOf("转机") === 0), JSON.stringify(legs));
  assert.strictEqual(legs[0] && legs[0].kind, "nav", "same-day return uses 怎么去, not 转机");
});

check("auto hint text: 去程 / 返程 / 转机 / 没认出来", function () {
  assert.strictEqual(Legs.autoRoleHintText("out"), "已自动识别为：去程");
  assert.strictEqual(Legs.autoRoleHintText("back"), "已自动识别为：返程");
  assert.strictEqual(Legs.autoRoleHintText("transfer"), "已自动识别为：转机");
  assert.strictEqual(Legs.autoRoleHintText(""), "没认出来，可以自己选");
  assert.strictEqual(Legs.autoRoleHintText("auto"), "没认出来，可以自己选");
  const out = {
    id: "hint-out", type: "flight", flightNo: "BA1",
    fromAirport: "LHR", toAirport: "HND",
    departDate: "2026-12-01", departTime: "09:30",
    arriveDate: "2026-12-02", arriveTime: "07:00"
  };
  const back = {
    id: "hint-back", type: "flight", flightNo: "BA2",
    fromAirport: "HND", toAirport: "LHR",
    departDate: "2026-12-10", departTime: "11:00",
    arriveDate: "2026-12-10", arriveTime: "16:00"
  };
  assert.strictEqual(Legs.autoRoleFor([out, back], "hint-out"), "out");
  assert.strictEqual(Legs.autoRoleFor([out, back], "hint-back"), "back");
  const a = {
    id: "lx1", type: "flight", flightNo: "X1",
    fromAirport: "LHR", toAirport: "DXB",
    departDate: "2026-12-01", departTime: "08:00",
    arriveDate: "2026-12-01", arriveTime: "18:00"
  };
  const b = {
    id: "lx2", type: "flight", flightNo: "X2",
    fromAirport: "DXB", toAirport: "HND",
    departDate: "2026-12-01", departTime: "20:30",
    arriveDate: "2026-12-02", arriveTime: "12:00"
  };
  assert.strictEqual(Legs.autoRoleFor([a, b], "lx2"), "transfer");
  assert.strictEqual(Legs.autoRoleFor([a], "lx1"), "");
});

check("flight form has 这段是 picker; selected/unselected styles; hint copy", function () {
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  const css = fs.readFileSync(__dirname + "/styles.css", "utf8");
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  assert.ok(html.indexOf("这段是") !== -1 && html.indexOf("id=\"leg-role-row\"") !== -1);
  assert.ok(html.indexOf("data-leg-role=\"auto\"") !== -1 && html.indexOf(">去程<") !== -1 && html.indexOf(">返程<") !== -1 && html.indexOf(">转机<") !== -1);
  assert.ok(/\.leg-role-seg \{[^}]*height: 36px;[^}]*border-radius: 18px;[^}]*background: #F1ECE4/.test(css));
  assert.ok(/\.leg-role-opt\.is-on \{[^}]*background: #fff;[^}]*color: #0F9D8A;[^}]*font-weight: 600;[^}]*box-shadow: 0 1px 3px rgba\(0,0,0,\.12\)/.test(css));
  assert.ok(/\.leg-role-opt \{[^}]*font-size: 14px;[^}]*color: #6B7A8F/.test(css));
  assert.ok(/\.leg-role-hint \{[^}]*font-size: 12px;[^}]*color: #9AA6B2/.test(css));
  assert.ok(fs.readFileSync(__dirname + "/legs.js", "utf8").indexOf("已自动识别为：去程") !== -1);
  assert.ok(html.indexOf("没认出来，可以自己选") !== -1);
  assert.ok(tl.indexOf("pickedLegRole") !== -1 && tl.indexOf("paintLegRoleHint") !== -1);
});

if (failures) {
  console.log("\n" + failures + " failure(s)");
  process.exit(1);
}
console.log("\nAll leg checks passed.");
