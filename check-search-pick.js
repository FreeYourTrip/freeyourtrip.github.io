/**
 * v5.2 搜索选点：店名不会被「Suite X01」这类单元号替换；只有一个但名字对不上的结果不自动选；结果第二行地址格式。
 * 全部假数据。用法：node check-search-pick.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
global.GeoUtil = require("./geo.js");
const Geo = require("./geocode.js");

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

/* 假的 Nominatim 返回：第一条是没有店名的建筑单元，第二条是真正的店 */
const RAW = [
  { lat: "51.5300", lon: "-0.2600", display_name: "Suite X01, 10 Example Park Royal Road, London, W3 6XX, United Kingdom", name: "", category: "building", type: "yes",
    address: { house_number: "10", road: "Example Park Royal Road", city: "London", postcode: "W3 6XX" } },
  { lat: "51.5110", lon: "-0.1300", display_name: "Example Hotpot, 1 Example Place, London, WC2H 7XX, United Kingdom", name: "Example Hotpot", category: "amenity", type: "restaurant",
    namedetails: { name: "Example Hotpot" }, address: { house_number: "1", road: "Example Place", city: "London", postcode: "WC2H 7XX" } }
];

check("Nominatim request asks for address parts + namedetails (same host, no new hosts)", function () {
  const src = fs.readFileSync(__dirname + "/geocode.js", "utf8");
  assert.ok(src.indexOf('"?format=jsonv2&limit=5&addressdetails=1&namedetails=1&accept-language="') !== -1);
  const hosts = (src.match(/https?:\/\/[a-z0-9.-]+/gi) || []).sort();
  assert.deepStrictEqual([...new Set(hosts)].filter((h) => !/nominatim\.openstreetmap\.org|webapi\.amap\.com|restapi\.amap\.com/.test(h)), []);
});

check("mapResults keeps name, namedetails and address parts", function () {
  const r = Geo.mapResults(RAW);
  assert.strictEqual(r[1].name, "Example Hotpot");
  assert.strictEqual(r[1].nameDetail, "Example Hotpot");
  assert.deepStrictEqual(r[1].address, { house_number: "1", road: "Example Place", city: "London", postcode: "WC2H 7XX" });
});

check("a unit / house number is never used as the place name", function () {
  const G = global.GeoUtil;
  ["Suite X01", "Unit 3", "Flat 2B", "12", "12-14", "Room 5"].forEach((n) => assert.strictEqual(G.isUnitLikeName(n), true, n));
  ["Example Hotpot", "大英博物馆", "Suite Café"].forEach((n) => assert.strictEqual(G.isUnitLikeName(n), false, n));
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  const fn = tl.slice(tl.indexOf("function candidateName"), tl.indexOf("function candidateShortAddr"));
  assert.ok(/if \(n && !unit\(n\)\) return n;/.test(fn) && /if \(first && !unit\(first\)\) return first;/.test(fn) && /return String\(typed \|\| ""\)\.trim\(\);/.test(fn), "falls back to what the user typed");
});

check("weak single match is not auto-picked", function () {
  const r = Geo.mapResults(RAW);
  assert.strictEqual(Geo.nameMatches("Example Hotpot", r[0]), false, "the bare building unit does not match the restaurant");
  assert.strictEqual(Geo.nameMatches("Example Hotpot", r[1]), true);
  assert.strictEqual(Geo.nameMatches("example hotpot london", r[1]), true, "half the words is enough");
  const src = fs.readFileSync(__dirname + "/geocode.js", "utf8");
  assert.ok(/if \(list\.length === 1 && name && !nameMatches\(name, list\[0\]\)\) \{\s*out\.chosen = null;\s*out\.status = "ambiguous";/.test(src));
});

check("result row: two lines, 56px, 'City POSTCODE-DISTRICT · number street'", function () {
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  assert.ok(tl.indexOf("var addr = candidateAddrLine(c, name);") !== -1);
  const fn = tl.slice(tl.indexOf("function candidateAddrLine"), tl.indexOf("function guessLabel"));
  /* 用同一段代码在 node 里跑一遍 */
  const candidateShortAddr = (c) => c.displayName;
  const f = new Function("candidateShortAddr", fn + "; return candidateAddrLine;")(candidateShortAddr);
  const r = Geo.mapResults(RAW);
  assert.strictEqual(f(r[1], "Example Hotpot"), "London WC2H · 1 Example Place");
  assert.strictEqual(f({ displayName: "Somewhere, Far" }, ""), "Somewhere, Far", "falls back to display_name");
  const css = fs.readFileSync(__dirname + "/styles.css", "utf8");
  assert.ok(/\.search-hit \{ min-height: 56px;/.test(css));
  assert.ok(/\.search-hit-name \{ font-size: 15px; font-weight: 600; color: #16332F;/.test(css));
  assert.ok(/\.search-hit-addr \{ display: block; font-size: 12px; color: #6B7A85;[^}]*text-overflow: ellipsis; white-space: nowrap;/.test(css));
});

if (failures) {
  console.log("\n" + failures + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll search-pick checks passed.");
