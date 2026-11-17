#!/usr/bin/env node
"use strict";
/**
 * v6.1.1：地图/列表并入底栏，56×56 方钮在『添加』左边。
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const root = __dirname;
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const tl = fs.readFileSync(path.join(root, "timeline.js"), "utf8");
const tiles = fs.readFileSync(path.join(root, "tiles.js"), "utf8");

let failed = 0;
function check(name, fn) {
  try { fn(); console.log("  ok  " + name); }
  catch (err) { failed += 1; console.error("  FAIL  " + name); console.error("    " + err.message); }
}

check("top bar has no segmented toggle; map button sits in the bottom bar left of 添加", function () {
  assert.ok(html.indexOf("view-toggle-btn") === -1 && tl.indexOf("view-toggle-btn") === -1);
  assert.ok(html.indexOf("view-seg") === -1 && css.indexOf(".view-seg") === -1);
  assert.ok(html.indexOf('id="view-fab"') !== -1 && html.indexOf('class="view-toggle"') !== -1);
  const dock = html.indexOf('id="add-fab"');
  const fab = html.indexOf('id="view-fab"');
  assert.ok(fab !== -1 && dock !== -1 && fab < dock, "地图 button is marked up left of 添加");
  assert.ok(html.indexOf('class="view-fab"') === -1, "old floating pill class is gone");
});

check("toggle style: 56×56, 16 radius, white, 1px #E3E7EC, 11px label; 添加 is 56 tall", function () {
  const block = css.slice(css.indexOf(".view-toggle {"), css.indexOf(".view-toggle {") + 900);
  assert.ok(/width:\s*56px;/.test(block) && /height:\s*56px;/.test(block));
  assert.ok(/border-radius:\s*16px;/.test(block));
  assert.ok(/background:\s*#fff;/.test(block));
  assert.ok(/border:\s*1px solid #E3E7EC;/.test(block));
  assert.ok(/box-shadow:/.test(block));
  assert.ok(/\.view-toggle-label \{[\s\S]*?font-size:\s*11px;/.test(css));
  const bar = css.slice(css.indexOf(".add-bar {"));
  assert.ok(/height:\s*56px;/.test(bar.slice(0, 500)));
});

check("same button in both views: 地图 in list, 列表 on the map; no close button", function () {
  assert.ok(tl.indexOf('isMap ? "列表" : "地图"') !== -1);
  assert.ok(tl.indexOf('setView(currentView === "map" ? "list" : "map")') !== -1);
  assert.ok(!/map-close|关闭地图/.test(html));
  assert.ok(tl.indexOf("点『添加』左边的『地图』") !== -1);
});

check("item 12 fail-card copy still uses the 「列表」 label", function () {
  assert.ok(tiles.indexOf("行程在『列表』里照常能看") !== -1);
});

check("locate and map-miss sit above the new bar, not overlapping it", function () {
  const loc = css.slice(css.indexOf(".locate-btn {"), css.indexOf(".locate-btn {") + 500);
  assert.ok(/right:\s*16px;/.test(loc));
  assert.ok(/bottom:\s*calc\(88px \+ env\(safe-area-inset-bottom, 0px\)\)/.test(loc));
  assert.ok(/bottom:\s*calc\(88px \+ env\(safe-area-inset-bottom, 0px\)\)/.test(css.slice(css.indexOf(".map-miss {"), css.indexOf(".map-miss {") + 400)));
});

if (failed) {
  console.error("\n" + failed + " failed");
  process.exit(1);
}
console.log("\nall passed");
