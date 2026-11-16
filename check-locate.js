/**
 * 地图「定位到我」：按钮接线、只在点按时请求、错误提示、GCJ-02 转换分支。用法：node check-locate.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
global.GeoUtil = require("./geo.js");
const LM = require("./locate.js");

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

function fakeNav(behaviour) {
  const calls = [];
  return {
    calls,
    geolocation: {
      getCurrentPosition(ok, fail, opts) {
        calls.push(opts);
        behaviour(ok, fail);
      }
    }
  };
}

check("success: one getCurrentPosition call with high accuracy, 10s timeout, 60s maximumAge", function () {
  const nav = fakeNav((ok) => ok({ coords: { latitude: 51.5007, longitude: -0.1246, accuracy: 30 } }));
  let got = null;
  LM.requestPosition(nav, (r) => (got = r));
  assert.strictEqual(nav.calls.length, 1);
  assert.deepStrictEqual(nav.calls[0], { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  assert.deepStrictEqual(got, { ok: true, lat: 51.5007, lng: -0.1246, accuracy: 30 });
});

check("denied (code 1) -> friendly toast, button greyed", function () {
  let got = null;
  LM.requestPosition(fakeNav((ok, fail) => fail({ code: 1 })), (r) => (got = r));
  assert.strictEqual(got.ok, false);
  assert.strictEqual(got.denied, true);
  assert.strictEqual(got.message, "没拿到位置，可以在手机设置里允许浏览器使用定位");
});

check("timeout (3) / unavailable (2) -> same friendly toast, not greyed", function () {
  [2, 3].forEach((code) => {
    let got = null;
    LM.requestPosition(fakeNav((ok, fail) => fail({ code })), (r) => (got = r));
    assert.strictEqual(got.denied, false);
    assert.strictEqual(got.message, "没拿到位置，可以在手机设置里允许浏览器使用定位");
  });
});

check("no geolocation API -> 这个浏览器不支持定位", function () {
  let got = null;
  LM.requestPosition({}, (r) => (got = r));
  assert.strictEqual(got.message, "这个浏览器不支持定位");
  LM.requestPosition(null, (r) => (got = r));
  assert.strictEqual(got.message, "这个浏览器不支持定位");
});

check("OSM tiles: raw WGS-84 everywhere (even in mainland China)", function () {
  const p = LM.displayPoint(31.2304, 121.4737, "osm");
  assert.deepStrictEqual(p, { lat: 31.2304, lng: 121.4737, converted: false });
});

check("GCJ-02 tiles: mainland China converted with the project helper; HK / Macau / Taiwan / London not", function () {
  const sh = LM.displayPoint(31.2304, 121.4737, "gcj02");
  const want = GeoUtil.wgs84ToGcj02(31.2304, 121.4737);
  assert.strictEqual(sh.converted, true);
  assert.strictEqual(sh.lat, want.lat);
  assert.strictEqual(sh.lng, want.lng);
  assert.ok(Math.abs(sh.lat - 31.2304) > 0.0005 || Math.abs(sh.lng - 121.4737) > 0.0005, "offset actually applied");
  [[22.2819, 114.1582], [22.1987, 113.5439], [25.033, 121.5654], [51.5007, -0.1246]].forEach(([la, ln]) => {
    assert.strictEqual(LM.displayPoint(la, ln, "gcj02").converted, false, la + "," + ln);
  });
});

check("wiring: button markup, aria-label, only on tap, never on load, script + precache, help line", function () {
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  const src = fs.readFileSync(__dirname + "/locate.js", "utf8");
  const sw = fs.readFileSync(__dirname + "/sw.js", "utf8");
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  assert.ok(/<button type="button" class="locate-btn" id="locate-btn" aria-label="定位到我"/.test(html));
  assert.ok(html.indexOf('src="./locate.js"') !== -1 && sw.indexOf('"./locate.js"') !== -1);
  assert.ok(sw.indexOf('"xingcheng-map-shell-v16"') !== -1);
  assert.strictEqual((src.match(/getCurrentPosition\(/g) || []).length, 1, "exactly one call site");
  assert.ok(/b\.addEventListener\("click", onTap\)/.test(src), "requested only from the click handler");
  const bindFn = src.slice(src.indexOf("function bind()"));
  assert.ok(bindFn.indexOf("requestPosition") === -1, "bind() does not request on load");
  assert.ok(tl.indexOf("点顶部的地图图标，所有地点一眼看全。右下角的按钮能定位到你自己") !== -1, "help line (v5.2 copywriter)");
  assert.ok(tl.indexOf("getMap: function") !== -1 && tl.indexOf("mapTileKind: function") !== -1);
});

check("button CSS: 44×44 white circle, shadow, states, reduced motion; dot + accuracy circle colours", function () {
  const css = fs.readFileSync(__dirname + "/styles.css", "utf8");
  const src = fs.readFileSync(__dirname + "/locate.js", "utf8");
  const b = css.slice(css.indexOf(".locate-btn {"), css.indexOf("}", css.indexOf(".locate-btn {")));
  ["right: 16px", "width: 44px", "height: 44px", "border-radius: 50%", "background: #fff", "color: #16332F", "box-shadow: 0 2px 8px rgba(22, 51, 47, 0.16)"].forEach((t) => assert.ok(b.indexOf(t) !== -1, t));
  assert.ok(/\.locate-btn\.is-locating \.locate-ico \{ animation: locate-pulse 1s/.test(css));
  assert.ok(/@keyframes locate-pulse \{ from \{ opacity: 1; \} to \{ opacity: 0\.4; \} \}/.test(css));
  assert.ok(/prefers-reduced-motion: reduce\) \{\s*\.locate-btn\.is-locating \.locate-ico \{ animation: none; \}/.test(css));
  assert.ok(/\.locate-btn\.is-denied \{ color: #8A9099; \}/.test(css));
  assert.ok(/\.me-dot \{[^}]*width: 14px;[^}]*background: #4C8DFF;[^}]*border: 2px solid #fff;/.test(css));
  assert.ok(src.indexOf('stroke: false, fillColor: "#4C8DFF", fillOpacity: 0.15') !== -1);
  assert.ok(src.indexOf('map.once("dragstart"') !== -1, "dragging returns to outline");
});

check("fold / dual-screen CSS: 600–799 column 640px; Duo split uses viewport segments; nothing else affected", function () {
  const css = fs.readFileSync(__dirname + "/styles.css", "utf8");
  const mid = css.slice(css.indexOf("@media (min-width: 600px) and (max-width: 799px)"));
  assert.ok(/\.timeline \{ max-width: 640px; \}/.test(mid));
  assert.ok(/\.add-dock \{ max-width: 640px;/.test(mid));
  const duo = css.slice(css.indexOf("@media (horizontal-viewport-segments: 2)"));
  assert.ok(duo.indexOf("env(viewport-segment-width 0 0, 50vw)") !== -1);
  assert.ok(duo.indexOf("env(viewport-segment-left 1 0, 50vw)") !== -1);
  assert.ok(/#map-view\[hidden\] \{ display: block; position: fixed; top: 0; bottom: 0; left: var\(--seg1-left\); right: 0;/.test(duo));
  assert.ok(/\.add-dock \{ left: 0; right: auto; width: var\(--seg0-w\);/.test(duo));
  assert.ok(/\.sheet \{ right: auto; width: var\(--seg0-w\); \}/.test(duo));
  const envUses = css.match(/env\(viewport-segment/g) || [];
  assert.strictEqual(envUses.length, 2, "segment env() used twice");
  assert.ok(css.indexOf("env(viewport-segment") > css.indexOf("@media (horizontal-viewport-segments: 2)"), "only inside the Duo block");
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  assert.ok(tl.indexOf('matchMedia("(horizontal-viewport-segments: 2)").matches') !== -1);
});

if (failures) {
  console.log("\n" + failures + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll checks passed.");
