#!/usr/bin/env node
"use strict";
/**
 * v6.1.1：高德 JS API 国内搜索、底栏、导入清空、toast、说明书、打开高德 App。
 * 用法：node check-v611.js
 * 不打印任何 Key。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const GeoUtil = require("./geo.js");
const Geocode = require("./geocode.js");
const Lookup = require("./lookup.js");
const V = require("./version.js");

const root = __dirname;
let failed = 0;
function check(name, fn) {
  const r = fn && fn.constructor && fn.constructor.name === "AsyncFunction" ? fn() : Promise.resolve().then(fn);
  return r.then(() => console.log("  ok  " + name)).catch((err) => {
    failed += 1;
    console.error("  FAIL  " + name);
    console.error("    " + (err && err.message ? err.message : err));
  });
}

const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const AND_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const DESK_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function read(name) {
  return fs.readFileSync(path.join(root, name), "utf8");
}

function redact(s) {
  return String(s || "").replace(/key=[^&"'\s]+/gi, "key=REDACTED").replace(/AMAP_[A-Z_]+=[^,\s"']+/g, "AMAP_*=REDACTED");
}

async function run() {
  await check("APP_VERSION v6.1.1, cache v20, announcement and changelog signed off", function () {
    assert.strictEqual(V.APP_VERSION, "v6.1.1");
    assert.strictEqual(V.SHELL_CACHE, "xingcheng-map-shell-v20");
    assert.ok(V.compareVersion("v6.1", "v6.1.1") < 0);
    assert.deepStrictEqual(V.ANNOUNCEMENT.bullets, [
      "国内的店名和地址，现在用高德搜，搜得更准",
      "『地图』按钮挪到『添加』旁边，看底部就能找到",
      "国内地点点『带我去』，直接打开高德 App"
    ]);
    assert.deepStrictEqual(V.CHANGELOG[0].lines, [
      "新增：搜国内地点改用高德，搜得更准",
      "调整：『地图』按钮挪到『添加』左边",
      "修复：导入成功后，输入框会自动清空",
      "修复：长按卡片和按钮不会再选中文字",
      "优化：屏幕下方的提示，点一下就能关掉",
      "优化：国内地点打开地图，直接跳到高德 App，不再卡在网页"
    ]);
    assert.strictEqual(V.CHANGELOG[1].version, "v6.1");
  });

  await check("CSP script-src is exactly the approved list; connect-src unchanged; no script unsafe-inline or wasm-unsafe-eval; repo keys empty", function () {
    const html = read("index.html");
    const cfg = require("./config.js");
    const csp = (html.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || "";
    const scriptSrc = ((csp.match(/script-src ([^;]+)/) || [])[1] || "").trim();
    const connectSrc = ((csp.match(/connect-src ([^;]+)/) || [])[1] || "").trim();
    assert.strictEqual(
      scriptSrc,
      "'self' 'unsafe-eval' https://webapi.amap.com https://restapi.amap.com",
      "script-src must match the approved list exactly"
    );
    assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp), "script-src must not include unsafe-inline");
    assert.ok(csp.indexOf("wasm-unsafe-eval") === -1, "do not add wasm-unsafe-eval");
    assert.ok(!/script-src[^;]*\*\.amap\.com/.test(csp), "no *.amap.com wildcard in script-src");
    assert.ok(connectSrc.indexOf("https://restapi.amap.com") !== -1, "connect-src keeps restapi.amap.com");
    assert.ok(connectSrc.indexOf("https://webapi.amap.com") !== -1, "connect-src keeps webapi.amap.com");
    assert.ok(html.indexOf("在国内搜地点时，搜的字会发给高德") !== -1);
    assert.strictEqual(String(cfg.AMAP_REST_KEY || ""), "");
    assert.strictEqual(String(cfg.AMAP_JS_KEY || ""), "");
    assert.strictEqual(String(cfg.AMAP_SECURITY_CODE || ""), "");
  });

  await check("our JS has no eval, no new Function, no string setTimeout/setInterval (excludes vendor/ and check-*.js)", function () {
    const fs = require("fs");
    const path = require("path");
    const root = __dirname;
    const excludeDirs = new Set(["vendor", "node_modules"]);
    const files = [];
    (function walk(dir) {
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        const rel = path.relative(root, p);
        const st = fs.statSync(p);
        if (st.isDirectory()) {
          if (excludeDirs.has(name)) continue;
          walk(p);
        } else if (name.endsWith(".js")) {
          if (/^check-.*\.js$/.test(name)) continue;
          files.push(rel);
        }
      }
    })(root);
    assert.ok(files.length > 10, "should scan product JS files");
    assert.ok(files.indexOf("vendor/leaflet.js") === -1 && files.every((f) => f.indexOf("vendor" + path.sep) !== 0), "vendor/ excluded");
    const ev = "ev" + "al(";
    const nf = "new " + "Function";
    const badTimer = /\bset(?:Timeout|Interval)\s*\(\s*['"]/;
    const hits = [];
    for (const rel of files) {
      const src = fs.readFileSync(path.join(root, rel), "utf8");
      if (src.indexOf(ev) !== -1) hits.push(rel + ": " + ev);
      if (src.indexOf(nf) !== -1) hits.push(rel + ": " + nf);
      if (badTimer.test(src)) hits.push(rel + ": string-timer");
    }
    assert.deepStrictEqual(hits, [], "product JS must not use " + ev + ", " + nf + ", or string timers");
  });

  await check("bottom bar merged: view-toggle + add, no floating view-fab styles", function () {
    const html = read("index.html");
    const css = read("styles.css");
    assert.ok(html.indexOf('class="view-toggle"') !== -1 && html.indexOf('id="add-fab"') !== -1);
    assert.ok(html.indexOf('class="view-fab"') === -1);
    assert.ok(/\.view-toggle \{[\s\S]*?width:\s*56px;[\s\S]*?height:\s*56px;/.test(css));
    assert.ok(css.indexOf("user-select: none") !== -1 && css.indexOf("-webkit-touch-callout: none") !== -1);
    assert.ok(css.indexOf("96px + env(safe-area-inset-bottom") !== -1);
  });

  await check("HELP_STARTER copy is centralized; card 2 uses ol.ai-steps; drag tip final", function () {
    const tl = read("timeline.js");
    assert.ok(tl.indexOf("var HELP_STARTER") !== -1);
    assert.ok(tl.indexOf('title: "想去的地方，先存进来"') !== -1);
    assert.ok(tl.indexOf('text: "点底部『＋ 添加』，输入店名或地址，点一下结果就存好了"') !== -1);
    assert.ok(tl.indexOf('title: "到了当天，一键导航"') !== -1);
    assert.ok(tl.indexOf('text: "点卡片上的『带我去』，手机地图会直接带你过去"') !== -1);
    assert.ok(tl.indexOf('title: "各种订单、攻略截图，都能变成行程"') !== -1);
    assert.ok(tl.indexOf('lead: "车票机票、酒店订单、小红书、抖音、大众点评都行"') !== -1);
    assert.ok(tl.indexOf("在这里点『复制』，复制一段给 AI 的话") !== -1);
    assert.ok(tl.indexOf("打开你手机上的 AI App（豆包、DeepSeek、ChatGPT 都行），先粘贴，再把截图发过去，一张或好几张都行") !== -1);
    assert.ok(tl.indexOf("把 AI 的回复全部复制，回到这里点『粘贴并导入』") !== -1);
    assert.ok(tl.indexOf('<ol class="ai-steps">') !== -1);
    assert.ok(tl.indexOf("长按卡片拖动，能换顺序或换日子") !== -1);
    assert.ok(tl.indexOf("点『添加』左边的『地图』，所有地点一眼看全，再点『列表』回来") !== -1);
    assert.ok(tl.indexOf("#0F9D8A") !== -1 && tl.indexOf('viewBox="0 0 160 96"') !== -1);
    assert.ok(tl.indexOf('rect x="8" y="6" width="54" height="84"') !== -1);
    const html = read("index.html");
    const css = read("styles.css");
    assert.ok(html.indexOf('id="ai-copy-btn">复制</button>') !== -1);
    assert.ok(/\.help-card-illu \{[^}]*width:\s*160px;[^}]*height:\s*96px;/.test(css));
  });

  await check("import success clears paste, toasts 已导入 N 项, add-go is secondary", function () {
    const tl = read("timeline.js");
    const html = read("index.html");
    assert.ok(tl.indexOf("function resetAddPasteUi") !== -1);
    assert.ok(tl.indexOf('toastOk: function (n) { return "已导入 " + n + " 项"; }') !== -1);
    assert.ok(html.indexOf('class="secondary-btn" id="add-go"') !== -1);
  });

  await check("toast: tap dismisses with 150ms fade, no × shown, pointer-events auto, clears bar", function () {
    const tl = read("timeline.js");
    const css = read("styles.css");
    const html = read("index.html");
    assert.ok(tl.indexOf("function onToastSurfaceClick") !== -1);
    assert.ok(tl.indexOf('if (closeBtn) closeBtn.hidden = true') !== -1);
    assert.ok(/el\.classList\.add\("is-out"\)/.test(tl) && /150/.test(tl.slice(tl.indexOf("function hideToast"), tl.indexOf("function hideToast") + 1200)));
    assert.ok(/#toast-undo/.test(tl) && /closest\("#toast-undo"\)/.test(tl));
    assert.ok(css.indexOf("pointer-events: auto") !== -1);
    assert.ok(/\.toast\.is-out \{[^}]*opacity:\s*0/.test(css));
    assert.ok(/\.toast \{[\s\S]*?bottom:\s*calc\(84px \+ env\(safe-area-inset-bottom, 0px\)\)/.test(css));
    assert.ok(html.indexOf('id="toast-close"') !== -1);
  });

  await check("empty Amap JS key falls back silently; no throw; no Amap request", async function () {
    const prev = global.AppConfig;
    const prevFetch = global.fetch;
    const prevAMap = global.AMap;
    let fetches = [];
    global.AppConfig = { AMAP_REST_KEY: "", AMAP_JS_KEY: "", AMAP_SECURITY_CODE: "" };
    global.AMap = undefined;
    if (Geocode.setCacheAll) Geocode.setCacheAll({});
    global.fetch = function (url) {
      fetches.push(String(url));
      if (/nominatim/.test(String(url))) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([{ lat: "39.9", lon: "116.4", display_name: "fallback" }]) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    };
    try {
      assert.strictEqual(Geocode.amapConfigured(), false);
      const empty = await Geocode.amapSearch("故宫博物院");
      assert.ok(Array.isArray(empty) && empty.length === 0);
      const list = await Geocode.searchAddress("故宫博物院");
      assert.ok(Array.isArray(list));
      assert.ok(fetches.every((u) => !/amap\.com/.test(u)), "empty key must not call Amap");
    } finally {
      global.fetch = prevFetch;
      global.AppConfig = prev;
      global.AMap = prevAMap;
    }
  });

  await check("mocked Amap JS API: 5 China places convert GCJ-02 to WGS-84 once; foreign unchanged", async function () {
    const places = [
      { q: "上海环球港", kind: "mall", gcj: { lng: 121.414000, lat: 31.232000 } },
      { q: "全聚德前门店", kind: "restaurant", gcj: { lng: 116.398000, lat: 39.899000 } },
      { q: "故宫博物院", kind: "sight", gcj: { lng: 116.397000, lat: 39.916000 } },
      { q: "北京饭店", kind: "hotel", gcj: { lng: 116.410000, lat: 39.909000 } },
      { q: "上海市黄浦区南京东路399号", kind: "address", gcj: { lng: 121.484000, lat: 31.238000 } }
    ];
    const prevCfg = global.AppConfig;
    const prevFetch = global.fetch;
    const prevAMap = global.AMap;
    global.AppConfig = { AMAP_REST_KEY: "", AMAP_JS_KEY: "test-js-key-not-real", AMAP_SECURITY_CODE: "test-sec-not-real" };
    assert.strictEqual(Geocode.amapConfigured(), true);
    if (Geocode.setCacheAll) Geocode.setCacheAll({});
    global.AMap = {
      PlaceSearch: function () {
        this.search = function (q, cb) {
          const hit = places.find((p) => String(q).indexOf(p.q) !== -1) || places[0];
          cb("complete", { poiList: { pois: [{ name: hit.q, address: "示例路", location: { lng: hit.gcj.lng, lat: hit.gcj.lat } }] } });
        };
      },
      AutoComplete: function () {
        this.search = function (q, cb) { cb("no_data", {}); };
      },
      plugin: function (name, fn) { fn(); }
    };
    global.fetch = function (url) {
      const u = String(url);
      if (/amap\.com/.test(u)) return Promise.reject(new Error("JS API must not use REST fetch in this mock"));
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    };
    try {
      for (const p of places) {
        const list = await Geocode.searchAddress(p.q);
        assert.ok(list.length >= 1, p.q + " should resolve");
        const wgs = GeoUtil.gcj02ToWgs84(Number(p.gcj.lat), Number(p.gcj.lng));
        assert.ok(Math.abs(list[0].lat - wgs.lat) < 1e-6 && Math.abs(list[0].lng - wgs.lng) < 1e-6, p.q + " must be WGS-84");
        assert.strictEqual(list[0].coordSystem, "wgs84");
        assert.strictEqual(list[0].source, "amap");
      }
      const foreign = "British Museum, London";
      let nom = 0;
      const inner = global.fetch;
      global.fetch = function (url) {
        if (/nominatim/.test(String(url))) {
          nom += 1;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([{ lat: "51.5194", lon: "-0.1270", display_name: foreign }])
          });
        }
        return inner(url);
      };
      const out = await Geocode.searchAddress(foreign);
      assert.ok(nom >= 1, "foreign place must use existing chain, not require Amap");
      assert.ok(out.length >= 1);
    } finally {
      global.fetch = prevFetch;
      global.AppConfig = prevCfg;
      global.AMap = prevAMap;
    }
  });

  await check("Amap JS load failure falls back silently to existing search", async function () {
    const prevCfg = global.AppConfig;
    const prevFetch = global.fetch;
    const prevAMap = global.AMap;
    global.AppConfig = { AMAP_REST_KEY: "", AMAP_JS_KEY: "test-js-key-not-real", AMAP_SECURITY_CODE: "test-sec-not-real" };
    global.AMap = undefined;
    if (Geocode.setCacheAll) Geocode.setCacheAll({});
    let nom = 0;
    global.fetch = function (url) {
      if (/nominatim/.test(String(url))) {
        nom += 1;
        return Promise.resolve({ ok: true, json: () => Promise.resolve([{ lat: "39.9", lon: "116.4", display_name: "故宫博物院" }]) });
      }
      return Promise.reject(new Error("no amap fetch"));
    };
    try {
      const list = await Geocode.searchAddress("故宫博物院");
      assert.ok(nom >= 1, "must fall back to Nominatim when JS API cannot load");
      assert.ok(list.length >= 1);
      assert.ok(list[0].source !== "amap");
    } finally {
      global.fetch = prevFetch;
      global.AppConfig = prevCfg;
      global.AMap = prevAMap;
    }
  });

  /* 现场 JS API 需要浏览器加载 webapi.amap.com，不在 Node 里跑、也不在这里读 Key。见 live 验收脚本。 */

  await check("Amap app scheme matches web link content for search / marker / route; iOS and Android", function () {
    const dest = { name: "示例店", address: "上海市示例路 1 号", lat: 31.2304, lng: 121.4737 };
    const pin = { lat: 31.2304, lng: 121.4737 };
    const origin = { name: "起点", lat: 31.2401, lng: 121.4904 };
    const webSearch = GeoUtil.buildFlexibleNavLinks(null, dest, "公共交通").amap;
    const webLook = GeoUtil.buildPlaceLink(dest).href;
    const webNav = GeoUtil.buildAmapUrl(origin, pin, "公共交通");
    const webPinNav = GeoUtil.amapNavUrl ? null : GeoUtil.buildFlexibleNavLinks(origin, pin, "公共交通").amap;
    assert.ok(webSearch.indexOf("uri.amap.com/search") !== -1 && webSearch.indexOf(encodeURIComponent("示例店")) !== -1);
    assert.ok(webLook.indexOf("uri.amap.com/search") !== -1);
    ["search", "look", "nav"].forEach((kind) => {
      const web = kind === "search" ? webSearch : kind === "look" ? webLook : webNav;
      const ios = GeoUtil.amapSchemeFromWeb(web, IOS_UA);
      const and = GeoUtil.amapSchemeFromWeb(web, AND_UA);
      assert.ok(ios.indexOf("iosamap://") === 0, kind + " ios scheme");
      assert.ok(and.indexOf("androidamap://") === 0, kind + " android scheme");
      if (kind !== "nav") {
        assert.ok(ios.indexOf("name=") !== -1 && and.indexOf("keywords=") !== -1);
        assert.ok(decodeURIComponent(ios.split("name=")[1]) === decodeURIComponent(web.split("keyword=")[1].split("&")[0]) || ios.indexOf(encodeURIComponent("示例店")) !== -1);
      } else {
        const to = /to=([^&]+)/.exec(web)[1];
        const [lng, lat] = to.split(",");
        assert.ok(ios.indexOf("dlat=" + lat) !== -1 && ios.indexOf("dlon=" + lng) !== -1);
        assert.ok(and.indexOf("dlat=" + lat) !== -1 && and.indexOf("dlon=" + lng) !== -1);
        assert.ok(ios.indexOf("slat=") !== -1 && and.indexOf("slat=") !== -1);
        assert.ok(ios.indexOf("dev=0") !== -1 && and.indexOf("dev=0") !== -1);
      }
      assert.ok(ios.indexOf("FreeYourTrip") !== -1 && and.indexOf("FreeYourTrip") !== -1);
    });
    const noOrigin = GeoUtil.buildAmapUrl ? GeoUtil.buildFlexibleNavLinks(null, pin, "公共交通").amap : "";
    if (noOrigin.indexOf("navigation") !== -1) {
      const ios = GeoUtil.amapSchemeFromWeb(noOrigin, IOS_UA);
      assert.ok(ios.indexOf("slat=") === -1 && ios.indexOf("slon=") === -1, "no start when none provided");
    }
  });

  await check("desktop opens web immediately; Android/iOS launch scheme; 1.5s visible → install dialog; hidden → no dialog", function () {
    const web = "https://uri.amap.com/search?keyword=" + encodeURIComponent("示例店, 上海市示例路 1 号") + "&callnative=1";
    function trial(ua, hideAt) {
      const launched = [];
      const opened = [];
      const install = [];
      const timers = [];
      let hideFn = null;
      GeoUtil.openAmap(web, {
        ua,
        launchScheme: (s) => launched.push(s),
        openWeb: (u) => opened.push(u),
        showInstall: (u) => install.push(u),
        setTimeout: (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, ms, cleared: false }); return id; },
        clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.cleared = true; },
        attachHide: (fn) => { hideFn = fn; return () => { hideFn = null; }; }
      });
      if (hideAt) hideFn && hideFn();
      timers.filter((t) => t.ms === 1500 && !t.cleared).forEach((t) => t.fn());
      return { launched, opened, install };
    }
    const desk = trial(DESK_UA, false);
    assert.deepStrictEqual(desk.launched, []);
    assert.deepStrictEqual(desk.opened, [web]);
    assert.deepStrictEqual(desk.install, []);
    const and = trial(AND_UA, false);
    assert.ok(and.launched[0] && and.launched[0].indexOf("androidamap://") === 0);
    assert.deepStrictEqual(and.opened, []);
    assert.deepStrictEqual(and.install, [web]);
    const ios = trial(IOS_UA, false);
    assert.ok(ios.launched[0] && ios.launched[0].indexOf("iosamap://") === 0);
    assert.deepStrictEqual(ios.install, [web]);
    const hid = trial(AND_UA, true);
    assert.ok(hid.launched.length === 1);
    assert.deepStrictEqual(hid.install, []);
    assert.deepStrictEqual(hid.opened, []);
  });

  await check("install dialog copy, store links verified, 先用网页版 is the only uri.amap.com open", function () {
    const html = read("index.html");
    const css = read("styles.css");
    const tl = read("timeline.js");
    const geo = read("geo.js");
    assert.ok(html.indexOf('id="amap-install"') !== -1);
    assert.ok(html.indexOf(">这台手机还没装高德地图<") !== -1);
    assert.ok(html.indexOf(">去装高德<") !== -1 && html.indexOf(">先用网页版<") !== -1);
    assert.ok(/\.amap-install-go \{[\s\S]*?height:\s*48px;[\s\S]*?border-radius:\s*12px;[\s\S]*?background:\s*#0F9D8A;/.test(css));
    const ios = GeoUtil.amapInstallLinks(IOS_UA);
    const and = GeoUtil.amapInstallLinks(AND_UA);
    assert.strictEqual(ios.primary, "https://apps.apple.com/cn/app/id461703208");
    assert.strictEqual(and.primary, "market://details?id=com.autonavi.minimap");
    assert.strictEqual(and.fallback, "https://mobile.amap.com/cn/");
    const files = fs.readdirSync(root).filter((f) => /\.(js|html)$/.test(f) && !/^check/.test(f) && f !== "geo.js");
    files.concat(["geo.js"]).forEach((f) => {
      const s = read(f);
      if (/href\s*=\s*["']https:\/\/uri\.amap\.com/.test(s)) {
        throw new Error(f + " still uses uri.amap.com as href");
      }
    });
    assert.ok(tl.indexOf("function onAmapInstallWeb") !== -1);
    assert.ok(geo.indexOf("function defaultOpenAmapWeb") !== -1);
  });

  await check("foreign destinations still recommend Google; user position not in schemes", function () {
    const here = { lat: 31.234567, lng: 121.476543 };
    const london = { name: "British Museum", address: "Great Russell St, London", lat: 51.5194, lng: -0.1270 };
    const links = GeoUtil.buildFlexibleNavLinks(null, london, "公共交通", here);
    assert.strictEqual(links.recommended, "google");
    assert.ok(links.href.indexOf("google.com") !== -1);
    const sh = { name: "示例", address: "上海市示例路 1 号" };
    const l = GeoUtil.buildFlexibleNavLinks(null, sh, "公共交通", here);
    const p = GeoUtil.buildPlaceLink(sh, here);
    const ios = GeoUtil.amapSchemeFromWeb(l.amap, IOS_UA);
    const and = GeoUtil.amapSchemeFromWeb(l.amap, AND_UA);
    const look = GeoUtil.amapSchemeFromWeb(p.href, AND_UA);
    [l.href, l.google, l.amap, p.href, ios, and, look].forEach((u) => {
      assert.ok(u.indexOf("31.234567") === -1 && u.indexOf("121.476543") === -1, "position leaked: " + u);
    });
  });

  if (failed) {
    console.error("\n" + failed + " failed");
    process.exit(1);
  }
  console.log("\nall passed");
}

run();
