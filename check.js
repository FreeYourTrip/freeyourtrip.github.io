/**
 * 离线校验：WGS-84→GCJ-02、中国大陆判断、导航链接。
 * 用法：node check.js
 */
"use strict";

const assert = require("assert");
const GeoUtil = require("./geo.js");
const fs = require("fs");
const vm = require("vm");

const ctx = { console: console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + "/data.js", "utf8") + "\nthis.DESTINATIONS = DESTINATIONS;\nthis.EXAMPLE_TRIPS = EXAMPLE_TRIPS;", ctx);
const trips = ctx.EXAMPLE_TRIPS;

function almostEqual(a, b, eps) {
  return Math.abs(a - b) < eps;
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log("PASS  " + name);
  } catch (err) {
    failures += 1;
    console.log("FAIL  " + name);
    console.log("      " + err.message);
  }
}

/* 公开测试向量（eviltransform / 常用 WGS-84→GCJ-02 对照） */
const KNOWN = {
  wgsLat: 31.1774276,
  wgsLng: 121.5272106,
  gcjLat: 31.17530398364597,
  gcjLng: 121.531541859215
};

check("wgs84ToGcj02 matches published Shanghai vector (1e-6°)", function () {
  const got = GeoUtil.wgs84ToGcj02(KNOWN.wgsLat, KNOWN.wgsLng);
  if (!almostEqual(got.lat, KNOWN.gcjLat, 1e-6) || !almostEqual(got.lng, KNOWN.gcjLng, 1e-6)) {
    throw new Error(
      "expected " + KNOWN.gcjLat + "," + KNOWN.gcjLng + " got " + got.lat + "," + got.lng
    );
  }
});

check("inMainlandChina: London points are outside", function () {
  assert.strictEqual(GeoUtil.inMainlandChina(51.47002, -0.454295), false, "LHR");
  assert.strictEqual(GeoUtil.inMainlandChina(51.51015, -0.12047), false, "Savoy");
});

check("inMainlandChina: Shanghai points are inside", function () {
  assert.strictEqual(GeoUtil.inMainlandChina(31.143378, 121.805214), true, "PVG");
  assert.strictEqual(GeoUtil.inMainlandChina(31.240105, 121.490432), true, "Bund");
});

check("inMainlandChina: excludes HK / Macau / Taiwan", function () {
  assert.strictEqual(GeoUtil.inMainlandChina(22.3193, 114.1694), false, "Hong Kong");
  assert.strictEqual(GeoUtil.inMainlandChina(22.1987, 113.5439), false, "Macau");
  assert.strictEqual(GeoUtil.inMainlandChina(25.033, 121.5654), false, "Taipei");
});

function findTrip(id) {
  return trips.find((t) => t.id === id);
}

function item(trip, id) {
  return trip.items.find((i) => i.id === id);
}

function endpoint(it) {
  return { id: it.id, name: it.nameZh, lat: it.lat, lng: it.lng };
}

const london = findTrip("london-example");
const shanghai = findTrip("shanghai-example");
const lhr = endpoint(item(london, "lhr-arrival"));
const savoy = endpoint(item(london, "savoy"));
const pvg = endpoint(item(shanghai, "pvg-arrival"));
const bund = endpoint(item(shanghai, "the-bund"));

check("recommend Google for Heathrow → The Savoy", function () {
  assert.strictEqual(GeoUtil.recommendApp(lhr, savoy), "google");
});

check("recommend Amap for PVG → 外滩", function () {
  assert.strictEqual(GeoUtil.recommendApp(pvg, bund), "amap");
});

check("London Amap coords stay WGS-84 (no conversion)", function () {
  const a = GeoUtil.amapCoord(lhr.lat, lhr.lng);
  const b = GeoUtil.amapCoord(savoy.lat, savoy.lng);
  assert.strictEqual(a.lat, lhr.lat);
  assert.strictEqual(a.lng, lhr.lng);
  assert.strictEqual(b.lat, savoy.lat);
  assert.strictEqual(b.lng, savoy.lng);
});

check("Shanghai Amap coords are GCJ-02 conversions of stored WGS-84", function () {
  const a = GeoUtil.amapCoord(pvg.lat, pvg.lng);
  const b = GeoUtil.amapCoord(bund.lat, bund.lng);
  const ea = GeoUtil.wgs84ToGcj02(pvg.lat, pvg.lng);
  const eb = GeoUtil.wgs84ToGcj02(bund.lat, bund.lng);
  assert.ok(!almostEqual(a.lat, pvg.lat, 1e-5), "PVG should shift");
  assert.ok(!almostEqual(a.lng, pvg.lng, 1e-5), "PVG lng should shift");
  assert.ok(almostEqual(a.lat, ea.lat, 1e-12) && almostEqual(a.lng, ea.lng, 1e-12));
  assert.ok(almostEqual(b.lat, eb.lat, 1e-12) && almostEqual(b.lng, eb.lng, 1e-12));
});

const modes = ["公共交通", "驾车", "步行", "打车"];

console.log("\n======= Heathrow Airport → The Savoy, Strand (WGS-84, no GCJ) =======");
console.log("origin WGS-84:  " + lhr.lat + ", " + lhr.lng + "  " + lhr.name);
console.log("dest   WGS-84:  " + savoy.lat + ", " + savoy.lng + "  " + savoy.name);
console.log("straight-line:  " + GeoUtil.haversineKm(lhr, savoy).toFixed(2) + " km (not a route)");
console.log("recommended:    Google Maps");
modes.forEach(function (mode) {
  const links = GeoUtil.buildNavLinks(lhr, savoy, mode);
  console.log("\n[" + mode + "]");
  console.log("Google: " + links.google);
  console.log("Amap:   " + links.amap);
});

const pvgGcj = GeoUtil.wgs84ToGcj02(pvg.lat, pvg.lng);
const bundGcj = GeoUtil.wgs84ToGcj02(bund.lat, bund.lng);
console.log("\n======= 上海浦东国际机场 → 外滩 (Amap uses GCJ-02) =======");
console.log("origin WGS-84:  " + pvg.lat + ", " + pvg.lng + "  " + pvg.name);
console.log("origin GCJ-02:  " + pvgGcj.lat + ", " + pvgGcj.lng);
console.log("dest   WGS-84:  " + bund.lat + ", " + bund.lng + "  " + bund.name);
console.log("dest   GCJ-02:  " + bundGcj.lat + ", " + bundGcj.lng);
console.log("delta PVG:      dlat=" + (pvgGcj.lat - pvg.lat).toFixed(6) + " dlng=" + (pvgGcj.lng - pvg.lng).toFixed(6));
console.log("delta Bund:     dlat=" + (bundGcj.lat - bund.lat).toFixed(6) + " dlng=" + (bundGcj.lng - bund.lng).toFixed(6));
console.log("straight-line:  " + GeoUtil.haversineKm(pvg, bund).toFixed(2) + " km (not a route)");
console.log("recommended:    Amap");
modes.forEach(function (mode) {
  const links = GeoUtil.buildNavLinks(pvg, bund, mode);
  console.log("\n[" + mode + "]");
  console.log("Google (WGS-84 lat,lng): " + links.google);
  console.log("Amap  (GCJ-02 lng,lat):  " + links.amap);
  /* URL 中的高德坐标必须是转换后的值 */
  const fromTok = GeoUtil.formatCoord(pvgGcj.lng) + "," + GeoUtil.formatCoord(pvgGcj.lat);
  const toTok = GeoUtil.formatCoord(bundGcj.lng) + "," + GeoUtil.formatCoord(bundGcj.lat);
  if (links.amap.indexOf(fromTok) === -1 || links.amap.indexOf(toTok) === -1) {
    failures += 1;
    console.log("FAIL  Amap URL missing expected GCJ-02 tokens", fromTok, toTok);
  }
  if (links.google.indexOf(GeoUtil.formatCoord(pvg.lat) + "," + GeoUtil.formatCoord(pvg.lng)) === -1) {
    failures += 1;
    console.log("FAIL  Google URL should use WGS-84 origin");
  }
});

console.log("\n======= flight local-time format (no browser TZ) =======");
function formatFlightLocal(item) {
  const [y1, m1, d1] = item.departDate.split("-").map(Number);
  const [y2, m2, d2] = item.arriveDate.split("-").map(Number);
  const n = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
  const off = n ? (n > 0 ? "+" + n : String(n)) : "";
  return item.flightNo + " " + item.departTime + " " + item.fromAirport + " → " + item.arriveTime + off + " " + item.toAirport;
}
const kyotoFlight = ctx.DESTINATIONS.find((d) => d.id === "kyoto").flightFromLondon;
const kyotoStr = kyotoFlight.departTime + " " + kyotoFlight.fromAirport + " → " + kyotoFlight.arriveTime + "+1 " + kyotoFlight.toAirport;
console.log("wishlist Kyoto: " + kyotoStr);
assert.strictEqual(kyotoStr, "10:00 LHR → 06:30+1 HND");
console.log("London example: " + formatFlightLocal(item(london, "lhr-arrival")));
console.log("Shanghai example: " + formatFlightLocal(item(shanghai, "pvg-arrival")));
assert.strictEqual(formatFlightLocal(item(shanghai, "pvg-arrival")), "MU552 11:20 LHR → 06:10+1 PVG");
console.log("PASS  flight local-time strings");

if (failures) {
  console.log("\n" + failures + " failure(s)");
  process.exit(1);
}
console.log("\nAll checks passed.");
