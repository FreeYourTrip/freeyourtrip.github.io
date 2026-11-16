/**
 * v5.2 行程名胶囊 + 起名建议。用法：node check-name-suggest.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
global.AirportDB = require("./airports.js");
const T = require("./trip-name.js");

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

const out = { type: "flight", fromAirport: "LHR", toAirport: "HND", departDate: "2026-12-01", departTime: "09:30", arriveDate: "2026-12-02" };
const back = { type: "flight", fromAirport: "HND", toAirport: "LHR", departDate: "2026-12-10", departTime: "11:00", arriveDate: "2026-12-10" };

check("airports.js: every entry has cityZh (empty only when unsure)", function () {
  const A = global.AirportDB.AIRPORTS;
  const keys = Object.keys(A);
  assert.ok(keys.length >= 180);
  keys.forEach((k) => assert.ok(typeof A[k].cityZh === "string", k));
  assert.strictEqual(A.HND.cityZh, "东京");
  assert.strictEqual(A.CDG.cityZh, "巴黎");
  assert.strictEqual(A.LHR.cityZh, "伦敦");
  assert.ok(keys.filter((k) => !A[k].cityZh).length <= 5);
});

check("flight → city from the outbound flight's arrival airport", function () {
  const s = T.suggestName([back, out, { type: "hotel", address: "大阪府大阪市", checkIn: "2026-12-05", checkOut: "2026-12-08" }]);
  assert.strictEqual(s.source, "flight");
  assert.strictEqual(s.name, "东京 · 12月1日–10日");
  assert.strictEqual(s.text, "给这趟起个名字：东京 · 12月1日–10日？");
});

check("hotel fallback (Chinese and English addresses); cross-month range", function () {
  const a = T.suggestName([{ type: "hotel", address: "东京都新宿区西新宿 1-1", checkIn: "2026-12-28", checkOut: "2027-01-03" }]);
  assert.strictEqual(a.source, "hotel");
  assert.strictEqual(a.text, "给这趟起个名字：东京 · 12月28日–1月3日？");
  const b = T.suggestName([{ type: "hotel", address: "1 Example Street, London WC1H 0XX", checkIn: "2026-12-04", checkOut: "2026-12-07" }]);
  assert.strictEqual(b.name, "伦敦 · 12月4日–7日");
});

check("dates only when no city is reliable; no dates → no suggestion", function () {
  const s = T.suggestName([{ type: "place", nameZh: "某处", date: "2026-12-01" }, { type: "hotel", address: "某个看不出城市的地址", checkIn: "2026-12-03", checkOut: "2026-12-10" }]);
  assert.strictEqual(s.source, "dates");
  assert.strictEqual(s.text, "给这趟起个名字：12月1日–10日的旅行？");
  assert.strictEqual(T.suggestName([{ type: "place", nameZh: "没日期" }]), null);
  assert.strictEqual(T.suggestName([{ type: "place", date: "2026-12-01", pendingDate: true }]), null, "pending dates are ignored");
});

check("asked once, only while the name is the default, only after items were added", function () {
  assert.strictEqual(T.shouldAsk({ name: "我的行程", asked: false, addedCount: 3 }), true);
  assert.strictEqual(T.shouldAsk({ name: "", asked: false, addedCount: 1 }), true);
  assert.strictEqual(T.shouldAsk({ name: "我的行程", asked: true, addedCount: 3 }), false, "never again, whatever the choice");
  assert.strictEqual(T.shouldAsk({ name: "东京之旅", asked: false, addedCount: 3 }), false);
  assert.strictEqual(T.shouldAsk({ name: "我的行程", asked: false, addedCount: 0 }), false);
  const tl = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  const q = tl.slice(tl.indexOf("function queueNameSuggest"), tl.indexOf("function flushNameSuggest"));
  assert.ok(q.indexOf("lsSet(TripName.ASKED_KEY, \"1\")") !== -1, "marked asked as soon as it is queued");
  assert.ok(q.indexOf("setTripName") === -1, "never renames by itself");
  const yes = tl.slice(tl.indexOf('$("name-pop-yes").addEventListener'), tl.indexOf('$("name-pop-self").addEventListener'));
  assert.ok(yes.indexOf("setTripName(sug.name)") !== -1, "only 就用这个 renames");
  assert.ok(tl.indexOf("function namePopOutside") !== -1, "tap outside = no");
  assert.ok(/if \(!pendingNameSuggest \|\| anyPopupOpen\(\) \|\| renaming\) return;/.test(tl), "never together with other popups");
  assert.deepStrictEqual([T.COPY.yes, T.COPY.self, T.COPY.hint, T.COPY.done], ["就用这个", "我自己改", "点这里起名", "完成"]);
  const src = fs.readFileSync(__dirname + "/trip-name.js", "utf8");
  assert.ok(!/fetch\(|XMLHttpRequest|localStorage/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "computed locally, no network");
});

check("pill markup + CSS (v6: data-role=switch opens 「我的行程」), 14px chevron SVG, hint, rename mode kept for the name pop", function () {
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  const css = fs.readFileSync(__dirname + "/styles.css", "utf8");
  assert.ok(/<div class="trip-pill" id="trip-pill" data-role="switch">/.test(html));
  assert.ok(/<svg class="trip-pill-ico"[^>]*width="14" height="14"[^>]*stroke="#8A9099"[^>]*><path d="M4 6l4 4 4-4"\/><\/svg>/.test(html), "self-drawn 14px chevron");
  assert.ok(/\$\("trip-name-btn"\)\.addEventListener\("click", openTrips\);/.test(fs.readFileSync(__dirname + "/timeline.js", "utf8")), "tap the name → 「我的行程」");
  assert.ok(html.indexOf('id="trip-name-done">完成<') !== -1);
  /* 默认名：胶囊自己写「点这里起名」+ 铅笔，没有单独的提示 span */
  const tlp = fs.readFileSync(__dirname + "/timeline.js", "utf8");
  assert.ok(html.indexOf("trip-name-hint") === -1 && tlp.indexOf("trip-name-hint") === -1 && css.indexOf("trip-name-hint") === -1, "separate hint removed");
  assert.strictEqual(require("./trip-name.js").COPY.hint, "点这里起名");
  assert.ok(/nameText\.textContent = isDefault && window\.TripName \? TripName\.COPY\.hint : name;/.test(tlp));
  assert.ok(/\.trip-pill\.is-default \.trip-name-text \{ color: #6B7A85;/.test(css));
  const pill = css.slice(css.indexOf("/* ---------- v5.2 行程名胶囊"));
  ["height: 28px;", "padding: 0 10px;", "border-radius: 14px;", "background: #F3ECE0;", "color: #16332F;", "font-size: 13px;", "font-weight: 600;", "gap: 4px;", "text-decoration: none;"].forEach((t) => assert.ok(pill.indexOf(t) !== -1, t));
  assert.ok(/\.topbar \.trip-name::before \{[^}]*top: -8px;[^}]*bottom: -8px;/.test(pill), "44px tap area");
  assert.ok(/\.topbar \.trip-name:active \{ background: #E8DCC8; \}/.test(pill));
  assert.ok(/\.trip-name-text \{[^}]*max-width: 7em;[^}]*text-overflow: ellipsis;/.test(pill));
  assert.ok(/@media \(max-width: 360px\) \{\s*\.trip-name-text \{ max-width: 6em; \}/.test(pill));
  assert.ok(/border-bottom: 2px solid #0F9D8A;/.test(pill) && /\.trip-name-done \{[^}]*color: #0F9D8A;[^}]*font-size: 13px;/.test(pill));
  assert.ok(/\.name-pop \{[^}]*border-radius: 12px;[^}]*box-shadow: 0 4px 16px rgba\(22, 51, 47, 0\.14\);/.test(pill));
});

if (failures) {
  console.log("\n" + failures + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll name-suggest checks passed.");
