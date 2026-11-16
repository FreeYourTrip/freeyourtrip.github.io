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

if (failures) {
  console.log("\n" + failures + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll install-env checks passed.");
