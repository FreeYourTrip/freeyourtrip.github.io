/**
 * v5.2 界面校验：使用说明三层、AI 向导、自选图标。用法：node check-v52-ui.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");

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

check("help: 3 tiers as cards; only tier 1 on first open; privacy line; 常用 grid incl. 改行程名; FAQ collapsed", function () {
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  const css = fs.readFileSync(__dirname + "/styles.css", "utf8");
  assert.ok(tl.indexOf('title: "新手先看这 3 条"') !== -1 && tl.indexOf('title: "常用"') !== -1 && tl.indexOf('title: "需要时再看"') !== -1);
  assert.ok(tl.indexOf('var HELP_PRIVACY_LINE = "发截图前，把护照号、银行卡、手机号裁掉或涂掉";') !== -1 && /class="help-alert-ico" viewBox="0 0 14 14" width="14" height="14"/.test(tl));
  /* 界面不用 emoji（公告 / 更新记录文案和分享文字除外） */
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}]/u;
  const uiSrc = (tl + fs.readFileSync(__dirname + "/index.html", "utf8") + fs.readFileSync(__dirname + "/install-guide.js", "utf8") + fs.readFileSync(__dirname + "/trip-name.js", "utf8")).replace(/✓|✕/g, "");
  assert.ok(!EMOJI.test(uiSrc), "emoji left in UI: " + (uiSrc.match(EMOJI) || [""])[0]);
  [
    '{ key: "add", title: "添加", text: "点「＋ 添加」，输入地名，点一下结果就加好了" }',
    '{ key: "ai", title: "截图交给 AI", text: "机票、酒店截图丢给任意 AI，自动整理成行程" }',
    '{ key: "map", title: "带我去", text: "点开地点卡片，点「带我去」直接打开导航" }'
  ].forEach((l) => assert.ok(tl.indexOf(l) !== -1, l));
  assert.ok(fs.readFileSync(__dirname + "/index.html", "utf8").indexOf('id="add-fab" aria-haspopup="dialog" aria-controls="add-sheet">＋ 添加<') !== -1, "the help names the real button label");
  ["看行程", "改和删", "地图", "分享我的行程", "放到桌面", "改行程名"].forEach((t) => assert.ok(tl.indexOf('title: "' + t + '"') !== -1, t));
  /* 第 3 层原文（广告文案宣传大师） */
  [
    '{ q: "换手机", a: "在设置里点「完整备份」，到新手机上点「导入」" }',
    '{ q: "更新", a: "看到的还是旧版，就把网页彻底关掉再打开" }',
    '{ q: "隐私", a: "行程只存在你手机里，没有账号，我们看不到。搜索和导航时，地名、地址和大概位置会发给地图服务" }',
    '{ q: "清空", a: "在设置里点「清空本机数据」，会删掉所有行程" }'
  ].forEach((l) => assert.ok(tl.indexOf(l) !== -1, l));
  /* 文案里提到的按钮名、行为都真实存在 */
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  ['id="backup-export-full"', ">完整备份<", ">导入<", ">清空本机数据<", 'id="locate-btn"'].forEach((k) => assert.ok(html.indexOf(k) !== -1, k));
  const B = require("./backup.js");
  const shared = B.redactItem({ nameZh: "示例航班", confirmationNo: "ABC123", seat: "12A", note: "确认号 ABC123 座位 12A 靠窗" });
  assert.ok(!shared.confirmationNo && !shared.seat && shared.note === "靠窗", "分享我的行程 hides 订单号 / 座位");
  assert.ok(tl.indexOf('{ key: "rename", icon: "pencil", title: "改行程名", text: "点左上角的名字或铅笔" }') !== -1);
  assert.ok(/<details class="help-faq">/.test(tl), "FAQ uses collapsed <details>");
  assert.ok(/openHelp\("first"\)/.test(tl) && /\.help-sheet\.help-first \.help-tier-2,\s*\.help-sheet\.help-first \.help-tier-3 \{ display: none; \}/.test(css));
  assert.ok(/scroll-snap-type: x mandatory/.test(css), "swipeable cards");
  assert.ok(tl.indexOf('aria-label="插图占位"') !== -1, "self-drawn placeholder illustrations");
  assert.ok(tl.indexOf("删错了，马上点底部的「撤销」就能恢复") !== -1);
});

check("AI wizard: big button on top, 1-2-3 progress, exact copy, clipboard read + fallback, no links", function () {
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  assert.ok(html.indexOf('id="ai-big-btn"') !== -1 && html.indexOf('id="ai-big-btn"') < html.indexOf('id="add-search-block"'), "big button above search");
  assert.ok(html.indexOf('<details class="fold add-only" id="ai-help">') === -1, "not folded any more");
  const C = {
    title: "截图交给 AI，自动排好行程",
    step1: "点「复制给 AI 的话」，复制完按钮显示「已复制 ✓」",
    copied: "已复制 ✓",
    step2: "打开你常用的 AI（豆包、Kimi、DeepSeek、ChatGPT 都行），先粘贴，再把截图发过去",
    step2Small: "不会截图？iPhone 同时按侧边键和音量加键",
    privacy: "发截图前，把护照号、银行卡、手机号裁掉或涂掉",
    step3: "把 AI 的回复整段复制，回来点「粘贴并导入」",
    step3Small: "手机弹出「粘贴」或「允许」时，再点一下就行",
    pasteBtn: "粘贴并导入",
    fallbackHint: "长按这里，选『粘贴』，再点『添加』"
  };
  Object.keys(C).forEach((k) => assert.ok(tl.indexOf(k + ': "' + C[k] + '"') !== -1, k));
  assert.ok(tl.indexOf("navigator.clipboard.readText()") !== -1);
  assert.ok(/function \(\) \{\s*showAiFallback\(\);\s*\}\);/.test(tl), "denied / failed → paste box opens");
  assert.ok(/aiLeftPage && aiStep === 2/.test(tl), "auto-advance to ③ after coming back from the AI");
  const wiz = html.slice(html.indexOf('id="ai-help"'), html.indexOf('id="manual-fold"'));
  assert.ok(!/https?:\/\//.test(wiz) && !/https?:\/\//.test(tl.slice(tl.indexOf("var AI_WIZARD_COPY"), tl.indexOf("var aiStep"))), "no links to AI sites");
});

check("icon picker: 4×2, 52px round, two-character labels, one colour map", function () {
  const I = require("./icons.js");
  assert.strictEqual(I.CATEGORIES.length, 8);
  I.CATEGORIES.forEach((c) => assert.strictEqual([...c.label].length, 2, c.label));
  const col = (k) => I.categoryMeta(k).color;
  assert.strictEqual(col("sight"), "#27AE60"); assert.strictEqual(col("nature"), "#27AE60");
  assert.strictEqual(col("food"), "#F2994A"); assert.strictEqual(col("dessert"), "#F2994A");
  assert.strictEqual(col("shop"), "#E26D9B"); assert.strictEqual(col("hotel"), "#8E5CF7");
  assert.strictEqual(col("transport"), "#6B7A8F");
  assert.deepStrictEqual([I.categoryMeta("other").color, I.categoryMeta("other").tint], ["#2B2B2B", "#EEE7DA"]);
  assert.strictEqual(new Set(I.CATEGORIES.map((c) => c.icon)).size, 8, "icons distinct within each colour group");
  assert.strictEqual(I.typeMeta({ type: "place", icon: "dessert" }).icon, "dessert");
  assert.strictEqual(I.typeMeta({ type: "flight", icon: "dessert" }).icon, "flight", "flights keep the plane");
  const src = fs.readFileSync(__dirname + "/icons.js", "utf8");
  assert.strictEqual((src.match(/#[0-9A-F]{6}\b/gi) || []).length, 12, "colours only in PALETTE");
  const css = fs.readFileSync(__dirname + "/styles.css", "utf8");
  assert.ok(/\.icon-picker \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/.test(css));
  assert.ok(/\.icon-dot \{\s*width: 52px;\s*height: 52px;\s*border-radius: 50%;/.test(css));
});

check("nav lives inside the expanded card only: no row between cards, hint once, none on flights, rules kept", function () {
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  const css = fs.readFileSync(__dirname + "/styles.css", "utf8");
  assert.ok(tl.indexOf("conn-slot-pair") === -1 && tl.indexOf("function firstPill") === -1 && tl.indexOf("navSlotHtml") === -1, "no full-width row between cards");
  const cs = tl.slice(tl.indexOf("function connectorSlot"), tl.indexOf("function connectorInto"));
  assert.ok(/if \(conn\.kind === "transfer"\) return transferHtml\(conn\.label\);\s*return "";/.test(cs), "only layover bars stay between cards");
  const cn = tl.slice(tl.indexOf("function cardNavHtml"), tl.indexOf("function cardHtml"));
  assert.ok(/if \(!item \|\| item\.type === "flight"\) return "";/.test(cn), "flight cards: no nav");
  assert.ok(/origin = prevIsFlight \? null : conn\.from \|\| null;/.test(cn), "previous flight is never the origin");
  assert.ok(/navPairHtml\(navPlan\(origin, cardTarget\(item\)\)/.test(cn), "same rules (待补地址 / >300 km / Google-高德 / transit hint) via navPlan + navPairHtml");
  assert.ok(/extra\.push\(cardNavHtml\(item, conn\)\);/.test(tl) && /'<div class="card-extra">' \+\s*extra\.join\(""\)/.test(tl), "rendered inside .card-extra (shown after ⌄)");
  assert.ok(/cardHtml\(item, i === 0 \? null : connectorInto\(connectors, item\.id\)\)/.test(tl), "first stop of the day starts from my location");
  assert.ok(/\.card\.is-open \.card-extra \{ display: block; \}/.test(css) && /\.card-nav, \.detail-nav \{ margin: 8px 0 4px; \}/.test(css), "hidden until expanded; 8px gap");
});

check("no coords + no known location → 「Google 地图」+「高德」 with the hint; location known → one app auto-picked, no hint", function () {
  const G = require("./geo.js");
  const dest = { name: "示例小店", address: "示例路 1 号" };
  assert.strictEqual(G.navChoice(dest, null), "choose", "position unknown → let the user pick");
  assert.strictEqual(G.navChoice(dest, { lat: 31.23, lng: 121.47 }), "auto", "in mainland → auto");
  assert.strictEqual(G.recommendFlexible(null, dest, { lat: 31.23, lng: 121.47 }), "amap");
  assert.strictEqual(G.navChoice(dest, { lat: 51.5, lng: -0.12 }), "auto");
  assert.strictEqual(G.recommendFlexible(null, dest, { lat: 51.5, lng: -0.12 }), "google");
  assert.strictEqual(G.navChoice({ name: "有坐标", lat: 51.5, lng: -0.1 }, null), "auto", "coords → always auto");
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  assert.ok(/if \(G\.navChoice\(dest, here\) === "choose"\) \{\s*return \{ state: "choose", googleHref: links\.google, amapHref: links\.amap \};/.test(tl));
  const pair = tl.slice(tl.indexOf("function navPairHtml"), tl.indexOf("function navPillHtml"));
  assert.ok(/plan\.state === "choose"[\s\S]*?NAV_COPY\.google[\s\S]*?NAV_COPY\.amap[\s\S]*?line = NAV_COPY\.noCoords;/.test(pair), "two buttons + hint");
  assert.ok(pair.split("NAV_COPY.noCoords").length === 2, "hint only in the choose state");
  assert.ok(tl.indexOf('google: "Google 地图"') !== -1 && tl.indexOf('amap: "高德"') !== -1);
  const css = fs.readFileSync(__dirname + "/styles.css", "utf8");
  assert.ok(/\.nav-look\.nav-app \{ flex: 1 1 0;/.test(css) && /\.nav-line \{[^}]*font-size: 12px; color: #8A9099;/.test(css), "side by side; 12px #8A9099 hint");
});

check("not-found copy no longer claims nav works without a location", function () {
  const Geo = require("./geocode.js");
  assert.strictEqual(Geo.FRIENDLY_NOT_FOUND, "暂时找不到位置，可以先直接添加，之后再补地址");
  const src = ["timeline.js", "geocode.js", "index.html", "README.md"].map((f) => fs.readFileSync(__dirname + "/" + f, "utf8")).join("\n");
  assert.ok(src.indexOf("不影响「带我去」") === -1 && src.indexOf("不影响『带我去』") === -1);
});

if (failures) {
  console.log("\n" + failures + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll v5.2 UI checks passed.");
