/**
 * 顶部日期条 / 月历 / 住宿段校验。用法：node check-calendar.js
 * 全部是假数据（示例地点，无真实个人信息）。
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const C = require("./calendar.js");

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

function trip() {
  return [
    { id: "f1", type: "flight", flightNo: "XX1", departDate: "2026-12-01", arriveDate: "2026-12-01" },
    { id: "h1", type: "hotel", nameZh: "示例酒店A", city: "东京", address: "Example 1, Tokyo", checkIn: "2026-12-01", checkOut: "2026-12-04" },
    { id: "p1", type: "place", subtype: "景点", nameZh: "示例景点", date: "2026-12-02", time: "10:00" },
    { id: "h2", type: "hotel", nameZh: "示例酒店B", address: "Example Rd 2, Kyoto 600-0000", checkIn: "2026-12-04", checkOut: "2026-12-07" },
    { id: "p2", type: "place", subtype: "餐厅", nameZh: "示例餐厅", date: "2026-12-06", time: "19:00" }
  ];
}

check("weekday / short date / month label", function () {
  assert.strictEqual(C.weekday("2026-11-16"), "周一");
  assert.strictEqual(C.weekday("2026-12-01"), "周二");
  assert.strictEqual(C.shortDate("2026-12-01"), "12/1");
  assert.strictEqual(C.monthLabel("2026-12-01"), "2026年12月");
});

check("strip covers first day to last checkout, gaps included", function () {
  const d = C.stripDays(trip(), "2025-01-01");
  assert.strictEqual(d[0], "2026-12-01");
  assert.strictEqual(d[d.length - 1], "2026-12-07");
  assert.strictEqual(d.length, 7);
});

check("strip extends to today when within 31 days, not when further", function () {
  const near = C.stripDays(trip(), "2026-11-16");
  assert.strictEqual(near[0], "2026-11-16");
  const far = C.stripDays(trip(), "2026-09-01");
  assert.strictEqual(far[0], "2026-12-01");
  const after = C.stripDays(trip(), "2026-12-20");
  assert.strictEqual(after[after.length - 1], "2026-12-20");
  assert.deepStrictEqual(C.stripDays([], "2026-11-16"), []);
});

check("default day: today when today has items", function () {
  assert.strictEqual(C.defaultDay(trip(), "2026-12-02"), "2026-12-02");
});

check("default day: next day with items when today is empty", function () {
  assert.strictEqual(C.defaultDay(trip(), "2026-12-03"), "2026-12-04");
  assert.strictEqual(C.defaultDay(trip(), "2026-11-16"), "2026-12-01", "before the trip -> first day");
});

check("default day: last day with items when the whole trip is past", function () {
  /* v5.4: checkout day also has a hotel card */
  assert.strictEqual(C.defaultDay(trip(), "2027-01-10"), "2026-12-07");
});

check("default day: no items -> all", function () {
  assert.strictEqual(C.defaultDay([], "2026-12-02"), "all");
  assert.strictEqual(C.defaultDay([{ id: "x", type: "place", nameZh: "无日期" }], "2026-12-02"), "all");
});


check("initial strip focus: first-day week before the trip, today during, last day after, today when no dates; ignores 待补", function () {
  /* trip(): 2026-12-01 .. 2026-12-07 (hotel checkout) */
  assert.strictEqual(C.initialStripFocus(trip(), "2026-11-16"), "2026-12-01", "today < first → first day");
  assert.strictEqual(C.initialStripFocus(trip(), "2026-12-03"), "2026-12-03", "during the trip → today, even if today has no item");
  assert.strictEqual(C.initialStripFocus(trip(), "2026-12-20"), "2026-12-07", "today > last → last day");
  assert.strictEqual(C.initialStripFocus([], "2026-11-16"), "2026-11-16", "no dated items → today");
  assert.strictEqual(C.initialStripFocus([{ id: "x", type: "place", nameZh: "无日期" }], "2026-11-16"), "2026-11-16");
  const pending = trip().concat([{ id: "z", type: "place", nameZh: "待补", pendingDate: true, dateRaw: "1月1日" }]);
  assert.strictEqual(C.initialStripFocus(pending, "2026-11-16"), "2026-12-01", "待补 ignored");
});

check("past greying: only days strictly before today", function () {
  assert.strictEqual(C.isPast("2026-12-01", "2026-12-02"), true);
  assert.strictEqual(C.isPast("2026-12-02", "2026-12-02"), false);
  assert.strictEqual(C.isPast("2026-12-03", "2026-12-02"), false);
});

check("dots: one per kind (flight, hotel, place) in that order", function () {
  const dots = C.dotsByDay(trip().concat([{ id: "p3", type: "place", nameZh: "另一个", date: "2026-12-01" }]));
  assert.deepStrictEqual(dots["2026-12-01"].map((d) => d.kind), ["flight", "hotel", "place"]);
  assert.deepStrictEqual(dots["2026-12-02"].map((d) => d.kind), ["place"]);
  assert.strictEqual(dots["2026-12-03"], undefined);
});

check("segments from hotel stays: city field, else city from address", function () {
  const s = C.deriveSegments(trip(), "2026-11-16");
  assert.strictEqual(s.length, 2);
  assert.strictEqual(s[0].label, "东京 · 12/1–12/4");
  assert.strictEqual(s[1].city, "Kyoto");
  assert.strictEqual(s[1].label, "Kyoto · 12/4–12/7");
  assert.ok(s.every((x) => !x.past));
});

check("segments fully in the past get 已去; current one does not", function () {
  const s = C.deriveSegments(trip(), "2026-12-05");
  assert.strictEqual(s[0].past, true);
  assert.strictEqual(s[0].label, "东京 · 12/1–12/4 · 已去");
  assert.strictEqual(s[1].past, false);
  const onLastDay = C.deriveSegments(trip(), "2026-12-04");
  assert.strictEqual(onLastDay[0].past, false, "checkout day is still part of the stay");
});

check("segment without checkout runs to next hotel, or only check-in day; falls back to hotel name", function () {
  const items = [
    { id: "a", type: "hotel", nameZh: "示例旅馆", address: "Example", checkIn: "2026-12-01" },
    { id: "b", type: "hotel", nameZh: "示例酒店", address: "", checkIn: "2026-12-03" }
  ];
  const s = C.deriveSegments(items, "2026-11-01");
  assert.strictEqual(s[0].end, "2026-12-03");
  assert.strictEqual(s[0].label, "示例旅馆 · 12/1–12/3");
  assert.strictEqual(s[1].label, "示例酒店 · 12/3");
});

check("month grid: Monday first, 6 weeks, correct in-month flags", function () {
  const g = C.monthGrid(2026, 12);
  assert.strictEqual(g.label, "2026年12月");
  assert.strictEqual(g.weeks.length, 6);
  g.weeks.forEach((w) => assert.strictEqual(w.length, 7));
  assert.strictEqual(g.weeks[0][0].iso, "2026-11-30");
  assert.strictEqual(g.weeks[0][1].iso, "2026-12-01");
  assert.strictEqual(g.weeks[0][1].inMonth, true);
  assert.strictEqual(g.weeks[0][0].inMonth, false);
  const inMonth = [].concat.apply([], g.weeks).filter((c) => c.inMonth).length;
  assert.strictEqual(inMonth, 31);
});

check("month prev/next wraps the year", function () {
  assert.deepStrictEqual(C.shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepStrictEqual(C.shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
});

check("month grid date pick: inside the strip selects it, outside is refused", function () {
  const days = C.stripDays(trip(), "2026-11-16");
  assert.strictEqual(C.pickFromGrid("2026-12-05", days), "2026-12-05");
  assert.strictEqual(C.pickFromGrid("2026-12-25", days), null);
  assert.strictEqual(C.pickFromGrid("nope", days), null);
});

check("UI wiring: strip, month sheet, 今天, 全部, help text, sw precache", function () {
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  const sw = fs.readFileSync(__dirname + "/sw.js", "utf8");
  const v = require("./version.js");
  assert.ok(html.indexOf('src="./calendar.js"') !== -1 && html.indexOf('src="./calendar.js"') < html.indexOf('src="./timeline.js"'));
  assert.ok(html.indexOf('id="month-sheet"') !== -1 && html.indexOf('id="month-prev"') !== -1 && html.indexOf('id="month-next"') !== -1);
  assert.ok(sw.indexOf('"./calendar.js"') !== -1 && sw.indexOf('"xingcheng-map-shell-v21"') !== -1);
  assert.ok(tl.indexOf('id="cal-today"') !== -1 && tl.indexOf('data-day="all"') !== -1 && tl.indexOf('id="cal-month"') !== -1);
  assert.ok(tl.indexOf("prefers-reduced-motion") !== -1);
  assert.ok(tl.indexOf("顶部日期条左右滑") !== -1 && tl.indexOf("第1天、第2天") === -1);
  assert.ok(v.CHANGELOG.filter((e) => e.version === "v5")[0].lines.some((b) => b.indexOf("日期条") !== -1) && v.ANNOUNCEMENT.bullets.length <= 5);
  const v5 = v.CHANGELOG.filter((e) => e.version === "v5")[0];
  assert.ok(v5 && v5.lines.some((l) => l.indexOf("日期条") !== -1));
  assert.ok(["v5.1", "v5.2", "v5.3", "v5.4", "v6", "v6.0", "v6.1", "v6.1.1", "v6.1.2"].indexOf(v.APP_VERSION) !== -1);
});

check("fitCity truncates only the name, keeps the range, no stray space before ·", function () {
  const m = (t) => Array.from(t).length * 10; // 每个字 10px 的假尺子
  assert.strictEqual(C.fitCity("东京", "· 12/1–12/7", 200, m, 4), "东京");
  const cut = C.fitCity("大阪难波心斋桥一带", "· 11/18–11/20", 160, m, 4);
  assert.ok(/…$/.test(cut) && cut.indexOf(" ") === -1, cut);
  assert.ok(m(cut) + 4 + m("· 11/18–11/20") <= 160);
  assert.strictEqual(cut, "大…");
  assert.strictEqual(C.fitCity("很长的名字", "· 11/18", 60, m, 4), "…");
});

if (failures) {
  console.log("\n" + failures + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll checks passed.");
