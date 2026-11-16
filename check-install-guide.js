/**
 * v5.2「放到手机桌面」引导：UA 矩阵、自动弹出规则、存储键、文案、没有新域名。用法：node check-install-guide.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
global.InstallEnv = require("./install-env.js");
const G = require("./install-guide.js");
const E = global.InstallEnv;

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

const UA = {
  wechatIOS: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50(0x1800322d) NetType/WIFI Language/zh_CN",
  wechatAndroid: "Mozilla/5.0 (Linux; Android 14; V2309A Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0 Mobile Safari/537.36 XWEB/1160065 MMWEBSDK/20231202 MicroMessenger/8.0.47.2560(0x28002F30) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64",
  iosSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iosChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1",
  ipadSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  desktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
};
function guide(ua, hints, opts) {
  return G.guideFor(E.detectInstallEnv(ua, hints || {}), ua, hints || {}, opts || {});
}

check("UA matrix → which guide", function () {
  assert.deepStrictEqual(guide(UA.wechatIOS), { kind: "inapp", variant: "wechat", ipad: false });
  assert.deepStrictEqual(guide(UA.wechatAndroid), { kind: "inapp", variant: "wechat", ipad: false });
  assert.deepStrictEqual(guide(UA.iosSafari), { kind: "ios-sheet", variant: "", ipad: false });
  assert.deepStrictEqual(guide(UA.iosChrome), { kind: "inapp", variant: "ios-other", ipad: false }, "iOS Chrome → told to use Safari");
  assert.deepStrictEqual(guide(UA.ipadSafari, { platform: "MacIntel", maxTouchPoints: 5 }), { kind: "ios-sheet", variant: "", ipad: true }, "iPad → arrow top-right");
  assert.strictEqual(guide(UA.iosSafari, { standalone: true }).kind, "none", "standalone: nothing");
  assert.strictEqual(guide(UA.androidChrome).kind, "android-steps");
  assert.strictEqual(guide(UA.androidChrome, {}, { hasPrompt: true }).kind, "android-prompt");
  assert.strictEqual(guide(UA.desktop).kind, "desktop");
});

check("final copy, kept in one place", function () {
  const C = G.COPY;
  assert.strictEqual(C.wechatText, "微信里没法放到桌面。点右上角 ···，选『在 Safari 中打开』或『在默认浏览器中打开』");
  assert.strictEqual(C.copyUrl, "复制网址");
  assert.strictEqual(C.iosTitle, "放到桌面，像 App 一样打开");
  assert.deepStrictEqual(C.iosSteps, ["点底部的分享按钮（方框加向上箭头）。没看到就先点「···」", "往下滑，选「添加到主屏幕」", "点右上角「添加」"]);
  assert.strictEqual(C.done, "我加好了");
  assert.strictEqual(C.later, "下次再说");
  assert.strictEqual(C.hasItemsNote, "桌面打开后看不到这里的行程。请先在设置里点『完整备份』，再到桌面那边点『导入』。");
  assert.strictEqual(C.settingsLabel, "放到手机桌面");
  assert.strictEqual(C.settingsSub, "像 App 一样，点图标就打开");
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  assert.ok(html.indexOf('>完整备份<') !== -1 && html.indexOf('>导入<') !== -1, "the note names real buttons");
  assert.ok(html.indexOf('id="install-btn" data-sub="像 App 一样，点图标就打开">放到手机桌面<') !== -1);
  assert.ok(html.indexOf(">添加到桌面<") === -1, "old label gone");
});

check("auto-show rules: no items → show; popup this open → next open; snooze 7 days; done never; with items once", function () {
  const day = 86400000;
  const now = Date.UTC(2026, 10, 16, 12);
  const ios = { kind: "ios-sheet" };
  assert.strictEqual(G.SNOOZE_MS, 7 * day);
  assert.strictEqual(G.shouldAutoShow({ guide: ios, now, hasItems: false }), true);
  assert.strictEqual(G.shouldAutoShow({ guide: ios, now, hasItems: false, popupThisOpen: true }), false, "help / announcement shown this open");
  assert.strictEqual(G.shouldAutoShow({ guide: ios, now, snoozedAt: now - 6 * day }), false);
  assert.strictEqual(G.shouldAutoShow({ guide: ios, now, snoozedAt: now - 7 * day }), true);
  assert.strictEqual(G.shouldAutoShow({ guide: ios, now, done: true }), false, "我加好了 → never");
  assert.strictEqual(G.shouldAutoShow({ guide: ios, now, hasItems: true, itemsShown: false }), true, "with items: once");
  assert.strictEqual(G.shouldAutoShow({ guide: ios, now, hasItems: true, itemsShown: true }), false);
  assert.strictEqual(G.shouldAutoShow({ guide: { kind: "inapp" }, now }), true, "WeChat overlay follows the same rules");
  ["none", "desktop", "android-steps", "android-prompt"].forEach((k) => assert.strictEqual(G.shouldAutoShow({ guide: { kind: k }, now }), false, k + " never auto"));
  assert.strictEqual(G.showItemsNote(ios, true), G.SHOW_SEPARATE_STORAGE_NOTE);
  assert.strictEqual(G.showItemsNote(ios, false), false);
});

check("storage: only three guide-state keys, all under the wishlist-map prefix (清空本机数据 resets them)", function () {
  assert.deepStrictEqual(G.STORAGE_KEYS, ["wishlist-map-install-guide-done-v1", "wishlist-map-install-guide-snooze-v1", "wishlist-map-install-guide-items-shown-v1"]);
  const src = fs.readFileSync(__dirname + "/install-guide.js", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ["localStorage", "sessionStorage", "fetch(", "XMLHttpRequest", "sendBeacon", "document.cookie"].forEach((bad) => assert.ok(src.indexOf(bad) === -1, bad));
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  const block = tl.slice(tl.indexOf("v5.2「放到手机桌面」引导"), tl.indexOf("function renderInstallBody"));
  const writes = block.match(/lsSet\(([^,]+),/g) || [];
  writes.forEach((w) => assert.ok(/InstallGuide\.(DONE_KEY|SNOOZE_KEY|ITEMS_SHOWN_KEY)/.test(w), "only guide keys are written: " + w));
  assert.strictEqual(G.shareableUrl({ origin: "https://example.test", pathname: "/", search: "?demo=x" }), "https://example.test/", "copied URL has no query");
});

check("wiring: order with other popups, standalone hidden, no new external hosts", function () {
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  assert.ok(/if \(!repeatHelp\) maybeAutoGuide\(openFlowPopup\);/.test(tl), "never on the same open as the first help / announcement");
  assert.ok(/if \(pendingNameSuggest \|\| namePopOpen\) return;/.test(tl), "name suggestion first, guide after it");
  assert.ok(/if \(settingsBtn\) settingsBtn\.hidden = hideAll;/.test(tl), "settings entry hidden in standalone");
  const files = ["install-guide.js", "index.html"].map((f) => fs.readFileSync(__dirname + "/" + f, "utf8")).join("\n");
  const hosts = (files.match(/https?:\/\/[a-z0-9.-]+/gi) || []).filter((h) => !/w3\.org/.test(h));
  assert.deepStrictEqual(hosts.filter((h) => !/freeyourtrip\.github\.io/.test(h)), [], "no new hosts: " + hosts.join(","));
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  assert.ok(html.indexOf('src="./install-guide.js"') !== -1 && fs.readFileSync(__dirname + "/sw.js", "utf8").indexOf('"./install-guide.js"') !== -1);
  assert.ok(/class="ig-arrow"/.test(html) && /class="ig-arrow-ipad"/.test(html) && /class="inapp-arrow"/.test(html), "arrows: bottom (iPhone), top-right (iPad, WeChat)");
  const css = fs.readFileSync(__dirname + "/styles.css", "utf8");
  assert.ok(/prefers-reduced-motion: reduce\) \{\s*\.inapp-arrow, \.ig-arrow, \.ig-arrow-ipad \{ animation: none; \}/.test(css));
  /* v5.2 引导图（UI 出图）：本地 ./guide/*.webp，预缓存；圆角 12、宽度铺满、高度按比例；非微信 App 也用 01-wechat.webp */
  const sw = fs.readFileSync(__dirname + "/sw.js", "utf8");
  ["01-wechat", "02-safari-classic-share-focus", "03-safari-ios26-more-focus", "04-share-sheet-add-focus", "05-add-confirm-focus", "ipad-share"].forEach((n) => {
    assert.ok(fs.existsSync(__dirname + "/guide/" + n + ".webp"), n);
    assert.ok(sw.indexOf('"./guide/' + n + '.webp"') !== -1, "precached: " + n);
  });
  ["02-safari-classic-share", "03-safari-ios26-more", "04-share-sheet-add", "05-add-confirm"].forEach((n) => assert.ok(sw.indexOf('"./guide/' + n + '.webp"') === -1 && tl.indexOf("./guide/" + n + ".webp") === -1, "full image no longer used: " + n));
  assert.ok(tl.indexOf('"inapp-menu": { src: "./guide/01-wechat.webp"') !== -1 && tl.indexOf('"wechat": { src: "./guide/01-wechat.webp"') !== -1);
  assert.ok(/\.ig-img \{ display: block; width: 100%; height: auto; border-radius: 12px; \}/.test(css));
  assert.ok(!/https?:\/\//.test(tl.slice(tl.indexOf("var GUIDE_IMAGES"), tl.indexOf("function igSlot"))), "no external hosts");
  /* 引导里不再用蓝色 #4C8DFF，统一青绿 #0F9D8A */
  const guideHtml = html.slice(html.indexOf('id="inapp-overlay"'), html.indexOf('id="toast"'));
  assert.ok(guideHtml.indexOf("#4C8DFF") === -1 && (guideHtml.match(/stroke="#0F9D8A"/g) || []).length >= 2, "arrows teal");
});

check("open order: first help / announcement → guide waits for next open; repeat auto-help → guide after help closes", function () {
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  assert.ok(tl.indexOf('openFlowPopup = decision.show === "announce" || (decision.show === "help" && !!decision.markSeenNow);') !== -1);
  assert.ok(tl.indexOf("if (!repeatHelp) maybeAutoGuide(openFlowPopup);") !== -1);
  const f = tl.slice(tl.indexOf("function afterOpenDialogClosed"), tl.indexOf("function afterOpenDialogClosed") + 200);
  assert.ok(/if \(!guideAfterHelp\) return;/.test(f) && /maybeAutoGuide\(false\)/.test(f), "sequential, never together");
  assert.ok(/closeSheet\("help-sheet"\);\s*afterOpenDialogClosed\(\);/.test(tl));
});

if (failures) {
  console.log("\n" + failures + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll install-guide checks passed.");
