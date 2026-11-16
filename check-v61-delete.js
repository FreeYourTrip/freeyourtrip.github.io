#!/usr/bin/env node
"use strict";
/**
 * v6.1：删行程 / 删条目共用确认框的文案、勾选框样式和出示条件。
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const root = __dirname;
const tl = fs.readFileSync(path.join(root, "timeline.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const fav = fs.readFileSync(path.join(root, "favorites.js"), "utf8");

let failed = 0;
function check(name, fn) {
  try { fn(); console.log("  ok  " + name); }
  catch (err) { failed += 1; console.error("  FAIL  " + name); console.error("    " + err.message); }
}

check("shared title helper uses 删除“名字”吗？", function () {
  assert.ok(tl.indexOf('return "删除“" + (name || "这一项") + "”吗？"') !== -1);
  assert.ok(tl.indexOf("deleteConfirmTitle(itemTitle(real)") !== -1);
  assert.ok(tl.indexOf('deleteConfirmTitle(t.nameZh || "我的行程")') !== -1);
  assert.ok(tl.indexOf("确定删除这一项吗？") === -1);
  assert.ok(tl.indexOf("确定删除「") === -1);
});

check("item and trip share checkbox helper; default unchecked; gated", function () {
  assert.ok(tl.indexOf("function footprintsReady") !== -1);
  assert.ok(tl.indexOf("Favorites.pageShipped") !== -1);
  assert.ok(tl.indexOf('label: kind === "trip" ? "同时删掉这趟的足迹" : "同时删掉这里的足迹"') !== -1);
  assert.ok(/checked:\s*false/.test(tl.slice(tl.indexOf("function footprintsCheckbox"), tl.indexOf("function footprintsCheckbox") + 500)));
  assert.ok(tl.indexOf('footprintsCheckbox("item", hasVisit)') !== -1);
  assert.ok(tl.indexOf('footprintsCheckbox("trip", hasVisits)') !== -1);
  assert.ok(tl.indexOf("Places.itemHasVisit") !== -1);
  assert.ok(tl.indexOf("Places.tripVisitCount") !== -1);
  assert.ok(/var PAGE_SHIPPED = false/.test(fav), "足迹 page is not shipped yet");
  assert.ok(/pageShipped:\s*PAGE_SHIPPED/.test(fav));
});

check("trip body is one line; no leftover copy", function () {
  assert.ok(tl.indexOf('n ? "这趟的 " + n + " 项会一起删掉，删除后不能撤销。" : "删除后不能撤销。"') !== -1);
  assert.ok(tl.indexOf("地点和备注会留在本机") === -1);
  assert.ok(tl.indexOf("删了不能撤销") === -1);
});

check("buttons stay 取消 / 删除; hotel uses the same button", function () {
  assert.ok(tl.indexOf('okText: "删除"') !== -1);
  assert.ok(tl.indexOf('cancelText: "取消"') !== -1);
  assert.ok(tl.indexOf('okText: "都删"') === -1);
  assert.ok(html.indexOf('id="confirm-cancel"') !== -1 && html.indexOf('id="confirm-ok"') !== -1);
});

check("deleting an item can also drop that place's visit, and undo restores it", function () {
  assert.ok(tl.indexOf("function deleteItemNow(id, alsoVisits)") !== -1);
  assert.ok(tl.indexOf("Places.removeItemVisits") !== -1);
  assert.ok(tl.indexOf("visitSnap = JSON.parse(JSON.stringify(places))") !== -1);
  assert.ok(tl.indexOf("if (visitSnap) places = visitSnap") !== -1);
});

check("checkbox sits between the grey line and the buttons, 20×20 radius 6, teal tick", function () {
  assert.ok(/\.confirm-check \{[\s\S]*?margin:\s*16px 0;/.test(css));
  assert.ok(/\.confirm-check \{[\s\S]*?font-size:\s*14px;/.test(css));
  assert.ok(/\.confirm-check \{[\s\S]*?color:\s*#1F2A37;/.test(css));
  assert.ok(/\.confirm-check input \{[\s\S]*?width:\s*20px;[\s\S]*?height:\s*20px;[\s\S]*?border-radius:\s*6px;/.test(css));
  assert.ok(/\.confirm-check input:checked \{[\s\S]*?background-color:\s*#0F9D8A;/.test(css));
  assert.ok(/stroke='%23fff'/.test(css), "white tick");
  assert.ok(/\.confirm-panel\.has-check \.confirm-actions \{[^}]*margin-top:\s*0;/.test(css));
  assert.ok(tl.indexOf('panel.classList.toggle("has-check", showCheck)') !== -1);
});

if (failed) {
  console.error("\n" + failed + " failed");
  process.exit(1);
}
console.log("\nall passed");
