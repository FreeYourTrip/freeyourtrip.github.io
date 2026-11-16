/**
 * 「日期待确认」校验：导入不丢行、修改后清除标记、日期条忽略无日期条目、分享 / 备份保留。用法：node check-pending.js
 * 假数据，无真实个人信息。
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const ImportUtil = require("./import.js");
const ItemEdit = require("./item-edit.js");
const C = require("./calendar.js");
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

const TEXT = [
  "地点/景点 | 示例博物馆 | Example St 1 | 2026/12/11 9:00 |",
  "地点/餐厅 | 示例餐厅 | Example St 2 | 2026-12-11 25:00 | 窗边",
  "酒店 | 示例酒店 | Example St 3 | 2026/12/11 ~ 2026/12/13 |",
  "机票 | XX100 | LHR - CDG | 乱写 | 座位 12A"
].join("\n");

function imported() {
  return ImportUtil.parseImport(TEXT).items;
}

check("import keeps every row; 2 pending with raw text", function () {
  const items = imported();
  assert.strictEqual(items.length, 4);
  const pend = items.filter(ItemEdit.isPendingDate);
  assert.deepStrictEqual(pend.map((i) => i.dateRaw), ["2026-12-11 25:00", "乱写"]);
});

check("edit prefills the parseable date; saving a valid date clears 待确认", function () {
  const it = imported()[1];
  const f = ItemEdit.formFields(it);
  assert.strictEqual(f.date, "2026-12-11");
  assert.strictEqual(f.time, "");
  const res = ItemEdit.applyForm(it, Object.assign(f, { time: "19:00" }));
  assert.strictEqual(res.item.pendingDate, undefined);
  assert.strictEqual(res.item.dateRaw, undefined);
  assert.strictEqual(res.item.dateGuess, undefined);
  assert.strictEqual(res.item.date, "2026-12-11");
  assert.strictEqual(res.item.time, "19:00");
  assert.strictEqual(res.item.note, "窗边");
});

check("saving without a date keeps the flag", function () {
  const it = imported()[3];
  const res = ItemEdit.applyForm(it, Object.assign(ItemEdit.formFields(it), { date: "" }));
  assert.strictEqual(res.item.pendingDate, true);
  const fixed = ItemEdit.applyForm(it, Object.assign(ItemEdit.formFields(it), { date: "2026-12-12", time: "08:00", endDate: "2026-12-12", endTime: "10:20" }));
  assert.strictEqual(fixed.item.pendingDate, undefined);
  assert.strictEqual(fixed.item.departDate, "2026-12-12");
});

check("calendar ignores undated / pending items safely", function () {
  const items = imported().concat([{ id: "h0", type: "hotel", nameZh: "无日期酒店", checkIn: "", pendingDate: true }]);
  const days = C.stripDays(items, "2026-11-16");
  assert.ok(days.indexOf("") === -1);
  assert.strictEqual(days[days.length - 1], "2026-12-13");
  assert.strictEqual(C.defaultDay(items, "2026-12-11"), "2026-12-11");
  assert.ok(!("" in C.dotsByDay(items)));
  assert.strictEqual(C.deriveSegments(items, "2026-11-16").length, 1);
  assert.strictEqual(C.defaultDay(items.filter(ItemEdit.isPendingDate), "2026-12-11"), "all");
});

check("legs built from dated items only do not mention pending ones", function () {
  const items = imported();
  const dated = items.filter((i) => !ItemEdit.isPendingDate(i));
  const ids = Legs.buildConnectors(dated).map((c) => c.fromItemId + ">" + c.toItemId).join(",");
  items.filter(ItemEdit.isPendingDate).forEach((p) => assert.ok(ids.indexOf(p.id) === -1));
});

check("share export keeps pending items and their raw text (strips only seat / confirmation as before)", function () {
  global.window = undefined;
  const Backup = require("./backup.js");
  const out = Backup.redactForShare({ trips: [{ id: "t", items: imported() }] });
  const items = out.trips[0].items;
  assert.strictEqual(items.length, 4);
  const f = items[3];
  assert.strictEqual(f.pendingDate, true);
  assert.strictEqual(f.dateRaw, "乱写");
  assert.ok(!f.seat, "seat still stripped for share");
});

check("UI wiring: 待确认日期 group, banner, colours, raw text, toast wording", function () {
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  const css = fs.readFileSync(__dirname + "/styles.css", "utf8");
  assert.ok(tl.indexOf("<span>待确认日期</span>") !== -1);
  assert.ok(tl.indexOf('"<span>有 " + pending.length + " 条日期待确认</span>') !== -1);
  assert.ok(tl.indexOf("这个时间看不懂：") !== -1);
  assert.ok(tl.indexOf('"，" + pendingN + " 条日期待确认"') !== -1);
  assert.ok(tl.indexOf('if (card.classList.contains("is-pending")) enterEditMode(') !== -1);
  assert.ok(/\.card\.is-pending \{ background: #FFF4CC;/.test(css) && css.indexOf("#F2B705") !== -1);
});

check("reversed hotel (checkout before check-in) -> 待确认, row kept, raw text kept", function () {
  const r = ImportUtil.parseImport("酒店 | 示例酒店 | Example St 3 | 2026/12/07 ~ 2026/12/04 | 确认号 FAKE-2");
  assert.deepStrictEqual(r.errors, []);
  const h = r.items[0];
  assert.strictEqual(h.pendingDate, true);
  assert.strictEqual(h.pendingKind, "hotel-reversed");
  assert.strictEqual(h.dateRaw, "2026/12/07 ~ 2026/12/04");
  assert.strictEqual(h.pendingFrom, "2026-12-07");
  assert.strictEqual(h.pendingTo, "2026-12-04");
  assert.strictEqual(h.checkIn, "");
  assert.strictEqual(h.confirmationNo, "FAKE-2");
  assert.deepStrictEqual(C.stripDays([h], "2026-11-16"), [], "calendar ignores it");
});

check("flight with landing date earlier than departure is always 待确认 (v5.4, including date-line -1 day)", function () {
  const r = ImportUtil.parseImport([
    "机票 | XX201 | HND - LAX | 2026-12-10 17:00 ~ 2026-12-09 10:30 |",
    "机票 | XX202 | HND - LAX | 2026-12-10 17:00 ~ 2026-12-08 10:30 |",
    "机票 | XX203 | HND - LAX | 2026-12-10 17:00 ~ 2026-12-07 10:30 |",
    "机票 | XX204 | LHR - CDG | 2026-12-10 17:00 ~ 2026-12-10 19:00 |"
  ].join("\n"));
  assert.deepStrictEqual(r.errors, []);
  const [a, b, c, d] = r.items;
  assert.strictEqual(a.pendingDate, true, "-1 day flagged");
  assert.strictEqual(a.pendingKind, "flight-reversed");
  assert.strictEqual(a.pendingFrom, "2026-12-10");
  assert.strictEqual(a.pendingTo, "2026-12-09");
  assert.strictEqual(a.departDate, "", "dates cleared until confirmed");
  assert.strictEqual(b.pendingKind, "flight-reversed");
  assert.strictEqual(c.pendingKind, "flight-reversed");
  assert.strictEqual(c.dateRaw, "2026-12-10 17:00 ~ 2026-12-07 10:30");
  assert.strictEqual(c.departTime, "17:00", "times kept for the edit form");
  assert.ok(!d.pendingDate, "same-day arrival is fine");
  assert.strictEqual(d.arriveDate, "2026-12-10");
});

check("editing a reversed item: still reversed keeps the flag; fixed clears it", function () {
  const h = ImportUtil.parseImport("酒店 | 示例酒店 | x | 2026-12-07 ~ 2026-12-04 |").items[0];
  const f = ItemEdit.formFields(h);
  assert.strictEqual(f.date, "2026-12-07");
  assert.strictEqual(f.endDate, "2026-12-04");
  const still = ItemEdit.applyForm(h, Object.assign({}, f)).item;
  assert.strictEqual(still.pendingDate, true);
  assert.strictEqual(still.checkIn, "");
  const fixed = ItemEdit.applyForm(h, Object.assign({}, f, { endDate: "2026-12-09" })).item;
  assert.strictEqual(fixed.pendingDate, undefined);
  assert.strictEqual(fixed.pendingKind, undefined);
  assert.strictEqual(fixed.checkIn, "2026-12-07");
  assert.strictEqual(fixed.checkOut, "2026-12-09");
  const fl = ImportUtil.parseImport("机票 | XX203 | HND - LAX | 2026-12-10 17:00 ~ 2026-12-07 10:30 |").items[0];
  const stillEarly = ItemEdit.applyForm(fl, Object.assign(ItemEdit.formFields(fl), { endDate: "2026-12-09" })).item;
  assert.strictEqual(stillEarly.pendingDate, true, "v5.4: still-early after edit stays 待确认");
  const okFl = ItemEdit.applyForm(fl, Object.assign(ItemEdit.formFields(fl), { endDate: "2026-12-10" })).item;
  assert.strictEqual(okFl.pendingDate, undefined, "same-day arrival clears 待确认");
  assert.strictEqual(okFl.arriveDate, "2026-12-10");
  const accepted = ItemEdit.acceptEarlyArrival(fl);
  assert.ok(!accepted.pendingDate && accepted.arriveEarlyOk);
  assert.strictEqual(accepted.departDate, "2026-12-10");
  assert.strictEqual(accepted.arriveDate, "2026-12-07");
  assert.strictEqual(ItemEdit.rangeProblem(accepted), "", "对的 keeps the early arrival");
});

check("card wording for reversed items is plain language", function () {
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  assert.ok(tl.indexOf('"退房比入住还早：" + mmdd(item.pendingFrom) + " ~ " + mmdd(item.pendingTo) + "，点我改一下"') !== -1);
  assert.ok(tl.indexOf("落地比起飞早，日期对吗？") !== -1);
  assert.ok(tl.indexOf(">对的<") !== -1 && tl.indexOf(">改日期<") !== -1);
  assert.ok(tl.indexOf('"这个时间看不懂：" + item.dateRaw + "，点我改一下"') !== -1);
});

if (failures) {
  console.log("\n" + failures + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll checks passed.");
