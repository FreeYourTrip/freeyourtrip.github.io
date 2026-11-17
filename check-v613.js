/**
 * v6.1.3：行程分享链接 / 文字块，以及顶栏『我的行程』只打开列表。
 * 用法：node check-v613.js
 * v6.1.3：分享链接 / 文字块，顶栏『我的行程』只打开列表。
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const root = __dirname;
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
require("./backup.js");
const S = require("./share-link.js");
const html = read("index.html");
const tl = read("timeline.js");
const css = read("styles.css");
const sw = read("sw.js");

/* Compact deflate-raw zeros that would expand to `targetBytes` if fully inflated. */
function makeDeflateZeroBomb(targetBytes) {
  class BitWriter {
    constructor() { this.bytes = []; this.cur = 0; this.n = 0; }
    writeBits(val, bits) {
      for (let i = 0; i < bits; i++) {
        this.cur |= ((val >> i) & 1) << this.n;
        this.n++;
        if (this.n === 8) { this.bytes.push(this.cur); this.cur = 0; this.n = 0; }
      }
    }
    writeHuff(code, bits) {
      for (let i = bits - 1; i >= 0; i--) this.writeBits((code >> i) & 1, 1);
    }
    toBuffer() {
      if (this.n) this.bytes.push(this.cur);
      return Buffer.from(this.bytes);
    }
  }
  const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  function buildCanonical(lengths) {
    const max = Math.max(0, ...lengths);
    const blCount = Array(max + 1).fill(0);
    for (const l of lengths) if (l) blCount[l]++;
    const nextCode = Array(max + 1).fill(0);
    let code = 0;
    for (let bits = 1; bits <= max; bits++) {
      code = (code + blCount[bits - 1]) << 1;
      nextCode[bits] = code;
    }
    return lengths.map((l, i) => l ? { code: nextCode[l]++, bits: l } : null);
  }
  const litLen = Array(286).fill(0);
  litLen[0] = 2;
  litLen[256] = 2;
  litLen[285] = 1;
  const distLen = [1, 1];
  const clLen = Array(19).fill(0);
  clLen[0] = 2; clLen[1] = 2; clLen[2] = 2; clLen[18] = 2;
  const copies = Math.max(0, Math.ceil((targetBytes - 1) / 258));
  const w = new BitWriter();
  w.writeBits(1, 1);
  w.writeBits(2, 2);
  w.writeBits(286 - 257, 5);
  w.writeBits(1, 5);
  w.writeBits(15, 4);
  for (let i = 0; i < 19; i++) w.writeBits(clLen[CL_ORDER[i]] || 0, 3);
  const clCodes = buildCanonical(clLen);
  const writeCL = (sym) => w.writeHuff(clCodes[sym].code, clCodes[sym].bits);
  for (let i = 0; i < 286; i++) writeCL(litLen[i]);
  writeCL(distLen[0]);
  writeCL(distLen[1]);
  const litCodes = buildCanonical(litLen);
  const distCodes = buildCanonical(distLen);
  w.writeHuff(litCodes[0].code, litCodes[0].bits);
  for (let i = 0; i < copies; i++) {
    w.writeHuff(litCodes[285].code, litCodes[285].bits);
    w.writeHuff(distCodes[0].code, distCodes[0].bits);
  }
  w.writeHuff(litCodes[256].code, litCodes[256].bits);
  return w.toBuffer().toString("base64url");
}


let passes = 0;
let failures = 0;
const pendingChecks = [];
function check(name, fn) {
  try {
    const ret = fn();
    if (ret && typeof ret.then === "function") {
      const p = ret.then(function () { passes += 1; console.log("PASS  " + name); }, function (err) {
        failures += 1; console.log("FAIL  " + name); console.log("      " + (err && err.stack ? err.stack : err));
      });
      pendingChecks.push(p);
      return p;
    }
    passes += 1;
    console.log("PASS  " + name);
  } catch (err) {
    failures += 1;
    console.log("FAIL  " + name);
    console.log("      " + (err && err.stack ? err.stack : err));
  }
}

function sampleState(n, extra) {
  extra = extra || {};
  const items = [];
  for (let i = 0; i < n; i++) {
    items.push({
      id: "p" + i,
      type: "place",
      nameZh: extra.name || ("地点" + i),
      address: extra.address || ("上海市黄浦区示例路" + i + "号"),
      date: "2026-12-0" + ((i % 9) + 1),
      lat: 31.2 + i * 0.001,
      lng: 121.4 + i * 0.001,
      note: extra.note || ("备注" + i)
    });
  }
  return {
    activeTripId: "t1",
    trips: [{ id: "t1", nameZh: extra.tripName || "示例行程", items: items }],
    places: [],
    legs: {}
  };
}

check("ShareLink.ENABLED is on; APP_VERSION is v6.1.3; cache is v22; announcement and changelog are live", function () {
  assert.strictEqual(S.ENABLED, true);
  const V = require("./version.js");
  assert.strictEqual(V.APP_VERSION, "v6.1.3");
  assert.strictEqual(V.SHELL_CACHE, "xingcheng-map-shell-v22");
  assert.ok(sw.indexOf("./share-link.js") !== -1);
  assert.ok(sw.indexOf('"xingcheng-map-shell-v22"') !== -1);
  assert.ok(html.indexOf('src="./share-link.js"') !== -1);
  assert.ok(!V.STAGED_V613, "staged object has been moved into the live announcement");
  assert.strictEqual(V.ANNOUNCEMENT.title, "v6.1.3 更新");
  assert.ok(!V.ANNOUNCEMENT.draft);
  assert.deepStrictEqual(V.ANNOUNCEMENT.bullets, [
    "分享给朋友，发个链接就行，朋友点开就能存好",
    "顶上的『+ 新行程』改叫『我的行程』，点了只打开列表"
  ]);
  assert.strictEqual(V.CHANGELOG[0].version, "v6.1.3");
  assert.ok(!V.CHANGELOG[0].draft);
  assert.deepStrictEqual(V.CHANGELOG[0].lines, [
    "新增：分享行程改成发链接，朋友点开就能存到自己的行程",
    "新增：链接打不开时，可以点『改发文字』，发一段文字过去",
    "修复：同一趟行程存两次，不会多出一份",
    "修复：点顶上的『我的行程』只打开列表，不会再多出一个空行程",
    "调整：设置里的「分享给朋友」改回「推荐这个工具」；新手说明加了一条，讲怎么和同行的人共用行程",
    "修复：所有地点都能拖着换顺序，『没定时间』和『待补』里的也行，刷新后不会变回去",
    "调整：『给 AI 的话』不用再展开一大段，点一下就复制好"
  ]);
});

check("encode/decode round trip uses the redacted share payload (no notes by default, no secrets, no cache)", function () {
  const state = sampleState(2, { note: "确认号 ABC 座位 12A 和晚餐" });
  state.trips[0].items[0].confirmationNo = "SECRET99";
  state.trips[0].items[0].seat = "12A";
  const p = S.buildSharePayload(state, { includeNotes: false });
  assert.strictEqual(p.kind, "share");
  assert.ok(!p.geocodeCache);
  assert.ok(p.trips[0].items[0].confirmationNo == null);
  assert.ok(p.trips[0].items[0].seat == null);
  assert.ok(p.trips[0].items[0].note == null);
  const data = S.encodeSync(p);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(data));
  const back = S.decodeSync(data);
  assert.strictEqual(back.trips[0].nameZh, "示例行程");
  assert.strictEqual(back.trips[0].items.length, 2);
  const withNotes = S.buildSharePayload(state, { includeNotes: true });
  assert.ok(withNotes.trips[0].items[0].note);
  assert.ok(withNotes.trips[0].items[0].note.indexOf("SECRET99") === -1);
  assert.ok(withNotes.trips[0].items[0].note.indexOf("确认号") === -1);
});

check("link over 4000 chars falls back to the text block", function () {
  const p = S.buildSharePayload(sampleState(2), { includeNotes: false });
  const data = S.encodeSync(p);
  const shortLink = S.makeLink(data);
  assert.ok(!S.shouldFallbackToText(p, shortLink));
  const longLink = S.BASE + "/#s=" + "A".repeat(4000);
  assert.ok(longLink.length > 4000);
  assert.ok(S.shouldFallbackToText(p, longLink));
  const many = S.buildSharePayload(sampleState(81), { includeNotes: false });
  assert.ok(S.placeCount(many) > 80);
  assert.ok(S.shouldFallbackToText(many, S.makeLink(S.encodeSync(many))));
  const text = S.makeTextBlock(S.summarize(p), data);
  assert.ok(text.indexOf("【Free Your Trip】朋友分享了一趟行程：") === 0);
  assert.ok(text.indexOf("把这整段复制下来，打开 freeyourtrip.github.io，点底部『＋ 添加』，再点『粘贴朋友发来的行程』，最后点『粘贴并导入』就能存好。") !== -1);
  const oldHeader = "【Free Your Trip】朋友分享了一趟行程：" + S.summarize(p).line + "。" + S.OLD_TEXT_HEADER_TAIL + "\n" + data;
  assert.ok(S.parseTextBlock(text), "new header is recognised");
  assert.ok(S.parseTextBlock(oldHeader), "old header is still recognised");
  assert.strictEqual(S.TEXT_TOAST, "行程太长，已改成一段文字，复制发给同行的人就行");
  assert.strictEqual(S.LINK_COPY_TOAST, "链接已复制，发给同行的人就行");
  assert.strictEqual(S.TEXT_COPY_TOAST, "文字已复制，发给同行的人就行");
});

check("receiving a link rejects more than 80 items (all types, same as 共 N 项) or decoded size over 64KB", function () {
  const many = S.buildSharePayload(sampleState(81), { includeNotes: false });
  const data = S.encodeSync(many);
  const r = S.decodeIncoming("link", data);
  assert.ok(!r.ok, "81-item link must be rejected");
  assert.ok(r.error === "too-many-places" || r.error === "too-large");
  const textOk = S.decodeIncoming("text", data);
  assert.ok(textOk.ok, "pasted text uses normal (higher) limits");
  const mixed81 = [];
  const kinds = ["place", "flight", "hotel", "train", "food"];
  for (let i = 0; i < 81; i++) {
    const type = kinds[i % kinds.length];
    const it = { id: "m" + i, type: type, nameZh: "项" + i, address: "东京都渋谷区1-1", city: "东京" };
    if (type === "flight") it.departDate = "2026-12-01";
    else if (type === "hotel") { it.checkIn = "2026-12-01"; it.checkOut = "2026-12-08"; }
    else if (type === "train") it.departDate = "2026-12-02";
    else it.date = "2026-12-03";
    mixed81.push(it);
  }
  const mixedPayload = S.buildSharePayload({
    activeTripId: "t1", trips: [{ id: "t1", nameZh: "混合", items: mixed81 }], places: [], legs: {}
  }, { includeNotes: false });
  assert.strictEqual(S.placeCount(mixedPayload), 81);
  assert.ok(S.shouldFallbackToText(mixedPayload, S.makeLink(S.encodeSync(mixedPayload))), "81 mixed items must fall back to text");
  const mixedLink = S.decodeIncoming("link", S.encodeSync(mixedPayload));
  assert.ok(!mixedLink.ok, "81 mixed items must be rejected on the link receive side");

  const bulkyItems = [];
  for (let i = 0; i < 30; i++) {
    bulkyItems.push({
      id: "b" + i, type: "place", nameZh: "X".repeat(800),
      address: "Y".repeat(800), date: "2026-12-01", lat: 31, lng: 121
    });
  }
  const bulky = S.buildSharePayload({
    activeTripId: "t1",
    trips: [{ id: "t1", nameZh: "大", items: bulkyItems }],
    places: [], legs: {}
  }, { includeNotes: false });
  const raw = Buffer.byteLength(JSON.stringify(bulky), "utf8");
  if (raw > 64 * 1024) {
    const d = S.encodeSync(bulky);
    const r2 = S.decodeIncoming("link", d);
    assert.ok(!r2.ok, "64KB decoded link must be rejected, bytes=" + raw);
  } else {
    const bigger = [];
    for (let i = 0; i < 80; i++) {
      bigger.push({
        id: "b" + i, type: "place", nameZh: "X".repeat(600),
        address: "Y".repeat(600), date: "2026-12-01", lat: 31, lng: 121, note: "Z".repeat(400)
      });
    }
    const p3 = S.buildSharePayload({
      activeTripId: "t1", trips: [{ id: "t1", nameZh: "大", items: bigger }], places: [], legs: {}
    }, { includeNotes: true });
    const bytes = Buffer.byteLength(JSON.stringify(p3), "utf8");
    assert.ok(bytes > 64 * 1024, "fixture should exceed 64KB, got " + bytes);
    const r3 = S.decodeIncoming("link", S.encodeSync(p3));
    assert.ok(!r3.ok);
  }
});

check("XSS: names like <img onerror> are escaped for render; bad coordinates and dates are stripped, items kept", function () {
  const payload = {
    trips: [{
      nameZh: "行程",
      items: [
        { nameZh: "<img onerror=alert(1)>", address: "<script>x</script>", note: "a & b", date: "2026-12-10" },
        { nameZh: "坏坐标", lat: 999, lng: 1, date: "2026-12-10" },
        { nameZh: "坏日期", date: "12/10/2026", lat: 31, lng: 121 },
        { nameZh: "不可能的日期", date: "2026-02-31", lat: 31, lng: 121 },
        { nameZh: "待补地点", address: "东京都渋谷区", city: "东京", lat: 35.66, lng: 139.7 },
        { nameZh: "好的", date: "2026-12-11", lat: 31.2, lng: 121.4 },
        { type: "place" },
        { city: "东京" }
      ]
    }]
  };
  const clean = S.sanitizePayload(payload);
  const names = clean.trips[0].items.map((it) => it.nameZh);
  assert.deepStrictEqual(names, ["<img onerror=alert(1)>", "坏坐标", "坏日期", "不可能的日期", "待补地点", "好的"]);
  assert.ok(S.itemHasInvalid({ nameZh: "坏", date: "12/10/2026" }));
  assert.ok(S.itemHasInvalid({ nameZh: "坏", date: "2026-02-31" }));
  assert.ok(!S.itemHasInvalid({ nameZh: "待补" }));
  assert.ok(!S.itemHasInvalid({ nameZh: "待补", date: "", pendingDate: true }));
  assert.ok(!S.itemHasUsableContent({ type: "place" }));
  assert.ok(!S.itemHasUsableContent({ city: "东京" }));
  assert.ok(S.itemHasUsableContent({ address: "东京都渋谷区" }));
  assert.ok(S.escapeText("<img onerror=alert(1)>").indexOf("<img") === -1);
  assert.strictEqual(S.escapeText("<img onerror=alert(1)>"), "&lt;img onerror=alert(1)&gt;");
  const fields = S.escapedFields(clean);
  assert.ok(fields.some((f) => f.indexOf("&lt;img") !== -1));
  assert.ok(fields.every((f) => f.indexOf("<img") === -1 && f.indexOf("<script") === -1));
});

check("incoming #s= is read then cleared with history.replaceState", function () {
  const p = S.buildSharePayload(sampleState(1), { includeNotes: false });
  const data = S.encodeSync(p);
  const loc = { hash: "#s=" + data, pathname: "/", search: "" };
  const calls = [];
  const hist = { replaceState: function (st, title, url) { calls.push(url); loc.hash = ""; } };
  const got = S.consumeHash(loc, hist);
  assert.ok(got.parsed && got.parsed.data === data);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0], "/");
  assert.ok(!loc.hash);
});

check("same content hash is treated as a duplicate (re-paste / already saved)", function () {
  const store = { _d: {}, getItem: function (k) { return this._d[k] || null; }, setItem: function (k, v) { this._d[k] = String(v); } };
  const p = S.buildSharePayload(sampleState(2), { includeNotes: false });
  const h = S.contentHash(p);
  assert.ok(!S.hasSeen(h, store));
  S.markSeen(h, store);
  assert.ok(S.hasSeen(h, store));
  const p2 = S.buildSharePayload(sampleState(2), { includeNotes: false });
  assert.strictEqual(S.contentHash(p2), h);
  const p3 = S.buildSharePayload(sampleState(3), { includeNotes: false });
  assert.notStrictEqual(S.contentHash(p3), h);
});

check("【Free Your Trip】 text block is recognised; other paste is not", function () {
  const p = S.buildSharePayload(sampleState(1), { includeNotes: false });
  const data = S.encodeSync(p);
  const block = S.makeTextBlock(S.summarize(p), data);
  const parsed = S.parseTextBlock(block);
  assert.ok(parsed && parsed.data === data);
  assert.ok(!S.parseTextBlock("地点 | 店名 | 地址 | 2026-12-10 |"));
  assert.ok(!S.parseTextBlock("随便一段话"));
  const incoming = S.decodeIncoming("text", parsed.data);
  assert.ok(incoming.ok);
  assert.ok(incoming.summary.line.indexOf("项") !== -1);
  assert.ok(incoming.summary.line.indexOf("个地点") === -1);
  const oldHeader = "【Free Your Trip】朋友分享了一趟行程：东京 · 8 天 · 10 个地点。" + S.OLD_TEXT_HEADER_TAIL + "\n" + data;
  assert.ok(S.parseTextBlock(oldHeader), "old 个地点 header is still recognised");
});

check("summary uses calendar span and 项; undated items stay in the payload and the count", function () {
  const B = require("./backup.js");
  const dated = [
    { id: "d1", type: "flight", nameZh: "NH1", address: "HND - NRT", departDate: "2026-12-01", city: "东京", lat: 35.55, lng: 139.78 },
    { id: "d2", type: "hotel", nameZh: "东京酒店", address: "东京都千代田区", checkIn: "2026-12-01", checkOut: "2026-12-08", city: "东京", lat: 35.68, lng: 139.76 },
    { id: "d3", type: "place", nameZh: "浅草寺", address: "东京都台东区浅草2-3-1", date: "2026-12-03", city: "东京", lat: 35.71, lng: 139.80 },
    { id: "d4", type: "food", nameZh: "一兰", address: "东京都渋谷区", date: "2026-12-08", city: "东京", lat: 35.66, lng: 139.70 },
    { id: "d5", type: "place", nameZh: "明治神宫", address: "东京都涩谷区代々木神园町1-1", date: "2026-12-04", city: "东京", lat: 35.68, lng: 139.70 }
  ];
  const undated = [
    { id: "u1", type: "place", nameZh: "待补一", address: "东京都渋谷区", city: "东京", pendingDate: true, lat: 35.66, lng: 139.70 },
    { id: "u2", type: "place", nameZh: "待补二", address: "东京都新宿区", city: "东京" },
    { id: "u3", type: "place", nameZh: "待补三", city: "东京" }
  ];
  const london = [
    { id: "l1", type: "place", nameZh: "大英博物馆", address: "Great Russell St, London WC1B 3DG, UK", city: "伦敦", date: "2026-12-05", lat: 51.52, lng: -0.13 },
    { id: "l2", type: "place", nameZh: "大本钟", address: "Westminster, London SW1A 0AA, UK", city: "伦敦", date: "2026-12-06", lat: 51.50, lng: -0.12 }
  ];
  const ten = dated.concat(undated).concat(london);
  const state = { activeTripId: "t1", trips: [{ id: "t1", nameZh: "东京行", items: ten }], places: [], legs: {} };
  const redacted = B.redactForShare(state);
  assert.strictEqual(redacted.trips[0].items.length, 10, "redactForShare keeps undated items");
  const payload = S.buildSharePayload(state, { includeNotes: false });
  assert.strictEqual(S.placeCount(payload), 10);
  const sum = S.summarize(payload);
  assert.strictEqual(sum.city, "东京", "city algorithm should pick 东京, not 伦敦");
  assert.notStrictEqual(sum.city, "伦敦");
  assert.strictEqual(sum.days, 8, "12/1–12/8 with gaps is 8 天; undated items do not shrink the span");
  assert.strictEqual(sum.items, 10);
  assert.strictEqual(sum.line, "东京 · 8 天 · 10 项");
  const data = S.encodeSync(payload);
  const backLink = S.sanitizePayload(S.decodeSync(data));
  const namesLink = backLink.trips[0].items.map((it) => it.nameZh).sort();
  assert.deepStrictEqual(namesLink, ten.map((it) => it.nameZh).sort(), "all items survive a link round trip");
  assert.strictEqual(S.summarize(backLink).items, 10);
  const block = S.makeTextBlock(sum, data);
  assert.ok(block.indexOf("东京 · 8 天 · 10 项。") !== -1);
  const parsed = S.parseTextBlock(block);
  const backText = S.sanitizePayload(S.decodeIncoming("text", parsed.data).payload);
  assert.strictEqual(backText.trips[0].items.length, 10, "all items survive a text-block round trip");
  assert.strictEqual(S.summarize(backText).line, "东京 · 8 天 · 10 项");
  ["待补一", "待补二", "待补三"].forEach(function (n) {
    assert.ok(namesLink.indexOf(n) !== -1, n + " must survive the link round trip");
    assert.ok(backText.trips[0].items.some((it) => it.nameZh === n), n + " must survive the text round trip");
  });
  assert.strictEqual(backText.trips[0].items.filter((it) => /^待补/.test(it.nameZh)).length, 3);
});

check("a trip with no dates omits the 天 segment: 「东京 · 10 项」", function () {
  const items = [];
  for (let i = 0; i < 10; i++) {
    items.push({ id: "n" + i, type: i === 0 ? "flight" : i === 1 ? "hotel" : "place", nameZh: "无日期" + i, address: "东京都渋谷区", city: "东京", lat: 35.66, lng: 139.7 });
  }
  const payload = S.buildSharePayload({
    activeTripId: "t1", trips: [{ id: "t1", nameZh: "未定日子", items: items }], places: [], legs: {}
  }, { includeNotes: false });
  const sum = S.summarize(payload);
  assert.strictEqual(sum.city, "东京");
  assert.strictEqual(sum.days, 0);
  assert.strictEqual(sum.items, 10);
  assert.strictEqual(sum.line, "东京 · 10 项");
  assert.ok(sum.line.indexOf("0 天") === -1 && sum.line.indexOf("天") === -1);
  const header = S.makeTextBlock(sum, "AAAA");
  assert.ok(header.indexOf("东京 · 10 项。") !== -1);
  assert.ok(header.indexOf("0 天") === -1);
});

check("bad coordinates and an impossible date survive as 待补 with that field removed; the count is unchanged", function () {
  const items = [
    { id: "ok", type: "place", nameZh: "浅草寺", address: "东京都台东区", date: "2026-12-01", city: "东京", lat: 35.71, lng: 139.80 },
    { id: "badc", type: "place", nameZh: "坏坐标店", address: "东京都渋谷区", date: "2026-12-02", city: "东京", lat: 999, lng: 1 },
    { id: "badd", type: "place", nameZh: "坏日期店", address: "东京都新宿区", date: "2026-02-31", city: "东京", lat: 35.69, lng: 139.70 }
  ];
  const state = { activeTripId: "t1", trips: [{ id: "t1", nameZh: "东京行", items: items }], places: [], legs: {} };
  const payload = S.buildSharePayload(state, { includeNotes: false });
  assert.strictEqual(S.placeCount(payload), 3);
  const data = S.encodeSync(payload);
  function assertRepaired(got, via) {
    assert.ok(got && got.ok, via + " should decode");
    const list = got.payload.trips[0].items;
    assert.strictEqual(list.length, 3, via + " count must be unchanged");
    assert.strictEqual(S.summarize(got.payload).items, 3);
    const byName = {};
    list.forEach((it) => { byName[it.nameZh] = it; });
    const badc = byName["坏坐标店"];
    assert.ok(badc, via + " keeps the bad-coord item");
    assert.ok(badc.lat == null && badc.lng == null, via + " strips only the coordinates");
    assert.strictEqual(badc.date, "2026-12-02");
    assert.ok(!badc.pendingDate, via + " valid date is not marked 待补");
    const badd = byName["坏日期店"];
    assert.ok(badd, via + " keeps the impossible-date item");
    assert.ok(!badd.date, via + " strips only the date");
    assert.strictEqual(badd.pendingDate, true, via + " marks the item 待补");
    assert.strictEqual(badd.dateRaw, "2026-02-31");
    assert.strictEqual(badd.lat, 35.69);
    assert.strictEqual(badd.lng, 139.70);
    assert.ok(byName["浅草寺"] && byName["浅草寺"].date === "2026-12-01");
  }
  assertRepaired(S.decodeIncoming("link", data), "link");
  assertRepaired(S.decodeIncoming("text", data), "text");
});

check("link data over 8000 chars, paste over 1MB, and a 10MB zip-bomb are rejected without inflating everything", function () {
  const before = S.getLastInflateBytes();
  const longData = "A".repeat(8001);
  const early = S.decodeIncoming("link", longData);
  assert.ok(!early.ok && early.error === "too-large");
  assert.ok(S.isLinkDataTooLong(longData));
  assert.strictEqual(S.getLastInflateBytes(), before, "must not decompress a too-long #s= payload");

  const hugePaste = "【Free Your Trip】朋友分享了一趟行程：东京 · 10 项。\n" + "A".repeat(1024 * 1024);
  assert.ok(S.isPasteTooLong(hugePaste));

  const bomb = makeDeflateZeroBomb(10 * 1024 * 1024);
  assert.ok(bomb.length < 20000, "10MB bomb should still be a small payload, got " + bomb.length);

  const t0 = Date.now();
  const textR = S.decodeIncoming("text", bomb);
  let linkInflate = { ok: true };
  try {
    S.decodeSync(bomb, { maxBytes: S.MAX_DECODED_BYTES });
  } catch (err) {
    linkInflate = { ok: false, error: err && err.code };
  }
  const ms = Date.now() - t0;
  assert.ok(!textR.ok && textR.error === "too-large", "paste path must reject the 10MB zip-bomb");
  assert.ok(!linkInflate.ok && linkInflate.error === "too-large", "link inflater must reject the 10MB zip-bomb at 64KB");
  assert.ok(ms < 1000, "zip-bomb must be rejected in under 1s, took " + ms + "ms");
  const inflated = S.getLastInflateBytes();
  assert.ok(inflated > 0 && inflated <= 1024 * 1024 + 65536, "must abort at the cap, inflated=" + inflated);
  assert.ok(inflated < 10 * 1024 * 1024, "must not allocate the full 10MB output");

  const linkEarly = S.decodeIncoming("link", bomb);
  assert.ok(!linkEarly.ok && linkEarly.error === "too-large", "link path must reject the 10MB zip-bomb");

  const smallBomb = makeDeflateZeroBomb(512 * 1024);
  assert.ok(smallBomb.length <= 8000, "stream-abort fixture must pass the 8000-char pre-check, got " + smallBomb.length);
  const linkStream = S.decodeIncoming("link", smallBomb);
  assert.ok(!linkStream.ok && linkStream.error === "too-large", "link path must abort once decoded output passes 64KB");
  assert.ok(S.getLastInflateBytes() <= 64 * 1024 + 4096, "link stream abort should stop near 64KB, got " + S.getLastInflateBytes());
});


check("drag groups: undated/待补/没定时间 keep manual order; hotels and flights stay locked; pending can leave 待补", function () {
  const E = require("./item-edit.js");
  const L = require("./legs.js");
  /* Groups a card can appear in:
     1. 待补 / 待确认日期 (pendingDate)
     2. A dated day, timed items
     3. 「没定时间」 — same day, no clock time
     4. 「还没定哪天」 — no date
     All four show in the all-days view and the single-day view. */
  function idsOf(items, day) {
    const key = L.normalizeDropDay(day);
    return L.sortDayItems(items.filter((it) => L.itemGroupKey(it) === key)).map((it) => it.id);
  }
  function trio(extra) {
    return ["a", "b", "c"].map((id) => Object.assign({ id: id, type: "place", nameZh: id }, extra || {}));
  }

  const undated = trio();
  L.applyDayOrder(undated, "未标明日期", ["c", "a", "b"]);
  assert.deepStrictEqual(idsOf(undated, ""), ["c", "a", "b"], "还没定哪天 / 未标明日期");
  L.applyDayOrder(undated, "", ["b", "c", "a"]);
  assert.deepStrictEqual(idsOf(undated, ""), ["b", "c", "a"]);

  const untimed = trio({ date: "2026-12-01" });
  L.applyDayOrder(untimed, "2026-12-01", ["c", "a", "b"]);
  assert.deepStrictEqual(idsOf(untimed, "2026-12-01"), ["c", "a", "b"], "没定时间");

  const timed = trio({ date: "2026-12-01", time: "10:00" });
  timed[1].time = "11:00";
  timed[2].time = "12:00";
  L.applyDayOrder(timed, "2026-12-01", ["c", "a", "b"]);
  assert.deepStrictEqual(idsOf(timed, "2026-12-01"), ["c", "a", "b"], "dated day");

  const pending = trio({ pendingDate: true, dateRaw: "待补" });
  L.applyDayOrder(pending, "待补", ["c", "a", "b"]);
  assert.deepStrictEqual(idsOf(pending, "待补"), ["c", "a", "b"], "待补");

  const food = E.moveToDay({ id: "f", type: "food", date: "2026-12-01", dayOrder: 1 }, "2026-12-05");
  assert.deepStrictEqual(food, { id: "f", type: "food", date: "2026-12-05" });

  const fromPending = E.moveToDay({ id: "p", type: "place", pendingDate: true, dateRaw: "x日" }, "2026-12-03");
  assert.strictEqual(fromPending.date, "2026-12-03");
  assert.ok(!fromPending.pendingDate, "待补 → a day leaves 待补 when the date is valid");

  const toUndated = E.moveToDay({ id: "p", type: "place", pendingDate: true, dateRaw: "x日" }, "");
  assert.deepStrictEqual(toUndated, { id: "p", type: "place" }, "待补 → 还没定哪天 clears the date");

  ["hotel", "flight", "train", "boat", "bus"].forEach((t) => {
    const it = { id: "x", type: t, date: "2026-12-01", departDate: "2026-12-01", checkIn: "2026-12-01" };
    assert.strictEqual(E.moveToDay(it, "2026-12-09"), it, t + " is not movable");
  });

  assert.ok(/data-drop-day="待补"/.test(tl));
  assert.ok(/function resetAiWizard\(/.test(tl) && /function resetAddPasteUi\([\s\S]{0,200}resetAiWizard\(/.test(tl));
  assert.ok(/normalizeDropDay\(el\.getAttribute\("data-drop-day"\)\)/.test(tl));
  assert.ok(/if \(groupOrderIds\(snapshot, day\) === groupOrderIds\(trip\.items \|\| \[\], day\)\) return;/.test(tl), "no 已换顺序 toast unless the saved order changed");
});

check("header #trip-add-btn label is 我的行程; click only opens the list; new trips come from ＋ 新建行程", function () {
  assert.ok(/var TRIPS_HEADER_BTN = "我的行程"/.test(tl));
  assert.ok(html.indexOf('id="trip-add-btn" aria-label="我的行程">我的行程</button>') !== -1);
  assert.ok(html.indexOf(">＋ 新行程</button>") === -1 && html.indexOf('aria-label="＋ 新行程"') === -1);
  assert.ok(tl.indexOf("全部行程") === -1 && html.indexOf("全部行程") === -1);
  const start = tl.indexOf('if ($("trip-add-btn"))');
  const end = tl.indexOf('if ($("trip-tip"))', start);
  const handler = tl.slice(start, end);
  assert.ok(handler.indexOf("openTrips()") !== -1);
  assert.ok(handler.indexOf("createTrip()") === -1, "header button must not create a trip");
  assert.ok(/trips-new[\s\S]{0,80}createTrip/.test(tl), "sheet bottom button still creates a trip");
  assert.ok(html.indexOf('id="trips-new">＋ 新建行程</button>') !== -1);
  assert.ok(tl.indexOf('text: "点顶上的『我的行程』，再点最下面的『+ 新建行程』"') !== -1);
  const approved = "修复：点顶上的『我的行程』只打开列表，不会再多出一个空行程";
  assert.ok(tl.indexOf(approved) !== -1, "approved changelog line is kept next to the constant until version is bumped");
});

check("guides no longer tell people to 把文件发给朋友; new share copy is in place; card 4 and 4 equal-height cards", function () {
  const guides = [
    html.slice(html.indexOf("settings-sheet"), html.indexOf("month-sheet")),
    tl.slice(tl.indexOf("var HELP_STARTER"), tl.indexOf("var HELP_ILLU_PLACEHOLDER") || tl.indexOf("function helpIllu"))
  ].join("\n");
  assert.ok(guides.indexOf("把文件发给朋友") === -1);
  assert.ok(guides.indexOf("发给同行的人，对方导入就能看到") === -1);
  assert.ok(html.indexOf('data-sub="发个链接给同行的人，对方点开就能存好">分享我的行程<') !== -1);
  assert.ok(html.indexOf('data-sub="只发网址，不含你的行程">推荐这个工具<') !== -1);
  assert.ok(tl.indexOf('text: "点一下生成链接，发给同行的人，订单号和座位会自动隐藏"') !== -1);
  assert.ok(tl.indexOf('title: "新手先看这 4 条"') !== -1);
  assert.ok(tl.indexOf('title: "和同行的人共用行程"') !== -1);
  assert.ok(tl.indexOf("发：点『设置』里的『分享我的行程』，把链接发过去") !== -1);
  assert.ok(tl.indexOf("收：点开朋友发来的链接，再点『存到我的行程』") !== -1);
  assert.ok(tl.indexOf("收到的是一段文字：整段复制，点底部『＋ 添加』，再点『粘贴朋友发来的行程』，最后点『粘贴并导入』") !== -1);
  assert.ok(/viewBox="0 0 160 96" width="160" height="96"/.test(tl.slice(tl.indexOf("sharetrip"))));
  assert.ok(/\.help-cards\s*\{[^}]*align-items:\s*stretch/.test(css));
  assert.ok(/\.help-card\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column/.test(css));
  assert.ok(/\.help-card p\.help-card-line\s*\{[^}]*font-size:\s*13px;[^}]*font-weight:\s*400;[^}]*color:\s*#6B7A8F/.test(css), "card 4 small print must beat .help-card p");
  assert.ok(/\.help-card\[data-card="sharetrip"\] p\.help-card-line\s*\{[^}]*margin-top:\s*12px/.test(css), "card 4 small print sits 12px under the 收 paragraph");
  assert.ok(tl.indexOf('"<span>有 " + pending.length + " 条日期待确认</span>') !== -1, "single-day banner 有 N 条日期待确认 is restored");
  assert.ok(/pending\.length && selectedDay !== "all"/.test(tl), "banner shows in a single-day view");
  assert.ok(tl.indexOf('c.line ? \'<p class="help-card-line">\' + escapeHtml(c.line)') !== -1);
  assert.ok(tl.indexOf('fileBad: "这个文件打不开，要用这里导出的备份或分享文件"') !== -1);
  const broken = "这个链接没发完整，打不开。请对方分享时点『改发文字』，再发你一次";
  assert.ok(html.indexOf('id="share-broken-body">' + broken + '<') !== -1);
  assert.strictEqual(S.COPY.brokenBody, broken);
  assert.ok(html.indexOf('id="share-link-alt-hint">链接打不开时用这个<') !== -1);
  assert.strictEqual(S.COPY.altHint, "链接打不开时用这个");
  assert.ok(/\.share-link-alt-hint\s*\{[^}]*color:\s*#8A9099/.test(css));
  const paste = tl.slice(tl.indexOf("var PASTE_FAIL_TOAST"), tl.indexOf("function selectedDateOrEmpty"));
  assert.ok(paste.indexOf("navigator.clipboard.readText()") !== -1, "tap 粘贴并导入 with an empty box reads the clipboard");
  assert.ok(paste.indexOf("function readClipboardOnPasteTap") !== -1);
  assert.ok(paste.indexOf("长按输入框粘贴，再点一次") !== -1);
  assert.strictEqual((tl.match(/clipboard\.readText/g) || []).length, (paste.match(/clipboard\.readText/g) || []).length, "clipboard.readText only inside paste-tap helpers");
  const shareSrc = read("share-link.js");
  assert.ok(shareSrc.indexOf("clipboard.readText") === -1, "share-link never reads the clipboard");
  const consumeStart = shareSrc.indexOf("function consumeIncoming");
  assert.ok(consumeStart !== -1);
  assert.ok(shareSrc.slice(consumeStart, consumeStart + 800).indexOf("clipboard") === -1);
  assert.ok(tl.indexOf('step3Small: "手机弹出「粘贴」或「允许」时，再点一下就行"') !== -1, "AI wizard step3Small unchanged");
  const menu = html.slice(html.indexOf('id="add-menu"'), html.indexOf('id="add-sheet"'));
  const pasteRow = menu.indexOf('id="am-friend-paste"');
  assert.ok(pasteRow !== -1, "menu row 粘贴朋友发来的行程 exists");
  assert.ok(menu.indexOf('id="am-place"') < pasteRow && pasteRow < menu.indexOf('id="am-whole"'), "row sits after 加地点 and directly above the AI-organise entry");
  assert.ok(/<button type="button" class="am-row" id="am-friend-paste"/.test(menu), "same am-row as the other rows");
  assert.ok(menu.indexOf('id="am-friend-paste"') !== -1 && !/id="am-friend-paste"[^>]*am-whole/.test(menu));
  const rowSlice = menu.slice(pasteRow, menu.indexOf("</button>", pasteRow));
  assert.ok(rowSlice.indexOf("color:#6B7A8F;background:#6B7A8F1A") !== -1, "neutral icon, not teal");
  assert.ok(rowSlice.indexOf("#0F9D8A") === -1, "row is not highlighted in brand teal");
  assert.ok(/\.am-sub \{[^}]*font-size:\s*13px;[^}]*color:\s*#6B7A8F;[^}]*white-space:\s*nowrap;[^}]*text-overflow:\s*ellipsis/.test(css));
  assert.ok(tl.indexOf('friendPaste: "粘贴朋友发来的行程"') !== -1);
  assert.ok(tl.indexOf('friendPasteSub: "朋友发来一段文字，就点这里"') !== -1);
  const pasteView = html.slice(html.indexOf('id="friend-paste-sheet"'), html.indexOf('id="add-sheet"'));
  assert.ok(pasteView.indexOf('id="friend-paste-text"') !== -1);
  assert.ok(pasteView.indexOf('id="friend-paste-btn">粘贴并导入</button>') !== -1);
  assert.ok(pasteView.indexOf("ai-help") === -1 && pasteView.indexOf("ai-step") === -1 && pasteView.indexOf("ai-progress") === -1 && pasteView.indexOf("给 AI 的话") === -1, "paste view has no wizard steps");
  assert.ok(tl.indexOf("function openFriendPaste") !== -1 && tl.indexOf("function pasteFriendImport") !== -1);
  const openFn = tl.slice(tl.indexOf("function openFriendPaste"), tl.indexOf("function pasteFriendImport"));
  assert.ok(openFn.indexOf("clipboard.readText") === -1, "opening the paste view does not read the clipboard");
});

async function headlessHeader() {
  const chromePath = ["google-chrome", "google-chrome-stable", "chromium"].find(function (c) {
    try { require("child_process").execFileSync("which", [c], { stdio: "ignore" }); return true; } catch (e) { return false; }
  });
  if (!chromePath) throw new Error("chrome not found");
  const PORT = 8773;
  const DEBUG = 9343;
  const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json" };
  const server = http.createServer((req, res) => {
    let pth = decodeURIComponent((req.url || "/").split("?")[0]);
    if (pth === "/") pth = "/index.html";
    const file = path.join(root, pth);
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end("no"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  const chrome = spawn(chromePath, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--remote-debugging-port=" + DEBUG, "--user-data-dir=/tmp/chrome-v613-check",
    "about:blank"
  ], { stdio: "ignore" });
  async function waitCDP() {
    for (let i = 0; i < 40; i++) {
      try { const r = await fetch("http://127.0.0.1:" + DEBUG + "/json/version"); if (r.ok) return; } catch (e) {}
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error("chrome cdp not up");
  }
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
    let id = 0; const pending = {};
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; } };
    const send = (method, params) => new Promise((r) => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
    const ev = async (e) => {
      const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 240));
      return r.result && r.result.result && r.result.result.value;
    };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const fake = {
      schema: 2,
      trips: [{ id: "demo-trip", nameZh: "示例行程", items: [
        { id: "p1", type: "place", nameZh: "示例商场", address: "上海市普陀区中山北路3300号", date: "2026-12-10", lat: 31.232, lng: 121.414 }
      ] }],
      places: [], activeTripId: "demo-trip", examplesLoaded: false
    };
    const seed = `localStorage.clear();
      localStorage.setItem("wishlist-map-data-v2", ${JSON.stringify(JSON.stringify(fake))});
      localStorage.setItem("wishlist-map-help-hide-v1","1");
      localStorage.setItem("wishlist-map-last-seen-version-v1","v6.1.3");
      window.__clipReads = 0;
      window.__clipHook = "none";
      (function () {
        var clip = {
          readText: function () { window.__clipReads += 1; return Promise.resolve(""); },
          writeText: function () { return Promise.resolve(); }
        };
        function install(obj, prop, desc) {
          try { Object.defineProperty(obj, prop, desc); return true; } catch (e) { return false; }
        }
        var desc = { configurable: true, enumerable: true, get: function () { return clip; } };
        if (install(Navigator.prototype, "clipboard", desc)) window.__clipHook = "proto";
        else if (install(navigator, "clipboard", desc)) window.__clipHook = "instance";
        else {
          try {
            var cur = navigator.clipboard;
            if (cur) {
              cur.readText = clip.readText;
              window.__clipHook = "wrap";
            }
          } catch (e) { window.__clipHook = "fail:" + e; }
        }
      })();
`;
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.setCacheDisabled", { cacheDisabled: true });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: seed });
    await send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/index.html" });
    await send("Page.loadEventFired").catch(() => {});
    await sleep(900);
    const before = await ev(`(function(){
      var a=document.getElementById("announce-sheet"); if(a) a.hidden=true;
      var h=document.getElementById("help-sheet"); if(h) h.hidden=true;
      var n = window.TripApp && TripApp.getTrips ? TripApp.getTrips().length : 0;
      var btn=document.getElementById("trip-add-btn");
      return { n:n, label: btn?btn.textContent.trim():"", aria: btn?btn.getAttribute("aria-label"):"" };
    })()`);
    assert.strictEqual(before.label, "我的行程");
    assert.strictEqual(before.aria, "我的行程");
    const after = await ev(`(function(){
      var n0 = window.TripApp.getTrips().length;
      document.getElementById("trip-add-btn").click();
      var sheet=document.getElementById("trips-sheet");
      return { n0:n0, n: window.TripApp.getTrips().length, open: sheet && !sheet.hidden };
    })()`);
    assert.strictEqual(after.n, after.n0, "tapping header must not add a trip");
    assert.ok(after.open, "tapping header must open 我的行程 sheet");
    const readsOnLoad = await ev("window.__clipReads");
    assert.strictEqual(readsOnLoad, 0, "must not read the clipboard on page load");
    const afterTap = await ev(`(async function(){
      var ta = document.getElementById("add-text");
      if (ta) ta.value = "";
      var n0 = window.__clipReads || 0;
      var btn = document.getElementById("ai-paste-btn");
      var hasRead = !!(navigator.clipboard && navigator.clipboard.readText);
      if (btn) btn.click();
      await new Promise(function (r) { setTimeout(r, 200); });
      var toast = document.getElementById("toast-msg");
      var fb = document.getElementById("ai-fallback");
      return {
        reads: (window.__clipReads || 0) - n0,
        toast: toast ? toast.textContent : "",
        fallback: !!(fb && !fb.hidden),
        hook: window.__clipHook,
        hasRead: hasRead,
        btn: !!btn,
        n0: n0
      };
    })()`);
    assert.strictEqual(afterTap.reads, 1, "tapping 粘贴并导入 with an empty box must read the clipboard (" + JSON.stringify(afterTap) + ")");
    assert.ok(afterTap.toast.indexOf("长按输入框粘贴，再点一次") !== -1, "failed/empty read shows the fallback toast, got: " + afterTap.toast);
    assert.ok(afterTap.fallback, "failed/empty read shows the input box");
    await send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/index.html?clipcheck=1#s=not-a-valid-payload" });
    await send("Page.loadEventFired").catch(() => {});
    await sleep(900);
    const readsOnHash = await ev("window.__clipReads");
    assert.strictEqual(readsOnHash, 0, "must not read the clipboard when a #s= link opens");
    await send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/index.html?clipcheck=2" });
    await send("Page.loadEventFired").catch(() => {});
    await sleep(900);
    const readsOnFresh = await ev("window.__clipReads");
    assert.strictEqual(readsOnFresh, 0, "must not read the clipboard on a later load");
    const sharePayload = S.buildSharePayload(sampleState(2, { tripName: "示例行程" }), { includeNotes: false });
    const shareData = S.encodeSync(sharePayload);
    const shareBlock = S.makeTextBlock(S.summarize(sharePayload), shareData);
    const menuInfo = await ev(`(function(){
      try {
      var a=document.getElementById("announce-sheet"); if(a) a.hidden=true;
      var h=document.getElementById("help-sheet"); if(h) h.hidden=true;
      var t=document.getElementById("trips-sheet"); if(t) t.hidden=true;
      var b=document.getElementById("share-broken-sheet"); if(b) b.hidden=true;
      var fab=document.getElementById("add-fab");
      if (!fab) return { err: "no add-fab" };
      fab.click();
      var menu=document.getElementById("add-menu");
      var row=document.getElementById("am-friend-paste");
      var place=document.getElementById("am-place");
      var whole=document.getElementById("am-whole");
      var ico=row && row.querySelector(".am-ico");
      var sub=row && row.querySelector(".am-sub");
      var cs=sub ? getComputedStyle(sub) : null;
      var order = { place: place && place.compareDocumentPosition(row), whole: row && row.compareDocumentPosition(whole) };
      return {
        menuOpen: !!(menu && !menu.hidden),
        isRow: !!(row && row.classList.contains("am-row") && row.tagName === "BUTTON"),
        notWhole: !!(row && !row.classList.contains("am-whole")),
        main: row && row.querySelector(".am-main") ? row.querySelector(".am-main").textContent : "",
        sub: sub ? sub.textContent : "",
        icoColor: ico ? ico.style.color : "",
        icoBg: ico ? ico.style.background : ico.style.backgroundColor,
        afterPlace: !!(place && row && (place.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING)),
        beforeWhole: !!(row && whole && (row.compareDocumentPosition(whole) & Node.DOCUMENT_POSITION_FOLLOWING)),
        subSize: cs ? cs.fontSize : "",
        subColor: cs ? cs.color : "",
        subWhiteSpace: cs ? cs.whiteSpace : "",
        reads: window.__clipReads || 0
      };
      } catch (err) { return { err: String(err && err.stack || err) }; }
    })()`);
    assert.ok(!menuInfo.err, "menu inspect failed: " + (menuInfo && menuInfo.err));
    assert.ok(menuInfo.menuOpen, "add menu opens");
    assert.ok(menuInfo.isRow && menuInfo.notWhole, "paste entry is a regular am-row, not the AI-organise button");
    assert.strictEqual(menuInfo.main, "粘贴朋友发来的行程");
    assert.strictEqual(menuInfo.sub, "朋友发来一段文字，就点这里");
    assert.ok(menuInfo.icoColor.toLowerCase() === "#6b7a8f" || menuInfo.icoColor === "rgb(107, 122, 143)", "neutral icon color, got " + menuInfo.icoColor);
    assert.ok(menuInfo.afterPlace && menuInfo.beforeWhole, "row is after 加地点 and directly above 整份行程");
    assert.ok(menuInfo.subSize === "13px", "sub is 13px, got " + menuInfo.subSize);
    assert.ok((menuInfo.subColor === "rgb(107, 122, 143)" || (menuInfo.subColor || "").toLowerCase() === "#6b7a8f"), "sub color #6B7A8F, got " + menuInfo.subColor);
    assert.strictEqual(menuInfo.subWhiteSpace, "nowrap");
    assert.strictEqual(menuInfo.reads, 0, "opening the menu does not read the clipboard");
    const viewInfo = await ev(`(function(){
      var n0 = window.__clipReads || 0;
      document.getElementById("am-friend-paste").click();
      var sheet=document.getElementById("friend-paste-sheet");
      var wizard = sheet && (sheet.querySelector(".ai-wizard, #ai-help, .ai-step, .ai-progress, #ai-big-btn"));
      var ta=document.getElementById("friend-paste-text");
      var btn=document.getElementById("friend-paste-btn");
      return {
        open: !!(sheet && !sheet.hidden),
        noWizard: !wizard,
        hasBox: !!(ta && ta.tagName === "TEXTAREA"),
        btn: btn ? btn.textContent.trim() : "",
        reads: (window.__clipReads || 0) - n0
      };
    })()`);
    assert.ok(viewInfo.open, "paste view opens");
    assert.ok(viewInfo.noWizard, "paste view has no wizard steps");
    assert.ok(viewInfo.hasBox, "paste view has an input box");
    assert.strictEqual(viewInfo.btn, "粘贴并导入");
    assert.strictEqual(viewInfo.reads, 0, "opening the paste view does not read the clipboard");
    const popped = await ev(`(async function(){
      var n0 = window.__clipReads || 0;
      var ta=document.getElementById("friend-paste-text");
      ta.value = ${JSON.stringify(shareBlock)};
      var parsed = window.ShareLink && ShareLink.parseTextBlock(ta.value);
      document.getElementById("friend-paste-btn").click();
      var pop, title, i;
      for (i = 0; i < 20; i++) {
        await new Promise(function (r) { setTimeout(r, 100); });
        pop=document.getElementById("friend-share-sheet");
        if (pop && !pop.hidden) break;
      }
      title=document.getElementById("friend-share-title");
      return {
        open: !!(pop && !pop.hidden),
        title: title ? title.textContent : "",
        parsed: !!(parsed && parsed.data),
        enabled: !!(window.ShareLink && ShareLink.ENABLED),
        reads: (window.__clipReads || 0) - n0
      };
    })()`);
    assert.ok(popped.open, "pasted 【Free Your Trip】 block shows the friend popup " + JSON.stringify(popped));
    assert.strictEqual(popped.title, "朋友分享了一趟行程");
    assert.strictEqual(popped.reads, 0, "pasting from the box does not read the clipboard");

    const bomb = makeDeflateZeroBomb(10 * 1024 * 1024);
    const smallBomb = makeDeflateZeroBomb(512 * 1024);
    const bombInfo = await ev(`(async function(){
      var t0 = Date.now();
      var trips0 = JSON.stringify(window.TripApp.getTrips());
      var n0 = window.TripApp.getTrips().length;
      var data = ${JSON.stringify(bomb)};
      var linkR = await ShareLink.decodeIncomingAsync("link", data);
      var textR = await ShareLink.decodeIncomingAsync("text", data);
      var linkStream = await ShareLink.decodeIncomingAsync("link", ${JSON.stringify(smallBomb)});
      return {
        ms: Date.now() - t0,
        n0: n0,
        n: window.TripApp.getTrips().length,
        same: trips0 === JSON.stringify(window.TripApp.getTrips()),
        linkOk: !!(linkR && linkR.ok),
        textOk: !!(textR && textR.ok),
        linkError: linkR && linkR.error,
        textError: textR && textR.error,
        streamOk: !!(linkStream && linkStream.ok),
        streamError: linkStream && linkStream.error,
        inflated: ShareLink.getLastInflateBytes()
      };
    })()`);
    assert.ok(!bombInfo.linkOk && bombInfo.linkError === "too-large", "headless link path rejects the zip-bomb " + JSON.stringify(bombInfo));
    assert.ok(!bombInfo.textOk && bombInfo.textError === "too-large", "headless paste path rejects the zip-bomb");
    assert.ok(!bombInfo.streamOk && bombInfo.streamError === "too-large", "headless link path aborts over-64KB inflate");
    assert.ok(bombInfo.ms < 1000, "headless zip-bomb must be rejected in under 1s, took " + bombInfo.ms + "ms");
    assert.ok(bombInfo.inflated < 10 * 1024 * 1024, "headless must not allocate the full 10MB, inflated=" + bombInfo.inflated);
    assert.ok(bombInfo.same && bombInfo.n === bombInfo.n0, "zip-bomb must not change trip data");

    const card4 = await ev(`(function(){
      var h = document.getElementById("help-sheet");
      if (h) h.hidden = false;
      var cards = document.querySelectorAll(".help-card");
      if (cards[3]) cards[3].hidden = false;
      var line = cards[3] && cards[3].querySelector("p.help-card-line");
      var cs = line ? getComputedStyle(line) : null;
      var heights = Array.prototype.map.call(cards, function (c) { return Math.round(c.getBoundingClientRect().height); });
      var rec = null;
      if (cards[3]) {
        var bodyPs = cards[3].querySelectorAll("p:not(.help-card-line)");
        rec = bodyPs.length ? bodyPs[bodyPs.length - 1] : null;
      }
      var recBox = rec ? rec.getBoundingClientRect() : null;
      var lineBox = line ? line.getBoundingClientRect() : null;
      var cardBox = cards[3] ? cards[3].getBoundingClientRect() : null;
      var padBottom = cards[3] ? parseFloat(getComputedStyle(cards[3]).paddingBottom) || 0 : 0;
      return {
        text: line ? line.textContent : "",
        fontSize: cs ? cs.fontSize : "",
        color: cs ? cs.color : "",
        weight: cs ? cs.fontWeight : "",
        heights: heights,
        recText: rec ? rec.textContent : "",
        gap: (recBox && lineBox) ? Math.round(lineBox.top - recBox.bottom) : null,
        spaceBelow: (cardBox && lineBox) ? Math.round(cardBox.bottom - lineBox.bottom - padBottom) : null
      };
    })()`);
    assert.ok((card4.text || "").indexOf("粘贴并导入") !== -1, "card 4 small print is present: " + (card4 && card4.text));
    assert.strictEqual(card4.fontSize, "13px", "card 4 small print is 13px, got " + card4.fontSize);
    assert.ok(card4.color === "rgb(107, 122, 143)" || (card4.color || "").toLowerCase() === "#6b7a8f", "card 4 colour #6B7A8F, got " + card4.color);
    assert.ok(card4.weight === "400" || card4.weight === "normal", "card 4 is normal weight, got " + card4.weight);
    assert.ok((card4.recText || "").indexOf("收：") === 0, "small print follows the 收 paragraph, got " + card4.recText);
    assert.ok(card4.gap >= 11 && card4.gap <= 13, "12px gap under 收, got " + card4.gap);
    assert.ok(card4.spaceBelow >= 8, "spare space should sit at the bottom of the card, got " + card4.spaceBelow);
    if (card4.heights && card4.heights.length === 4) {
      const maxH = Math.max.apply(null, card4.heights);
      const minH = Math.min.apply(null, card4.heights);
      assert.ok(maxH - minH <= 2, "help cards should be equal height, got " + card4.heights);
    }

    /* ---- drag groups + wizard reset (same headless session) ---- */
    const dragFails = [];
    const dragReport = await ev(`(async function(){
      function hideChrome() {
        ["announce-sheet","help-sheet","friend-share-sheet","share-broken-sheet","add-menu","add-sheet","trips-sheet"].forEach(function (id) {
          var el = document.getElementById(id);
          if (el) el.hidden = true;
        });
      }
      function cards(sel) {
        return Array.prototype.map.call(document.querySelectorAll(sel + " .card[data-item]"), function (c) { return c.getAttribute("data-item"); });
      }
      function toastText() {
        var t = document.getElementById("toast");
        var m = document.getElementById("toast-msg");
        return (t && !t.hidden && m) ? m.textContent : "";
      }
      function loadFixture() {
        var items = [
          { id: "pa", type: "place", nameZh: "待补A", pendingDate: true, dateRaw: "待补" },
          { id: "pb", type: "place", nameZh: "待补B", pendingDate: true, dateRaw: "待补" },
          { id: "pc", type: "place", nameZh: "待补C", pendingDate: true, dateRaw: "待补" },
          { id: "ta", type: "place", nameZh: "上午A", date: "2026-12-01", time: "10:00", lat: 35.6, lng: 139.7 },
          { id: "tb", type: "place", nameZh: "上午B", date: "2026-12-01", time: "11:00", lat: 35.6, lng: 139.7 },
          { id: "tc", type: "place", nameZh: "上午C", date: "2026-12-01", time: "12:00", lat: 35.6, lng: 139.7 },
          { id: "ua", type: "place", nameZh: "没时间A", date: "2026-12-02", lat: 35.6, lng: 139.7 },
          { id: "ub", type: "place", nameZh: "没时间B", date: "2026-12-02", lat: 35.6, lng: 139.7 },
          { id: "uc", type: "place", nameZh: "没时间C", date: "2026-12-02", lat: 35.6, lng: 139.7 },
          { id: "na", type: "place", nameZh: "未定A" },
          { id: "nb", type: "place", nameZh: "未定B" },
          { id: "nc", type: "place", nameZh: "未定C" },
          { id: "hx", type: "hotel", nameZh: "锁定酒店", checkIn: "2026-12-08", checkOut: "2026-12-10", lat: 35.6, lng: 139.7 },
          { id: "fx", type: "flight", nameZh: "NH1", departDate: "2026-12-08", departTime: "08:00", fromAirport: "HND", toAirport: "NRT" }
        ];
        TripApp.importState({ trips: [{ id: "drag-trip", nameZh: "拖动测试", items: items }], places: [], activeTripId: "drag-trip", examplesLoaded: true }, "replace");
        TripApp.refresh();
        hideChrome();
      }
      function reloadFromStore(view) {
        var raw = localStorage.getItem("wishlist-map-data-v2");
        TripApp.importState(JSON.parse(raw), "replace");
        TripApp.selectDay(view === "all" ? "all" : view, true);
        TripApp.refresh();
        hideChrome();
      }
      var fails = [];
      async function runReorder(name, view, dayKey, sel, original) {
        hideChrome();
        TripApp.selectDay(view === "all" ? "all" : view, true);
        var want = [original[2], original[0], original[1]];
        var before = cards(sel);
        if (before.join(",") !== original.join(",")) {
          fails.push(name + " start order " + before.join(",") + " expected " + original.join(","));
        }
        TripApp.reorderGroup(dayKey, want, original[2]);
        var confirm = document.getElementById("confirm-sheet");
        if (confirm && !confirm.hidden) {
          var no = document.getElementById("confirm-cancel");
          if (no) no.click();
        }
        await new Promise(function (r) { setTimeout(r, 30); });
        var after = cards(sel);
        if (after.join(",") !== want.join(",")) fails.push(name + " drag → " + after.join(",") + " expected " + want.join(","));
        if (toastText().indexOf("已换顺序") === -1) fails.push(name + " missing 已换顺序 toast: " + toastText());
        var undo = document.getElementById("toast-undo");
        if (undo) undo.click();
        var restored = cards(sel);
        if (restored.join(",") !== original.join(",")) fails.push(name + " undo → " + restored.join(",") + " expected " + original.join(","));
        TripApp.reorderGroup(dayKey, want, original[2]);
        reloadFromStore(view);
        var persisted = cards(sel);
        if (persisted.join(",") !== want.join(",")) fails.push(name + " after reload → " + persisted.join(",") + " expected " + want.join(","));
      }

      loadFixture();
      await runReorder("all-days dated day", "all", "2026-12-01", "#day-2026-12-01", ["ta","tb","tc"]);
      loadFixture();
      await runReorder("all-days 没定时间", "all", "2026-12-02", "#day-2026-12-02", ["ua","ub","uc"]);
      loadFixture();
      await runReorder("all-days 还没定哪天", "all", "", "#day-undated", ["na","nb","nc"]);
      loadFixture();
      await runReorder("all-days 待补", "all", "待补", "#day-pending", ["pa","pb","pc"]);
      loadFixture();
      await runReorder("single-day dated day", "2026-12-01", "2026-12-01", "#day-2026-12-01", ["ta","tb","tc"]);
      loadFixture();
      await runReorder("single-day 没定时间", "2026-12-02", "2026-12-02", "#day-2026-12-02", ["ua","ub","uc"]);
      loadFixture();
      await runReorder("single-day 还没定哪天", "2026-12-01", "", "#day-undated", ["na","nb","nc"]);
      loadFixture();
      await runReorder("single-day 待补", "2026-12-01", "待补", "#day-pending", ["pa","pb","pc"]);

      loadFixture();
      TripApp.selectDay("all", true);
      TripApp.moveItemToGroup("pc", "2026-12-03", ["pc"]);
      var moved = TripApp.getTrips()[0].items.filter(function (it) { return it.id === "pc"; })[0];
      if (!moved || moved.date !== "2026-12-03" || moved.pendingDate) fails.push("待补 → a day: " + JSON.stringify(moved));
      if (cards("#day-pending").indexOf("pc") !== -1) fails.push("待补 → a day still listed in 待补");

      loadFixture();
      TripApp.selectDay("all", true);
      TripApp.moveItemToGroup("pb", "", ["na","nb","nc","pb"]);
      var und = TripApp.getTrips()[0].items.filter(function (it) { return it.id === "pb"; })[0];
      if (!und || und.date || und.pendingDate) fails.push("待补 → 还没定哪天: " + JSON.stringify(und));
      if (cards("#day-pending").indexOf("pb") !== -1) fails.push("待补 → undated still listed in 待补");
      if (cards("#day-undated").indexOf("pb") === -1) fails.push("待补 → 还没定哪天 not in #day-undated: " + cards("#day-undated"));

      var hotel = TripApp.getTrips()[0].items.filter(function (it) { return it.id === "hx"; })[0];
      var flight = TripApp.getTrips()[0].items.filter(function (it) { return it.id === "fx"; })[0];
      var hLock = TripApp.lockReason(hotel);
      var fLock = TripApp.lockReason(flight);
      if (!hLock) fails.push("hotel should be locked");
      if (!fLock) fails.push("flight should be locked");

      return { fails: fails, hLock: hLock, fLock: fLock };
    })()`);
    (dragReport.fails || []).forEach((f) => dragFails.push(f));
    if (dragFails.length) {
      assert.fail("drag group failures:\\n" + dragFails.join("\\n"));
    }
    assert.ok(dragReport.hLock, "hotel is locked");
    assert.ok(dragReport.fLock, "flight is locked");

    const wiz = await ev(`(async function(){
      ["announce-sheet","help-sheet","friend-share-sheet","add-menu","trips-sheet"].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.hidden = true;
      });
      var written = "";
      if (navigator.clipboard) {
        navigator.clipboard.writeText = function (t) {
          written = String(t == null ? "" : t);
          return Promise.resolve();
        };
      }
      var fab = document.getElementById("add-fab");
      if (fab) fab.click();
      var whole = document.getElementById("am-whole") || document.getElementById("am-flight");
      if (whole) whole.click();
      var sheet = document.getElementById("add-sheet");
      var copy = document.getElementById("ai-copy-btn");
      var cs = copy ? getComputedStyle(copy) : {};
      var startLabel = copy ? (copy.textContent || "").replace(/\\s+/g, "") : "";
      var expected = (window.AiPrompt && AiPrompt.TEXT) || "";
      if (copy) copy.click();
      await new Promise(function (r) { setTimeout(r, 80); });
      var afterLabel = copy ? (copy.textContent || "").replace(/\\s+/g, "") : "";
      var close = sheet && sheet.querySelector('[data-close="add-sheet"]');
      if (close) close.click();
      if (fab) fab.click();
      if (whole) whole.click();
      copy = document.getElementById("ai-copy-btn");
      return {
        opened: !!(document.getElementById("add-sheet") && !document.getElementById("add-sheet").hidden),
        noOpen: !document.getElementById("ai-prompt-open"),
        noBox: !document.getElementById("ai-prompt-box"),
        noView: !document.getElementById("ai-prompt-view"),
        startLabel: startLabel,
        afterLabel: afterLabel,
        resetLabel: copy ? (copy.textContent || "").replace(/\\s+/g, "") : "",
        writtenOk: !!(expected && written === expected),
        writtenLen: written.length,
        expectedLen: expected.length,
        height: cs.height,
        radius: cs.borderRadius,
        bg: cs.backgroundColor
      };
    })()`);
    assert.ok(wiz.noOpen && wiz.noBox && wiz.noView, "prompt elements must not exist in the DOM: " + JSON.stringify(wiz));
    assert.ok(wiz.writtenOk && wiz.writtenLen > 80, "clipboard must get the full JS prompt, got len " + wiz.writtenLen + "/" + wiz.expectedLen);
    assert.ok((wiz.startLabel || "").indexOf("复制给AI的话") !== -1, "initial label, got " + wiz.startLabel);
    assert.ok((wiz.afterLabel || "").indexOf("已复制") !== -1, "after tap shows ✓ 已复制, got " + wiz.afterLabel);
    assert.ok((wiz.resetLabel || "").indexOf("复制给AI的话") !== -1 && (wiz.resetLabel || "").indexOf("已复制") === -1, "label resets on reopen, got " + wiz.resetLabel);
    assert.strictEqual(wiz.height, "48px", "复制给 AI 的话 is 48px tall, got " + wiz.height);
    assert.ok(wiz.radius === "12px", "12px radius, got " + wiz.radius);
    assert.ok(wiz.bg === "rgb(15, 157, 138)" || (wiz.bg || "").toLowerCase() === "#0f9d8a", "background #0F9D8A, got " + wiz.bg);

    const banner = await ev(`(function(){
      ["announce-sheet","help-sheet","friend-share-sheet","add-menu","add-sheet","trips-sheet"].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.hidden = true;
      });
      TripApp.importState({
        trips: [{ id: "banner-trip", nameZh: "待确认条", items: [
          { id: "d1", type: "place", nameZh: "有日期", date: "2026-12-01", address: "东京都渋谷区", lat: 35.66, lng: 139.70 },
          { id: "p1", type: "place", nameZh: "待补一", pendingDate: true, dateRaw: "待补", address: "东京都新宿区" },
          { id: "p2", type: "place", nameZh: "待补二", pendingDate: true, dateRaw: "待补", address: "东京都台东区" }
        ] }],
        places: [], activeTripId: "banner-trip", examplesLoaded: true
      }, "replace");
      TripApp.selectDay("2026-12-01", true);
      TripApp.refresh();
      var b = document.querySelector(".pending-banner");
      var all = document.querySelector(".pending-banner");
      return {
        text: b ? (b.textContent || "").replace(/\\s+/g, "") : "",
        hasGo: !!(b && b.querySelector(".pending-banner-go")),
        shown: !!(b && b.offsetParent !== null)
      };
    })()`);
    assert.ok(banner.shown, "single-day view shows 有 N 条日期待确认 banner: " + JSON.stringify(banner));
    assert.ok((banner.text || "").indexOf("有2条日期待确认") !== -1, "banner wording, got " + banner.text);
    assert.ok(banner.hasGo, "banner includes the ›");
    ws.close();
  } finally {
    try { chrome.kill("SIGKILL"); } catch (e) {}
    await new Promise((r) => server.close(r));
  }
}

(async function main() {
  await Promise.all(pendingChecks);
  const r = await check("headless: header, clipboard on tap only, paste-row view has no wizard, pasted block shows friend popup", headlessHeader);
  if (r && typeof r.then === "function") await r;
  console.log(failures ? ("FAIL  " + failures + " failed, " + passes + " passed") : ("PASS  " + passes + " checks"));
  process.exit(failures ? 1 : 0);
})().catch(function (err) {
  console.log("FAIL  check-v613 runner\n      " + (err && err.stack ? err.stack : err));
  process.exit(1);
});
