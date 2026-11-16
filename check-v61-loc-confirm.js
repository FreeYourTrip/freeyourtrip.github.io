/**
 * v6.1 location-confirm map: pin tip = map centre, saved point within 10 m
 * after drag/tap; one Leaflet instance; buttons work when tiles fail.
 * Usage: node check-v61-loc-confirm.js
 */
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const net = require("net");
const os = require("os");

const ROOT = __dirname;
const tl = fs.readFileSync(path.join(ROOT, "timeline.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log("  ok  " + name);
  } catch (err) {
    failed += 1;
    console.error("  FAIL  " + name);
    console.error("    " + (err && err.message));
  }
}

function distM(a, b) {
  const R = 6371000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = ((b.lat - a.lat) * Math.PI) / 180;
  const dl = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

check("source: invalidateSize after layout + resize; pin tip anchored at wrap centre; map.remove on close", function () {
  assert.ok(/function scheduleLocConfirmMapSize\(/.test(tl));
  assert.ok(/requestAnimationFrame\(function \(\) \{\s*syncLocConfirmMapSize\(\);\s*requestAnimationFrame\(syncLocConfirmMapSize\);/.test(tl));
  assert.ok(/addEventListener\("resize", syncLocConfirmMapSize\)/.test(tl));
  assert.ok(/locConfirmMap\.remove\(\)/.test(tl));
  assert.ok(/sheet\.innerHTML = ""/.test(tl));
  assert.ok(/import-confirm-pin-anchor/.test(tl));
  assert.ok(/\.import-confirm-map,\s*\.import-confirm-map\.leaflet-container \{[\s\S]*?height: 280px;/.test(css));
  assert.ok(!/\.import-confirm-pin \{[\s\S]{0,80}top: 44%/.test(css));
  assert.ok(/#import-confirm-sheet \.leaflet-bottom(?:\.leaflet-right)? \{[\s\S]*?margin-bottom: 0;/.test(css), "confirm attribution not lifted 122px");

});

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      let rel = decodeURIComponent(u.pathname);
      if (rel === "/") rel = "/index.html";
      const file = path.normalize(path.join(ROOT, rel));
      if (!file.startsWith(ROOT)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
    server.on("error", reject);
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}

function chromePath() {
  const cands = ["/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium"];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

async function launchChrome(debugPort) {
  const bin = chromePath();
  if (!bin) throw new Error("no chrome binary for runtime loc-confirm tests");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v61-lc-chrome-"));
  const child = spawn(bin, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--user-data-dir=" + dir,
    "--remote-debugging-port=" + debugPort,
    "--remote-allow-origins=*",
    "about:blank"
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const start = Date.now();
  while (Date.now() - start < 15000) {
    try {
      const r = await fetch("http://127.0.0.1:" + debugPort + "/json/version");
      if (r.ok) return { child, dir, debugPort };
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 150));
  }
  child.kill();
  throw new Error("chrome debug port did not come up");
}

async function cdpPage(debugPort) {
  const created = await fetch("http://127.0.0.1:" + debugPort + "/json/new?about:blank", { method: "PUT" });
  const raw = await created.text();
  let info;
  try { info = JSON.parse(raw); } catch (e) {
    throw new Error("CDP /json/new: " + created.status + " " + raw.slice(0, 200));
  }
  if (!info.webSocketDebuggerUrl) {
    const list = await (await fetch("http://127.0.0.1:" + debugPort + "/json/list")).json();
    info = (list || []).find(function (t) { return t.type === "page"; }) || info;
  }
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = {};
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending[d.id]) {
      pending[d.id](d);
      delete pending[d.id];
    }
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pending[i] = r;
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const ev = async (expr, awaitPromise = false) => {
    const r = await send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise
    });
    if (r.result.exceptionDetails) {
      const t = r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description
        || r.result.exceptionDetails.text;
      throw new Error(t || "eval error");
    }
    return r.result.result && r.result.result.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  return { ws, send, ev };
}

async function runRuntime() {
  const { server, port } = await startServer();
  const origin = "http://127.0.0.1:" + port;
  const debugPort = await freePort();
  const chrome = await launchChrome(debugPort);
  const page = await cdpPage(debugPort);

  const setW = async (w) => {
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: w,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true
    });
  };

  const openApp = async (w) => {
    await setW(w);
    await page.send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
    await page.send("Page.navigate", { url: origin + "/index.html?demo=empty&n=" + Date.now() });
    await new Promise((r) => setTimeout(r, 1600));
    await page.ev(`(() => {
      window.__locConfirmErrors = [];
      window.addEventListener("error", function (e) { window.__locConfirmErrors.push(String(e.message || e.error || e)); });
      ['help-ok','announce-ok','trip-tip','install-banner-dismiss'].forEach(function (id) {
        var el = document.getElementById(id); if (el) el.click();
      });
      if (window.Lookup) Lookup.searchByName = function () { return Promise.resolve([]); };
      return true;
    })()`);
  };

  const injectTwo = async () => {
    await page.ev(`(() => {
      var t = TripApp.currentTrip();
      t.nameZh = "伦敦五日";
      t.items = [
        {id:'h1', type:'hotel', nameZh:'示例酒店', address:'1 Example Road, London', checkIn:'2026-11-18', checkOut:'2026-11-20', checkInTime:'15:00', checkOutTime:'11:00', lat:51.52, lng:-0.14},
        {id:'p3', type:'place', subtype:'其他', nameZh:'还没定位置的店', address:'Somewhere Lane, London', date:'2026-11-19'},
        {id:'p4', type:'place', subtype:'其他', nameZh:'第二家待确认', address:'Another Lane, London', date:'2026-11-19'}
      ];
      try { localStorage.setItem('wishlist-map-trip-tip-v1','1'); } catch (e) {}
      TripApp.refresh();
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 300));
  };

  const openConfirm = async () => {
    const clicked = await page.ev(`(() => {
      var b = document.querySelector('.loc-pending, [data-fix-loc]');
      if (b) b.click();
      return !!b;
    })()`);
    if (!clicked) throw new Error("no 位置待确认 button");
    await new Promise((r) => setTimeout(r, 400));
    await page.ev(`(() => { if (window.LocConfirmMap) LocConfirmMap.scheduleSize(); return true; })()`);
    await new Promise((r) => setTimeout(r, 250));
  };

  const measure = `(function () {
    var mapEl = document.getElementById("loc-confirm-map");
    var wrap = mapEl && mapEl.parentElement;
    var sheet = document.getElementById("import-confirm-sheet");
    var attr = sheet && sheet.querySelector(".leaflet-control-attribution");
    var zoom = sheet && sheet.querySelector(".leaflet-control-zoom");
    var anchor = sheet && sheet.querySelector(".import-confirm-pin-anchor");
    var leaflets = sheet ? sheet.querySelectorAll(".leaflet-container") : [];
    var hidden = !sheet || sheet.hidden;
    function box(el) { return el ? el.getBoundingClientRect() : null; }
    var mb = box(mapEl), ab = box(attr), zb = box(zoom), pb = box(anchor), wb = box(wrap);
    var api = window.LocConfirmMap || {};
    var map = api.getMap && api.getMap();
    var size = map && map.getSize && map.getSize();
    return {
      hidden: hidden,
      leafletCount: leaflets.length,
      map: mb && { w: mb.width, h: mb.height, t: mb.top, b: mb.bottom, l: mb.left, r: mb.right },
      wrap: wb && { w: wb.width, h: wb.height, t: wb.top, b: wb.bottom },
      attr: ab && { t: ab.top, b: ab.bottom, l: ab.left, r: ab.right, text: attr.textContent },
      zoom: zb && { t: zb.top, b: zb.bottom, l: zb.left, r: zb.right },
      pin: pb && { x: pb.left, y: pb.top },
      leafletSize: size && { x: size.x, y: size.y },
      saved: api.savedLatLng && api.savedLatLng(),
      tip: api.pinTipLatLng && api.pinTipLatLng(),
      errors: window.__locConfirmErrors || []
    };
  })()`;

  try {
    await openApp(390);
    await injectTwo();
    await openConfirm();
    let m = await page.ev(measure);

    check("runtime 390: one Leaflet map, size matches 280px container, attribution at bottom-right, zoom inside the frame", function () {
      assert.ok(!m.hidden, "confirm sheet open");
      assert.strictEqual(m.leafletCount, 1, "exactly one .leaflet-container");
      assert.ok(m.map && Math.abs(m.map.h - 280) <= 1, "map height " + (m.map && m.map.h));
      assert.ok(m.leafletSize && Math.abs(m.leafletSize.y - m.map.h) <= 1, "Leaflet _size.y matches container: " + JSON.stringify(m.leafletSize) + " vs " + m.map.h);
      assert.ok(m.leafletSize && Math.abs(m.leafletSize.x - m.map.w) <= 1, "Leaflet _size.x matches container");
      assert.ok(m.attr && /OpenStreetMap/i.test(m.attr.text || ""), "attribution present: " + (m.attr && m.attr.text));
      assert.ok(Math.abs(m.attr.b - m.map.b) <= 3, "attribution bottom flush with map bottom: attr.b=" + m.attr.b + " map.b=" + m.map.b);
      assert.ok(m.attr.r <= m.map.r + 1 && m.attr.r >= m.map.r - 80, "attribution at the right of the map");
      assert.ok(m.attr.t > (m.map.t + m.map.b) / 2, "attribution in the lower half, not mid-map next to the pin");
      assert.ok(m.zoom && m.zoom.t >= m.map.t - 1 && m.zoom.b <= m.map.b + 1 && m.zoom.l >= m.map.l - 1 && m.zoom.r <= m.map.r + 1, "zoom controls inside the map frame");
    });

    check("runtime 390: pin tip equals container centre; getCenter equals latlng under the tip within 10 m", function () {
      assert.ok(m.pin && m.map, "pin and map present");
      const cx = (m.map.l + m.map.r) / 2;
      const cy = (m.map.t + m.map.b) / 2;
      const dx = Math.abs(m.pin.x - cx);
      const dy = Math.abs(m.pin.y - cy);
      assert.ok(dx <= 2 && dy <= 2, "pin tip (" + m.pin.x + "," + m.pin.y + ") vs centre (" + cx + "," + cy + ")");
      assert.ok(m.saved && m.tip, "saved and tip latlng");
      const d = distM(m.saved, m.tip);
      assert.ok(d <= 10, "initial getCenter vs pin tip " + d + " m");
    });

    // after drag
    await page.ev(`(() => {
      var map = LocConfirmMap.getMap();
      map.panBy([70, 45], { animate: false });
      LocConfirmMap.syncSize();
      return true;
    })()`);
    m = await page.ev(measure);
    check("runtime: after drag, 『就放这里』 would save the point under the pin tip within 10 m", function () {
      const d = distM(m.saved, m.tip);
      assert.ok(d <= 10, "after drag " + d + " m  saved=" + JSON.stringify(m.saved) + " tip=" + JSON.stringify(m.tip));
    });

    // after tap (panTo a non-centre point, same as a map click)
    const tapD = await page.ev(`(() => {
      var map = LocConfirmMap.getMap();
      var el = document.getElementById("loc-confirm-map");
      var ll = map.containerPointToLatLng(L.point(el.clientWidth * 0.28, el.clientHeight * 0.32));
      map.fire("click", { latlng: ll });
      /* wait a tick for panTo; use setView to avoid animation */
      map.setView(ll, map.getZoom(), { animate: false });
      LocConfirmMap.syncSize();
      return LocConfirmMap.savedLatLng();
    })()`);
    m = await page.ev(measure);
    check("runtime: after tap, 『就放这里』 would save the point under the pin tip within 10 m", function () {
      const d = distM(m.saved, m.tip);
      assert.ok(d <= 10, "after tap " + d + " m");
    });

    // actually click 就放这里 and compare stored coords
    const savedItem = await page.ev(`(() => {
      var before = JSON.parse(JSON.stringify(TripApp.currentTrip().items.find(function (it) { return it.id === "p3"; })));
      var expect = LocConfirmMap.savedLatLng();
      var tip = LocConfirmMap.pinTipLatLng();
      document.getElementById("loc-pending-here").click();
      var after = TripApp.currentTrip().items.find(function (it) { return it.id === "p3"; });
      return { expect: expect, tip: tip, lat: after && after.lat, lng: after && after.lng, had: before };
    })()`);
    check("runtime: clicking 『就放这里』 stores the pin-tip point within 10 m", function () {
      assert.ok(savedItem && isFinite(savedItem.lat) && isFinite(savedItem.lng), "item got coords");
      const got = { lat: savedItem.lat, lng: savedItem.lng };
      assert.ok(distM(got, savedItem.tip) <= 10, "stored vs tip " + distM(got, savedItem.tip) + " m");
      assert.ok(distM(got, savedItem.expect) <= 10, "stored vs getCenter " + distM(got, savedItem.expect) + " m");
    });

    // after 就放这里 we should be on the next item (p4) with exactly one map
    await new Promise((r) => setTimeout(r, 300));
    await page.ev(`(() => { if (window.LocConfirmMap) LocConfirmMap.scheduleSize(); return true; })()`);
    await new Promise((r) => setTimeout(r, 200));
    m = await page.ev(measure);
    check("runtime: advancing to the next item leaves exactly one Leaflet map and no errors", function () {
      assert.ok(!m.hidden, "still on confirm (second item)");
      assert.strictEqual(m.leafletCount, 1, "one map after next item");
      assert.deepStrictEqual(m.errors, [], "no errors: " + JSON.stringify(m.errors));
    });

    // skip to close
    await page.ev(`(() => { var b = document.getElementById("loc-pending-skip"); if (b) b.click(); return true; })()`);
    await new Promise((r) => setTimeout(r, 200));
    const afterClose = await page.ev(`(() => {
      var sheet = document.getElementById("import-confirm-sheet");
      return {
        hidden: !sheet || sheet.hidden,
        html: sheet ? sheet.innerHTML.length : 0,
        leaflets: document.querySelectorAll("#import-confirm-sheet .leaflet-container").length,
        anyMaps: document.querySelectorAll(".import-confirm-map.leaflet-container, #import-confirm-sheet .leaflet-container").length,
        errors: window.__locConfirmErrors || []
      };
    })()`);
    check("runtime: close destroys the map (map.remove, empty sheet) with no leftover Leaflet instance or error", function () {
      assert.ok(afterClose.hidden, "sheet hidden");
      assert.strictEqual(afterClose.html, 0, "sheet cleared");
      assert.strictEqual(afterClose.leaflets, 0, "no .leaflet-container in the sheet");
      assert.deepStrictEqual(afterClose.errors, [], "no errors on close: " + JSON.stringify(afterClose.errors));
    });

    // reopen
    await openConfirm();
    m = await page.ev(measure);
    check("runtime: reopening the confirm view creates exactly one new map, no error", function () {
      assert.ok(!m.hidden);
      assert.strictEqual(m.leafletCount, 1);
      assert.deepStrictEqual(m.errors, [], "no errors on reopen: " + JSON.stringify(m.errors));
    });
    await page.ev(`(() => { var b = document.getElementById("loc-pending-skip"); if (b) b.click(); return true; })()`);
    await new Promise((r) => setTimeout(r, 150));

    // tiles failing + empty keys
    await page.ev(`(() => {
      window.MapTiles.attach = function (map) {
        L.tileLayer("http://127.0.0.1:9/missing-tiles/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
        return { provider: "none" };
      };
      return true;
    })()`);
    await openConfirm();
    const failSave = await page.ev(`(() => {
      var tip = LocConfirmMap.pinTipLatLng();
      var expect = LocConfirmMap.savedLatLng();
      document.getElementById("loc-pending-here").click();
      /* last remaining unlocated may have closed or advanced */
      var items = TripApp.currentTrip().items;
      var withCoords = items.filter(function (it) { return it.id !== "h1" && typeof it.lat === "number"; });
      return { tip: tip, expect: expect, withCoords: withCoords.map(function (it) { return { id: it.id, lat: it.lat, lng: it.lng }; }), errors: window.__locConfirmErrors || [] };
    })()`);
    check("runtime: when tiles fail to load, 『就放这里』 still saves the pin-tip point within 10 m", function () {
      assert.deepStrictEqual(failSave.errors, [], "no errors when tiles fail");
      assert.ok(failSave.expect && failSave.tip, "centre still available without tiles");
      assert.ok(distM(failSave.expect, failSave.tip) <= 10, "centre vs tip without tiles " + distM(failSave.expect, failSave.tip) + " m");
      const last = failSave.withCoords[failSave.withCoords.length - 1];
      assert.ok(last, "a place got coords");
      assert.ok(distM({ lat: last.lat, lng: last.lng }, failSave.tip) <= 10, "saved vs tip " + distM({ lat: last.lat, lng: last.lng }, failSave.tip) + " m");
    });

    // 先跳过 with tiles failing: reopen leftover or use a fresh unlocated
    await page.ev(`(() => {
      var t = TripApp.currentTrip();
      t.items.push({id:'p5', type:'place', subtype:'其他', nameZh:'第三家待确认', address:'Third Lane, London', date:'2026-11-19'});
      TripApp.refresh();
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 200));
    await openConfirm();
    const skipped = await page.ev(`(() => {
      var id = "p5";
      document.getElementById("loc-pending-skip").click();
      var it = TripApp.currentTrip().items.find(function (x) { return x.id === id; });
      var sheet = document.getElementById("import-confirm-sheet");
      return {
        hidden: !sheet || sheet.hidden,
        stillUnlocated: it && typeof it.lat !== "number",
        errors: window.__locConfirmErrors || []
      };
    })()`);
    check("runtime: when tiles fail, 「先跳过」 still closes / advances with no error and does not force a point", function () {
      assert.deepStrictEqual(skipped.errors, [], "no errors: " + JSON.stringify(skipped.errors));
      assert.ok(skipped.hidden || skipped.stillUnlocated, "skip did not crash");
      assert.ok(skipped.stillUnlocated, "skip did not write coordinates");
    });

    // 360 layout
    await openApp(360);
    await injectTwo();
    await openConfirm();
    await page.ev(`(() => { if (window.LocConfirmMap) LocConfirmMap.scheduleSize(); return true; })()`);
    await new Promise((r) => setTimeout(r, 250));
    m = await page.ev(measure);
    check("runtime 360: Leaflet size matches the container; attribution bottom-right; zoom inside the frame", function () {
      assert.ok(!m.hidden);
      assert.strictEqual(m.leafletCount, 1);
      assert.ok(m.map && Math.abs(m.map.h - 280) <= 1, "360 map height " + (m.map && m.map.h));
      assert.ok(m.leafletSize && Math.abs(m.leafletSize.y - m.map.h) <= 1 && Math.abs(m.leafletSize.x - m.map.w) <= 1, "360 Leaflet size " + JSON.stringify(m.leafletSize) + " map " + JSON.stringify(m.map));
      assert.ok(m.attr && Math.abs(m.attr.b - m.map.b) <= 3, "360 attribution bottom: attr.b=" + (m.attr && m.attr.b) + " map.b=" + m.map.b);
      assert.ok(m.attr.r <= m.map.r + 1 && m.attr.t > (m.map.t + m.map.b) / 2, "360 attribution at bottom-right, not mid-map");
      assert.ok(m.zoom && m.zoom.t >= m.map.t - 1 && m.zoom.b <= m.map.b + 1 && m.zoom.l >= m.map.l - 1 && m.zoom.r <= m.map.r + 1, "360 zoom inside the map frame");
      const cx = (m.map.l + m.map.r) / 2, cy = (m.map.t + m.map.b) / 2;
      assert.ok(Math.abs(m.pin.x - cx) <= 2 && Math.abs(m.pin.y - cy) <= 2, "360 pin tip at centre");
      assert.ok(distM(m.saved, m.tip) <= 10, "360 centre vs tip " + distM(m.saved, m.tip) + " m");
    });
  } finally {
    try { page.ws.close(); } catch (e) {}
    try { chrome.child.kill(); } catch (e) {}
    try { server.close(); } catch (e) {}
  }
}

runRuntime()
  .then(() => {
    if (failed) {
      console.error("\n" + failed + " failed");
      process.exit(1);
    }
    console.log("\nall passed");
  })
  .catch((err) => {
    console.error("  FAIL  runtime loc-confirm harness: " + (err && err.stack || err));
    process.exit(1);
  });
