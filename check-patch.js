/**
 * v5 补丁校验：推荐给朋友、窄屏顶栏、住宿段截断、iPhone 启动图。用法：node check-patch.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const R = require("./recommend.js");

let failures = 0;
const queue = [];
function check(name, fn) {
  queue.push([name, fn]);
}

const FULL = "机票、酒店、想去的地方，一路串起来 ✈️ 不用下载不用注册，打开就能用 👉 https://freeyourtrip.github.io";

check("recommend text is exact; share payload puts URL only in url", function () {
  assert.strictEqual(R.FULL_TEXT, FULL);
  const p = R.sharePayload();
  assert.strictEqual(p.title, "Free Your Trip");
  assert.strictEqual(p.url, "https://freeyourtrip.github.io");
  assert.ok(p.text.indexOf("http") === -1, "no URL inside text");
  assert.strictEqual(p.text + " " + p.url, FULL);
});

check("uses navigator.share when available, no toast, no trip data", async function () {
  let got = null;
  const toasts = [];
  const res = await R.recommend({ navigator: { share: (d) => { got = d; return Promise.resolve(); } }, toast: (m) => toasts.push(m) });
  assert.strictEqual(res, "shared");
  assert.deepStrictEqual(Object.keys(got).sort(), ["text", "title", "url"]);
  assert.strictEqual(toasts.length, 0);
});

check("user cancelling the share sheet does nothing", async function () {
  const toasts = [];
  const res = await R.recommend({ navigator: { share: () => Promise.reject(Object.assign(new Error("x"), { name: "AbortError" })) }, toast: (m) => toasts.push(m) });
  assert.strictEqual(res, "cancelled");
  assert.strictEqual(toasts.length, 0);
});

check("no navigator.share -> copies full text and toasts 已复制，去粘贴给朋友吧", async function () {
  let copied = null;
  const toasts = [];
  const res = await R.recommend({ navigator: { clipboard: { writeText: (t) => { copied = t; return Promise.resolve(); } } }, toast: (m) => toasts.push(m) });
  assert.strictEqual(res, "copied");
  assert.strictEqual(copied, FULL);
  assert.deepStrictEqual(toasts, ["已复制，去粘贴给朋友吧"]);
});

check("share failing (not cancel) falls back to copy", async function () {
  let copied = null;
  const res = await R.recommend({
    navigator: { share: () => Promise.reject(new Error("NotAllowed")), clipboard: { writeText: (t) => { copied = t; return Promise.resolve(); } } },
    toast: () => {}
  });
  assert.strictEqual(res, "copied");
  assert.strictEqual(copied, FULL);
});

check("settings markup: 推荐给朋友 separate from 分享给朋友; script + precache; v5 unchanged", function () {
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  const sw = fs.readFileSync(__dirname + "/sw.js", "utf8");
  const v = require("./version.js");
  assert.ok(html.indexOf('id="recommend-btn"') !== -1 && html.indexOf(">推荐给朋友<") !== -1);
  assert.ok(html.indexOf('id="backup-export-share"') !== -1 && html.indexOf(">分享给朋友<") !== -1);
  assert.ok(html.indexOf('src="./recommend.js"') !== -1);
  assert.ok(sw.indexOf('"./recommend.js"') !== -1 && sw.indexOf('"xingcheng-map-shell-v12"') !== -1);
  assert.strictEqual(v.APP_VERSION, "v5");
});

check("narrow top bar CSS: ≤360px brand 16px nowrap, icon-only buttons, 44px; help button keeps aria-label", function () {
  const css = fs.readFileSync(__dirname + "/styles.css", "utf8");
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  const block = css.slice(css.indexOf("@media (max-width: 360px)"));
  assert.ok(/\.brand-name \{ font-size: 16px; white-space: nowrap; \}/.test(block));
  assert.ok(/\.top-label,\s*\.top-actions \.top-optional-label \{ display: none !important; \}/.test(block));
  assert.ok(/min-width: 44px; width: 44px; min-height: 44px/.test(block));
  assert.ok(tl.indexOf('help.setAttribute("aria-label", "使用说明")') !== -1);
  assert.ok(tl.indexOf('settings.setAttribute("aria-label", "设置")') !== -1);
});

check("segment label: only the city truncates, range kept, 72px min, bar-only tap shows full name, 16px end padding", function () {
  const css = fs.readFileSync(__dirname + "/styles.css", "utf8");
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  assert.ok(/\.cal-grid \{ padding-right: 16px; \}/.test(css));
  assert.ok(/\.seg-city \{[^}]*text-overflow: ellipsis/.test(css));
  assert.ok(/\.seg-range \{ flex: 0 0 auto; white-space: nowrap;/.test(css));
  assert.ok(/min-width: 72px/.test(css));
  assert.ok(tl.indexOf("var SEG_LABEL_MIN = 72;") !== -1);
  assert.ok(tl.indexOf('showToast(seg.getAttribute("data-seg-label"), null, 3000)') !== -1);
});

check("iOS startup images: 9 portrait media queries, files exist, none precached", function () {
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  const sw = fs.readFileSync(__dirname + "/sw.js", "utf8");
  const want = [
    [430, 932, 3, "1290x2796"], [393, 852, 3, "1179x2556"], [390, 844, 3, "1170x2532"], [428, 926, 3, "1284x2778"],
    [375, 812, 3, "1125x2436"], [414, 896, 3, "1242x2688"], [414, 896, 2, "828x1792"], [360, 780, 3, "1080x2340"], [375, 667, 2, "750x1334"]
  ];
  want.forEach(([w, h, r, f]) => {
    const tag = '<link rel="apple-touch-startup-image" href="./splash-' + f + '.png" media="(device-width: ' + w + 'px) and (device-height: ' + h + 'px) and (-webkit-device-pixel-ratio: ' + r + ') and (orientation: portrait)">';
    assert.ok(html.indexOf(tag) !== -1, "missing tag " + f);
    assert.ok(fs.existsSync(__dirname + "/splash-" + f + ".png"), "missing file " + f);
    const buf = fs.readFileSync(__dirname + "/splash-" + f + ".png");
    const [pw, ph] = f.split("x").map(Number);
    assert.strictEqual(buf.readUInt32BE(16), pw, f + " width");
    assert.strictEqual(buf.readUInt32BE(20), ph, f + " height");
  });
  assert.strictEqual((html.match(/apple-touch-startup-image/g) || []).length, 9);
  assert.ok(sw.indexOf("splash") === -1, "splashes are not precached");
});

check("no new external hosts in shipped code", function () {
  const files = ["index.html", "recommend.js", "timeline.js", "calendar.js", "import.js", "sw.js"];
  const allowed = /freeyourtrip\.github\.io|openstreetmap|nominatim|amap|autonavi|google\.com|googleapis|w3\.org|leafletjs|github\.com\/Leaflet|maps\.apple|uri\.amap|schemas|example/i;
  files.forEach((f) => {
    const src = fs.readFileSync(__dirname + "/" + f, "utf8");
    (src.match(/https?:\/\/[^\s"'<>)]+/g) || []).forEach((u) => assert.ok(allowed.test(u), f + ": unexpected host " + u));
  });
  const cfg = fs.readFileSync(__dirname + "/config.js", "utf8");
  assert.ok(/AMAP_JS_KEY\s*=\s*""/.test(cfg) || /AMAP_JS_KEY:\s*""/.test(cfg), "Amap key stays empty");
});

(async function () {
  for (const [name, fn] of queue) {
    try {
      await fn();
      console.log("PASS  " + name);
    } catch (err) {
      failures += 1;
      console.log("FAIL  " + name);
      console.log("      " + (err && err.stack ? err.stack : err));
    }
  }
  if (failures) {
    console.log("\n" + failures + " check(s) failed.");
    process.exit(1);
  }
  console.log("\nAll checks passed.");
})();
