#!/usr/bin/env node
"use strict";
/**
 * v6.1 citywalk import stability (fake data only, network mocked).
 * A citywalk of 8 undated stops is pasted once: some full addresses,
 * some postcode only, some shop name only.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Lookup = require("./lookup.js");
const Geocode = require("./geocode.js");
const Imp = require("./import.js");
const Legs = require("./legs.js");

let failed = 0;
function check(name, fn) {
  const r = fn && fn.constructor && fn.constructor.name === "AsyncFunction" ? fn() : Promise.resolve().then(fn);
  return r.then(() => console.log("  ok  " + name)).catch((err) => {
    failed += 1;
    console.error("  FAIL  " + name);
    console.error("    " + (err && err.stack ? err.stack : err));
  });
}

const NAMES = [
  "示例书店",
  "示例公园茶室",
  "示例画廊",
  "示例市场",
  "示例小馆",
  "角落咖啡",
  "示例博物馆分馆",
  "河边小店"
];

/* 8 条假数据：3 条完整地址、2 条只有邮编、3 条只有店名，都没有日期。顺序即帖子顺序。 */
const CITYWALK = [
  "地点 | 示例书店 | 10 Example Street, London W1T 1AA, UK |  |",
  "地点 | 示例公园茶室 | 25 Sample Road, London EC1A 1BB, United Kingdom |  |",
  "地点 | 示例画廊 | W1W 7QF |  |",
  "地点 | 示例市场 | SW1A 1AA |  |",
  "地点 | 示例小馆 |  |  |",
  "地点 | 角落咖啡 |  |  |",
  "地点 | 示例博物馆分馆 | 1 Test Lane, London WC1B 3DG, UK |  |",
  "地点 | 河边小店 |  |  |"
].join("\n");

const NAME_ONLY = new Set(["示例小馆", "角落咖啡", "河边小店"]);
const POSTCODE_ONLY = new Set(["示例画廊", "示例市场"]);
const FULL_ADDR = new Set(["示例书店", "示例公园茶室", "示例博物馆分馆"]);

const POSTCODES = {
  "W1T 1AA": { lat: 51.5201, lng: -0.1360 },
  "EC1A 1BB": { lat: 51.5204, lng: -0.0977 },
  "W1W 7QF": { lat: 51.5205, lng: -0.1410 },
  "SW1A 1AA": { lat: 51.5010, lng: -0.1416 },
  "WC1B 3DG": { lat: 51.5194, lng: -0.1269 }
};

function uniqueItemIds(existing, incoming) {
  const used = {};
  (existing || []).forEach((it) => { if (it.id) used[it.id] = true; });
  return (incoming || []).map((it) => {
    const copy = Object.assign({}, it);
    let base = copy.id || "item";
    let id = base;
    let n = 1;
    while (used[id]) {
      n += 1;
      id = base + "-" + n;
    }
    used[id] = true;
    copy.id = id;
    return copy;
  });
}

function listCountLine(view) {
  return view.count ? "共 " + view.count + " 项" : "";
}

function missLine(view) {
  return view.unlocated.length + " 项还没位置 ›";
}

async function resolveWithMocks(items) {
  const origFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = function (url) {
    fetchCalls += 1;
    return Promise.reject(new Error("network was not mocked: " + url));
  };
  Lookup.setProvider("geocode", function (parts) {
    const blob = JSON.stringify(parts || {});
    assert.ok(!/示例小馆|角落咖啡|河边小店|示例书店|示例画廊/.test(blob) || /Example Street|Sample Road|Test Lane|W1T|EC1A|WC1B|W1W|SW1A/.test(blob), "shop-name-only must not be sent as a name search");
    if (parts && parts.street && /Example Street/i.test(parts.street)) {
      return [{ lat: 51.5201, lng: -0.1360, displayName: "10 Example Street" }];
    }
    if (parts && parts.street && /Sample Road/i.test(parts.street)) {
      return [{ lat: 51.5204, lng: -0.0977, displayName: "25 Sample Road" }];
    }
    if (parts && parts.street && /Test Lane/i.test(parts.street)) {
      return [{ lat: 51.5194, lng: -0.1269, displayName: "1 Test Lane" }];
    }
    return [];
  });
  Lookup.setProvider("postcode", function (code) {
    const hit = POSTCODES[code];
    if (!hit) return null;
    return { lat: hit.lat, lng: hit.lng, postcode: code, source: "postcode" };
  });
  try {
    await Geocode.resolveAll(items, null, function () { return { skipLibrary: true }; });
  } finally {
    Lookup.setProvider("geocode", null);
    Lookup.setProvider("postcode", null);
    global.fetch = origFetch;
  }
  assert.strictEqual(fetchCalls, 0, "postcodes.io / nominatim must be mocked, no real network");
  return items;
}

async function run() {
  await check("parser keeps all 8 undated stops in post order; empty address cells stay empty", function () {
    const r = Imp.parseImport(CITYWALK);
    assert.deepStrictEqual(r.errors, [], r.errors.join("; "));
    assert.strictEqual(r.items.length, 8);
    assert.deepStrictEqual(r.items.map((it) => it.nameZh || it.nameEn), NAMES);
    r.items.forEach((it) => {
      assert.ok(!it.date && !it.pendingDate, it.nameZh + " must be undated");
      if (NAME_ONLY.has(it.nameZh)) {
        assert.ok(!String(it.address || "").trim(), it.nameZh + " address must stay empty");
      }
    });
  });

  await check("citywalk: list count, 「共 N 项」 and map pins + unlocated agree; name-only is 「位置待确认」", async function () {
    const r = Imp.parseImport(CITYWALK);
    await resolveWithMocks(r.items);
    const view = Legs.viewItems(r.items, "all");
    assert.strictEqual(view.count, 8);
    assert.strictEqual(view.visible.length, 8);
    assert.deepStrictEqual(view.visible.map((it) => it.nameZh), NAMES, "visible order follows the paste");
    assert.strictEqual(view.pins.length + view.unlocated.length, view.count, "map pins + unlocated = list count");
    assert.strictEqual(listCountLine(view), "共 8 项");

    const pending = r.items.filter((it) => NAME_ONLY.has(it.nameZh));
    const located = r.items.filter((it) => !NAME_ONLY.has(it.nameZh));
    assert.strictEqual(pending.length, 3);
    pending.forEach((it) => {
      assert.ok(typeof it.lat !== "number" || typeof it.lng !== "number", it.nameZh + " must stay unlocated");
    });
    located.forEach((it) => {
      assert.ok(typeof it.lat === "number" && typeof it.lng === "number", it.nameZh + " should get a mocked point");
    });
    assert.strictEqual(view.unlocated.length, 3);
    assert.strictEqual(view.pins.length, 5);
    assert.strictEqual(missLine(view), "3 项还没位置 ›");
    assert.ok(Lookup.COPY.pending.indexOf("位置待确认") !== -1);
    view.unlocated.forEach((it) => {
      assert.ok(NAME_ONLY.has(it.nameZh), it.nameZh + " should be the name-only stops");
    });
  });

  await check("timeline toast copy is 「已导入 N 项」; 位置待确认 and 项还没位置 strings are in the UI", function () {
    const tl = fs.readFileSync(path.join(__dirname, "timeline.js"), "utf8");
    assert.ok(tl.indexOf('return "已导入 " + n + " 项"') !== -1);
    assert.ok(tl.indexOf('list.length + " 项还没位置 ›"') !== -1);
    assert.ok(tl.indexOf("位置待确认 ›") !== -1);
  });

  await check("blank lines and AI chatter around the paste are ignored; 8 stops still import in order", function () {
    const messy = [
      "下面是整理好的行程：",
      "",
      "```",
      CITYWALK,
      "```",
      "",
      "祝你玩得开心！"
    ].join("\n");
    const r = Imp.parseImport(messy);
    assert.strictEqual(r.items.length, 8, "chatter must not drop or add stops");
    assert.deepStrictEqual(r.items.map((it) => it.nameZh), NAMES);
    assert.deepStrictEqual(r.errors, []);
  });

  await check("pasting the same text again: report current behaviour, do not add dedupe", function () {
    const first = Imp.parseImport(CITYWALK).items;
    const second = Imp.parseImport(CITYWALK).items;
    assert.strictEqual(first.length, 8);
    assert.strictEqual(second.length, 8);
    /* IDs from two independent parses collide (same slug); appendItems only uniquifies ids. */
    const sameIds = first.filter((a) => second.some((b) => b.id === a.id));
    const merged = first.concat(uniqueItemIds(first, second));
    assert.strictEqual(merged.length, 16, "current behaviour: a second paste appends another 8 cards");
    const names = merged.map((it) => it.nameZh);
    NAMES.forEach((n) => {
      assert.strictEqual(names.filter((x) => x === n).length, 2, n + " appears twice after a second paste");
    });
    const ids = merged.map((it) => it.id);
    assert.strictEqual(new Set(ids).size, 16, "ids are uniquified with -2, but cards are still duplicated");
    assert.ok(sameIds.length === 8, "parser emits the same ids again; appendItems does not drop them as content dupes");
    /* Known issue in v6.1: a second paste appends duplicates. Dedupe is scheduled for v6.2; do not implement it here. */
  });

  if (failed) {
    console.error("\n" + failed + " failed");
    process.exit(1);
  }
  console.log("\nall passed");
}

run();
