/**
 * v6 火车 / 船 / 大巴：导入（管道 + JSON）、老格式照旧、时间线排序和转乘、日历、修改、图标、找车站（搜不到不进待补）、AI 提示词。
 * 全部假数据，网络请求用假的 fetch。用法：node check-transport.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");

const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
const urls = [];
let fake = {};
globalThis.fetch = (u) => {
  urls.push(u);
  const q = decodeURIComponent((u.match(/[?&]q=([^&]*)/) || [])[1] || "").replace(/\+/g, " ");
  return Promise.resolve({ ok: true, json: () => Promise.resolve(fake[q] || []) });
};

const T = require("./transport.js");
const I = require("./import.js");
const Legs = require("./legs.js");
const Cal = require("./calendar.js");
const E = require("./item-edit.js");
const Icons = require("./icons.js");
require("./geo.js");
const Geocode = require("./geocode.js");
const F = require("./fix-cand.js");
const AiPrompt = require("./ai-prompt.js");
const read = (f) => fs.readFileSync(__dirname + "/" + f, "utf8");

let failures = 0;
let passes = 0;
const queue = [];
function check(name, fn) {
  queue.push([name, fn]);
}

check("type words: 火车 / 高铁 / 动车 / 车票 / 火车票, 船 / 轮渡 / 船票, 大巴 / 巴士 / 大巴票 / 汽车票, English too; unknown → ''", function () {
  ["火车", "高铁", "动车", "车票", "火车票", "train"].forEach((w) => assert.strictEqual(T.groundKindFromWord(w), "train", w));
  ["船", "轮渡", "渡轮", "船票", "Ferry"].forEach((w) => assert.strictEqual(T.groundKindFromWord(w), "boat", w));
  ["大巴", "巴士", "长途汽车", "大巴票", "汽车票", "coach", "BUS"].forEach((w) => assert.strictEqual(T.groundKindFromWord(w), "bus", w));
  assert.strictEqual(T.groundKindFromWord("飞船"), "");
});

check("import synonyms: 船票=船, 车票/火车票=火车, 大巴票/汽车票=大巴", function () {
  const I = require("./import.js");
  const rows = [
    ["船票 | | Dover - Calais | 2026-12-05 09:00 ~ 2026-12-05 11:30 |", "boat"],
    ["车票 | G7 | 北京南 - 上海虹桥 | 2026-12-03 08:00 ~ 2026-12-03 12:28 |", "train"],
    ["火车票 | G7 | 北京南 - 上海虹桥 | 2026-12-03 08:00 ~ 2026-12-03 12:28 |", "train"],
    ["大巴票 | X90 | Victoria Coach Station - Oxford | 2026-12-06 10:00 ~ 2026-12-06 12:00 |", "bus"],
    ["汽车票 | X90 | Victoria Coach Station - Oxford | 2026-12-06 10:00 ~ 2026-12-06 12:00 |", "bus"]
  ];
  rows.forEach(([row, typ]) => {
    const r = I.parseImport(row);
    assert.deepStrictEqual(r.errors, [], row);
    assert.strictEqual(r.items[0].type, typ, row);
    assert.ok(!r.items[0].pendingDate, row);
  });
});

check("stations: 「A - B」, 「A → B」, hyphen inside a name is kept", function () {
  assert.deepStrictEqual(T.splitStations("北京南 - 上海虹桥"), { from: "北京南", to: "上海虹桥" });
  assert.deepStrictEqual(T.splitStations("London St Pancras → Paris Nord"), { from: "London St Pancras", to: "Paris Nord" });
  assert.deepStrictEqual(T.splitStations("Saint-Malo - Portsmouth"), { from: "Saint-Malo", to: "Portsmouth" });
  assert.strictEqual(T.splitStations("只有一个站"), null);
});

check("pipe rows: train with seat + confirmation pulled out, boat without number, bus with date only, same-day short form", function () {
  const r = I.parseImport([
    "火车 | G1 | 北京南 - 上海虹桥 | 2026-12-01 09:00 ~ 13:28 | 座位 05车12A 确认号 FAKE-E1",
    "船 |  | Dover - Calais | 2026-12-02 10:00 ~ 2026-12-02 11:30 | 带护照",
    "大巴 | X90 | Victoria Coach Station → Oxford | 2026-12-03 | "
  ].join("\n"));
  assert.deepStrictEqual(r.errors, []);
  const [tr, bt, bs] = r.items;
  assert.deepStrictEqual(
    [tr.type, tr.number, tr.fromNameZh, tr.nameZh, tr.departDate, tr.departTime, tr.arriveDate, tr.arriveTime, tr.seat, tr.confirmationNo],
    ["train", "G1", "北京南", "上海虹桥", "2026-12-01", "09:00", "2026-12-01", "13:28", "05车12A", "FAKE-E1"]
  );
  assert.deepStrictEqual([bt.type, bt.number, bt.note, bt.arriveTime], ["boat", "", "带护照", "11:30"]);
  assert.deepStrictEqual([bs.type, bs.departDate, bs.arriveDate, bs.departTime], ["bus", "2026-12-03", "2026-12-03", ""]);
  assert.ok(!r.items.some((x) => "lat" in x || "address" in x), "no address / coords invented");
});

check("JSON: {type: train/boat/bus, number, from, to, depart, arrive}", function () {
  const r = I.parseImport(JSON.stringify([
    { type: "train", number: "ES9014", from: "London St Pancras", to: "Paris Nord", depart: "2026-12-05 08:01", arrive: "2026-12-05 11:20" },
    { type: "bus", from: "A站", to: "B站", depart: "2026-12-06 07:00" }
  ]));
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.items.map((x) => [x.type, x.number, x.fromNameZh, x.nameZh, x.arriveTime]), [
    ["train", "ES9014", "London St Pancras", "Paris Nord", "11:20"],
    ["bus", "", "A站", "B站", ""]
  ]);
});

check("bad transport rows give a clear Chinese error; missing date → 日期待确认 like flights", function () {
  const bad = I.parseImport("火车 | G1 | 北京南 | 2026-12-01 09:00 ~ 13:28 | ");
  assert.ok(/火车的地址应为「出发站 - 到达站」/.test(bad.errors.join(" ")), bad.errors.join(" "));
  const nodate = I.parseImport("船 | P1 | Dover - Calais |  | ");
  assert.strictEqual(nodate.items.length, 1);
  assert.ok(nodate.items[0].pendingDate, "date pending, same as flights");
});

check("AI prompt example imports cleanly (flight, hotel, train, place, undated place); unknown type message lists the new types", function () {
  const r = I.parseImport(AiPrompt.EXAMPLE);
  assert.deepStrictEqual(r.items.map((x) => x.type), ["flight", "hotel", "train", "place", "place"]);
  assert.strictEqual(r.items.length, 5);
  assert.ok(!r.items[4].date && !r.items[4].pendingDate && r.items[4].nameZh === "浅草寺");
  assert.deepStrictEqual([r.items[2].number, r.items[2].departDate, r.items[2].departTime, r.items[2].arriveTime], ["G7", "2026-12-03", "08:00", "12:28"]);
  assert.strictEqual(r.items[0].flightNo, "BA123");
  assert.strictEqual(r.items[0].number, undefined, "flights keep flightNo, no new field");
  const u = I.parseImport("飞船 | X | A - B | 2026-12-01 | ");
  assert.ok(/机票、火车、船、大巴、酒店 或 地点/.test(u.errors.join(" ")));
});

check("timeline order + connectors: train sorts by departure; flight → train is 怎么去 (not 转机/换乘), train → place nav from the arrival station", function () {
  const items = [
    { id: "p", type: "place", nameZh: "外滩", date: "2026-12-01", time: "16:00", lat: 31.24, lng: 121.49 },
    { id: "t", type: "train", number: "G1", fromNameZh: "北京南", nameZh: "上海虹桥", departDate: "2026-12-01", departTime: "09:00", arriveDate: "2026-12-01", arriveTime: "13:28", fromLat: 39.865, fromLng: 116.379, lat: 31.194, lng: 121.32 },
    { id: "f", type: "flight", flightNo: "XX1", fromAirport: "LHR", toAirport: "PEK", departDate: "2026-12-01", departTime: "01:00", arriveDate: "2026-12-01", arriveTime: "07:00" }
  ];
  assert.deepStrictEqual(Legs.sortedItems(items).map((x) => x.id), ["f", "t", "p"]);
  const c = Legs.buildConnectors(items);
  assert.strictEqual(c[0].kind, "nav", "mixed flight↔train is not 转机/换乘");
  assert.ok(String(c[0].label).indexOf("转机") === -1 && String(c[0].label).indexOf("换乘") === -1, c[0].label);
  assert.strictEqual(c[1].kind, "nav");
  assert.strictEqual(c[1].from.name, "上海虹桥");
  assert.strictEqual(Legs.itemDisplayDate(items[1]), "2026-12-01");
});

check("station without coords: no map point for that end (segment not drawn), fallback names per type", function () {
  const it = { id: "b", type: "boat", fromNameZh: "", nameZh: "", departDate: "2026-12-02" };
  const dest = Legs.endpointFor(it, "dest");
  assert.strictEqual(dest.name, "出发码头");
  assert.ok(typeof dest.lat !== "number");
  const rows = Legs.numberedList([it]);
  assert.ok(rows[0].marker && typeof rows[0].marker.lat !== "number", "renderMap skips markers without coords");
  assert.strictEqual(Legs.endpointFor({ id: "x", type: "bus" }, "origin").name, "下车站");
});

check("calendar: transport counts as the travel dot on its departure day and fills the range to arrival", function () {
  const tr = { id: "t", type: "train", departDate: "2026-12-01", arriveDate: "2026-12-02", departTime: "22:00", arriveTime: "07:00", fromNameZh: "A", nameZh: "B" };
  const src = read("calendar.js");
  assert.ok(/if \(isTransit\(item\)\) return "flight";/.test(src));
  assert.ok(/it && isTransit\(it\) && parse\(it\.arriveDate\)/.test(src));
  assert.strictEqual(Cal.dotKind(tr), "flight");
  const dots = Cal.dotsByDay([tr]);
  assert.ok(dots["2026-12-01"], "dot on the departure day");
});

check("edit form round trip: number, 「出发站 - 到达站」, times; changing a station drops that end's coords only", function () {
  const it = { id: "t", type: "train", number: "G1", fromNameZh: "北京南", nameZh: "上海虹桥", departDate: "2026-12-01", departTime: "09:00", arriveDate: "2026-12-01", arriveTime: "13:28", fromLat: 1, fromLng: 2, lat: 3, lng: 4, note: "靠窗" };
  const f = E.formFields(it);
  assert.deepStrictEqual([f.type, f.name, f.address, f.endTime, f.note], ["火车", "G1", "北京南 - 上海虹桥", "13:28", "靠窗"]);
  const same = E.applyForm(it, f);
  assert.strictEqual(same.addressChanged, false);
  assert.deepStrictEqual(same.item, it);
  const moved = E.applyForm(it, Object.assign({}, f, { address: "北京南 - 南京南", name: "" }));
  assert.strictEqual(moved.addressChanged, true);
  assert.deepStrictEqual([moved.item.fromLat, moved.item.lat, moved.item.nameZh, moved.item.number], [1, undefined, "南京南", undefined]);
  assert.strictEqual(E.rangeProblem({ type: "bus", departDate: "2026-12-05", arriveDate: "2026-12-01" }), "flight-reversed");
});

check("icons: own icon per type (train / boat / bus) in the transport grey; a picked category icon never overrides it", function () {
  assert.deepStrictEqual(["train", "boat", "bus"].map((t) => Icons.typeMeta({ type: t }).icon), ["train", "boat", "bus"]);
  assert.deepStrictEqual(["train", "boat", "bus"].map((t) => Icons.typeMeta({ type: t }).label), ["火车", "船", "大巴"]);
  assert.strictEqual(Icons.typeMeta({ type: "boat", icon: "food" }).icon, "boat");
  ["train", "boat", "bus"].forEach((n) => assert.ok(Icons.html(n).indexOf("<svg") !== -1, n));
  assert.strictEqual(Icons.typeMeta({ type: "train" }).color, Icons.typeMeta({ type: "flight" }).color);
});

check("never 待补: transport without station coords is not 「待补地址」 (no banner, no 选一下位置, no nav)", function () {
  assert.strictEqual(F.needsFix({ type: "train", fromNameZh: "某个小站", nameZh: "另一个小站" }), false);
  assert.strictEqual(F.needsFix({ type: "place", nameZh: "x" }), true, "places still are");
  const tl = read("timeline.js");
  assert.ok(/if \(isGround\(item\)\) return false;/.test(tl.slice(tl.indexOf("function itemUnlocated"), tl.indexOf("function typeStyle"))));
  /* v5.4 起导航是卡片右边的「带我去」+ 展开后的「看位置」，交通都不放 */
  assert.ok(/function cardGoBtnHtml\(item\) \{[^}]*if \(!item \|\| isTransit\(item\)\) return "";/.test(tl), "no 带我去 on transport");
  assert.ok(/function cardLookHtml\(item\) \{\s*if \(!item \|\| isTransit\(item\)\) return "";/.test(tl), "no 看位置 on transport");
  assert.ok(/\(isGround\(item\) \? "" : '<div class="detail-nav">'/.test(tl), "no nav on the detail sheet either");
});

check("AI prompt: types include 火车/高铁/动车、船/轮渡、大巴/巴士 and 6 categories; 出发 ~ 到达 in local time; train example; numbering 8–11 unchanged; still no links", function () {
  const P = AiPrompt.TEXT;
  assert.ok(P.indexOf("机票、酒店、火车（也可写高铁、动车）、船（也可写轮渡）、大巴（也可写巴士）") !== -1);
  assert.ok(P.indexOf("地点/景点、地点/自然、地点/餐厅、地点/咖啡甜点酒吧、地点/购物、地点/其他") !== -1);
  assert.ok(P.indexOf("日期时间写“出发 ~ 到达”，用当地时间") !== -1);
  assert.ok(P.indexOf("火车 | G7 | 北京南 - 上海虹桥 | 2026-12-03 08:00 ~ 2026-12-03 12:28 |") !== -1);
  ["8. ", "9. ", "10. ", "11. "].forEach((n) => assert.ok(P.indexOf("\n" + n) !== -1, n));
  assert.ok(!/https?:\/\//.test(P));
  assert.ok(!/草稿/.test(read("ai-prompt.js")), "prompt is no longer a draft placeholder");
});

async function asyncChecks() {
  await run("find stations: departure searched with that day's city; one clear hit → coords; nothing found → name kept, status ok (never 待补)", async function () {
    fake = {
      "Paddington London": [{ lat: "51.5154", lon: "-0.1755", display_name: "Paddington, London", name: "Paddington", address: { city: "London" } }]
    };
    const it = { id: "t", type: "train", number: "GW1", fromNameZh: "Paddington", nameZh: "某个找不到的站", departDate: "2026-12-01" };
    const r = await Geocode.resolveItem(it, { city: "London", bias: null });
    assert.strictEqual(r.status, "ok");
    assert.ok(r.fromChosen && Math.abs(r.fromChosen.lat - 51.5154) < 1e-6);
    assert.strictEqual(r.chosen, null);
    Geocode.applyChoice(it, r.chosen, r.fromChosen);
    assert.deepStrictEqual([it.fromLat, it.lat, it.nameZh, it.city], [51.5154, undefined, "某个找不到的站", undefined]);
    assert.ok(urls.some((u) => /q=Paddington(\+|%20)London/.test(u)), "city added to the departure search");
    assert.ok(!urls.some((u) => /%E6%9F%90%E4%B8%AA.*London/.test(u)), "arrival station searched without the departure city");
    assert.ok(urls.every((u) => u.indexOf("https://nominatim.openstreetmap.org/search") === 0), "same host as before");
  });
  await run("several far-apart results → not guessed (name only); results clustered within 2 km → used", async function () {
    fake = {
      "Central": [{ lat: "22.28", lon: "114.16", display_name: "Central HK", name: "Central" }, { lat: "51.5", lon: "-0.1", display_name: "Central London", name: "Central" }],
      "Shanghai Hongqiao": [{ lat: "31.194", lon: "121.320", display_name: "上海虹桥站", name: "虹桥" }, { lat: "31.196", lon: "121.322", display_name: "虹桥火车站地铁站", name: "虹桥站" }]
    };
    const r = await Geocode.resolveItem({ id: "b", type: "bus", fromNameZh: "Central", nameZh: "Shanghai Hongqiao", departDate: "2026-12-01" }, {});
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(r.fromChosen, null);
    assert.ok(r.chosen && Math.abs(r.chosen.lat - 31.194) < 1e-6);
  });
}

async function run(name, fn) {
  try {
    await fn();
    passes += 1;
    console.log("PASS  " + name);
  } catch (err) {
    failures += 1;
    console.log("FAIL  " + name);
    console.log("      " + (err && err.stack ? err.stack : err));
  }
}

(async function () {
  for (const [name, fn] of queue) await run(name, fn);
  await asyncChecks();
  console.log("\n" + passes + " passed, " + failures + " failed");
  if (failures) process.exit(1);
  console.log("All transport checks passed.");
})();
