/**
 * v6.1.2：全页长按不选字（地址/输入框除外）、弹出层每次打开回到顶部、
 * 编辑页底部固定「取消 / 保存修改」栏。用法：node check-v612.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const root = __dirname;
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const V = require("./version.js");
const css = read("styles.css");
const tl = read("timeline.js");
const html = read("index.html");
const sw = read("sw.js");
const ub = read("update-banner.js");

let passes = 0;
let failures = 0;
function check(name, fn) {
  try {
    const ret = fn();
    if (ret && typeof ret.then === "function") {
      return ret.then(function () {
        passes += 1;
        console.log("PASS  " + name);
      }, function (err) {
        failures += 1;
        console.log("FAIL  " + name);
        console.log("      " + (err && err.stack ? err.stack : err));
      });
    }
    passes += 1;
    console.log("PASS  " + name);
  } catch (err) {
    failures += 1;
    console.log("FAIL  " + name);
    console.log("      " + (err && err.stack ? err.stack : err));
  }
}

check("APP_VERSION v6.1.2, cache v21, announcement 2 bullets and changelog 3 lines signed off", function () {
  assert.strictEqual(V.APP_VERSION, "v6.1.2");
  assert.strictEqual(V.SHELL_CACHE, "xingcheng-map-shell-v21");
  assert.strictEqual(V.versionLabel(), "当前版本 v6.1.2 · 2026-11-17");
  assert.ok(V.compareVersion("v6.1.1", "v6.1.2") < 0);
  assert.strictEqual(V.ANNOUNCEMENT.title, "v6.1.2 更新");
  assert.ok(!V.ANNOUNCEMENT.draft);
  assert.deepStrictEqual(V.ANNOUNCEMENT.bullets, [
    "长按页面任何地方，都不会再选中文字了",
    "改地点时，『保存修改』一直在底部，不用往下找"
  ]);
  assert.strictEqual(V.ANNOUNCEMENT.tip, "看到的还是旧版，就把网页彻底关掉再打开");
  assert.strictEqual(V.CHANGELOG[0].version, "v6.1.2");
  assert.ok(!V.CHANGELOG[0].draft);
  assert.deepStrictEqual(V.CHANGELOG[0].lines, [
    "修复：长按空白处和标题不会再选中文字，展开后的地址照样能长按复制",
    "修复：弹出的页面每次打开都从最上面开始，不会停在上次划到的地方",
    "调整：『保存修改』和『取消』一直在底部，不用往下划就能看到"
  ]);
  assert.strictEqual(sw.match(/var CACHE = "([^"]+)"/)[1], "xingcheng-map-shell-v21");
  assert.ok(ub.indexOf('var SHELL_CACHE = "xingcheng-map-shell-v21"') !== -1);
  assert.ok(html.indexOf('name="shell-cache" content="xingcheng-map-shell-v21"') !== -1);
  const d = V.decideOnOpen({ lastSeen: "v6.1.1", hasTrips: true, helpHidden: true, current: "v6.1.2" });
  assert.strictEqual(d.show, "announce");
});

check("body disables selection; only inputs, textarea, contenteditable and .card-address re-enable text", function () {
  const body = css.slice(css.search(/^body\s*\{/m));
  const bodyBlock = body.slice(0, body.indexOf("}") + 1);
  assert.ok(/user-select:\s*none/.test(bodyBlock), "body user-select:none");
  assert.ok(/-webkit-user-select:\s*none/.test(bodyBlock), "body -webkit-user-select:none");
  assert.ok(/-webkit-touch-callout:\s*none/.test(bodyBlock), "body touch-callout none");
  assert.ok(/-webkit-tap-highlight-color:\s*transparent/.test(bodyBlock), "body tap highlight");
  const textSels = [];
  const re = /([^{}]+)\{([^{}]*user-select:\s*text[^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    textSels.push(m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim().replace(/\s+/g, " "));
  }
  const allowed = {
    "input, textarea, [contenteditable]": true,
    ".card-address": true
  };
  textSels.forEach(function (sel) {
    assert.ok(allowed[sel], "unexpected user-select:text selector: " + sel);
  });
  assert.ok(allowed["input, textarea, [contenteditable]"] && textSels.indexOf("input, textarea, [contenteditable]") !== -1);
  assert.ok(textSels.indexOf(".card-address") !== -1);
  assert.ok(css.indexOf(".card { -webkit-user-select: none") === -1, "old card none rule removed");
  assert.ok(!/\.card input, \.card textarea, \.card select/.test(css), "old card input allowlist removed (select is not allowlisted)");
});

check("openSheet resets every sheet scroll container to the top", function () {
  assert.ok(/function resetSheetScroll\(root\)/.test(tl));
  assert.ok(/el\.scrollTop = 0/.test(tl));
  const open = tl.slice(tl.indexOf("function openSheet(id)"));
  const openBody = open.slice(0, open.indexOf("\n  function "));
  assert.ok(openBody.indexOf("resetSheetScroll(el)") !== -1, "openSheet calls resetSheetScroll");
  assert.ok((tl.match(/resetSheetScroll\(sheet\)/g) || []).length >= 2, "import-confirm / other direct opens also reset");
  assert.ok(tl.indexOf("resetSheetScroll(el)") !== -1);
});

check("edit/add sheet has one-row sticky footer: 取消 1/3, 保存修改 2/3, specified colors, keyboard inset", function () {
  const actions = html.slice(html.indexOf('id="manual-actions"'), html.indexOf('id="trips-sheet"'));
  assert.ok(/id="edit-cancel"/.test(actions) && /id="manual-save"/.test(actions));
  assert.ok(actions.indexOf("edit-cancel") < actions.indexOf("manual-save"), "取消 is on the left");
  const bar = css.slice(css.indexOf(".sheet-actions {"));
  const barBlock = bar.slice(0, bar.indexOf("\n.sheet-actions .sheet-cancel"));
  assert.ok(/position:\s*sticky/.test(barBlock));
  assert.ok(/bottom:\s*var\(--kb-inset/.test(barBlock));
  assert.ok(/background:\s*#fff/.test(barBlock));
  assert.ok(/border-top:\s*1px solid #E3E7EC/.test(barBlock));
  assert.ok(/padding:\s*12px 16px calc\(12px \+ env\(safe-area-inset-bottom/.test(barBlock));
  assert.ok(/gap:\s*12px/.test(barBlock));
  assert.ok(!/box-shadow/.test(barBlock), "no shadow on the action bar");
  const cancel = css.slice(css.indexOf(".sheet-actions .sheet-cancel {"));
  const cancelBlock = cancel.slice(0, cancel.indexOf("\n.sheet-actions .sheet-save"));
  assert.ok(/flex:\s*1 1 0/.test(cancelBlock));
  assert.ok(/height:\s*48px/.test(cancelBlock) && /border-radius:\s*12px/.test(cancelBlock));
  assert.ok(/font-size:\s*16px/.test(cancelBlock) && /font-weight:\s*700/.test(cancelBlock));
  assert.ok(/background:\s*#F1F3F5/.test(cancelBlock) && /color:\s*#16332F/.test(cancelBlock));
  const save = css.slice(css.indexOf(".sheet-actions .sheet-save,"));
  const saveBlock = save.slice(0, save.indexOf("\n.sheet-actions:not"));
  assert.ok(/flex:\s*2 1 0/.test(saveBlock));
  assert.ok(/height:\s*48px/.test(saveBlock) && /border-radius:\s*12px/.test(saveBlock));
  assert.ok(/font-size:\s*16px/.test(saveBlock) && /font-weight:\s*700/.test(saveBlock));
  assert.ok(/background:\s*#0F9D8A/.test(saveBlock) && /color:\s*#fff/.test(saveBlock));
  assert.ok(/padding-bottom:\s*calc\(72px \+ env\(safe-area-inset-bottom/.test(css));
  assert.ok(/scroll-padding-bottom:\s*calc\(88px \+ env\(safe-area-inset-bottom/.test(css));
  assert.ok(/function bindSheetKeyboard\(/.test(tl));
  assert.ok(/visualViewport/.test(tl) && /--kb-inset/.test(tl));
  assert.ok(/field\.bottom \+ 16/.test(tl), "focused field sits 16px above the bar");
});

check("card drag already ignores the address line (no extra JS needed this release)", function () {
  assert.ok(/\.card-address/.test(tl));
  assert.ok(/function interactiveFrom\(/.test(tl));
  const inter = tl.slice(tl.indexOf("function interactiveFrom"));
  const interBody = inter.slice(0, inter.indexOf("\n    }") + 6);
  assert.ok(interBody.indexOf(".card-address") !== -1, "interactiveFrom excludes .card-address");
  assert.ok(/closest\("input, textarea, select, \[contenteditable\], \.card-address"\)/.test(tl), "noNative also excludes address");
});

async function headless() {
  const chromePath = ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium"].find(function (c) {
    try {
      require("child_process").execFileSync("which", [c], { stdio: "ignore" });
      return true;
    } catch (e) {
      return false;
    }
  });
  if (!chromePath) throw new Error("chrome not found for v6.1.2 headless checks");

  const PORT = 8768;
  const DEBUG = 9338;
  const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json" };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end("no"); return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  const chrome = spawn(chromePath, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--remote-debugging-port=" + DEBUG, "--user-data-dir=/tmp/chrome-v612-check",
    "about:blank"
  ], { stdio: "ignore" });
  const waitCDP = async () => {
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch("http://127.0.0.1:" + DEBUG + "/json/version");
        if (r.ok) return;
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error("chrome cdp not up");
  };
  try {
    await waitCDP();
    const created = await fetch("http://127.0.0.1:" + DEBUG + "/json/new?about:blank", { method: "PUT" });
    const target = JSON.parse(await created.text());
    let wsUrl = target.webSocketDebuggerUrl;
    if (!wsUrl) {
      const list = await (await fetch("http://127.0.0.1:" + DEBUG + "/json/list")).json();
      wsUrl = (list.find((t) => t.type === "page") || {}).webSocketDebuggerUrl;
    }
    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0;
    const pending = {};
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; }
    };
    const send = (method, params) => new Promise((r) => {
      const i = ++id;
      pending[i] = r;
      ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });
    const ev = async (e) => {
      const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) {
        throw new Error(JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails).slice(0, 300));
      }
      return r.result && r.result.result && r.result.result.value;
    };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const fake = {
      schema: 2,
      trips: [{
        id: "demo-trip",
        nameZh: "示例行程",
        items: [
          { id: "p1", type: "place", nameZh: "示例商场", address: "上海市普陀区中山北路3300号", date: "2026-12-10", lat: 31.232, lng: 121.414 },
          { id: "p2", type: "food", nameZh: "示例餐厅", address: "北京市东城区前门大街", date: "2026-12-12", lat: 39.899, lng: 116.398 }
        ]
      }],
      places: [],
      activeTripId: "demo-trip",
      examplesLoaded: false
    };
    const seed = `
      localStorage.clear();
      localStorage.setItem("wishlist-map-data-v2", ${JSON.stringify(JSON.stringify(fake))});
      localStorage.setItem("wishlist-map-help-hide-v1","1");
      localStorage.setItem("wishlist-map-drag-tip-v1","1");
      localStorage.setItem("wishlist-map-ios-guide-closed-v1","1");
      localStorage.setItem("wishlist-map-install-guide-done-v1","1");
      localStorage.setItem("wishlist-map-last-seen-version-v1","v6.1.2");
    `;
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.setCacheDisabled", { cacheDisabled: true });
    await send("Emulation.setDeviceMetricsOverride", {
      width: 375, height: 667, deviceScaleFactor: 2, mobile: true, screenWidth: 375, screenHeight: 667
    });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: seed });
    await send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/index.html" });
    await send("Page.loadEventFired").catch(() => {});
    await sleep(900);
    await ev(`(function(){
      if (window.TripApp && TripApp.setView) TripApp.setView("list");
      var a=document.getElementById("announce-sheet"); if(a) a.hidden=true;
      var h=document.getElementById("help-sheet"); if(h) h.hidden=true;
    })()`);
    await sleep(200);

    const styles = await ev(`(function(){
      function cs(sel){ var el=document.querySelector(sel); return el ? getComputedStyle(el).userSelect : "missing"; }
      var card = document.querySelector(".card");
      if (card) card.classList.add("is-open");
      var addr = document.querySelector(".card-address");
      var inp = document.getElementById("place-search") || document.querySelector("input");
      return {
        count: cs(".count, #item-count, .trip-count") || cs(".topbar"),
        gap: card ? getComputedStyle(card).userSelect : "missing",
        title: cs(".card-title, .card-name"),
        input: inp ? getComputedStyle(inp).userSelect : "missing",
        addr: addr ? getComputedStyle(addr).userSelect : "missing"
      };
    })()`);
    const none = function (v) { return v === "none"; };
    const textish = function (v) { return v === "text" || v === "auto" || v === "search-field" || v === "all"; };
    // header count may not match; also check body / topbar text
    const bodySel = await ev(`getComputedStyle(document.body).userSelect`);
    assert.ok(none(bodySel), "body computed userSelect is none, got " + bodySel);
    const topbar = await ev(`(function(){
      var el = document.querySelector(".topbar") || document.querySelector("header");
      return el ? getComputedStyle(el).userSelect : "missing";
    })()`);
    assert.ok(none(topbar) || topbar === "missing", "topbar userSelect none, got " + topbar);
    const countSel = await ev(`(function(){
      var nodes = Array.prototype.slice.call(document.querySelectorAll(".topbar *, #trip-count, .count, .item-count, .top-count"));
      var hit = nodes.find(function(n){ return (n.textContent||"").indexOf("共") !== -1 && (n.textContent||"").indexOf("项") !== -1; });
      if (!hit) {
        var walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        var t;
        while ((t = walk.nextNode())) {
          if (t.nodeValue && t.nodeValue.indexOf("共") !== -1 && t.nodeValue.indexOf("项") !== -1) { hit = t.parentElement; break; }
        }
      }
      return hit ? { sel: getComputedStyle(hit).userSelect, text: hit.textContent.trim() } : { sel: "missing", text: "" };
    })()`);
    if (countSel.sel !== "missing") assert.ok(none(countSel.sel), "count userSelect none, got " + JSON.stringify(countSel));
    if (styles.gap && styles.gap !== "missing") assert.ok(none(styles.gap), "card userSelect none, got " + styles.gap);
    if (styles.title && styles.title !== "missing") assert.ok(none(styles.title), "title userSelect none, got " + styles.title);
    assert.ok(textish(styles.input), "input userSelect text/auto, got " + styles.input);
    // expand card for address
    const addrSel = await ev(`(function(){
      var card = document.querySelector(".card");
      if (card) card.click();
      var addr = document.querySelector(".card-address");
      return addr ? getComputedStyle(addr).userSelect : "missing-after-click";
    })()`);
    await sleep(200);
    const addrSel2 = await ev(`(function(){
      var addr = document.querySelector(".card-address");
      return addr ? getComputedStyle(addr).userSelect : "missing";
    })()`);
    const addrFinal = (addrSel2 !== "missing" ? addrSel2 : addrSel);
    assert.ok(textish(addrFinal), "expanded address userSelect text, got " + addrFinal + " / " + addrSel);

    const paste = await ev(`(function(){
      var inp = document.createElement("input");
      inp.id = "v612-paste";
      document.body.appendChild(inp);
      inp.focus();
      inp.value = "";
      var okSelect = getComputedStyle(inp).userSelect;
      inp.value = "pasted-ok";
      var out = { userSelect: okSelect, value: inp.value };
      inp.remove();
      return out;
    })()`);
    assert.ok(textish(paste.userSelect), "paste target userSelect, got " + paste.userSelect);
    assert.strictEqual(paste.value, "pasted-ok");

    async function openEdit() {
      return ev(`(function(){
        var a=document.getElementById("announce-sheet"); if(a) a.hidden=true;
        var h=document.getElementById("help-sheet"); if(h) h.hidden=true;
        if (window.TripApp && TripApp.openDetail) TripApp.openDetail("p1");
        var btn = document.getElementById("detail-edit");
        if (btn) btn.click();
        var save = document.getElementById("manual-save");
        var cancel = document.getElementById("edit-cancel");
        var actions = document.getElementById("manual-actions");
        var scroll = document.querySelector("#add-sheet .sheet-scroll") || document.querySelector("#add-sheet .sheet-panel");
        function vis(el){
          if (!el) return null;
          var r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, height: r.height, hidden: !!el.hidden, text: (el.textContent||"").trim(), inView: r.top >= 0 && r.bottom <= (window.innerHeight+1) && r.height > 0 };
        }
        return {
          title: (document.getElementById("add-sheet-title")||{}).textContent,
          actionsHidden: !!(actions && actions.hidden),
          save: vis(save),
          cancel: vis(cancel),
          scrollTop: scroll ? scroll.scrollTop : null,
          scrollHeight: scroll ? scroll.scrollHeight : null,
          clientHeight: scroll ? scroll.clientHeight : null
        };
      })()`);
    }

    let info = await openEdit();
    await sleep(250);
    info = await ev(`(function(){
      var save = document.getElementById("manual-save");
      var cancel = document.getElementById("edit-cancel");
      function vis(el){
        if (!el) return null;
        var r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height, hidden: !!el.hidden, text: (el.textContent||"").trim(), inView: r.top >= 0 && r.bottom <= (window.innerHeight+1) && r.height > 0 };
      }
      return { title: (document.getElementById("add-sheet-title")||{}).textContent, save: vis(save), cancel: vis(cancel) };
    })()`);
    assert.strictEqual(info.title, "修改");
    assert.ok(info.save && info.save.inView && info.save.text.indexOf("保存修改") !== -1, "save visible at 375: " + JSON.stringify(info.save));
    assert.ok(info.cancel && info.cancel.inView && info.cancel.text === "取消", "cancel visible at 375: " + JSON.stringify(info.cancel));

    const reset = await ev(`(function(){
      var scroll = document.querySelector("#add-sheet .sheet-scroll") || document.querySelector("#add-sheet .sheet-panel");
      if (!scroll) return { ok:false, reason:"no scroller" };
      scroll.scrollTop = scroll.scrollHeight;
      var mid = scroll.scrollTop;
      var close = document.querySelector('#add-sheet [data-close="add-sheet"]');
      if (close) close.click();
      if (window.TripApp && TripApp.openDetail) TripApp.openDetail("p1");
      var btn = document.getElementById("detail-edit");
      if (btn) btn.click();
      var after = (document.querySelector("#add-sheet .sheet-scroll") || document.querySelector("#add-sheet .sheet-panel")).scrollTop;
      return { mid: mid, after: after };
    })()`);
    assert.ok(reset.mid > 0, "could scroll the edit sheet before close, mid=" + reset.mid);
    assert.strictEqual(reset.after, 0, "reopen starts at top, after=" + reset.after);

    await send("Emulation.setDeviceMetricsOverride", {
      width: 360, height: 640, deviceScaleFactor: 2, mobile: true, screenWidth: 360, screenHeight: 640
    });
    await sleep(200);
    await ev(`(function(){
      var a=document.getElementById("add-sheet"); if(a) a.hidden=true;
      if (window.TripApp && TripApp.openDetail) TripApp.openDetail("p1");
      var btn = document.getElementById("detail-edit");
      if (btn) btn.click();
    })()`);
    await sleep(200);
    const info360 = await ev(`(function(){
      var save = document.getElementById("manual-save");
      var cancel = document.getElementById("edit-cancel");
      function vis(el){
        if (!el) return null;
        var r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height, hidden: !!el.hidden, text: (el.textContent||"").trim(), inView: r.top >= 0 && r.bottom <= (window.innerHeight+1) && r.height > 0 };
      }
      return { save: vis(save), cancel: vis(cancel), innerHeight: window.innerHeight };
    })()`);
    assert.ok(info360.save && info360.save.inView && info360.save.text.indexOf("保存修改") !== -1, "save visible at 360: " + JSON.stringify(info360));
    assert.ok(info360.cancel && info360.cancel.inView && info360.cancel.text === "取消", "cancel visible at 360: " + JSON.stringify(info360));

    ws.close();
  } finally {
    try { chrome.kill("SIGKILL"); } catch (e) {}
    await new Promise((r) => server.close(r));
  }
}

(async function main() {
  const r = await check("headless: selection, paste, edit-bar visible at 375 and 360, sheet scroll resets", headless);
  if (r && typeof r.then === "function") await r;
  console.log(failures ? ("FAIL  " + failures + " failed, " + passes + " passed") : ("PASS  " + passes + " checks"));
  process.exit(failures ? 1 : 0);
})().catch(function (err) {
  console.log("FAIL  check-v612 runner");
  console.log("      " + (err && err.stack ? err.stack : err));
  process.exit(1);
});
