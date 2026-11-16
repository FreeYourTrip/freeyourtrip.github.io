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

check("version is v6.0, defined once", function () {
  assert.strictEqual(V.APP_VERSION, "v6.0");
  assert.strictEqual(V.versionLabel(), "当前版本 v6.0 · 2026-11-16");
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
  assert.strictEqual(store[V.LAST_SEEN_KEY], "v6.0");
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

check("someone who already saw v5, v5.1 … v5.4 gets the v6.0 card once", function () {
  const store = { [V.LAST_SEEN_KEY]: "v5" };
  assert.strictEqual(openApp(store, { hasTrips: true, helpHidden: true }), "announce");
  tapOk(store);
  assert.strictEqual(store[V.LAST_SEEN_KEY], "v6.0");
  assert.strictEqual(openApp(store, { hasTrips: true, helpHidden: true }), "none");
  assert.strictEqual(openApp({ [V.LAST_SEEN_KEY]: "v5" }, { hasTrips: false, helpHidden: false }), "announce", "even without trips, a v5 viewer is a returning user");
  assert.strictEqual(openApp({ [V.LAST_SEEN_KEY]: "v5.1" }, { hasTrips: true, helpHidden: true }), "announce", "v5.1 viewer gets the v6 card");
  assert.strictEqual(openApp({ [V.LAST_SEEN_KEY]: "v5.2" }, { hasTrips: true, helpHidden: true }), "announce", "v5.2 viewer gets the v6 card");
  assert.strictEqual(openApp({ [V.LAST_SEEN_KEY]: "v5.3" }, { hasTrips: true, helpHidden: true }), "announce", "v5.3 viewer gets the v6 card");
  assert.strictEqual(openApp({ [V.LAST_SEEN_KEY]: "v5.4" }, { hasTrips: true, helpHidden: true }), "announce", "v5.4 viewer gets the v6 card");
});

check("v6.0 announcement + changelog are signed off, no emoji; v5.4 / v5.3 / v5.2 / v5.1 entries untouched", function () {
  assert.strictEqual(V.ANNOUNCEMENT.title, "v6.0 大更新");
  assert.ok(!V.ANNOUNCEMENT.draft, "v6.0 copy is signed off");
  assert.strictEqual(V.CHANGELOG[0].version, "v6.0");
  assert.ok(!V.CHANGELOG[0].draft, "changelog signed off");
  assert.ok(!/draft:\s*true/.test(fs.readFileSync(__dirname + "/version.js", "utf8")), "no draft:true left");
  V.ANNOUNCEMENT.bullets.concat(V.CHANGELOG[0].lines).forEach((b) => assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(b), "no emoji: " + b));
  ["一屏", "保证", "永不丢失"].forEach((w) => V.ANNOUNCEMENT.bullets.concat(V.CHANGELOG[0].lines).forEach((b) => assert.ok(b.indexOf(w) === -1, "no over-promise: " + w)));
  assert.ok(V.ANNOUNCEMENT.bullets.length >= 1 && V.ANNOUNCEMENT.bullets.length <= 5);
  assert.deepStrictEqual(V.CHANGELOG[1], {
    version: "v5.4",
    date: "2026-11-16",
    lines: [
      "新增：长按卡片，在同一天里拖动换顺序，机票固定不动；拖完 5 秒内可以撤销",
      "新增：两站之间显示直线距离和『路线』，点一下从上一站导航到下一站；当天最后一站显示『回酒店』；缺位置的显示「补位置」",
      "新增：往返机票自动标「去程」「回程」；手动加机票可以点『再加一张返程』",
      "调整：加酒店要先选入住和退房日期，退房那天多一张「退房」卡；『带我去』挪到卡片右边，从你现在的位置出发",
      "调整：导入机票时，落地比起飞早的会先问一句；几处界面颜色和间距统一了"
    ]
  });
  const v53 = V.CHANGELOG.find((e) => e.version === "v5.3");
  assert.deepStrictEqual(v53, {
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
  assert.deepStrictEqual(V.CHANGELOG[3], {
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
  assert.deepStrictEqual(V.CHANGELOG[4].lines, [
    "日期写法不标准也能自动认，认不出的标黄让你确认",
    "地图新增定位按钮；设置里分成「分享我的行程」和「推荐这个工具」",
    "窄屏排版和日期条标签优化，补齐各款 iPhone 的启动画面"
  ]);
});

check("next release re-announces", function () {
  const d = V.decideOnOpen({ lastSeen: "v5", hasTrips: true, helpHidden: true, current: "v6.0" });
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

check("v6.0 changelog lines are the signed-off copy (incl. bus lock + date strip)", function () {
  assert.deepStrictEqual(V.CHANGELOG[0].lines, [
    "新增：可以存好几个行程，点顶部的行程名切换、新建、改名、删除；原来的行程自动放进「我的行程」",
    "新增：火车、船、大巴可以导入，有自己的图标，时间旁边标「当地时间」；火车、船、大巴跟机票一样不能拖",
    "新增：长按卡片可以拖到别的日子，也能拖进「还没定哪天」，5 秒内可以撤销；有酒店或机票、车票、船票的行程，「全部」按日期一天一栏",
    "新增：备注跟着地点走，同一个地方加进别的行程，上次写的备注还在",
    "新增：手动加机票可以选去程、返程、转机",
    "调整：『清空全部』改成『清空这趟』，只清当前这一趟；『清空本机数据』挪到使用说明最下面；导入已有的行程会先问覆盖还是另存一份；旧备份照样能导入",
    "调整：「甜品」改叫「咖啡甜点酒吧」；『给 AI 的话』『分享给朋友』『找不到？换个方式加』各合成一个入口；手动填写的图标少了「酒店」「交通」",
    "调整：导入时分不清月和日的日期会问一句；缺日期的酒店先放进「待补」",
    "调整：打开行程时，日期条直接停在第一天那一周；旅行中停在今天，整趟结束了停在最后一天",
    "修复：长按卡片不再选中文字；退房卡的文字不再被『带我去』挡住",
    "修复：往返中间没订酒店时，误显示成转机"
  ]);
  assert.deepStrictEqual(V.ANNOUNCEMENT.bullets, [
    "能存好几个行程了：点顶部的行程名，切换、新建、改名、删除都在这里",
    "火车、船、大巴也能导入，跟机票一样按时间排好，时间旁边标着「当地时间」",
    "长按卡片能拖到别的日子；有酒店或票的行程，「全部」里一天一栏，没定日子的放在最下面「还没定哪天」",
    "同一个地方加进别的行程，上次写的备注会跟过来",
    "原来的行程已经自动放进「我的行程」，内容不变"
  ]);
});

check("changelog v1–v6.0, newest first = APP_VERSION, no hashes or private data", function () {
  assert.deepStrictEqual(V.CHANGELOG.map((v) => v.version), ["v6.0", "v5.4", "v5.3", "v5.2", "v5.1", "v5", "v4", "v3", "v2", "v1"]);
  assert.strictEqual(V.CHANGELOG[0].version, V.APP_VERSION);
  assert.strictEqual(V.CHANGELOG[1].lines.length, 5, "v5.4 copywriter copy is 5 lines");
  V.CHANGELOG.forEach((v) => {
    const max = v.version === "v6.0" ? 12 : 5;
    assert.ok(v.lines.length >= 1 && v.lines.length <= max, v.version + " has " + v.lines.length + " lines");
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
  assert.ok(sw.indexOf('"./version.js"') !== -1 && sw.indexOf('"xingcheng-map-shell-v18"') !== -1);
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
  assert.ok(P.indexOf("8. 截图里看不出年份、从下单日期等也推不出来时，日期那一格留空，不要自己编年份") !== -1);
  assert.ok(P.indexOf("截图里日月分不清（如 04/12），按原样写，别自己换算") !== -1);
  assert.ok(P.indexOf("9. 我可能一次发好几张截图，请全部整理在一起") !== -1);
  assert.ok(P.indexOf("10. 每段航班单独一行（转机就是两行）；往返机票必须拆成两行（去程一行、返程一行），各写各的日期；酒店每次入住只写一行「入住日期 ~ 退房日期」，住 3 晚也是一行，中途换酒店才另起一行") !== -1);
  assert.ok(P.indexOf("11. 只输出这些行，放在一个代码块里，不要加任何解释") !== -1);
  assert.ok(!/每晚|每一晚/.test(P), "hotel = one row per stay, never per night");
  assert.ok(!/https?:\/\//.test(P), "no links in the prompt");
});

if (failures) {
  console.log("\n" + failures + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll checks passed.");
