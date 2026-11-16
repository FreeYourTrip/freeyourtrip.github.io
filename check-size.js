/**
 * 手机要存多少：sw.js 预缓存清单里每个文件的原始大小（不压缩）加起来，打印总量和比上次记录多了 / 少了多少。
 * 超过 1.5 MB（1,572,864 字节）只打印 WARNING，不算失败；预缓存里有 png / jpg（下面列出的 App 图标除外）也只是 WARNING。
 * 只有清单里的文件不存在才算失败。上次记录在 size-baseline.json。
 * 用法：node check-size.js；确认新的大小后 node check-size.js --record 更新记录。
 */
"use strict";
const fs = require("fs");
const path = require("path");

const LIMIT = 1572864;
const PNG_ALLOW = [
  "./icons/icon-16.png",
  "./icons/icon-32.png",
  "./icons/icon-120.png",
  "./icons/icon-152.png",
  "./icons/icon-167.png",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

let failures = 0;
let warnings = 0;
function fail(msg) {
  failures += 1;
  console.log("FAIL  " + msg);
}
function warn(msg) {
  warnings += 1;
  console.log("WARNING  " + msg);
}
const BASELINE = path.join(__dirname, "size-baseline.json");

const sw = fs.readFileSync(path.join(__dirname, "sw.js"), "utf8");
const m = sw.match(/var SHELL = \[([\s\S]*?)\];/);
if (!m) {
  fail("could not find the SHELL precache list in sw.js");
  process.exit(1);
}
const list = (m[1].match(/"[^"]+"/g) || []).map((s) => JSON.parse(s));
let total = 0;
const rows = [];
list.forEach((u) => {
  const rel = u === "./" ? "index.html" : u.replace(/^\.\//, "");
  if (u === "./") return; /* 同一个 index.html，只算一次 */
  const file = path.join(__dirname, rel);
  if (!fs.existsSync(file)) {
    fail("precached file missing: " + u);
    return;
  }
  const n = fs.statSync(file).size;
  total += n;
  rows.push([n, u]);
  if (/\.(png|jpe?g)$/i.test(u) && PNG_ALLOW.indexOf(u) === -1) warn("png/jpg in precache (use webp): " + u);
});
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.webmanifest"), "utf8"));
(manifest.icons || []).forEach((ic) => {
  if (PNG_ALLOW.indexOf("./" + ic.src.replace(/^\.\//, "")) === -1) warn("manifest icon not on the png allowlist: " + ic.src);
});

rows.sort((a, b) => b[0] - a[0]);
console.log("largest: " + rows.slice(0, 5).map((r) => r[1] + " " + r[0]).join(", "));
let prev = null;
try {
  prev = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
} catch (err) {}
const delta = prev && typeof prev.total === "number" ? total - prev.total : null;
console.log("precache files: " + rows.length + ", total " + total + " bytes (" + (total / 1048576).toFixed(2) + " MB); warning line " + LIMIT);
console.log(delta == null
  ? "previous recorded total: none (run with --record to save one)"
  : "previous recorded total: " + prev.total + " (" + (prev.note || "") + ") → delta " + (delta >= 0 ? "+" : "") + delta + " bytes");
if (total > LIMIT) warn("precache total " + total + " bytes is over 1.5 MB (" + LIMIT + ")");
if (process.argv.indexOf("--record") !== -1) {
  const ver = (fs.readFileSync(path.join(__dirname, "version.js"), "utf8").match(/APP_VERSION\s*=\s*"([^"]+)"/) || [])[1] || "";
  fs.writeFileSync(BASELINE, JSON.stringify({ total: total, files: rows.length, note: ver }, null, 2) + "\n");
  console.log("recorded " + total + " bytes in size-baseline.json");
}
if (failures) {
  console.log("\n" + failures + " size failure(s)");
  process.exit(1);
}
console.log("\nAll size checks passed" + (warnings ? " (" + warnings + " warning(s))." : "."));
