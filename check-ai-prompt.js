/**
 * v6.0：给 AI 的提示词必须覆盖导入器认的类型和分类，示例行能原样导入。
 * 用法：node check-ai-prompt.js
 * 这是对着提示词原文和导入器做的检查，不是拿真的外部 AI 跑出来的结果。
 */
"use strict";
const assert = require("assert");
const Imp = require("./import.js");
const Ai = require("./ai-prompt.js");
const Icons = require("./icons.js");
const T = require("./transport.js");
const fs = require("fs");
const path = require("path");

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

const P = Ai.TEXT;

check("prompt mentions every official type and alias the importer should see, plus the 6 place categories", function () {
  ["机票", "酒店", "火车", "高铁", "动车", "船", "轮渡", "大巴", "巴士", "地点"].forEach((w) => {
    assert.ok(P.indexOf(w) !== -1, "missing type " + w);
  });
  const cats = Icons.CATEGORIES.filter((c) => Icons.MANUAL_PICKER_KEYS.indexOf(c.key) !== -1).map((c) => c.label);
  assert.deepStrictEqual(cats, ["景点", "自然", "餐厅", "咖啡甜点酒吧", "购物", "其他"]);
  cats.forEach((w) => assert.ok(P.indexOf("地点/" + w) !== -1, "missing 地点/" + w));
  assert.strictEqual(T.groundKindFromWord("高铁"), "train");
  assert.strictEqual(T.groundKindFromWord("轮渡"), "boat");
  assert.strictEqual(T.groundKindFromWord("巴士"), "bus");
});

check("prompt tells the AI to use YYYY-MM-DD when unambiguous, leave 04/12 as-is, local times, 出发站 - 到达站, leave blanks, output only the block", function () {
  assert.ok(P.indexOf("YYYY-MM-DD") !== -1);
  assert.ok(P.indexOf("日月分不清的（如 04/12）按原样写，别自己换算") !== -1);
  assert.ok(P.indexOf("不要写成 4/12") === -1, "must not forbid writing 4/12");
  assert.ok(P.indexOf("当地时间") !== -1);
  assert.ok(P.indexOf("出发站 - 到达站") !== -1);
  assert.ok(P.indexOf("必须写入住和退房日期") !== -1);
  assert.ok(P.indexOf("不要猜") !== -1);
  assert.ok(P.indexOf("只输出这些行，放在一个代码块里，不要加任何解释") !== -1);
  assert.ok(P.indexOf("日期时间写“出发 ~ 到达”，用当地时间") !== -1);
  assert.ok(P.indexOf("火车 | G7 | 北京南 - 上海虹桥 | 2026-12-03 08:00 ~ 2026-12-03 12:28 |") !== -1);
  assert.ok(P.indexOf("看不到年份就只写月和日，如 12-03 或 12月3日，不要自己补年份") !== -1);
  assert.ok(P.indexOf("名称那一格只写店名或地名") !== -1);
  assert.ok(P.indexOf("地址 @纬度,经度") !== -1);
});

check("收藏 is hidden from the shipped prompt while the 收藏 page is off; full text is kept for when the flag turns on", function () {
  const Fav = require("./favorites.js");
  assert.strictEqual(Fav.pageShipped, false);
  assert.ok(P.indexOf("收藏") === -1, "shipped TEXT must not mention 收藏");
  assert.ok(Ai.EXAMPLE.indexOf("收藏/") === -1);
  assert.ok(Ai.TEXT_WITH_FAVORITES.indexOf("收藏/（后面接分类") !== -1);
});

const RULE10 = "10. 我可能一次发好几张截图，请全部整理在一起；攻略或帖子里有好几个地点的，按帖子里的顺序一站写一行，一个都不要漏；只有店名没有地址的，地址那一格留空";

check("rule 10 matches 旅行顾问 final wording in TEXT and TEXT_WITH_FAVORITES; handoff file is the favorites text", function () {
  assert.ok(Ai.TEXT.indexOf(RULE10) !== -1, "shipped TEXT rule 10");
  assert.ok(Ai.TEXT_SHIPPED.indexOf(RULE10) !== -1);
  assert.ok(Ai.TEXT_WITH_FAVORITES.indexOf(RULE10) !== -1);
  assert.ok(Ai.TEXT.indexOf("收藏") === -1);
  const refPath = path.join(__dirname, "..", "v61-handoff", "ai-prompt-v61.txt");
  if (!fs.existsSync(refPath)) {
    console.log("  skip  handoff file is not in this package; rule 10 still checked in TEXT / TEXT_WITH_FAVORITES");
    return;
  }
  const ref = fs.readFileSync(refPath, "utf8");
  assert.strictEqual(Ai.TEXT_WITH_FAVORITES, ref, "TEXT_WITH_FAVORITES must match the handoff file");
});


function assertClean(item, extra) {
  assert.ok(!item.pendingDate, (item.nameZh || item.flightNo || item.number || item.type) + " should not be 待补");
  if (extra) extra(item);
}

check("hand-written sample following the prompt (plain pipe): flight, hotel, train, boat, bus, restaurant, cafe-bar, undated place", function () {
  const text = [
    "机票 | BA321 | LHR - CDG | 2026-12-01 09:30 ~ 2026-12-01 11:50 | 座位 12A",
    "酒店 | Hotel Example | 1 Fake Street, Paris | 2026-12-01 ~ 2026-12-04 | 确认号 HX123",
    "火车 | G7 | 北京南 - 上海虹桥 | 2026-12-03 08:00 ~ 2026-12-03 12:28 |",
    "船 | | Dover - Calais | 2026-12-05 09:00 ~ 2026-12-05 11:30 |",
    "大巴 | X90 | Victoria Coach Station - Oxford | 2026-12-06 10:00 ~ 2026-12-06 12:00 |",
    "地点/餐厅 | Dishoom Covent Garden | 12 Upper St Martin's Ln, London WC2H 9FB | 2026-12-07 13:00 |",
    "地点/咖啡甜点酒吧 | 示例咖啡馆 | 3 Fake St, London | 2026-12-07 16:00 |",
    "地点 | 想去的书店 | 4 Fake St, London | |"
  ].join("\n");
  const r = Imp.parseImport(text);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.items.length, 8);
  const [fl, ho, tr, bo, bu, re, ca, un] = r.items;
  assert.strictEqual(fl.type, "flight");
  assert.deepStrictEqual([fl.flightNo, fl.fromAirport, fl.toAirport, fl.departDate, fl.departTime, fl.arriveDate, fl.arriveTime], ["BA321", "LHR", "CDG", "2026-12-01", "09:30", "2026-12-01", "11:50"]);
  assertClean(fl);
  assert.strictEqual(ho.type, "hotel");
  assert.deepStrictEqual([ho.nameZh, ho.checkIn, ho.checkOut], ["Hotel Example", "2026-12-01", "2026-12-04"]);
  assertClean(ho);
  assert.strictEqual(tr.type, "train");
  assert.deepStrictEqual([tr.number, tr.fromNameZh, tr.nameZh, tr.departDate, tr.departTime, tr.arriveDate, tr.arriveTime], ["G7", "北京南", "上海虹桥", "2026-12-03", "08:00", "2026-12-03", "12:28"]);
  assertClean(tr);
  assert.strictEqual(bo.type, "boat");
  assert.deepStrictEqual([bo.fromNameZh, bo.nameZh, bo.departDate, bo.departTime, bo.arriveTime], ["Dover", "Calais", "2026-12-05", "09:00", "11:30"]);
  assertClean(bo);
  assert.strictEqual(bu.type, "bus");
  assert.deepStrictEqual([bu.number, bu.fromNameZh, bu.nameZh, bu.departDate, bu.departTime, bu.arriveTime], ["X90", "Victoria Coach Station", "Oxford", "2026-12-06", "10:00", "12:00"]);
  assertClean(bu);
  assert.strictEqual(re.type, "place");
  assert.strictEqual(re.subtype, "餐厅");
  assert.deepStrictEqual([re.nameZh, re.date, re.time], ["Dishoom Covent Garden", "2026-12-07", "13:00"]);
  assertClean(re);
  assert.strictEqual(ca.type, "place");
  assert.strictEqual(ca.subtype, "咖啡甜点酒吧");
  assert.deepStrictEqual([ca.nameZh, ca.date, ca.time], ["示例咖啡馆", "2026-12-07", "16:00"]);
  assertClean(ca);
  assert.strictEqual(un.type, "place");
  assert.strictEqual(un.nameZh, "想去的书店");
  assert.ok(!un.date, "intentionally undated");
  assert.ok(!un.pendingDate, "empty date is not 待补");
  assert.strictEqual(r.items.filter((it) => it.pendingDate).length, 0);
});

check("a fenced sample (as if pasted from an AI) and a 高铁/巴士 synonym sample also import cleanly", function () {
  const fenced = "好的，整理如下：\n```\n" + Ai.EXAMPLE + "```\n";
  const a = Imp.parseImport(fenced);
  assert.deepStrictEqual(a.errors, []);
  assert.deepStrictEqual(a.items.map((x) => x.type), ["flight", "hotel", "train", "place", "place"]);
  a.items.forEach((it) => assert.ok(!it.pendingDate));
  const senso = a.items[4];
  assert.strictEqual(senso.subtype, "景点");
  assert.strictEqual(senso.nameZh, "浅草寺");
  assert.strictEqual(senso.address, "东京都台东区浅草2-3-1");
  assert.ok(!senso.date, "浅草寺 is undated");
  assert.ok(!senso.pendingDate, "empty date is not 待补");
  assert.strictEqual(senso.note, "早上人少");

  const syn = [
    "高铁 | G7 | 北京南 - 上海虹桥 | 2026-12-03 08:00 ~ 2026-12-03 12:28 |",
    "轮渡 | | Dover - Calais | 2026-12-05 09:00 ~ 2026-12-05 11:30 |",
    "巴士 | X90 | Victoria Coach Station - Oxford | 2026-12-06 10:00 ~ 2026-12-06 12:00 |"
  ].join("\n");
  const b = Imp.parseImport(syn);
  assert.deepStrictEqual(b.errors, []);
  assert.deepStrictEqual(b.items.map((x) => x.type), ["train", "boat", "bus"]);
  b.items.forEach((it) => assert.ok(!it.pendingDate));
});

check("blind AI output fixture: seat/confirmation values stop at ； and confirmation labels include 预订号/取票号", function () {
  /* Exact text of /workspace/ai-accept/ai-output-blind.txt (a fresh AI given only the 4 PNGs + prompt.txt). */
  const fixture = "```\n机票 | EA321 | LHR - CDG | 2026-12-03 09:30 ~ 2026-12-03 11:50 | 座位 12A；预订号 ABC12D；票号 0000 1111 2222\n机票 | EA322 | CDG - LHR | 2026-12-08 18:00 ~ 2026-12-08 18:20 | 座位 12A；预订号 ABC12D；票号 0000 1111 2222\n酒店 | The Sample Strand Hotel | 1 Fake Street, Strand, London WC2R 0AA | 2026-12-03 ~ 2026-12-06 | 确认号 HX998877；1间 大床房；15:00后入住，12:00前退房\n火车 | G7 | 北京南 - 上海虹桥 | 2026-12-03 08:00 ~ 2026-12-03 12:28 | 座位 05车12A；取票号 E123456789\n大巴 | X90 | Victoria Coach Station - Oxford | 2026-12-04 10:00 ~ 2026-12-04 12:00 | 预订号 BUS4455\n地点/餐厅 | The Example Kitchen | 12 Upper Fake Lane, London WC2H 9FB | 2026-12-05 19:00 | 2位；预订号 RK-7788\n```\n";
  const r = Imp.parseImport(fixture);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.items.length, 6);
  r.items.forEach((it) => assert.ok(!it.pendingDate, it.type + " should not be 待补"));
  assert.deepStrictEqual(r.items.map((x) => x.type), ["flight", "flight", "hotel", "train", "bus", "place"]);
  const [f1, f2, hotel, train, bus, place] = r.items;
  assert.deepStrictEqual([f1.seat, f1.confirmationNo, f1.note], ["12A", "ABC12D", "票号 0000 1111 2222"]);
  assert.deepStrictEqual([f2.seat, f2.confirmationNo, f2.note], ["12A", "ABC12D", "票号 0000 1111 2222"]);
  assert.strictEqual(f1.flightNo, "EA321");
  assert.strictEqual(f1.departDate, "2026-12-03");
  assert.strictEqual(f1.departTime, "09:30");
  assert.strictEqual(f1.arriveTime, "11:50");
  assert.deepStrictEqual([hotel.confirmationNo, hotel.note], ["HX998877", "1间 大床房；15:00后入住，12:00前退房"]);
  assert.deepStrictEqual([train.seat, train.confirmationNo, train.note || ""], ["05车12A", "E123456789", ""]);
  assert.deepStrictEqual([bus.confirmationNo, bus.note || ""], ["BUS4455", ""]);
  assert.strictEqual(place.note, "2位；预订号 RK-7788");
  assert.ok(!(place.confirmationNo), "place keeps 预订号 in the note");
});


check("parser: trailing @lat,lng is split off; month/day-only dates get a year; 收藏/xxx is recognised even when the page is off", function () {
  const withHint = Imp.parseImport("地点/餐厅 | Example Cafe | 12 Example St, London EC1A 1BB, UK @51.5203,-0.1355 | 2026-12-05 13:00 |");
  assert.deepStrictEqual(withHint.errors, []);
  assert.strictEqual(withHint.items.length, 1);
  assert.strictEqual(withHint.items[0].address, "12 Example St, London EC1A 1BB, UK");
  assert.ok(Math.abs(withHint.items[0].hintLat - 51.5203) < 1e-6);
  assert.ok(Math.abs(withHint.items[0].hintLng - (-0.1355)) < 1e-6);
  assert.ok(withHint.items[0].lat == null, "trailing @ is a hint, not a confirmed pin");

  const yearless = Imp.parseImport("地点 | Example Park | 1 Fake Rd, London | 12-03 15:00 |\n地点 | 示例公园 | 北京市东城区 | 12月3日 |", { today: "2026-11-16" });
  assert.deepStrictEqual(yearless.errors, []);
  assert.ok(yearless.items.length >= 2, String(yearless.items.length));
  yearless.items.forEach((it) => {
    assert.ok(/^202[6-7]-12-03$/.test(it.date || ""), "year filled for " + (it.nameZh) + " got " + it.date);
    assert.ok(!it.pendingDate, it.nameZh + " should not be 待补");
  });

  const fav = Imp.parseImport("收藏/餐厅 | Monmouth Coffee | 2 Park St, London SE1 9AB, UK |  | 朋友推荐");
  assert.deepStrictEqual(fav.errors, []);
  assert.strictEqual(fav.items.length, 1);
  assert.strictEqual(fav.items[0].type, "place");
  assert.strictEqual(fav.items[0].subtype, "餐厅");
  assert.ok(!fav.items[0].favorite, "收藏 page is off: imported as a regular place, not a hidden favorite");
  assert.ok(!fav.items[0].date);
});

console.log("\n" + failures + " failed");
if (failures) process.exit(1);
console.log("All AI prompt checks passed. (Not a test against a real external AI.)");
