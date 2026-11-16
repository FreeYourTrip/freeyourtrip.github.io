/**
 * 「有新版本」居中弹窗与 service worker 更新规则校验。用法：node check-update.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const UB = require("./update-banner.js");

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

function fakeSession() {
  const m = {};
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; }
  };
}
const waiting = { hasWaiting: true, hasController: true };

check("shows when a new version is waiting", function () {
  assert.strictEqual(UB.shouldShow(waiting, fakeSession()), true);
});

check("never shows on first visit (no controller) or when nothing is waiting", function () {
  assert.strictEqual(UB.shouldShow({ hasWaiting: true, hasController: false }, fakeSession()), false);
  assert.strictEqual(UB.shouldShow({ hasWaiting: false, hasController: true }, fakeSession()), false);
});

check("稍后 hides it for the rest of this session", function () {
  const s = fakeSession();
  UB.markLater(s);
  assert.strictEqual(UB.shouldShow(waiting, s), false);
  assert.strictEqual(UB.laterThisSession(s), true);
});

check("稍后 re-shows on next load (new session) if update still waiting", function () {
  const s1 = fakeSession();
  UB.markLater(s1);
  assert.strictEqual(UB.shouldShow(waiting, s1), false);
  const s2 = fakeSession(); // 下次打开：sessionStorage 是新的
  assert.strictEqual(UB.shouldShow(waiting, s2), true);
  assert.strictEqual(UB.shouldShow({ hasWaiting: false, hasController: true }, s2), false, "already updated -> no banner");
});

check("storage errors do not break the app", function () {
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.doesNotThrow(() => UB.markLater(broken));
  assert.strictEqual(UB.shouldShow(waiting, broken), true);
  assert.strictEqual(UB.shouldShow(waiting, null), true);
});

check("sw.js never forces updates and keeps offline fallback", function () {
  const sw = fs.readFileSync(__dirname + "/sw.js", "utf8");
  const install = sw.slice(sw.indexOf('addEventListener("install"'), sw.indexOf('addEventListener("message"'));
  assert.ok(install.indexOf("skipWaiting()") === -1, "install must not call skipWaiting");
  assert.ok(/SKIP_WAITING[\s\S]*self\.skipWaiting\(\)/.test(sw), "skipWaiting only on user message");
  assert.ok(sw.indexOf('"xingcheng-map-shell-v19"') !== -1);
  assert.ok(sw.indexOf('"./update-banner.js"') !== -1);
  assert.ok(/return cached \|\| fresh/.test(sw), "cache-first so offline opens the cached version");
  assert.ok(/catch\(function \(\) \{\s*return cached \|\| caches\.match\("\.\/index\.html"\)/.test(sw), "offline fallback to cached index");
});

check("banner markup, texts and help line", function () {
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  assert.ok(html.indexOf('id="update-banner"') !== -1);
  assert.ok(html.indexOf('class="update-mask"') !== -1 && html.indexOf('class="update-card"') !== -1, "centred popup");
  assert.ok(html.indexOf(">有新版本<") !== -1);
  assert.ok(html.indexOf("刷新一次就能用上，行程不会丢") !== -1);
  assert.ok(html.indexOf(">稍后<") !== -1 && html.indexOf(">立即更新<") !== -1);
  assert.ok(html.indexOf('src="./update-banner.js"') !== -1);
  assert.ok(html.indexOf("serviceWorker.register") === -1, "registration lives in update-banner.js only");
  assert.ok(tl.indexOf('{ q: "更新", a: "看到「有新版本」就点『立即更新』，行程不会丢。还是旧版，就把网页彻底关掉再打开" }') !== -1, "help 更新");
});

check("works at root (freeyourtrip.github.io/) or any subfolder: relative paths only", function () {
  const m = JSON.parse(fs.readFileSync(__dirname + "/manifest.webmanifest", "utf8"));
  assert.strictEqual(m.start_url, "./");
  assert.strictEqual(m.scope, "./");
  m.icons.forEach((i) => assert.ok(!/^\/|^https?:/.test(i.src), i.src));
  const ub = fs.readFileSync(__dirname + "/update-banner.js", "utf8");
  assert.ok(ub.indexOf('register("./sw.js")') !== -1);
  const sw = fs.readFileSync(__dirname + "/sw.js", "utf8");
  const shell = sw.slice(sw.indexOf("var SHELL"), sw.indexOf("];"));
  (shell.match(/"[^"]+"/g) || []).forEach((p) => assert.ok(p.indexOf('"./') === 0, "shell path must be relative: " + p));
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  (html.match(/(?:src|href)="([^"]+)"/g) || []).forEach((a) => assert.ok(!/="\//.test(a), "no root-absolute path: " + a));
  ["index.html", "timeline.js", "sw.js", "update-banner.js", "backup.js", "manifest.webmanifest"].forEach((f) => {
    const t = fs.readFileSync(__dirname + "/" + f, "utf8");
    assert.ok(t.indexOf("/Trip-Map") === -1, f + " must not hard-code /Trip-Map");
  });
});

check("new icon set: files exist, manifest/html/sw reference them, old icons gone", function () {
  const path = require("path");
  const m = JSON.parse(fs.readFileSync(__dirname + "/manifest.webmanifest", "utf8"));
  assert.strictEqual(m.background_color, "#E8DCC8");
  assert.strictEqual(m.theme_color, "#FFFFFF");
  const byPurpose = m.icons.map((i) => i.src + "|" + i.sizes + "|" + i.purpose).sort();
  assert.deepStrictEqual(byPurpose, [
    "icons/icon-192.png|192x192|any",
    "icons/icon-512.png|512x512|any",
    "icons/icon-maskable-512.png|512x512|maskable"
  ]);
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  const sw = fs.readFileSync(__dirname + "/sw.js", "utf8");
  ["16", "32", "120", "152", "167", "180", "192", "512", "maskable-512"].forEach((n) => {
    const f = "icons/icon-" + n + ".png";
    assert.ok(fs.existsSync(path.join(__dirname, f)), f + " exists");
    assert.ok(sw.indexOf('"./' + f + '"') !== -1, f + " precached");
  });
  assert.ok(html.indexOf('rel="apple-touch-icon" href="./icons/icon-180.png"') !== -1);
  assert.ok(html.indexOf('sizes="32x32" href="./icons/icon-32.png"') !== -1 && html.indexOf('sizes="16x16" href="./icons/icon-16.png"') !== -1);
  (html.match(/(?:src|href)="\.\/(icons\/[^"]+)"/g) || []).forEach((a) => {
    const f = a.replace(/^.*"\.\//, "").replace(/"$/, "");
    assert.ok(fs.existsSync(path.join(__dirname, f)), "referenced file missing: " + f);
  });
  [html, sw, JSON.stringify(m)].forEach((t) => assert.ok(t.indexOf("apple-touch-icon.png") === -1, "old icon reference"));
  assert.ok(!fs.existsSync(path.join(__dirname, "icons/apple-touch-icon.png")));
  assert.ok(!fs.existsSync(path.join(__dirname, "icons/icon-1024.png")), "1024 not shipped");
});

check("link preview + iOS splash", function () {
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  const sw = fs.readFileSync(__dirname + "/sw.js", "utf8");
  assert.ok(html.indexOf('<meta property="og:title" content="Free Your Trip">') !== -1);
  assert.ok(html.indexOf('<meta property="og:description" content="机票、酒店、想去的地方，一路串起来">') !== -1);
  assert.ok(html.indexOf('<meta property="og:image" content="https://freeyourtrip.github.io/cover-1200x630.png">') !== -1, "absolute og:image");
  assert.ok(html.indexOf('og:image:width" content="1200"') !== -1 && html.indexOf('og:image:height" content="630"') !== -1);
  assert.ok(html.indexOf('<meta name="twitter:card" content="summary_large_image">') !== -1);
  assert.ok(/rel="apple-touch-startup-image" href="\.\/splash-1290x2796\.png" media="\(device-width: 430px\) and \(device-height: 932px\) and \(-webkit-device-pixel-ratio: 3\) and \(orientation: portrait\)"/.test(html));
  assert.ok(fs.existsSync(__dirname + "/cover-1200x630.png") && fs.existsSync(__dirname + "/splash-1290x2796.png"));
  assert.ok(sw.indexOf("cover-1200x630") === -1 && sw.indexOf("splash-1290x2796") === -1, "not precached");
});


check("centred update popup matches the 300 / 20 / 40% spec; mixed files reload once", function () {
  const css = fs.readFileSync(__dirname + "/styles.css", "utf8");
  assert.ok(/\.update-mask,[\s\S]*#update-banner \{[\s\S]*background: rgba\(0, 0, 0, 0\.4\)/.test(css), "40% black mask");
  assert.ok(/\.update-card \{[^}]*width: 300px;[^}]*border-radius: 20px;/.test(css), "300 wide, radius 20");
  assert.ok(/\.update-title \{[^}]*font-size: 17px;[^}]*font-weight: 700;/.test(css), "17px bold title");
  assert.ok(/\.update-body \{[^}]*font-size: 14px;/.test(css), "14px grey line");
  assert.ok(/\.update-now \{[^}]*height: 44px;/.test(css), "44-tall primary");
  assert.strictEqual(UB.SHELL_CACHE, "xingcheng-map-shell-v19");
  const V = require("./version.js");
  assert.strictEqual(V.SHELL_CACHE, "xingcheng-map-shell-v19");
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  assert.ok(html.indexOf('name="shell-cache" content="xingcheng-map-shell-v19"') !== -1);
  assert.strictEqual(UB.isMixed("xingcheng-map-shell-v19", "xingcheng-map-shell-v19", "xingcheng-map-shell-v19"), false);
  assert.strictEqual(UB.isMixed("xingcheng-map-shell-v18", "xingcheng-map-shell-v19", "xingcheng-map-shell-v19"), true);
  const store = {};
  const storage = { getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
  assert.strictEqual(UB.shouldReloadMixed(true, storage), true);
  UB.markMixedReload(storage);
  assert.strictEqual(UB.shouldReloadMixed(true, storage), false, "second time in the same session does not loop");
  assert.strictEqual(UB.shouldReloadMixed(false, storage), false);
});

if (failures) {
  console.log("\n" + failures + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll checks passed.");
