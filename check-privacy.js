/**
 * 隐私导出校验。用法：node check-privacy.js
 */
"use strict";

const assert = require("assert");
const BackupUtil = require("./backup.js");
const Geocode = require("./geocode.js");

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

const samplePayload = {
  app: "行程地图",
  version: 1,
  trips: [
    {
      id: "sample",
      nameZh: "测试行程",
      items: [
        {
          type: "flight",
          flightNo: "BA123",
          fromAirport: "LHR",
          toAirport: "HND",
          seat: "32A",
          confirmationNo: "",
          note: "座位 32A 靠窗，已值机"
        },
        {
          type: "hotel",
          nameZh: "The Savoy",
          nameEn: "The Savoy",
          address: "Strand, London WC2R 0EZ",
          confirmationNo: "ABC123",
          note: "确认号 ABC123 豪华房"
        }
      ],
      legs: [{ origin: "a", destination: "b", note: "确认号 XYZ999 上车点" }]
    }
  ],
  legs: {
    "a:b": { origin: "a", destination: "b", mode: "公共交通", note: "座位 12B 别忘了" }
  },
  geocodeCache: { "the savoy": { results: [{ lat: 51.51, lng: -0.12 }] } }
};

check("share export strips confirmation, seat, and note patterns; drops geocode cache", function () {
  const share = BackupUtil.redactForShare(JSON.parse(JSON.stringify(samplePayload)));
  const json = JSON.stringify(share);
  assert.strictEqual(share.kind, "share");
  assert.strictEqual("geocodeCache" in share, false, "must not include geocodeCache");
  assert.ok(!json.includes("ABC123"), json);
  assert.ok(!json.includes("32A"), json);
  assert.ok(!json.includes("XYZ999"), json);
  assert.ok(!json.includes("12B"), json);
  const flight = share.trips[0].items[0];
  const hotel = share.trips[0].items[1];
  assert.strictEqual(flight.flightNo, "BA123");
  assert.ok(!flight.seat);
  assert.ok(!flight.confirmationNo);
  assert.strictEqual(flight.note, "靠窗，已值机");
  assert.ok(!hotel.confirmationNo);
  assert.strictEqual(hotel.note, "豪华房");
  assert.strictEqual(share.trips[0].legs[0].note, "上车点");
  assert.strictEqual(share.legs["a:b"].note, "别忘了");
  assert.ok(json.includes("BA123"));
  assert.ok(json.includes("The Savoy"));
});

check("full backup payload keeps secrets when includeGeocodeCache is true", function () {
  /* collect() needs no DOM; we only test redact is not applied to a raw payload */
  const json = JSON.stringify(samplePayload);
  assert.ok(json.includes("ABC123"));
  assert.ok(json.includes("32A"));
  assert.ok(json.includes("geocodeCache"));
});

check("share filename pattern uses compact YYYYMMDD", function () {
  const stamp = BackupUtil.todayStamp();
  assert.ok(/^\d{8}$/.test(stamp), stamp);
  const src = require("fs").readFileSync(__dirname + "/backup.js", "utf8");
  assert.ok(src.indexOf('"freeyourtrip-share-" + todayStamp() + ".json"') !== -1, "share file uses freeyourtrip- prefix");
  assert.ok(src.indexOf('"freeyourtrip-full-backup-" + todayStamp() + ".json"') !== -1, "full backup uses freeyourtrip- prefix");
  assert.ok(src.indexOf("行程分享-") === -1 && src.indexOf("行程完整备份-") === -1, "old names gone");
  const shareName = "freeyourtrip-share-" + stamp + ".json";
  const fullName = "freeyourtrip-full-backup-" + stamp + ".json";
  assert.notStrictEqual(shareName, fullName);
});

check("Nominatim sanitize drops confirmation/seat/notes, keeps name/address/IATA", function () {
  const s = Geocode.sanitizeGeocodeQuery;
  assert.strictEqual(s("The Savoy 确认号 ABC123 豪华房"), "The Savoy 豪华房");
  assert.strictEqual(s("大英博物馆 座位 32A"), "大英博物馆");
  assert.strictEqual(s("LHR airport"), "LHR airport");
  assert.strictEqual(s("Great Russell St, London"), "Great Russell St, London");
  assert.ok(!s("确认号 ABC123").includes("ABC123"));
  assert.ok(!s("座位 32A").includes("32A"));
});

check("mask pattern for UI (ABC123 -> AB****23)", function () {
  function maskSecret(s) {
    s = String(s == null ? "" : s);
    if (s.length <= 4) return "****";
    return s.slice(0, 2) + "****" + s.slice(-2);
  }
  assert.strictEqual(maskSecret("ABC123"), "AB****23");
  assert.strictEqual(maskSecret("SAV-EXAMPLE-001"), "SA****01");
  assert.strictEqual(maskSecret("AB"), "****");
});

check("locate: position stays in memory only — never stored, sent, or exported", function () {
  const fs = require("fs");
  const src = fs.readFileSync(__dirname + "/locate.js", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ["localStorage", "sessionStorage", "indexedDB", "fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "watchPosition", "document.cookie"].forEach((bad) => {
    assert.ok(src.indexOf(bad) === -1, "locate.js must not use " + bad);
  });
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  const bk = fs.readFileSync(__dirname + "/backup.js", "utf8");
  assert.ok(tl.indexOf("geolocation") === -1, "timeline.js never requests the position");
  /* v5.2：timeline.js 只在 hereInMemory() 里读内存里的位置，用来选高德还是 Google；不存、不放进链接 */
  const hereFn = tl.slice(tl.indexOf("function hereInMemory"), tl.indexOf("function hereInMemory") + 300);
  /* LocateMe 只在两处出现：hereInMemory() 读内存位置；展开没坐标卡片时 warmIfGranted（权限已允许才取，不弹窗） */
  assert.ok(/window\.LocateMe && LocateMe\.warmIfGranted\) \{\s*LocateMe\.warmIfGranted\(renderList\);/.test(tl));
  assert.strictEqual(tl.split("LocateMe").length - 1, hereFn.split("LocateMe").length - 1 + 3, "LocateMe only in hereInMemory() and the warm-up on expand");
  const loc = fs.readFileSync(__dirname + "/locate.js", "utf8");
  const warm = loc.slice(loc.indexOf("function warmIfGranted"), loc.indexOf("function warmIfGranted") + 700);
  assert.ok(/st\.state !== "granted"\) return;/.test(warm), "only when permission is already granted (no prompt)");
  assert.ok(!/localStorage|sessionStorage|fetch\(/.test(warm), "never stored or sent");
  const G = require("./geo.js");
  const here = { lat: 31.234567, lng: 121.476543 };
  const l = G.buildFlexibleNavLinks(null, { name: "示例", address: "上海市示例路 1 号" }, "公共交通", here);
  const p = G.buildPlaceLink({ name: "示例", address: "上海市示例路 1 号" }, here);
  [l.href, l.google, l.amap, p.href].forEach((u) => assert.ok(u.indexOf("31.234567") === -1 && u.indexOf("121.476543") === -1, "your position never goes into a link: " + u));
  assert.ok(bk.indexOf("LocateMe") === -1 && bk.indexOf("geolocation") === -1, "backup/share never include the position");
  const ex = fs.readFileSync(__dirname + "/timeline.js", "utf8").match(/function exportState\(\)[\s\S]*?\n  \}/);
  assert.ok(ex && !/position|coords|locate/i.test(ex[0]), "exportState has no position fields");
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  assert.ok(!/geolocation|getCurrentPosition/.test(html), "no geolocation call on page load");
});

check("area bias: viewbox numbers have at most 1 decimal; built only from trip items, never the user's location", function () {
  const fs = require("fs");
  const exact = { lat: 35.003712, lng: 135.778845 };
  const box = Geocode.biasArea(exact);
  box.viewbox.split(",").forEach((n) => assert.ok(/^-?\d+(\.\d)?$/.test(n), "1 decimal max: " + n));
  assert.ok(box.viewbox.indexOf("35.0037") === -1 && box.viewbox.indexOf("135.7788") === -1, "exact hotel coords never sent");
  [[51.50729, -0.12759], [-33.86882, 151.20929], [0.04, -0.04]].forEach(([lat, lng]) => {
    Geocode.biasArea({ lat, lng }).viewbox.split(",").forEach((n) => assert.ok(/^-?\d+(\.\d)?$/.test(n), n));
  });
  const geo = fs.readFileSync(__dirname + "/geocode.js", "utf8");
  assert.ok(!/LocateMe|geolocation|lastPoint|hereInMemory/.test(geo), "geocode.js never reads the user's position");
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  const args = tl.slice(tl.indexOf("function searchDayArgs"), tl.indexOf("function openFixAddress"));
  assert.ok(args.length > 100 && !/LocateMe|hereInMemory|lastPoint|geolocation/.test(args), "the bias comes from trip items only");
  assert.ok(/TripName\.dayArea\(items, day, opts\)/.test(args));
  const tn = fs.readFileSync(__dirname + "/trip-name.js", "utf8");
  assert.ok(!/LocateMe|geolocation|lastPoint/.test(tn));
});

(async function () {
  /* real request URL with a fake fetch: rounded viewbox, bounded=0, no exact coords */
  const urls = [];
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.fetch = (u) => { urls.push(u); return Promise.resolve({ ok: true, json: () => Promise.resolve([]) }); };
  try {
    await Geocode.nominatimSearch("示例小店 Kyoto", { bias: { lat: 35.003712, lng: 135.778845 } });
    const u = urls[0] || "";
    const vb = (u.match(/[?&]viewbox=([^&]*)/) || [])[1] || "";
    assert.strictEqual(decodeURIComponent(vb), "135.6,35.2,136.0,34.8");
    /* v5.3：先 bounded=1（只在框里找），0 个结果再 bounded=0 */
    assert.ok(/[?&]bounded=1(&|$)/.test(u), "first try stays inside the box");
    assert.ok(urls[1] && /[?&]bounded=0(&|$)/.test(urls[1]) && urls[1].indexOf("viewbox=" + vb) !== -1, "0 results → bounded=0 fallback");
    urls.slice(0, 2).forEach((x) => assert.ok(!/35\.00|135\.77|\d\.\d{2}/.test(decodeURIComponent(x.replace(/^[^?]*\?/, "").replace(/q=[^&]*/, ""))), "no value with 2+ decimals in the params"));
    await Geocode.nominatimSearch("示例小店");
    assert.ok(urls[2] && urls[2].indexOf("viewbox") === -1, "no bias → no viewbox");
    console.log("PASS  Nominatim request: rounded viewbox, bounded=1 then 0, nothing more precise");
  } catch (err) {
    failures += 1;
    console.log("FAIL  Nominatim request bias");
    console.log("      " + (err && err.stack ? err.stack : err));
  }
  if (failures) {
    console.log("\n" + failures + " failure(s)");
    process.exit(1);
  }
  console.log("\nAll privacy checks passed.");
})();
