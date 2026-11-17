#!/usr/bin/env node
"use strict";
/**
 * v6.1 item 18: location lookup layers (mocked network), parser, display-only titles.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Lookup = require("./lookup.js");
const Imp = require("./import.js");
const Geo = require("./geo.js");

let failed = 0;
function check(name, fn) {
  const r = fn && fn.constructor && fn.constructor.name === "AsyncFunction" ? fn() : Promise.resolve().then(fn);
  return r.then(() => console.log("  ok  " + name)).catch((err) => {
    failed += 1;
    console.error("  FAIL  " + name);
    console.error("    " + (err && err.stack ? err.stack : err));
  });
}

async function run() {
  await check("structured address: range house + postcode without city", function () {
    const p = Lookup.parseStructuredAddress("60-62 Great Titchfield Street, W1W 7QF", "Fitzrovia Music Studios");
    assert.strictEqual(p.house.replace(/\s/g, ""), "60-62");
    assert.ok(/Great Titchfield Street/i.test(p.street));
    assert.strictEqual(Lookup.normalizeUkPostcode(p.ukPostcode), "W1W 7QF");
    assert.ok(!p.street || p.street.indexOf("Fitzrovia") === -1, "shop name must not be in the street query");
  });

  await check("displayTitle is display-only: stored name with city suffix is trimmed, address-only shows street", function () {
    const full = "Sen Sen Noodle Bar, London";
    const addr = "7 Maddox St, London W1S 2QB, United Kingdom";
    assert.strictEqual(Lookup.displayTitle(full, addr), "Sen Sen Noodle Bar");
    assert.strictEqual(Lookup.displayTitle("", addr), "7 Maddox St");
    assert.strictEqual(Lookup.displayTitle("Moxy London Stratford", "4 Olympic Park Ave, London"), "Moxy London Stratford");
  });

  await check("decide: library / geocode / postcode / street-near / AI / pending", function () {
    const lib = Lookup.decide({ library: { lat: 51.5, lng: -0.12 } });
    assert.strictEqual(lib.source, "library");
    assert.strictEqual(lib.needsConfirm, false);
    const geo = Lookup.decide({ houseHit: { lat: 51.52, lng: -0.14 }, ai: { lat: 48.8, lng: 2.3 } });
    assert.strictEqual(geo.source, "geocode", "prefer address even when AI disagrees a lot");
    assert.strictEqual(geo.needsConfirm, false);
    const pc = Lookup.decide({ postcode: { lat: 51.516, lng: -0.14 } });
    assert.strictEqual(pc.source, "postcode");
    const streetOk = Lookup.decide({
      streetCity: { lat: 51.5161, lng: -0.1401 },
      postcode: { lat: 51.5160, lng: -0.1400 }
    });
    assert.strictEqual(streetOk.source, "street");
    const streetFar = Lookup.decide({
      streetCity: { lat: 51.6, lng: -0.2 },
      ai: { lat: 51.516, lng: -0.14 }
    });
    assert.notStrictEqual(streetFar.source, "street");
    const ai = Lookup.decide({ ai: { lat: 51.516, lng: -0.14 }, tripPoints: [{ lat: 51.51, lng: -0.13 }] });
    assert.strictEqual(ai.source, "ai");
    const aiFar = Lookup.decide({ ai: { lat: 48.8, lng: 2.3 }, tripPoints: [{ lat: 51.51, lng: -0.13 }] });
    assert.strictEqual(aiFar.needsConfirm, true);
    const none = Lookup.decide({});
    assert.strictEqual(none.needsConfirm, true);
    assert.strictEqual(none.lat, null);
  });

  await check("lookup layers: mocked geocode + postcodes.io; never calls name search", async function () {
    let nameCalls = 0;
    const origSearch = Lookup.searchByName;
    Lookup.searchByName = function () {
      nameCalls += 1;
      return Promise.resolve([{ lat: 99, lng: 99, name: "SHOULD NOT RUN" }]);
    };
    Lookup.setProvider("geocode", function (parts) {
      assert.ok(!/Sen Sen|Fitzrovia|Noodle/i.test(JSON.stringify(parts)), "shop name must not be sent");
      if (parts.street && /60-62/.test(parts.street) && parts.postalcode) {
        return [{ lat: 51.5204, lng: -0.1412, address: { house_number: "60" }, displayName: "60 Great Titchfield Street" }];
      }
      return [];
    });
    Lookup.setProvider("postcode", function (code) {
      assert.strictEqual(code, "W1S 2QB");
      return { lat: 51.5132, lng: -0.1425, postcode: code, source: "postcode" };
    });
    const a = await Lookup.lookup({
      nameZh: "Fitzrovia Music Studios",
      address: "60-62 Great Titchfield Street, W1W 7QF"
    }, { skipLibrary: true });
    assert.strictEqual(a.source, "geocode");
    assert.strictEqual(a.needsConfirm, false);
    const b = await Lookup.lookup({
      nameZh: "Sen Sen Noodle Bar",
      address: "7 Maddox St, London W1S 2QB, United Kingdom"
    }, { skipLibrary: true });
    assert.strictEqual(b.source, "postcode");
    assert.strictEqual(b.needsConfirm, false);
    assert.strictEqual(nameCalls, 0, "import path must not fall back to a name search");
    Lookup.searchByName = origSearch;
    Lookup.setProvider("geocode", null);
    Lookup.setProvider("postcode", null);
  });

  await check("import parser: trailing @lat,lng, month/day year fill, 收藏/xxx recognised", function () {
    const r = Imp.parseImport("地点/其他 | Test | 7 Maddox St, London W1S 2QB @51.5132,-0.1425 | 11-17 15:00 | 备注");
    assert.ok(r.items && r.items.length === 1);
    const it = r.items[0];
    assert.ok(it.address.indexOf("@") === -1, "coords stripped from stored address");
    assert.ok(Math.abs(it.hintLat - 51.5132) < 1e-6);
    assert.ok(Math.abs(it.hintLng - (-0.1425)) < 1e-6);
    assert.ok(/^\d{4}-11-17$/.test(it.date), "year filled for month/day: " + it.date);
    assert.strictEqual(it.time, "15:00");
    const fav = Imp.parseImport("收藏/餐厅 | Monmouth Coffee | 2 Park St, London SE1 9AB, UK |  | 朋友推荐");
    assert.ok(fav.items.length === 1);
    assert.ok(fav.items[0].type === "place" || fav.items[0].type === "food" || fav.items[0].subtype);
  });

  await check("带我去 uses name + address, coordinates only when no text", function () {
    const withText = Geo.pointQuery({ nameZh: "Sen Sen Noodle Bar", address: "7 Maddox St, London W1S 2QB", lat: 51.5, lng: -0.1 });
    assert.ok(/Sen Sen/.test(withText) && /Maddox/.test(withText), withText);
    assert.ok(!/51\.5/.test(withText), "coords must not be used when text exists");
    const only = Geo.pointQuery({ lat: 51.5074, lng: -0.1278 });
    assert.ok(/51\.5074/.test(String(only)) || /51,5074/.test(String(only)) || /51.5074/.test(String(only)));
  });

  await check("CSP and allowed-host list include api.postcodes.io; no name-fallback in import lookup", function () {
    const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
    assert.ok(html.indexOf("https://api.postcodes.io") !== -1, "CSP connect-src");
    const lu = fs.readFileSync(path.join(__dirname, "lookup.js"), "utf8");
    assert.ok(lu.indexOf("导入时绝不按店名") !== -1 || lu.indexOf("导入时绝不按店名搜") !== -1);
    assert.ok(lu.indexOf("providers.amap") !== -1, "v6.3 高德 hook");
    const sw = fs.readFileSync(path.join(__dirname, "sw.js"), "utf8");
    assert.ok(sw.indexOf('cache: "reload"') !== -1);
    assert.ok(sw.indexOf('cache: "no-cache"') !== -1);
    assert.ok(sw.indexOf("xingcheng-map-shell-v21") !== -1);
  });

  if (failed) {
    console.error("\n" + failed + " failed");
    process.exit(1);
  }
  console.log("\nall passed");
}

run();
