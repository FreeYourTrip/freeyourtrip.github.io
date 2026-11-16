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

check("version is v5.3, defined once", function () {
  assert.strictEqual(V.APP_VERSION, "v5.3");
  assert.strictEqual(V.versionLabel(), "当前版本 v5.3 · 2026-11-16");
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
  assert.strictEqual(V.compareVersion("v5", "v5.1"), -1, "小更新 v5.1 > v5");
  assert.strictEqual(V.compareVersion("v5.1", "v5.2"), -1);
  assert.strictEqual(V.compareVersion("v5.9", "v6"), -1);
  assert.strictEqual(V.compareVersion("v5.1", "v5.1"), 0);
  assert.strictEqual(V.compareVersion("garbage", "v1"), -1);
});

check("first-time user → help only, version recorded silently, never the card", function () {
  const store = {};
  assert.strictEqual(openApp(store, { hasTrips: false }), "help");
  assert.strictEqual(store[V.LAST_SEEN_KEY], "v5.3");
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

check("someone who already saw v5, v5.1 or v5.2 gets the v5.3 card once", function () {
  const store = { [V.LAST_SEEN_KEY]: "v5" };
  assert.strictEqual(openApp(store, { hasTrips: true, helpHidden: true }), "announce");
  tapOk(store);
  assert.strictEqual(store[V.LAST_SEEN_KEY], "v5.3");
  assert.strictEqual(openApp(store, { hasTrips: true, helpHidden: true }), "none");
  assert.strictEqual(openApp({ [V.LAST_SEEN_KEY]: "v5" }, { hasTrips: false, helpHidden: false }), "announce", "even without trips, a v5 viewer is a returning user");
  assert.strictEqual(openApp({ [V.LAST_SEEN_KEY]: "v5.1" }, { hasTrips: true, helpHidden: true }), "announce", "v5.1 viewer gets the v5.3 card");
  assert.strictEqual(openApp({ [V.LAST_SEEN_KEY]: "v5.2" }, { hasTrips: true, helpHidden: true }), "announce", "v5.2 viewer gets the v5.3 card");
});

check("v5.3 announcement and changelog exactly as the copywriter wrote them (final), no emoji; v5.2 and v5.1 changelog entries untouched", function () {
  assert.strictEqual(V.ANNOUNCEMENT.title, "v5.3 更新");
  assert.deepStrictEqual(V.ANNOUNCEMENT.bullets, [
    "补地址基本不用打字，点一下候选就补好",
    "小红书、微信里复制的地址，可以直接粘进来",
    "搜不到的小店，在地图上长按就能选",
    "待补的地点放在一个面板里，一次补完"
  ], "copywriter's final copy, IT老板 approved");
  V.ANNOUNCEMENT.bullets.forEach((b) => assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(b), "no emoji: " + b));
  assert.deepStrictEqual(V.CHANGELOG[0], {
    version: "v5.3",
    date: "2026-11-16",
    lines: [
      "新增：待补地点自动列出候选，点一下确认；搜不到的在地图上长按选点；待补地点集中在一个面板里补",
      "调整：搜索框能直接粘贴地址；搜索先找附近，没有再搜全球；导入时搜到多个位置不再自动用第一个，放进待补让你确认",
      "调整：点『添加』先选加机票、酒店还是地点；AI 向导只写截图里看得到的地址；放到桌面的引导文字更短了"
    ]
  });
  const css = fs.readFileSync(__dirname + "/styles.css", "utf8");
  assert.ok(/\.announce-list li::before \{[^}]*background: #0F9D8A;/.test(css) && /\.announce-ok \{[^}]*background: #0F9D8A;/.test(css), "teal bullets and button");
  assert.ok(!V.ANNOUNCEMENT.placeholder, "no longer a placeholder");
  assert.deepStrictEqual(V.CHANGELOG[1], {
    version: "v5.2",
    date: "2026-11-16",
    lines: [
      "新增：放到桌面的引导、分级说明书、截图交给 AI 的 3 步向导、行程起名提示、自选图标、搜不到的地点也能先加上，之后点『待补地址』补上位置",
      "修复：导航时店名和地址一起传；没坐标的地点按你当前所在位置选高德或 Google；搜索结果会显示地址，搜错了一眼就能看出来",
      "调整：『带我去』和『看位置』挪进卡片里，点开卡片就能看到；删除单条后，撤销提示缩短到 5 秒"
    ]
  });
  assert.strictEqual(V.ANNOUNCEMENT.tip, "更新不会删除你的行程。如果看到的还是旧版：把网页彻底关掉再打开。放在桌面的，就从后台划掉，再点图标打开。");
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  assert.ok(tl.indexOf("a.bullets.slice(0, 5)") !== -1, "all bullets rendered");
  assert.deepStrictEqual(V.CHANGELOG[2].lines, [
    "日期写法不标准也能自动认，认不出的标黄让你确认",
    "地图新增定位按钮；设置里分成「分享我的行程」和「推荐这个工具」",
    "窄屏排版和日期条标签优化，补齐各款 iPhone 的启动画面"
  ]);
});

check("next release re-announces", function () {
  const d = V.decideOnOpen({ lastSeen: "v5", hasTrips: true, helpHidden: true, current: "v6" });
  assert.strictEqual(d.show, "announce");
});

check("announcement content: title, ≤5 bullets, refresh tip always present", function () {
  const a = V.ANNOUNCEMENT;
  assert.ok(a.title.indexOf(V.APP_VERSION) !== -1, "title names the version");
  assert.ok(a.bullets.length >= 1 && a.bullets.length <= 5);
  assert.strictEqual(a.tip, "更新不会删除你的行程。如果看到的还是旧版：把网页彻底关掉再打开。放在桌面的，就从后台划掉，再点图标打开。");
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  assert.ok(html.indexOf('id="announce-tip"') !== -1 && html.indexOf('id="announce-ok"') !== -1);
  assert.ok(/<img class="announce-illu" src="\.\/icons\/icon-180\.png" width="64" height="64"/.test(html), "app icon instead of the old SVG illustration");
  assert.ok(html.indexOf('<svg class="announce-illu"') === -1);
});

check("changelog v1–v5.3, newest first = APP_VERSION, 1–3 lines each, no hashes or private data", function () {
  assert.deepStrictEqual(V.CHANGELOG.map((v) => v.version), ["v5.3", "v5.2", "v5.1", "v5", "v4", "v3", "v2", "v1"]);
  assert.strictEqual(V.CHANGELOG[0].version, V.APP_VERSION);
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
  assert.ok(sw.indexOf('"./version.js"') !== -1 && sw.indexOf('"xingcheng-map-shell-v16"') !== -1);
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

check("AI prompt (v5.2): year never invented, several screenshots at once, one row per flight leg and per hotel stay", function () {
  const P = require("./ai-prompt.js").TEXT;
  assert.ok(P.indexOf("8. 截图里看不出年份、从下单日期等也推不出来时，日期按截图原样写，不要自己编一个年份") !== -1);
  assert.ok(P.indexOf("9. 我可能一次发好几张截图，请全部整理在一起") !== -1);
  assert.ok(P.indexOf("10. 每段航班单独一行（转机就是两行）；酒店每次入住只写一行「入住日期 ~ 退房日期」，住 3 晚也是一行，中途换酒店才另起一行") !== -1);
  assert.ok(P.indexOf("11. 只输出这些行，放在一个代码块里，不要加任何解释") !== -1);
  assert.ok(!/每晚|每一晚/.test(P), "hotel = one row per stay, never per night");
  assert.ok(!/https?:\/\//.test(P), "no links in the prompt");
});

if (failures) {
  console.log("\n" + failures + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll checks passed.");
