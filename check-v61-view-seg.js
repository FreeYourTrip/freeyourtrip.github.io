#!/usr/bin/env node
"use strict";
/**
 * v6.1 item 10：底部白色胶囊「地图」/「列表」，在『添加』上方 16px，居中；
 * 顶栏不再放切换按钮，地图页也没有关闭按钮。
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

check("top bar has no ☰ / segmented toggle; one bottom capsule sits above 添加", function () {
  assert.ok(html.indexOf("view-toggle-btn") === -1 && tl.indexOf("view-toggle-btn") === -1);
  assert.ok(html.indexOf("view-seg") === -1 && css.indexOf(".view-seg") === -1);
  assert.ok(html.indexOf('id="view-fab"') !== -1);
  const dock = html.indexOf('id="add-fab"');
  const fab = html.indexOf('id="view-fab"');
  assert.ok(fab !== -1 && dock !== -1 && fab < dock, "capsule is marked up next to 添加");
});

check("capsule style: 40 tall, radius 20, white, light shadow, 14px bold dark, 16px above 添加", function () {
  const block = css.slice(css.indexOf(".view-fab {"), css.indexOf(".view-fab {") + 700);
  assert.ok(/height:\s*40px;/.test(block));
  assert.ok(/border-radius:\s*20px;/.test(block));
  assert.ok(/background:\s*#fff;/.test(block));
  assert.ok(/color:\s*#1F2A37;/.test(block));
  assert.ok(/font-size:\s*14px;/.test(block));
  assert.ok(/font-weight:\s*700;/.test(block));
  assert.ok(/box-shadow:/.test(block));
  assert.ok(/bottom:\s*calc\(82px \+ env\(safe-area-inset-bottom, 0px\)\)/.test(block), "82px = dock 10 + 添加 56 + 16 gap");
  assert.ok(/left:\s*50%/.test(block) && /translateX\(-50%\)/.test(block), "centred");
});

check("same button in both views: 地图 in list, 列表 on the map; no close button", function () {
  assert.ok(tl.indexOf('fab.textContent = isMap ? "列表" : "地图"') !== -1);
  assert.ok(tl.indexOf('setView(currentView === "map" ? "list" : "map")') !== -1);
  assert.ok(!/map-close|关闭地图/.test(html));
  assert.ok(tl.indexOf("点底部的『地图』，所有地点一眼看全") !== -1);
});

check("item 12 fail-card copy still uses the 「列表」 label", function () {
  assert.ok(tiles.indexOf("行程在『列表』里照常能看") !== -1);
});

if (failed) {
  console.error("\n" + failed + " failed");
  process.exit(1);
}
console.log("\nall passed");
