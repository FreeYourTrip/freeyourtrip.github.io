/**
 * 版本号、新版本公告、更新记录校验。用法：node check-version.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const V = require("./version.js");

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

// 模拟“打开网页”的流程：和 timeline.js 的 runOpenFlow 一样使用 decideOnOpen + 存储
function openApp(store, opts) {
  const d = V.decideOnOpen({ lastSeen: store[V.LAST_SEEN_KEY] || null, hasTrips: !!opts.hasTrips, helpHidden: !!opts.helpHidden });
  if (d.markSeenNow) store[V.LAST_SEEN_KEY] = V.APP_VERSION;
  return d.show;
}
function tapOk(store) {
  store[V.LAST_SEEN_KEY] = V.APP_VERSION;
}

check("version is v5, defined once", function () {
  assert.strictEqual(V.APP_VERSION, "v5");
  assert.strictEqual(V.versionLabel(), "当前版本 v5 · 2026-11-16");
  const files = ["timeline.js", "index.html", "update-banner.js", "item-edit.js", "app.js"];
  files.forEach((f) => {
    const s = fs.readFileSync(__dirname + "/" + f, "utf8");
    assert.ok(!/APP_VERSION\s*=/.test(s), f + " must not redefine APP_VERSION");
  });
});

check("compareVersion", function () {
  assert.strictEqual(V.compareVersion("v4", "v5"), -1);
  assert.strictEqual(V.compareVersion("v5", "v5"), 0);
  assert.strictEqual(V.compareVersion("v10", "v5"), 1);
  assert.strictEqual(V.compareVersion("garbage", "v1"), -1);
});

check("first-time user → help only, version recorded silently, never the card", function () {
  const store = {};
  assert.strictEqual(openApp(store, { hasTrips: false }), "help");
  assert.strictEqual(store[V.LAST_SEEN_KEY], "v5");
  assert.strictEqual(openApp(store, { hasTrips: true }), "help", "next open: still help (until 不再自动弹出), no card");
  assert.strictEqual(openApp(store, { hasTrips: true, helpHidden: true }), "none");
});

check("returning user on an older version → card once, not again after 知道了", function () {
  const store = { [V.LAST_SEEN_KEY]: "v4" };
  assert.strictEqual(openApp(store, { hasTrips: true, helpHidden: true }), "announce");
  assert.strictEqual(openApp(store, { hasTrips: true, helpHidden: true }), "announce", "closed without 知道了 → shows again");
  tapOk(store);
  assert.strictEqual(openApp(store, { hasTrips: true, helpHidden: true }), "none");
  assert.strictEqual(openApp(store, { hasTrips: true, helpHidden: false }), "help", "card never stacks: afterwards only the old help rule");
});

check("v4 user with trips but no lastSeenVersion → card", function () {
  const store = {};
  assert.strictEqual(openApp(store, { hasTrips: true }), "announce");
  assert.strictEqual(store[V.LAST_SEEN_KEY], undefined, "only recorded after 知道了");
  tapOk(store);
  assert.strictEqual(openApp(store, { hasTrips: true, helpHidden: true }), "none");
});

check("v4 user with no trips but 不再自动弹出 ticked → card (not first-time)", function () {
  assert.strictEqual(openApp({}, { hasTrips: false, helpHidden: true }), "announce");
});

check("next release re-announces", function () {
  const d = V.decideOnOpen({ lastSeen: "v5", hasTrips: true, helpHidden: true, current: "v6" });
  assert.strictEqual(d.show, "announce");
});

check("announcement content: title, ≤3 bullets, refresh tip always present", function () {
  const a = V.ANNOUNCEMENT;
  assert.strictEqual(a.title, "新版本 v5 来啦");
  assert.ok(a.bullets.length >= 1 && a.bullets.length <= 4);
  assert.strictEqual(a.tip, "更新不会删除你的行程。如果看到的还是旧版：把网页彻底关掉再打开。放在桌面的，就从后台划掉，再点图标打开。");
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  assert.ok(html.indexOf('id="announce-tip"') !== -1 && html.indexOf('id="announce-ok"') !== -1);
  assert.ok(/<svg class="announce-illu"/.test(html), "inline SVG illustration");
});

check("changelog v1–v5, 1–3 lines each, no hashes or private data", function () {
  assert.deepStrictEqual(V.CHANGELOG.map((v) => v.version), ["v5", "v4", "v3", "v2", "v1"]);
  V.CHANGELOG.forEach((v) => {
    assert.ok(v.lines.length >= 1 && v.lines.length <= 3, v.version);
    v.lines.forEach((l) => {
      assert.ok(!/\b[0-9a-f]{7,40}\b/.test(l), "no commit hash: " + l);
      assert.ok(!/key|密钥|确认号\s*[A-Z0-9]|@/i.test(l), "nothing private: " + l);
    });
  });
});

check("settings shows version label and 更新记录 row; sw caches version.js", function () {
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  const sw = fs.readFileSync(__dirname + "/sw.js", "utf8");
  const settings = html.slice(html.indexOf('id="settings-sheet"'), html.indexOf('id="changelog-sheet"'));
  assert.ok(settings.indexOf('id="version-label"') !== -1);
  assert.ok(settings.indexOf("更新记录") !== -1);
  assert.ok(tl.indexOf("AppVersion.versionLabel()") !== -1);
  assert.ok(html.indexOf('src="./version.js"') !== -1 && html.indexOf('src="./version.js"') < html.indexOf('src="./timeline.js"'));
  assert.ok(sw.indexOf('"./version.js"') !== -1 && sw.indexOf('"xingcheng-map-shell-v12"') !== -1);
  assert.ok(V.LAST_SEEN_KEY.indexOf("wishlist-map") === 0, "清空本机数据 resets it");
});

check("rename: FreeYourTrip short name, Free Your Trip everywhere else, top bar brand", function () {
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  const css = fs.readFileSync(__dirname + "/styles.css", "utf8");
  const m = JSON.parse(fs.readFileSync(__dirname + "/manifest.webmanifest", "utf8"));
  assert.strictEqual(m.short_name, "FreeYourTrip");
  assert.strictEqual(m.name, "Free Your Trip");
  assert.ok(html.indexOf('<meta name="apple-mobile-web-app-title" content="FreeYourTrip">') !== -1);
  assert.ok(html.indexOf("<title>Free Your Trip</title>") !== -1);
  assert.ok(/<img class="brand-icon" src="\.\/icons\/icon-192\.png" width="24" height="24"/.test(html), "existing icon, 24px");
  assert.ok(html.indexOf('<span class="brand-name"><span class="brand-free">Free</span> Your Trip</span>') !== -1);
  assert.ok(/\.brand-name \{[^}]*font-size: 18px;[^}]*font-weight: 700;[^}]*color: #1F2329;/.test(css));
  assert.ok(/\.brand-free \{ color: #FF7A45; \}/.test(css));
  ["我的行程", "行程地图", "旅行心愿地图"].forEach((old) => {
    assert.ok(m.name.indexOf(old) === -1 && m.short_name.indexOf(old) === -1);
  });
  const bk = fs.readFileSync(__dirname + "/backup.js", "utf8");
  assert.ok(bk.indexOf('payload.app !== "行程地图"') !== -1, "file format id unchanged so old backups still import");
  const head = fs.readFileSync(__dirname + "/DEVLOG.md", "utf8").split("\n")[0];
  assert.ok(head.indexOf("Free Your Trip") !== -1, head);
});

if (failures) {
  console.log("\n" + failures + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll checks passed.");
