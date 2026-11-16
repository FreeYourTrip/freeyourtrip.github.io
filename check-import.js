/**
 * 导入解析校验。用法：node check-import.js
 */
"use strict";

const assert = require("assert");
const ImportUtil = require("./import.js");

const PIPE_THREE = [
  "地点 | 大英博物馆 | Great Russell St, London WC1B 3DG | 2026-12-05 10:00 | 免费，建议预约",
  "酒店 | The Savoy | Strand, London WC2R 0EZ | 2026-12-04 ~ 2026-12-07 | 确认号 ABC123",
  "机票 | BA123 | LHR - HND | 2026-12-01 09:30 ~ 2026-12-02 07:00 | 座位 32A"
].join("\n");

const DISHOOM_JSON = JSON.stringify(
  [
    {
      类型: "地点/餐厅",
      名称: "Dishoom",
      地址: "12 Upper St. Martin's Lane, London WC2H 9FB",
      日期时间: "2026-12-05 19:00",
      备注: "建议提前预约"
    }
  ],
  null,
  2
);

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

check("auto-detects pipe vs JSON", function () {
  assert.strictEqual(ImportUtil.looksLikeJson(DISHOOM_JSON), true);
  assert.strictEqual(ImportUtil.looksLikeJson(PIPE_THREE), false);
  assert.strictEqual(ImportUtil.parseImport(PIPE_THREE).format, "pipe");
  assert.strictEqual(ImportUtil.parseImport(DISHOOM_JSON).format, "json");
});

check("three official pipe lines", function () {
  const r = ImportUtil.parseImport(PIPE_THREE);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.items.length, 3);
  const place = r.items[0];
  const hotel = r.items[1];
  const flight = r.items[2];
  assert.strictEqual(place.type, "place");
  assert.strictEqual(place.nameZh, "大英博物馆");
  assert.strictEqual(place.address, "Great Russell St, London WC1B 3DG");
  assert.strictEqual(place.date, "2026-12-05");
  assert.strictEqual(place.time, "10:00");
  assert.strictEqual(place.note, "免费，建议预约");

  assert.strictEqual(hotel.type, "hotel");
  assert.strictEqual(hotel.nameEn, "The Savoy");
  assert.strictEqual(hotel.address, "Strand, London WC2R 0EZ");
  assert.strictEqual(hotel.checkIn, "2026-12-04");
  assert.strictEqual(hotel.checkOut, "2026-12-07");
  assert.strictEqual(hotel.confirmationNo, "ABC123");
  assert.strictEqual(hotel.note, "");

  assert.strictEqual(flight.type, "flight");
  assert.strictEqual(flight.flightNo, "BA123");
  assert.strictEqual(flight.fromAirport, "LHR");
  assert.strictEqual(flight.toAirport, "HND");
  assert.strictEqual(flight.departDate, "2026-12-01");
  assert.strictEqual(flight.departTime, "09:30");
  assert.strictEqual(flight.arriveDate, "2026-12-02");
  assert.strictEqual(flight.arriveTime, "07:00");
  assert.strictEqual(flight.seat, "32A");
  /* 当地墙钟：跨日差 +1，不经过浏览器时区 */
  const offsetDays = Math.round(
    (Date.UTC(2026, 11, 2) - Date.UTC(2026, 11, 1)) / 86400000
  );
  assert.strictEqual(offsetDays, 1);
});

check("accepts full-width pipes, header row, and empty cells", function () {
  const text = [
    "类型 | 名称 | 地址 | 日期时间 | 备注",
    "地点｜无名处｜｜｜",
    "地点 | 保留空列 |  | 2026-12-08 | "
  ].join("\n");
  const r = ImportUtil.parseImport(text);
  assert.deepStrictEqual(r.errors, [], r.errors.join("; "));
  assert.strictEqual(r.items.length, 2);
  assert.strictEqual(r.items[0].nameZh, "无名处");
  assert.strictEqual(r.items[0].address, "");
  assert.strictEqual(r.items[0].date, "");
  assert.strictEqual(r.items[1].date, "2026-12-08");
});

check("malformed lines report Chinese line numbers and still import good ones", function () {
  const text = [
    "地点 | 大英博物馆 | Great Russell St, London WC1B 3DG | 2026-12-05 10:00 | 免费，建议预约",
    "火车 | 欧洲之星 | 圣潘克拉斯 | 2026-12-06 | 这不是支持的类型",
    "机票 | BA123 | LONDON - TOKYO | 2026-12-01 09:30 ~ 2026-12-02 07:00 | 座位 32A",
    "酒店 | The Savoy | Strand, London WC2R 0EZ | 2026-12-04 ~ 2026-12-07 | 确认号 ABC123",
    "机票 | BA999 | LHR - NRT"
  ].join("\n");
  const r = ImportUtil.parseImport(text);
  assert.strictEqual(r.items.length, 2, "should keep museum + hotel");
  assert.strictEqual(r.items[0].nameZh, "大英博物馆");
  assert.strictEqual(r.items[1].nameEn, "The Savoy");
  assert.strictEqual(r.errors.length, 3);
  assert.ok(r.errors[0].indexOf("第 2 行") !== -1, r.errors[0]);
  assert.ok(r.errors[0].indexOf("火车") !== -1, r.errors[0]);
  assert.ok(r.errors[1].indexOf("第 3 行") !== -1, r.errors[1]);
  assert.ok(/IATA|机场/.test(r.errors[1]), r.errors[1]);
  assert.ok(r.errors[2].indexOf("第 5 行") !== -1, r.errors[2]);
  assert.ok(r.errors[2].indexOf("5 列") !== -1, r.errors[2]);
});

check("Dishoom JSON (Chinese keys, legacy)", function () {
  const r = ImportUtil.parseImport(DISHOOM_JSON);
  assert.deepStrictEqual(r.errors, [], r.errors.join("; "));
  assert.strictEqual(r.items.length, 1);
  const d = r.items[0];
  assert.strictEqual(d.type, "place");
  assert.strictEqual(d.subtype, "餐厅");
  assert.strictEqual(d.nameEn, "Dishoom");
  assert.strictEqual(d.address, "12 Upper St. Martin's Lane, London WC2H 9FB");
  assert.strictEqual(d.date, "2026-12-05");
  assert.strictEqual(d.time, "19:00");
  assert.strictEqual(d.note, "建议提前预约");
});

const DISHOOM_EN = JSON.stringify([
  {
    type: "place",
    name: "Dishoom Covent Garden",
    address: "12 Upper St Martin's Ln, London WC2H 9FB",
    date: "2026-12-05",
    note: "印度早餐，建议早去排队"
  }
]);

check("Dishoom JSON (agreed English fields)", function () {
  const r = ImportUtil.parseImport(DISHOOM_EN);
  assert.deepStrictEqual(r.errors, [], r.errors.join("; "));
  assert.strictEqual(r.items.length, 1);
  const d = r.items[0];
  assert.strictEqual(d.type, "place");
  assert.strictEqual(d.nameEn, "Dishoom Covent Garden");
  assert.strictEqual(d.address, "12 Upper St Martin's Ln, London WC2H 9FB");
  assert.strictEqual(d.date, "2026-12-05");
  assert.strictEqual(d.note, "印度早餐，建议早去排队");
});

check("English flight/hotel schema", function () {
  const r = ImportUtil.parseImport(JSON.stringify([
    { type: "flight", flight_no: "BA123", from: "LHR", to: "HND", depart: "2026-12-01 09:30", arrive: "2026-12-02 07:00", seat: "32A" },
    { type: "hotel", name: "The Savoy", address: "Strand, London WC2R 0EZ", check_in: "2026-12-04", check_out: "2026-12-07", confirmation: "ABC123" }
  ]));
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.items[0].flightNo, "BA123");
  assert.strictEqual(r.items[0].fromAirport, "LHR");
  assert.strictEqual(r.items[0].toAirport, "HND");
  assert.strictEqual(r.items[0].departDate, "2026-12-01");
  assert.strictEqual(r.items[0].arriveTime, "07:00");
  assert.strictEqual(r.items[0].seat, "32A");
  assert.strictEqual(r.items[1].checkIn, "2026-12-04");
  assert.strictEqual(r.items[1].checkOut, "2026-12-07");
  assert.strictEqual(r.items[1].confirmationNo, "ABC123");
});

check("mixed pipe lines + Dishoom JSON in one box", function () {
  const r = ImportUtil.parseImport(PIPE_THREE + "\n" + DISHOOM_EN);
  assert.strictEqual(r.format, "mixed");
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.items.length, 4);
  assert.ok(r.items.some((i) => i.nameZh === "大英博物馆"));
  assert.ok(r.items.some((i) => i.flightNo === "BA123"));
  assert.ok(r.items.some((i) => (i.nameEn || "") === "Dishoom Covent Garden"));
});

check("JSON one bad record still imports the good one and names the index", function () {
  const text = JSON.stringify([
    { 类型: "地点/餐厅", 名称: "Dishoom", 地址: "12 Upper St. Martin's Lane, London WC2H 9FB", 日期时间: "2026-12-05 19:00", 备注: "建议提前预约" },
    { 类型: "机票", 名称: "BA1", 地址: "LHR", 日期时间: "不是日期", 备注: "" }
  ]);
  const r = ImportUtil.parseImport(text);
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.items[0].nameEn, "Dishoom");
  assert.strictEqual(r.errors.length, 1);
  assert.ok(r.errors[0].indexOf("第 2 条") !== -1, r.errors[0]);
});

check("invalid JSON reports a Chinese parse error", function () {
  const r = ImportUtil.parseImport("{ not json");
  assert.strictEqual(r.items.length, 0);
  assert.strictEqual(r.format, "json");
  assert.ok(r.errors[0].indexOf("JSON 无法解析") !== -1, r.errors[0]);
});

check("parses coords from a Google Maps link in 地址", function () {
  const text =
    "地点 | 测试点 | https://www.google.com/maps/@51.519413,-0.126956,17z | 2026-12-05 10:00 | ";
  const r = ImportUtil.parseImport(text);
  assert.deepStrictEqual(r.errors, []);
  assert.ok(Math.abs(r.items[0].lat - 51.519413) < 1e-6);
  assert.ok(Math.abs(r.items[0].lng - -0.126956) < 1e-6);
});

check("empty input error is in Chinese", function () {
  const r = ImportUtil.parseImport("   \n  ");
  assert.strictEqual(r.items.length, 0);
  assert.ok(/没有可导入/.test(r.errors[0]));
});

const AiPrompt = require("./ai-prompt.js");

check("team prompt example block parses into correct items", function () {
  const r = ImportUtil.parseImport(AiPrompt.EXAMPLE);
  assert.deepStrictEqual(r.errors, [], (r.errors || []).join("; "));
  assert.strictEqual(r.items.length, 5);

  const flight = r.items[0];
  assert.strictEqual(flight.type, "flight");
  assert.strictEqual(flight.flightNo, "BA123");
  assert.strictEqual(flight.fromAirport, "LHR");
  assert.strictEqual(flight.toAirport, "HND");
  assert.strictEqual(flight.departDate, "2026-12-01");
  assert.strictEqual(flight.departTime, "09:30");
  assert.strictEqual(flight.arriveDate, "2026-12-02");
  assert.strictEqual(flight.arriveTime, "07:00");
  assert.strictEqual(flight.seat, "32A");
  assert.strictEqual(flight.confirmationNo || "", "");

  const hotel = r.items[1];
  assert.strictEqual(hotel.type, "hotel");
  assert.strictEqual(hotel.nameZh, "某某酒店");
  assert.strictEqual(hotel.address, "酒店地址");
  assert.strictEqual(hotel.checkIn, "2026-12-04");
  assert.strictEqual(hotel.checkOut, "2026-12-07");
  assert.strictEqual(hotel.checkInTime || "", "");
  assert.strictEqual(hotel.checkOutTime || "", "");
  assert.strictEqual(hotel.confirmationNo, "ABC123");

  const train = r.items[2];
  assert.strictEqual(train.type, "train");
  assert.strictEqual(train.number, "G7");
  assert.strictEqual(train.fromNameZh, "北京南");
  assert.strictEqual(train.nameZh, "上海虹桥");
  assert.strictEqual(train.departDate, "2026-12-03");
  assert.strictEqual(train.departTime, "08:00");
  assert.strictEqual(train.arriveDate, "2026-12-03");
  assert.strictEqual(train.arriveTime, "12:28");

  const place = r.items[3];
  assert.strictEqual(place.type, "place");
  assert.strictEqual(place.subtype, "餐厅");
  assert.strictEqual(place.nameEn, "Dishoom Covent Garden");
  assert.strictEqual(place.address, "12 Upper St Martin's Ln, London WC2H 9FB");
  assert.strictEqual(place.date, "2026-12-05");
  assert.strictEqual(place.time, "13:00");
  assert.strictEqual(place.note, "排队的人多");

  const senso = r.items[4];
  assert.strictEqual(senso.type, "place");
  assert.strictEqual(senso.subtype, "景点");
  assert.strictEqual(senso.nameZh, "浅草寺");
  assert.strictEqual(senso.address, "东京都台东区浅草2-3-1");
  assert.ok(!senso.date, "intentionally undated");
  assert.ok(!senso.time);
  assert.strictEqual(senso.note, "早上人少");
  assert.ok(!senso.pendingDate, "empty date is not 待补");
});

check("prompt example inside code fences with leading text still imports", function () {
  const wrapped =
    "好的，这是整理结果：\n\n```\n\n" +
    AiPrompt.EXAMPLE +
    "\n```\n\n祝旅途愉快！\n";
  const r = ImportUtil.parseImport(wrapped);
  assert.strictEqual(r.items.length, 5, "items: " + r.items.length + " errors: " + (r.errors || []).join("; "));
  assert.deepStrictEqual(r.errors, [], (r.errors || []).join("; "));
  assert.strictEqual(r.items[0].flightNo, "BA123");
  assert.strictEqual(r.items[0].seat, "32A");
  assert.strictEqual(r.items[1].confirmationNo, "ABC123");
  assert.strictEqual(r.items[1].checkIn, "2026-12-04");
  assert.strictEqual(r.items[2].number, "G7");
  assert.strictEqual(r.items[3].subtype, "餐厅");
  assert.strictEqual(r.items[4].nameZh, "浅草寺");
  assert.ok(!r.items[4].date && !r.items[4].pendingDate);
  assert.ok((r.notes || []).length >= 1, "should gently note skipped explanation lines");
  assert.ok(r.notes.every(function (n) { return /跳过/.test(n); }));
});

check("leading bullets and full-width pipes parse", function () {
  const text = [
    "- 地点｜无名处｜｜｜",
    "* 地点 | 保留空列 |  | 2026-12-08 | "
  ].join("\n");
  const r = ImportUtil.parseImport(text);
  assert.deepStrictEqual(r.errors, [], (r.errors || []).join("; "));
  assert.strictEqual(r.items.length, 2);
  assert.strictEqual(r.items[0].nameZh, "无名处");
  assert.strictEqual(r.items[0].address, "");
  assert.strictEqual(r.items[1].date, "2026-12-08");
});

check("date tolerance: 2026/12/11, 2026.12.11, 2026年12月11日, full-width digits -> YYYY-MM-DD", function () {
  const N = ImportUtil.normalizeDateTime;
  assert.strictEqual(N("2026/12/11"), "2026-12-11");
  assert.strictEqual(N("2026.12.11"), "2026-12-11");
  assert.strictEqual(N("2026年12月11日"), "2026-12-11");
  assert.strictEqual(N("2026-1-5"), "2026-01-05");
  assert.strictEqual(N("２０２６／１２／１１"), "2026-12-11");
  assert.strictEqual(N("2026-12-11T09:00"), "2026-12-11 09:00");
});

check("time tolerance: 9:00, 9点, 9点半, 9:00 AM/PM, 12am, 下午3点, full-width colon", function () {
  const N = ImportUtil.normalizeDateTime;
  assert.strictEqual(N("2026/12/11 9:00"), "2026-12-11 09:00");
  assert.strictEqual(N("2026/12/11 9点"), "2026-12-11 09:00");
  assert.strictEqual(N("2026/12/11 9点半"), "2026-12-11 09:30");
  assert.strictEqual(N("2026/12/11 9:00 AM"), "2026-12-11 09:00");
  assert.strictEqual(N("2026/12/11 9:00 PM"), "2026-12-11 21:00");
  assert.strictEqual(N("2026/12/11 12:15 am"), "2026-12-11 00:15");
  assert.strictEqual(N("2026/12/11 9pm"), "2026-12-11 21:00");
  assert.strictEqual(N("2026/12/11 下午3点"), "2026-12-11 15:00");
  assert.strictEqual(N("2026年12月11日 ９：３０"), "2026-12-11 09:30");
  assert.strictEqual(N("2026-12-11 25:00"), "2026-12-11 25:00", "impossible time left alone -> still an error later");
});

check("pipe rows with loose dates/times are imported, not dropped", function () {
  const text = [
    "类型 | 名称 | 地址 | 日期时间 | 备注",
    "地点 | 示例咖啡馆 | Example St 1 | 2026/12/11 9:00 |",
    "地点/景点 | 示例博物馆 | Example St 2 | 2026年12月12日 下午2点 |",
    "酒店 | 示例酒店 | Example St 3 | 2026.12.11 ~ 2026.12.13 |",
    "机票 | XX100 | LHR - CDG | 2026/12/13 9:00 AM ～ 2026/12/13 11:30 AM |"
  ].join("\n");
  const r = ImportUtil.parseImport(text);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.items.length, 4);
  assert.strictEqual(r.items[0].date, "2026-12-11");
  assert.strictEqual(r.items[0].time, "09:00");
  assert.strictEqual(r.items[1].time, "14:00");
  assert.strictEqual(r.items[2].checkIn, "2026-12-11");
  assert.strictEqual(r.items[2].checkOut, "2026-12-13");
  assert.strictEqual(r.items[3].departTime, "09:00");
  assert.strictEqual(r.items[3].arriveTime, "11:30");
});

check("12月11日 uses the year from other rows; with no year anywhere it uses the next occurrence on or after today", function () {
  const ok = ImportUtil.parseImport("地点 | 示例A | Example 1 | 2026/12/10 |\n地点 | 示例B | Example 2 | 12月11日 9点 |");
  assert.deepStrictEqual(ok.errors, []);
  assert.strictEqual(ok.items[1].date, "2026-12-11");
  assert.strictEqual(ok.items[1].time, "09:00");
  const next = ImportUtil.parseImport("地点 | 示例B | Example 2 | 12月11日 9点 |", { today: "2026-11-16" });
  assert.deepStrictEqual(next.errors, []);
  assert.strictEqual(next.items.length, 1);
  assert.ok(!next.items[0].pendingDate);
  assert.strictEqual(next.items[0].date, "2026-12-11");
  assert.strictEqual(next.items[0].time, "09:00");
  const past = ImportUtil.parseImport("地点 | 示例B | Example 2 | 12月11日 9点 |", { today: "2026-12-12" });
  assert.strictEqual(past.items[0].date, "2027-12-11");
});

check("JSON records get the same date/time tolerance", function () {
  const r = ImportUtil.parseImport(JSON.stringify([
    { 类型: "地点", 名称: "示例咖啡馆", 地址: "Example St 1", 日期时间: "2026年12月11日 9:00 PM" },
    { 类型: "地点", 名称: "示例餐厅", 地址: "Example St 2", 日期时间: "12月12日 9点" }
  ]));
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.items[0].date, "2026-12-11");
  assert.strictEqual(r.items[0].time, "21:00");
  assert.strictEqual(r.items[1].date, "2026-12-12");
});

check("unconvertible dates are kept as 待确认 (not dropped): 25:00, no-year, garbage; other fields kept", function () {
  const text = [
    "地点/餐厅 | 示例餐厅 | Example St 1 | 2026-12-11 25:00 | 订了窗边",
    "地点 | 示例公园 | Example St 2 | 下周三下午 | ",
    "酒店 | 示例酒店 | Example St 3 | 入住那天 | 确认号 FAKE-1",
    "机票 | XX100 | LHR - CDG | 乱写的时间 | 座位 12A",
    "地点 | 示例咖啡馆 | Example St 4 | 2026/12/12 9:00 |"
  ].join("\n");
  const r = ImportUtil.parseImport(text);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.items.length, 5);
  const [a, b, h, f, ok] = r.items;
  assert.strictEqual(a.pendingDate, true);
  assert.strictEqual(a.dateRaw, "2026-12-11 25:00");
  assert.strictEqual(a.dateGuess, "2026-12-11", "parseable part kept for prefill");
  assert.strictEqual(a.date, "");
  assert.strictEqual(a.subtype, "餐厅");
  assert.strictEqual(a.address, "Example St 1");
  assert.strictEqual(a.note, "订了窗边");
  assert.strictEqual(b.pendingDate, true);
  assert.strictEqual(b.dateRaw, "下周三下午");
  assert.strictEqual(h.type, "hotel");
  assert.strictEqual(h.pendingDate, true);
  assert.strictEqual(h.checkIn, "");
  assert.strictEqual(h.confirmationNo, "FAKE-1");
  assert.strictEqual(f.type, "flight");
  assert.strictEqual(f.pendingDate, true);
  assert.strictEqual(f.flightNo, "XX100");
  assert.strictEqual(f.seat, "12A");
  assert.strictEqual(ok.pendingDate, undefined);
  assert.strictEqual(ok.time, "09:00");
});

check("non-date problems are still errors (bad type, missing name, bad airport pair)", function () {
  const r = ImportUtil.parseImport("火车 | X | y | 2026-12-11 |\n地点 |  | y | 2026-12-11 |\n机票 | XX1 | LHRCDG | 2026-12-11 09:00 ~ 2026-12-11 10:00 |");
  assert.strictEqual(r.items.length, 0);
  assert.strictEqual(r.errors.length, 3);
});

console.log("\n--- official pipe lines ---");
console.log(PIPE_THREE);
console.log("\n--- Dishoom JSON ---");
console.log(DISHOOM_JSON);
console.log("\n--- Dishoom English JSON ---");
console.log(DISHOOM_EN);

if (failures) {
  console.log("\n" + failures + " failure(s)");
  process.exit(1);
}
console.log("\nAll import checks passed.");
