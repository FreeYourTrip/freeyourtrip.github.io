#!/usr/bin/env node
"use strict";
/**
 * v6.1 item 17 addendum: AI import panel — all steps visible,
 * no 「发好了，下一步」, no step-2 ✓, 「已复制」 is a secondary button,
 * 「粘贴并导入」 is always tappable and the only solid primary after copy.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const root = __dirname;
const tl = fs.readFileSync(path.join(root, "timeline.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const wiz = html.slice(html.indexOf('id="ai-help"'), html.indexOf('id="manual-fold"'));

let failed = 0;
function check(name, fn) {
  try { fn(); console.log("  ok  " + name); }
  catch (err) { failed += 1; console.error("  FAIL  " + name); console.error("    " + err.message); }
}

check("发好了，下一步 is gone; steps stay in the panel", function () {
  assert.ok(wiz.indexOf("发好了，下一步") === -1);
  assert.ok(wiz.indexOf("ai-step2-next") === -1);
  assert.ok(tl.indexOf("ai-step2-next") === -1);
  assert.ok(tl.indexOf("aiLeftPage") === -1, "no auto-advance after leaving to an AI app");
  assert.ok(wiz.indexOf('data-step="1"') !== -1 && wiz.indexOf('data-step="2"') !== -1 && wiz.indexOf('data-step="3"') !== -1);
});

check("no ✓ on step 2 (or any step) after completion", function () {
  assert.ok(!/\.ai-step\.is-done \.ai-step-text::after\s*\{[^}]*content:\s*" ✓"/.test(css));
  assert.ok(tl.indexOf('li.classList.remove("is-done")') !== -1);
  assert.ok(tl.indexOf("copied: \"✓ 已复制\"") !== -1);
  assert.ok(tl.indexOf("已复制 ✓") === -1);
});

check("all steps stay fully visible, not greyed out", function () {
  const block = css.slice(css.indexOf(".ai-steps"), css.indexOf(".ai-small"));
  assert.ok(/\.ai-step \{[^}]*opacity:\s*1;/.test(block));
  assert.ok(!/\.ai-step \{[^}]*opacity:\s*0\.55;/.test(block));
});

check("粘贴并导入 is always tappable and the solid primary", function () {
  assert.ok(wiz.indexOf('id="ai-paste-btn"') !== -1);
  assert.ok(!/\sdisabled/.test(wiz.slice(wiz.indexOf("ai-paste-btn") - 80, wiz.indexOf("ai-paste-btn") + 80)));
  assert.ok(/<button type="button" class="primary-btn" id="ai-paste-btn">粘贴并导入<\/button>/.test(wiz));
  assert.ok(tl.indexOf("function pasteAndImport") !== -1);
  assert.ok(!/ai-paste-btn[\s\S]{0,200}disabled/.test(tl));
});

check("after copy, the button stays the same primary style and shows ✓ 已复制", function () {
  assert.ok(/#ai-copy-btn\.primary-btn\.is-copied\s*\{[^}]*background:\s*#0F9D8A;[^}]*color:\s*#fff/.test(css));
  assert.ok(tl.indexOf("copied: \"✓ 已复制\"") !== -1);
});

if (failed) {
  console.error("\n" + failed + " failed");
  process.exit(1);
}
console.log("\nall passed");
