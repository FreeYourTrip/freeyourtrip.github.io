/**
 * v5.2 宽容导入：AI 回复里夹着解释文字、``` 代码块、Markdown 表格、JSON 时，只取有效行。用法：node check-import-tolerant.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const I = require("./import.js");

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
const F = "机票 | XX201 | LHR - HND | 2026-12-01 09:30 ~ 2026-12-02 07:00 | 座位 32A";
const H = "酒店 | 示例酒店 | 东京都新宿区示例 1-1 | 2026-12-02 ~ 2026-12-05 | ";

check("explanation text + ``` fence: rows only, one summary note", function () {
  const r = I.parseImport("好的，以下是整理好的行程：\n\n```\n" + F + "\n" + H + "\n```\n\n如果还有其他截图，欢迎继续发给我！");
  assert.strictEqual(r.items.length, 2);
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.notes, ["AI 回复里的 2 行说明文字已跳过。"]);
});

check("``` with a language tag", function () {
  const r = I.parseImport("```text\n地点/景点 | 示例寺 | 京都市东山区 | 2026-12-05 10:00 |\n```");
  assert.strictEqual(r.items.length, 1);
});

check("Markdown table with header and --- rule; a stray '说明：A | B' line is not an error", function () {
  const r = I.parseImport(["整理如下：", "| 类型 | 名称 | 地址 | 日期时间 | 备注 |", "|---|---|---|---|---|", "| " + F + " |", "| " + H.trim() + " |", "说明：A | B 两张图看不清。"].join("\n"));
  assert.strictEqual(r.items.length, 2, JSON.stringify(r));
  assert.deepStrictEqual(r.errors, []);
});

check("JSON inside ```json with prose around it", function () {
  const r = I.parseImport('这是 JSON：\n```json\n[{"type":"place","nameZh":"示例寺","address":"东京都台东区"}]\n```\n有问题告诉我。');
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.items[0].nameZh, "示例寺");
});

check("a real bad row (known type, wrong column count) still reports an error", function () {
  const r = I.parseImport("好的：\n" + F + "\n酒店 | 少了列 | 2026-12-02");
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.errors.length, 1);
});

check("nothing recognisable → no items; the wizard shows the friendly failure and opens the paste box", function () {
  const r = I.parseImport("抱歉，我看不清这张截图。");
  assert.strictEqual(r.items.length, 0);
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  assert.ok(tl.indexOf('fail: "没认出来，把 AI 的回复整段复制过来再试一次"') !== -1);
  assert.ok(/if \(\/```\/\.test\(t\) \|\| \/\^\\s\*\[\\\[\{\]\/m\.test\(t\)\) return true;/.test(tl), "looksStructured accepts fenced / prose-wrapped JSON");
});

if (failures) {
  console.log("\n" + failures + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll tolerant-import checks passed.");
