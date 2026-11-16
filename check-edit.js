/**
 * 单条删除 / 撤销 / 修改 / 清空全部校验。用法：node check-edit.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const ItemEdit = require("./item-edit.js");
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

// 假数据（示例地点，无真实个人信息）
function sample() {
  return [
    { id: "a", type: "place", nameZh: "示例咖啡馆", address: "Example St 1", date: "2026-12-04", time: "09:00", lat: 51.51, lng: -0.12 },
    { id: "b", type: "place", subtype: "景点", nameZh: "示例博物馆", address: "Example St 2", date: "2026-12-04", time: "11:00", lat: 51.52, lng: -0.13 },
    { id: "c", type: "place", subtype: "餐厅", nameZh: "示例餐厅", address: "Example St 3", date: "2026-12-04", time: "13:00", lat: 51.53, lng: -0.14 },
    { id: "d", type: "hotel", nameZh: "示例酒店", address: "Example St 4", checkIn: "2026-12-05", checkInTime: "15:00", confirmationNo: "FAKE-000", lat: 51.5, lng: -0.1 }
  ];
}

function pairs(items) {
  return Legs.buildConnectors(items)
    .filter(function (c) { return c.kind !== "transfer"; })
    .map(function (c) { return c.fromItemId + ">" + c.toItemId; });
}

check("removeItem drops one item without mutating the input", function () {
  const items = sample();
  const res = ItemEdit.removeItem(items, "b");
  assert.strictEqual(items.length, 4);
  assert.deepStrictEqual(res.items.map((i) => i.id), ["a", "c", "d"]);
  assert.strictEqual(res.removed.id, "b");
  assert.strictEqual(res.index, 1);
});

check("removeItem with unknown id is a no-op", function () {
  const res = ItemEdit.removeItem(sample(), "zzz");
  assert.strictEqual(res.removed, null);
  assert.strictEqual(res.items.length, 4);
});

check("restoreItem puts the item back at its original index", function () {
  const res = ItemEdit.removeItem(sample(), "b");
  const back = ItemEdit.restoreItem(res.items, res.removed, res.index);
  assert.deepStrictEqual(back.map((i) => i.id), ["a", "b", "c", "d"]);
  assert.deepStrictEqual(back[1], sample()[1]);
});

check("restoreItem does not duplicate when undo is pressed twice", function () {
  const res = ItemEdit.removeItem(sample(), "a");
  const once = ItemEdit.restoreItem(res.items, res.removed, res.index);
  const twice = ItemEdit.restoreItem(once, res.removed, res.index);
  assert.strictEqual(twice.length, 4);
});

check("restoreItem works after other items were added meanwhile", function () {
  const res = ItemEdit.removeItem(sample(), "d");
  const withNew = res.items.concat([{ id: "e", type: "place", nameZh: "新加的" }]);
  const back = ItemEdit.restoreItem(withNew, res.removed, res.index);
  assert.deepStrictEqual(back.map((i) => i.id), ["a", "b", "c", "d", "e"]);
});

check("带我去 legs reconnect neighbours after delete, and come back after undo", function () {
  const items = sample();
  assert.ok(pairs(items).indexOf("a>b") !== -1);
  assert.ok(pairs(items).indexOf("b>c") !== -1);
  const res = ItemEdit.removeItem(items, "b");
  const after = pairs(res.items);
  assert.ok(after.indexOf("a>c") !== -1, "a should now lead straight to c: " + after.join(","));
  assert.ok(after.every((p) => p.indexOf("b") === -1), "no leg should mention deleted b");
  const back = pairs(ItemEdit.restoreItem(res.items, res.removed, res.index));
  assert.deepStrictEqual(back, pairs(items));
});

check("map numbering shrinks after delete", function () {
  const res = ItemEdit.removeItem(sample(), "a");
  const rows = Legs.numberedList(res.items);
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[0].item.id, "b");
  assert.strictEqual(rows[0].n, 1);
});

check("clearItems empties the list and keeps a copy for undo", function () {
  const items = sample();
  const res = ItemEdit.clearItems(items);
  assert.strictEqual(res.items.length, 0);
  assert.strictEqual(res.removed.length, 4);
  assert.strictEqual(items.length, 4);
});

check("formFields prefills place / hotel / flight", function () {
  const s = sample();
  assert.deepStrictEqual(ItemEdit.formFields(s[1]).type, "地点/景点");
  assert.strictEqual(ItemEdit.formFields(s[1]).time, "11:00");
  const h = ItemEdit.formFields(s[3]);
  assert.strictEqual(h.type, "酒店");
  assert.strictEqual(h.date, "2026-12-05");
  assert.strictEqual(h.time, "15:00");
  const f = ItemEdit.formFields({ id: "f", type: "flight", flightNo: "XX100", departDate: "2026-12-05", departTime: "10:00", arriveDate: "2026-12-05", arriveTime: "12:00" });
  assert.strictEqual(f.type, "机票");
  assert.strictEqual(f.name, "XX100");
  assert.strictEqual(f.endTime, "12:00");
});

check("edit keeps id, coords and position when address is unchanged", function () {
  const items = sample();
  const form = Object.assign(ItemEdit.formFields(items[1]), { name: "示例美术馆", time: "12:30", note: "带水" });
  const res = ItemEdit.applyForm(items[1], form);
  assert.strictEqual(res.error, "");
  assert.strictEqual(res.addressChanged, false);
  assert.strictEqual(res.item.id, "b");
  assert.strictEqual(res.item.lat, 51.52);
  assert.strictEqual(res.item.nameZh, "示例美术馆");
  assert.strictEqual(res.item.time, "12:30");
  assert.strictEqual(res.item.note, "带水");
  const list = ItemEdit.updateItem(items, "b", res.item);
  assert.deepStrictEqual(list.map((i) => i.id), ["a", "b", "c", "d"]);
  assert.strictEqual(items[1].nameZh, "示例博物馆", "original untouched");
});

check("edit with a new address drops coords and flags re-geocode", function () {
  const items = sample();
  const form = Object.assign(ItemEdit.formFields(items[2]), { address: "Another Example Rd 9" });
  const res = ItemEdit.applyForm(items[2], form);
  assert.strictEqual(res.addressChanged, true);
  assert.strictEqual(res.item.address, "Another Example Rd 9");
  assert.strictEqual(res.item.lat, undefined);
  assert.strictEqual(res.item.lng, undefined);
  assert.strictEqual(res.item.id, "c");
});

check("edit with empty name is refused", function () {
  const res = ItemEdit.applyForm(sample()[0], { name: "  " });
  assert.ok(res.error);
});

check("edit hotel keeps confirmation number; place->hotel moves date to checkIn", function () {
  const s = sample();
  const h = ItemEdit.applyForm(s[3], Object.assign(ItemEdit.formFields(s[3]), { note: "x" }));
  assert.strictEqual(h.item.confirmationNo, "FAKE-000");
  const p = ItemEdit.applyForm(s[0], Object.assign(ItemEdit.formFields(s[0]), { type: "酒店" }));
  assert.strictEqual(p.item.type, "hotel");
  assert.strictEqual(p.item.checkIn, "2026-12-04");
  assert.strictEqual(p.item.date, undefined);
});

check("moving an item to another day re-sorts timeline and day groups", function () {
  const items = sample();
  const res = ItemEdit.applyForm(items[0], Object.assign(ItemEdit.formFields(items[0]), { date: "2026-12-05", time: "18:00" }));
  const list = ItemEdit.updateItem(items, "a", res.item);
  const groups = Legs.groupByDay(list);
  assert.deepStrictEqual(groups.map((g) => g.date), ["2026-12-04", "2026-12-05"]);
  assert.deepStrictEqual(groups[1].items.map((i) => i.id), ["d", "a"]);
  assert.ok(pairs(list).indexOf("d>a") !== -1);
});

check("flight edit shifts arrival date with departure date", function () {
  const f = { id: "f", type: "flight", flightNo: "XX100", departDate: "2026-12-05", departTime: "22:00", arriveDate: "2026-12-06", arriveTime: "06:00", lat: 1, lng: 2 };
  const res = ItemEdit.applyForm(f, Object.assign(ItemEdit.formFields(f), { date: "2026-12-07" }));
  assert.strictEqual(res.item.departDate, "2026-12-07");
  assert.strictEqual(res.item.arriveDate, "2026-12-08");
  assert.strictEqual(res.item.lat, 1);
});

check("UI wiring: help text, undo 10s, no 无法恢复, sw v14 caches item-edit.js", function () {
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  const sw = fs.readFileSync(__dirname + "/sw.js", "utf8");
  assert.ok(tl.indexOf("卡片右边的“删除”可以删掉这一项，点开卡片还能修改；列表右上角“清空全部”一次删光。删错了 10 秒内点底部的“撤销”就能恢复。") !== -1);
  assert.strictEqual(ItemEdit.UNDO_MS, 10000);
  assert.ok(tl.indexOf("删除后 10 秒内可以撤销。") !== -1);
  assert.ok(tl.indexOf("确定删除这一项吗？") !== -1);
  assert.ok(tl.indexOf("window.confirm") === -1);
  assert.ok((tl + html).indexOf("无法恢复") === -1);
  assert.ok(sw.indexOf('"xingcheng-map-shell-v14"') !== -1);
  assert.ok(sw.indexOf("./item-edit.js") !== -1);
  assert.ok(html.indexOf('src="./item-edit.js"') !== -1);
  assert.ok(html.indexOf('id="clear-all-btn"') !== -1);
});

check("清空本机数据 uses the in-app confirm; toast sits above the add bar", function () {
  const bk = fs.readFileSync(__dirname + "/backup.js", "utf8");
  const css = fs.readFileSync(__dirname + "/styles.css", "utf8");
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  assert.ok(bk.indexOf("TripApp.confirm") !== -1);
  assert.ok(bk.indexOf("确定清空本机全部数据吗？") !== -1);
  assert.ok(bk.indexOf("全部清空") !== -1);
  assert.ok(bk.indexOf("建议先备份（点“完整备份”导出文件）。") !== -1);
  assert.ok(/confirm:\s*openConfirm/.test(tl));
  assert.ok(css.indexOf("bottom: calc(78px + env(safe-area-inset-bottom, 0px));") !== -1);
});

if (failures) {
  console.log("\n" + failures + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll checks passed.");
