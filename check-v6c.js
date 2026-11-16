/**
 * v6（19:20 以后加进来的）：长按不选字、退房卡第二行给「带我去」让位、「全部」日程表样式（日期带、空白日、
 * 「还没定哪天」、只在有酒店 / 机票 / 火车 / 船时出现）、跨天拖动改日期 + 撤销、酒店两张卡上锁、说明书一行。
 * 页面部分另有无头 Chrome 走一遍（/workspace/e2e-v6b.mjs）。用法：node check-v6c.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
require("./transport.js");
const E = require("./item-edit.js");

const read = (f) => fs.readFileSync(__dirname + "/" + f, "utf8");
const tl = read("timeline.js");
const css = read("styles.css");

let passes = 0;
let failures = 0;
function check(name, fn) {
  try {
    fn();
    passes += 1;
    console.log("PASS  " + name);
  } catch (err) {
    failures += 1;
    console.log("FAIL  " + name);
    console.log("      " + (err && err.stack ? err.stack : err));
  }
}
const rule = (sel) => {
  const i = css.lastIndexOf("\n" + sel + " {");
  assert.ok(i !== -1, "css rule " + sel);
  return css.slice(i, css.indexOf("}", i));
};

check("cards: no text selection / callout on long-press (inputs still selectable); contextmenu + selectstart blocked on cards only", function () {
  assert.ok(css.indexOf(".card { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }") !== -1);
  assert.ok(/\.card input, \.card textarea, \.card select, \.card \[contenteditable\] \{ -webkit-user-select: text; user-select: text;/.test(css));
  assert.ok(/if \(t\.closest\("input, textarea, select, \[contenteditable\](?:, \.card-address)?"\)\) return;\s*if \(t\.closest\("\.card"\)\) ev\.preventDefault\(\);/.test(tl));
  assert.ok(/root\.addEventListener\("contextmenu", noNative\);\s*root\.addEventListener\("selectstart", noNative\);/.test(tl));
});

check("long-press drag survives pointercancel: switches to touchmove / touchend instead of ending; list scroll untouched until dragging", function () {
  assert.ok(/window\.addEventListener\("pointercancel", onPointerLost, true\);/.test(tl));
  assert.ok(/function onPointerLost\(\) \{\s*if \(dragState && dragState\.dragging\) dragState\.pointerLost = true;/.test(tl));
  assert.ok(/function onDragTouchEnd\(ev\) \{[\s\S]*?if \(!st \|\| !st\.dragging \|\| !st\.pointerLost\) return;\s*onDragEnd\(ev\);/.test(tl));
  assert.ok(/window\.addEventListener\("touchmove", onDragTouchMove, \{ capture: true, passive: false \}\);/.test(tl), "added only when a drag starts");
  assert.ok(/var moveGuard = function \(ev\) \{\s*if \(dragState && dragState\.dragging\) ev\.preventDefault\(\);/.test(tl), "scroll is only blocked while dragging");
});

check("checkout line 2 「12:00 · 共 2 晚」: time never wraps; trailing 「· 共 N 晚」 is a card-sub hidden when clipped", function () {
  assert.ok(/function checkoutTimeHtml\(label\)/.test(tl) && /class="card-sub co-sub"/.test(tl));
  assert.ok(/function fitCardMetaSubs\(/.test(tl) && /card-sub/.test(css));
  assert.ok(/\.card-meta-main \.card-time,[\s\S]*?flex-shrink: 0;[\s\S]*?white-space: nowrap;/.test(css), "time: nowrap + no shrink");
  assert.ok(/\.card-meta-main \.card-sub \{[\s\S]*?overflow: hidden;[\s\S]*?white-space: nowrap;/.test(css), "sub-label clips as a unit");
  assert.ok(/\.card-meta-main \.card-sub\.is-clipped \{ display: none; \}/.test(css), "clipped sub-label is hidden entirely");
  assert.ok(/\.card-meta-row \.card-go-btn \{\s*margin-left: auto;\s*flex: none;/.test(css), "button never shrinks");
  assert.ok(!/co-nights \{[\s\S]*?flex: 0 0 100%;[\s\S]*?#9AA6B2/.test(css), "360 no longer wraps nights onto a third line");
});

check("全部 agenda bands: 40 px, #F1ECE4, 14 px 600 #6B7A8F, left 24 px, sticky under the date strip; empty day 48 px blank; drag-over #E8F5F2 + 1.5 px dashed #0F9D8A", function () {
  const b = rule(".day-subhead");
  ["position: sticky;", "top: var(--subhead-top, 0px);", "height: 40px;", "padding: 0 16px 0 24px;", "background: #F1ECE4;", "font-size: 14px;", "font-weight: 600;", "color: #6B7A8F;"].forEach((d) => assert.ok(b.indexOf(d) !== -1, d));
  assert.ok(/\.day-rail\.day-empty \{ height: 48px;/.test(css));
  assert.ok(!/\.day-rail\.day-empty \{ height: 48px; background: #fff/.test(css), "empty day has no white card");
  assert.ok(/\.day-block\.is-drop-target \.day-rail\.day-empty \{ background: #E8F5F2; border: 1\.5px dashed #0F9D8A; \}/.test(css));
  assert.ok(/\.day-block\.is-drop-target \{ background: #E8F5F2;/.test(css));
  assert.ok(/html \+= '<div class="day-rail day-empty"><\/div><\/section>';/.test(tl), "empty day: no text");
});

check("agenda only when the trip has a hotel / flight / train / boat; range = first to last (arrivals / check-outs too); plain list otherwise", function () {
  assert.ok(/var ANCHOR_TYPES = \["hotel", "flight", "train", "boat", "bus"\];/.test(tl));
  assert.ok(/var agenda = selectedDay === "all" && hasAnchorItems\(datedRaw\);/.test(tl), "recomputed on every render → switches by itself");
  assert.ok(/if \(agenda\) groups = fillEmptyDays\(groups, datedRaw\);/.test(tl));
  assert.ok(/var end = it\.type === "hotel" \? it\.checkOut : it\.arriveDate;/.test(tl));
  assert.ok(/if \(agenda && g\.date === UNDATED_KEY\)/.test(tl) && /if \(showAll\) html \+= undatedBlockHtml\(undatedGroup\);/.test(tl) && /var showAll = agenda;/.test(tl), "plain list: no bands, no 还没定哪天");
});

check("「还没定哪天」 at the bottom: same band, 2 px dashed #C9D2DA left border, no pills, hidden when empty except while dragging", function () {
  assert.ok(/var UNDATED_TITLE = "还没定哪天";/.test(tl));
  const u = tl.slice(tl.indexOf("function undatedBlockHtml"), tl.indexOf("function syncStickyOffset"));
  assert.ok(/items\.forEach\(function \(item\) \{ out \+= cardHtml\(item, null\); \}\);/.test(u) && u.indexOf("legPillHtml") === -1, "no pills");
  assert.ok(/data-drop-day=""/.test(u) && /<h3 class="day-subhead">' \+ UNDATED_TITLE/.test(u));
  assert.ok(/\.undated-block \.card \{ border-left: 2px dashed #C9D2DA; \}/.test(css));
  assert.ok(/\.undated-block\.is-empty \{ display: none; \}/.test(css) && /\.timeline\.is-dragging-any \.undated-block\.is-empty \{ display: block; \}/.test(css));
});

check("moveToDay (pure): place gets the day / loses it; hotel / flight / train / boat / bus untouched; order cleared", function () {
  assert.deepStrictEqual(E.moveToDay({ id: "a", type: "place", date: "2026-12-01", time: "10:00", dayOrder: 3 }, "2026-12-05"), { id: "a", type: "place", date: "2026-12-05", time: "10:00" });
  assert.deepStrictEqual(E.moveToDay({ id: "a", type: "place", date: "2026-12-01" }, ""), { id: "a", type: "place" });
  assert.deepStrictEqual(E.moveToDay({ id: "u", type: "place" }, "2026-12-07"), { id: "u", type: "place", date: "2026-12-07" }, "undated → dated");
  ["hotel", "flight", "train", "boat", "bus"].forEach((t) => {
    const it = { id: "x", type: t, date: "2026-12-01", departDate: "2026-12-01", checkIn: "2026-12-01" };
    assert.strictEqual(E.moveToDay(it, "2026-12-09"), it, t);
  });
});

check("drop on another day: date changes, toast 「已移到 11月17日」 / 「已放进「还没定哪天」」 + 撤销 5 s, no 「放哪天？」", function () {
  assert.ok(/var MOVE_COPY = \{ moved: "已移到 ", undated: "已放进「还没定哪天」" \};/.test(tl));
  const m = tl.slice(tl.indexOf("function moveItemToDay"), tl.indexOf("function snapshotItems"));
  assert.ok(/showToast\(day \? MOVE_COPY\.moved \+ formatMd\(day\) : MOVE_COPY\.undated, function \(\) \{[\s\S]*?t\.items = snapshot;[\s\S]*?\}, 5000\);/.test(m));
  assert.ok(m.indexOf("openConfirm") === -1 && !/"[^"\n]*放哪天[^"\n]*"/.test(tl), "never asks");
  assert.ok(/if \(target\.day === fromDay\) \{[\s\S]*?applyReorder\(fromDay, newIds, moving\);[\s\S]*?moveItemToDay\(moving, target\.day, newIds\);/.test(tl), "same day still = v5.4 reorder");
  assert.ok(/st\.blocks\.forEach\(function \(b\) \{ b\.el\.classList\.toggle\("is-drop-target", b === block\); \}\);/.test(tl), "highlight the group under the finger");
});

check("locks: hotel 入住 + 退房 → 「跟着入住日期走，不能拖」; flight / train / boat → 「有固定时间，不能拖」; lock icon on all of them", function () {
  assert.ok(/var LOCK_COPY = \{ fixed: "有固定时间，不能拖", hotel: "跟着入住日期走，不能拖" \};/.test(tl));
  const lr = tl.slice(tl.indexOf("function lockReason"), tl.indexOf("function flightLockSvg"));
  assert.ok(/if \(item\.type === "hotel" \|\| \(window\.Legs && Legs\.isCheckoutView && Legs\.isCheckoutView\(item\)\)\) return LOCK_COPY\.hotel;/.test(lr));
  assert.ok(/if \(isFixedTime\(item\)\) return LOCK_COPY\.fixed;/.test(lr));
  assert.ok(/var locked = cardIsCheckout \? LOCK_COPY\.hotel : lockReason\(item\);\s*if \(locked\) \{[\s\S]*?showToast\(locked, null, 2500\);/.test(tl));
  assert.ok(/\(lockText \? flightLockSvg\(lockText\) : ""\)/.test(tl));
});

check("说明书 line: 「长按卡片拖动，能换顺序，也能拖到别的日子」", function () {
  assert.ok(tl.indexOf('line: "长按卡片拖动，能换顺序，也能拖到别的日子" }') !== -1);
});

check("confirm box: checkbox and third button really hidden when not used (display:flex used to override [hidden])", function () {
  assert.ok(/\.confirm-check\[hidden\], \.confirm-alt\[hidden\] \{ display: none; \}/.test(css));
});

check("手动填写 图标（可不选）: no 酒店 / 交通, 6 icons in a 3×2 grid (景点 自然 餐厅 / 咖啡甜点酒吧 购物 其他); old hotel / transport icons still render", function () {
  const I = require("./icons.js");
  assert.deepStrictEqual(I.MANUAL_PICKER_KEYS, ["sight", "nature", "food", "dessert", "shop", "other"]);
  const shown = I.CATEGORIES.filter((c) => I.MANUAL_PICKER_KEYS.indexOf(c.key) !== -1).map((c) => c.label);
  assert.deepStrictEqual(shown, ["景点", "自然", "餐厅", I.CAFE_LABEL, "购物", "其他"], "order kept");
  assert.ok(/if \(box\.id === "icon-picker" && Icons\.MANUAL_PICKER_KEYS\) \{\s*cats = cats\.filter/.test(tl));
  assert.ok(/#icon-picker\.icon-picker \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/.test(css), "3 equal columns; circle size untouched");
  assert.strictEqual(I.typeMeta({ type: "place", icon: "hotel" }).icon, "hotel", "existing place with the hotel icon");
  assert.strictEqual(I.typeMeta({ type: "place", icon: "transport" }).icon, "train", "existing place with the transport icon");
  assert.strictEqual(I.CATEGORIES.length, 8, "hidden from the picker only, not removed");
});

check("import: 类型「酒店」 is saved as a hotel with no date dialog; missing dates → 待补 with today pre-filled; batch not interrupted", function () {
  const Imp = require("./import.js");
  const r = Imp.parseImport("酒店 | The Savoy | Strand, London | | \n酒店 | 示例旅馆 | 1 Fake Street | 2026-12-04 ~ 2026-12-07 | \n地点 | 大英博物馆 | Great Russell St | 2026-12-05 10:00 |");
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.items.map((i) => i.type), ["hotel", "hotel", "place"], "all 3 rows kept, in order");
  const d = new Date();
  const today = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  assert.strictEqual(r.items[0].pendingDate, true);
  assert.strictEqual(r.items[0].dateGuess, today);
  assert.strictEqual(r.items[1].pendingDate, undefined);
  const fin = tl.slice(tl.indexOf("function finishImport"), tl.indexOf("function finishImport") + 6000);
  assert.ok(fin.indexOf("afterHotelReady") === -1 && fin.indexOf("openHotelDateSheet") === -1, "import path never opens the date sheet");
});

check("「甜品」 → 「咖啡甜点酒吧」: one label constant, same id (old places follow), cup glyph, orange; import accepts both names; AI prompt uses the new name", function () {
  const I = require("./icons.js");
  const src = read("icons.js");
  assert.strictEqual(I.CAFE_LABEL, "咖啡甜点酒吧");
  assert.strictEqual((src.match(/"咖啡甜点酒吧"/g) || []).length, 2, "label written once (+ its import alias key)");
  assert.ok(/\{ key: "dessert", label: CAFE_LABEL, icon: "dessert", group: "orange" \}/.test(src));
  assert.deepStrictEqual([I.categoryMeta("dessert").label, I.categoryMeta("dessert").color, I.categoryMeta("dessert").tint], [I.CAFE_LABEL, "#F2994A", "#FDEDD9"]);
  assert.strictEqual(I.typeMeta({ type: "place", icon: "dessert", nameZh: "老地点" }).label, I.CAFE_LABEL, "existing places follow");
  assert.ok(/dessert:\s*'<path d="M5 11h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"\/>/.test(src), "steaming cup");
  assert.deepStrictEqual(["甜品", "咖啡甜点酒吧", "餐厅", ""].map(I.categoryFromWord), ["dessert", "dessert", "", ""]);
  const Imp = require("./import.js");
  const r = Imp.parseImport("地点/甜品 | 示例甜品店 | 1 Fake St | |\n地点/咖啡甜点酒吧 | 示例咖啡馆 | 2 Fake St | |\n地点/餐厅 | 示例餐厅 | 3 Fake St | |");
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.items.map((i) => [i.subtype, i.icon || ""]), [[I.CAFE_LABEL, "dessert"], [I.CAFE_LABEL, "dessert"], ["餐厅", ""]]);
  assert.ok(require("./ai-prompt.js").TEXT.indexOf("地点/景点、地点/自然、地点/餐厅、地点/咖啡甜点酒吧、地点/购物、地点/其他\n") !== -1);
  assert.ok(/\.icon-name \{ white-space: nowrap; \}/.test(css), "never wraps");
});

const html = read("index.html");

check("「给 AI 的话」: one button opens the full prompt, 「复制」 below it (old 查看提示词 / 复制给 AI 的话 gone)", function () {
  assert.ok(/<button type="button" class="primary-btn" id="ai-prompt-open"[^>]*>给 AI 的话<\/button>\s*<div class="ai-prompt-box" id="ai-prompt-box" hidden>\s*<pre class="prompt-view" id="ai-prompt-view"><\/pre>\s*<button type="button" class="primary-btn copy-btn" id="ai-copy-btn">复制<\/button>/.test(html));
  assert.ok(html.indexOf("ai-preview-toggle") === -1 && tl.indexOf("ai-preview-toggle") === -1);
  ["查看提示词", "复制给 AI 的话", "收起提示词"].forEach((w) => assert.ok(html.indexOf(w) === -1 && tl.indexOf(w) === -1, w));
  assert.ok(/if \(on && \$\("ai-prompt-view"\)\) \$\("ai-prompt-view"\)\.textContent = aiPromptText\(\);/.test(tl), "full text");
  assert.ok(/if \(btn\.id === "ai-copy-btn"\) \{\s*setAiStep\(Math\.max\(aiStep, 2\)\);/.test(tl), "copy still moves on to step 2");
});

check("「分享给朋友」 restores system share when available; copy fallback toasts 「网址已复制，发给朋友就行」", function () {
  const R = require("./recommend.js");
  assert.strictEqual(R.COPIED, "网址已复制，发给朋友就行");
  assert.ok(html.indexOf('id="recommend-btn" data-sub="只发网址，不含你的行程">分享给朋友</button>') !== -1);
  assert.ok(read("recommend.js").indexOf("nav.share(") !== -1, "system share sheet restored");
});

check("one fallback row 「找不到？换个方式加 ›」 → choose 『在地图上选』 / 『手动填地址』 (加酒店 and 补地址)", function () {
  assert.ok(html.indexOf('id="add-fallback" hidden>找不到？换个方式加 ›</button>') !== -1);
  assert.ok(html.indexOf('id="add-map-link"') === -1 && html.indexOf('id="fix-manual"') === -1, "the two old links are gone");
  assert.ok(/b\.hidden = !\(hotelMode \|\| fixingId\);/.test(tl));
  const fb = tl.slice(tl.indexOf("function openAddFallback"), tl.indexOf("function manualHotelFromSearch"));
  assert.ok(/okText: C\.fallbackMap,/.test(fb) && /altText: C\.fallbackManual,/.test(fb));
  assert.ok(/if \(fixId\) openMapPick\(fixId\);/.test(fb) && /if \(fixId\) fixManually\(\);\s*else manualHotelFromSearch\(q\);/.test(fb));
});

check("清空本机数据 at the very bottom of 使用说明 (not in 设置 next to 清空这趟); confirm 「手机上所有行程和地点都会删掉，删了找不回来」 全部删掉 / 取消", function () {
  const help = html.slice(html.indexOf('id="help-sheet"'), html.indexOf('id="install-sheet"'));
  assert.ok(/<div class="help-body" id="help-body"><\/div>\s*<!--[^>]*-->\s*<div class="help-danger"><button type="button" class="more-btn more-btn-danger" id="backup-clear">清空本机数据<\/button><\/div>\s*<div class="help-foot">/.test(help));
  assert.ok(/if \(danger && danger.parentNode\) danger.parentNode.removeChild\(danger\);/.test(tl) && /if \(danger\) box.appendChild\(danger\);/.test(tl), "moved to the end of the scrolling help content after each render");
  assert.ok(/\.help-sheet\.help-first \.help-danger \{ display: none; \}/.test(css), "not on the first-run short version");
  const settings = html.slice(html.indexOf('id="settings-sheet"'), html.indexOf('id="help-sheet"'));
  assert.ok(settings.indexOf("backup-clear") === -1);
  const B = require("./backup.js");
  assert.deepStrictEqual(B.CLEAR_LOCAL_COPY, { title: "手机上所有行程和地点都会删掉，删了找不回来", ok: "全部删掉", cancel: "取消" });
});

check("ticket times (flight / train / boat / bus) get 「当地时间」 small text; places and hotels don't", function () {
  assert.ok(/var TZ_NOTE = "当地时间";/.test(tl));
  assert.ok(/\(timeLabel && isFixedTime\(item\) \? '<span class="card-sub tz-note">' \+ TZ_NOTE \+ "<\/span>" : ""\)/.test(tl));
  assert.ok(/\.card-meta-main \.tz-note \{ font-size: 11px; color: #8A9099;/.test(css));
});

check("import dates: YYYY-MM-DD as is; a/b with a number > 12 parsed; both ≤ 12 → 待补 「是12月4日还是4月12日？」 with two readings; never guessed", function () {
  const Imp = require("./import.js");
  const r = Imp.parseImport("酒店 | 示例旅馆 | 1 Fake St | 2026-12-01 ~ 2026-12-03 |\n地点 | 示例公园 | 2 Fake St | 12/4 10:00 |\n地点 | 示例馆 | 3 Fake St | 25/12 |\n地点 | 示例店 | 4 Fake St | 12/25/2026 15:00 |\n酒店 | 示例酒店 | 5 Fake St | 4/12/2026 ~ 7/12/2026 |\n地点 | 同一天 | 6 Fake St | 5/5 |");
  assert.deepStrictEqual(r.errors, []);
  const [h, amb, d1, d2, hAmb, same] = r.items;
  assert.deepStrictEqual([h.checkIn, h.checkOut, h.pendingDate], ["2026-12-01", "2026-12-03", undefined]);
  assert.deepStrictEqual([d1.date, d2.date, d2.time, same.date], ["2026-12-25", "2026-12-25", "15:00", "2026-05-05"]);
  assert.deepStrictEqual([amb.date, amb.pendingDate, amb.pendingKind, amb.pendingReason], ["", true, "date-ambiguous", "是12月4日还是4月12日？"]);
  assert.deepStrictEqual(amb.pendingChoices.map((c) => c.label), ["12月4日", "4月12日"]);
  const a0 = Imp.applyDateChoice(amb, 0);
  const a1 = Imp.applyDateChoice(amb, 1);
  assert.deepStrictEqual([a0.date, a0.time, a0.pendingDate, a0.id], ["2026-12-04", "10:00", undefined, amb.id]);
  assert.deepStrictEqual([a1.date, a1.time], ["2026-04-12", "10:00"]);
  assert.deepStrictEqual([hAmb.checkIn, hAmb.pendingKind], ["", "date-ambiguous"]);
  const hb = Imp.applyDateChoice(hAmb, 1);
  assert.deepStrictEqual([hb.checkIn, hb.checkOut, hb.pendingDate], ["2026-12-04", "2026-12-07", undefined]);
  assert.ok(/data-date-choice="' \+ escapeHtml\(item\.id\) \+ '" data-choice="' \+ k \+ '">' \+ escapeHtml\(c\.label\)/.test(tl), "two buttons on the 待补 card");
});

check("yearless 4/25 and 12/25 without a trip year use the next occurrence on or after today; 4/12 asks with each option's own year", function () {
  const Imp = require("./import.js");
  const today = "2026-11-16";
  const a = Imp.parseImport("地点 | 示例园 | 1 Fake St | 4/25 |", { today });
  assert.deepStrictEqual(a.errors, []);
  assert.strictEqual(a.items[0].date, "2027-04-25");
  assert.ok(!a.items[0].pendingDate, "unambiguous yearless does not go to 待补");
  const b = Imp.parseImport("地点 | 示例街 | 2 Fake St | 12/25 10:00 |", { today });
  assert.strictEqual(b.items[0].date, "2026-12-25");
  assert.strictEqual(b.items[0].time, "10:00");
  assert.ok(!b.items[0].pendingDate);
  const c = Imp.parseImport("地点 | 示例馆 | 3 Fake St | 4/12 |", { today });
  const it = c.items[0];
  assert.strictEqual(it.pendingDate, true);
  assert.strictEqual(it.pendingKind, "date-ambiguous");
  assert.strictEqual(it.pendingReason, "是4月12日还是12月4日？");
  assert.deepStrictEqual(it.pendingChoices.map((x) => x.label), ["4月12日", "12月4日"]);
  assert.ok(it.pendingChoices[0].datetime.indexOf("2027-04-12") !== -1, "4月12日 → 2027");
  assert.ok(it.pendingChoices[1].datetime.indexOf("2026-12-04") !== -1, "12月4日 → 2026");
});

check("yearless dates use the trip's first dated year when the trip already has one", function () {
  const Imp = require("./import.js");
  const trip = [{ id: "h", type: "hotel", checkIn: "2026-12-03", checkOut: "2026-12-06" }];
  const r = Imp.parseImport("地点 | 示例园 | 1 Fake St | 4/25 |", { today: "2026-11-16", items: trip });
  assert.strictEqual(r.items[0].date, "2026-04-25", "trip year 2026, even if that date is already past");
  const c = Imp.parseImport("地点 | 示例馆 | 3 Fake St | 4/12 |", { today: "2026-11-16", items: trip });
  assert.strictEqual(c.items[0].pendingKind, "date-ambiguous");
  assert.ok(c.items[0].pendingChoices[0].datetime.indexOf("2026-04-12") !== -1);
  assert.ok(c.items[0].pendingChoices[1].datetime.indexOf("2026-12-04") !== -1);
});

console.log("\n" + passes + " passed, " + failures + " failed");
if (failures) process.exit(1);
console.log("All v6c checks passed.");
