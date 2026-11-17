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

check("recommend text is exact; share payload is title + URL only (no trip data, no promo text)", function () {
  assert.strictEqual(R.FULL_TEXT, FULL);
  const p = R.sharePayload();
  assert.deepStrictEqual(p, { title: "Free Your Trip", url: "https://freeyourtrip.github.io" });
  assert.ok(!p.text, "share sheet sends the URL only");
});

check("uses navigator.share when available: only URL, no toast, no trip data", async function () {
  let got = null;
  const toasts = [];
  const res = await R.recommend({ navigator: { share: (d) => { got = d; return Promise.resolve(); } }, toast: (m) => toasts.push(m) });
  assert.strictEqual(res, "shared");
  assert.deepStrictEqual(got, { title: "Free Your Trip", url: "https://freeyourtrip.github.io" });
  assert.strictEqual(toasts.length, 0, "toast only on the copy fallback");
});

check("user cancelling the share sheet does nothing", async function () {
  const toasts = [];
  const res = await R.recommend({ navigator: { share: () => Promise.reject(Object.assign(new Error("x"), { name: "AbortError" })) }, toast: (m) => toasts.push(m) });
  assert.strictEqual(res, "cancelled");
  assert.strictEqual(toasts.length, 0);
});

check("no navigator.share -> copies the URL and toasts 「网址已复制，发给朋友就行」", async function () {
  let copied = null;
  const toasts = [];
  const res = await R.recommend({ navigator: { clipboard: { writeText: (t) => { copied = t; return Promise.resolve(); } } }, toast: (m) => toasts.push(m) });
  assert.strictEqual(res, "copied");
  assert.strictEqual(copied, "https://freeyourtrip.github.io");
  assert.deepStrictEqual(toasts, ["网址已复制，发给朋友就行"]);
});

check("share failing (not cancel) falls back to copy + toast", async function () {
  let copied = null;
  const toasts = [];
  const res = await R.recommend({
    navigator: { share: () => Promise.reject(new Error("NotAllowed")), clipboard: { writeText: (t) => { copied = t; return Promise.resolve(); } } },
    toast: (m) => toasts.push(m)
  });
  assert.strictEqual(res, "copied");
  assert.strictEqual(copied, "https://freeyourtrip.github.io");
  assert.deepStrictEqual(toasts, ["网址已复制，发给朋友就行"]);
});

check("copy failing tells the user the URL to copy by hand", async function () {
  const toasts = [];
  const res = await R.recommend({ navigator: { clipboard: { writeText: () => Promise.reject(new Error("no")) } }, toast: (m) => toasts.push(m) });
  assert.strictEqual(res, "failed");
  assert.deepStrictEqual(toasts, ["没复制上，长按网址自己复制：https://freeyourtrip.github.io"]);
});

check("settings markup: 分享我的行程 / 分享给朋友 (v6) with subtitles; old labels gone; script + precache", function () {
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  const sw = fs.readFileSync(__dirname + "/sw.js", "utf8");
  assert.ok(html.indexOf('id="recommend-btn"') !== -1 && html.indexOf('data-sub="只发网址，不含你的行程">推荐这个工具<') !== -1);
  assert.ok(html.indexOf('id="backup-export-share"') !== -1 && html.indexOf('data-sub="发个链接给同行的人，对方点开就能存好">分享我的行程<') !== -1);
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  const css = fs.readFileSync(__dirname + "/styles.css", "utf8");
  assert.ok(/\.more-sub \{ font-size: 12px; font-weight: 400; color: #8A9099;/.test(css));
  assert.ok(/#backup-export-share \+ #recommend-btn \{ margin-top: 8px; \}/.test(css));
  const docs = ["index.html", "timeline.js", "README.md", "DESIGN.md", "backup.js", "recommend.js"].map((f) => fs.readFileSync(__dirname + "/" + f, "utf8")).join("\n");
  ["分享行程」", "「分享行程", "推荐给朋友"].forEach((old) => assert.ok(docs.indexOf(old) === -1, "old label gone: " + old));
  /* v6.1.3：「分享给朋友」改回「推荐这个工具」；小字仍是「只发网址，不含你的行程」。README 历史记录不算 */
  assert.ok(html.indexOf(">推荐这个工具<") !== -1);
  assert.ok(html.indexOf(">分享给朋友<") === -1, "settings recommend button uses 推荐这个工具");
  const v = require("./version.js");
  const v51 = v.ANNOUNCEMENT.bullets.concat(v.CHANGELOG[0].lines).join("\n");
  assert.ok(v51.indexOf("推荐给朋友") === -1 && v51.indexOf("「分享行程」") === -1, "v5.1 texts use the final names");
  assert.ok(tl.indexOf('title: "分享我的行程", text: "点一下生成链接，发给同行的人，订单号和座位会自动隐藏"') !== -1, "help sheet uses final names");
  assert.ok(html.indexOf('src="./recommend.js"') !== -1);
  assert.ok(sw.indexOf('"./recommend.js"') !== -1 && sw.indexOf('"xingcheng-map-shell-v22"') !== -1);
  assert.ok(["v5.1", "v5.2", "v5.3", "v5.4", "v6", "v6.0", "v6.1", "v6.1.1", "v6.1.2", "v6.1.3"].indexOf(v.APP_VERSION) !== -1);
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
  assert.ok(/\.seg-city \{[^}]*overflow: hidden/.test(css));
  assert.ok(tl.indexOf("C.fitCity(sg.city, segRest(sg), textW, measureSegText, SEG_GAP_PX)") !== -1, "city truncated in JS");
  assert.ok(/return sg\.label\.slice\(sg\.city\.length\)\.replace\(\/\^\\s\+\/, ""\)/.test(tl), "range has no leading space");
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
  const allowed = /freeyourtrip\.github\.io|openstreetmap|nominatim|amap|autonavi|google\.com|googleapis|w3\.org|leafletjs|github\.com\/Leaflet|maps\.apple|uri\.amap|schemas|example|postcodes\.io/i;
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
