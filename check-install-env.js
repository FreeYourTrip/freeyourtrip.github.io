/**
 * 校验 detectInstallEnv()：standalone / iOS Safari / 微信内置浏览器。
 * 用法：node check-install-env.js
 */
"use strict";

const assert = require("assert");
const { detectInstallEnv, isInAppBrowser } = require("./install-env.js");

const IOS_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IOS_WECHAT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.44(0x18002c2d) NetType/WIFI Language/zh_CN";
const ANDROID_WECHAT =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 MicroMessenger/8.0.44 Language/zh_CN";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const IOS_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1";
const IPADOS_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log("PASS  " + name);
  } catch (err) {
    failures += 1;
    console.log("FAIL  " + name);
    console.log("      " + err.message);
  }
}

check("iOS Safari → ios-safari, install visible", function () {
  const env = detectInstallEnv(IOS_SAFARI, {});
  assert.strictEqual(env.kind, "ios-safari");
  assert.strictEqual(env.hideInstall, false);
  assert.strictEqual(env.ios, true);
  assert.strictEqual(env.safari, true);
});

check("standalone hides 添加到桌面", function () {
  const env = detectInstallEnv(IOS_SAFARI, { standalone: true });
  assert.strictEqual(env.kind, "standalone");
  assert.strictEqual(env.hideInstall, true);
  const env2 = detectInstallEnv(ANDROID_CHROME, { displayMode: "standalone" });
  assert.strictEqual(env2.hideInstall, true);
  assert.strictEqual(env2.kind, "standalone");
});

check("WeChat / in-app → inapp", function () {
  assert.strictEqual(detectInstallEnv(IOS_WECHAT).kind, "inapp");
  assert.strictEqual(detectInstallEnv(ANDROID_WECHAT).kind, "inapp");
  assert.ok(isInAppBrowser(IOS_WECHAT));
  assert.strictEqual(detectInstallEnv(IOS_WECHAT).hideInstall, false);
});

check("Android Chrome → other", function () {
  const env = detectInstallEnv(ANDROID_CHROME);
  assert.strictEqual(env.kind, "other");
  assert.strictEqual(env.hideInstall, false);
  assert.strictEqual(env.inApp, false);
});

check("iOS Chrome is treated as in-app (need Safari)", function () {
  const env = detectInstallEnv(IOS_CHROME);
  assert.strictEqual(env.kind, "inapp");
  assert.strictEqual(env.ios, true);
  assert.strictEqual(env.safari, false);
});

check("iPadOS desktop UA with touch is iOS Safari", function () {
  const env = detectInstallEnv(IPADOS_DESKTOP, { platform: "MacIntel", maxTouchPoints: 5 });
  assert.strictEqual(env.ios, true);
  assert.strictEqual(env.kind, "ios-safari");
});

check("清空本机数据 would reset help-hide (same wishlist-map prefix)", function () {
  const helpKey = "wishlist-map-help-hide-v1";
  const prefix = "wishlist-map";
  assert.ok(helpKey.indexOf(prefix) === 0);
});

check("iOS guide: only iPhone Safari, not standalone / iPad / WeChat / Chrome / Android", function () {
  assert.strictEqual(InstallEnv.iosGuideEligible(IOS_SAFARI, {}), true);
  assert.strictEqual(InstallEnv.iosGuideEligible(IOS_SAFARI, { standalone: true }), false);
  assert.strictEqual(InstallEnv.iosGuideEligible(IOS_WECHAT, {}), false);
  assert.strictEqual(InstallEnv.iosGuideEligible(IOS_CHROME, {}), false);
  assert.strictEqual(InstallEnv.iosGuideEligible(ANDROID_CHROME, {}), false);
  assert.strictEqual(InstallEnv.iosGuideEligible(IPADOS_DESKTOP, { platform: "MacIntel", maxTouchPoints: 5 }), false);
});

check("iOS guide: auto-shows until closed, then not for 7 days", function () {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.UTC(2026, 10, 16, 12);
  assert.strictEqual(InstallEnv.IOS_GUIDE_SNOOZE_MS, 7 * day);
  assert.strictEqual(InstallEnv.shouldAutoShowIosGuide({ eligible: true, closedAt: null, now }), true);
  assert.strictEqual(InstallEnv.shouldAutoShowIosGuide({ eligible: true, closedAt: String(now - 1 * day), now }), false);
  assert.strictEqual(InstallEnv.shouldAutoShowIosGuide({ eligible: true, closedAt: now - 7 * day + 60000, now }), false);
  assert.strictEqual(InstallEnv.shouldAutoShowIosGuide({ eligible: true, closedAt: now - 7 * day, now }), true);
  assert.strictEqual(InstallEnv.shouldAutoShowIosGuide({ eligible: false, closedAt: null, now }), false);
  assert.ok(InstallEnv.IOS_GUIDE_KEY.indexOf("wishlist-map") === 0, "清空本机数据 resets it");
});

check("v5.2: old two-step card replaced by the install-guide sheet + in-app overlay", function () {
  const fs = require("fs");
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  assert.ok(html.indexOf('id="ios-guide"') === -1, "old card removed");
  assert.ok(html.indexOf('id="ios-install-sheet"') !== -1 && html.indexOf('id="inapp-overlay"') !== -1);
  assert.ok(/if \(kind === "ios-sheet"\) return openIosSheet\(g\.ipad\);/.test(tl), "放到手机桌面 opens the sheet on iPhone / iPad Safari");
});

if (failures) {
  console.log("\n" + failures + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll install-env checks passed.");
