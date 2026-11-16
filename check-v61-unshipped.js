#!/usr/bin/env node
"use strict";
/**
 * v6.1 未上线功能不得出现在对外文案里。解析器可以认得这些词，但提示词和页面入口要藏起来。
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const root = __dirname;
const Ai = require("./ai-prompt.js");
const Fav = require("./favorites.js");

const TERMS = ["收藏", "足迹", "选行程分享", "放到哪天"];
let failed = 0;
function check(name, fn) {
  try { fn(); console.log("  ok  " + name); }
  catch (err) { failed += 1; console.error("  FAIL  " + name); console.error("    " + err.message); }
}

check("flags are off in v6.1", function () {
  assert.strictEqual(Fav.pageShipped, false, "收藏/足迹 page is not shipped");
});

check("shipped AI prompt and top-level HTML do not advertise unshipped terms", function () {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  TERMS.forEach((w) => {
    assert.ok(Ai.TEXT.indexOf(w) === -1, "AiPrompt.TEXT mentions " + w);
    assert.ok(html.indexOf(">" + w + "<") === -1 && html.indexOf("「" + w) === -1, "index.html visible copy mentions " + w);
  });
});


check("选行程分享 is not in the shipped UI or announcement", function () {
  ["index.html", "version.js", "timeline.js", "backup.js", "ai-prompt.js"].forEach((f) => {
    const t = fs.readFileSync(path.join(root, f), "utf8");
    assert.ok(t.indexOf("选行程分享") === -1, f + " mentions 选行程分享");
  });
});

check("放到哪天 is not in the shipped UI or announcement", function () {
  ["index.html", "version.js", "timeline.js", "backup.js", "ai-prompt.js"].forEach((f) => {
    const t = fs.readFileSync(path.join(root, f), "utf8");
    assert.ok(t.indexOf("放到哪天") === -1, f + " mentions 放到哪天");
  });
});

if (failed) {
  console.error("\n" + failed + " failed");
  process.exit(1);
}
console.log("\nall passed");
