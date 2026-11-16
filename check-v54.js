/**
 * v5.4：酒店日期面板规则、当天拖动排序、直线胶囊、当前定位导航、航班落地早于起飞。
 * 用法：node check-v54.js（假数据，不连网，不读定位）。
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const F = require("./fix-cand.js");
const L = require("./legs.js");
const G = require("./geo.js");
const ImportUtil = require("./import.js");
const ItemEdit = require("./item-edit.js");

const tl = fs.readFileSync(path.join(__dirname, "timeline.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const sw = fs.readFileSync(path.join(__dirname, "sw.js"), "utf8");
const V = require("./version.js");

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

check("version is v5.4 (or v6, which carries v5.4) and sw cache is v18", function () {
  /* v6 合并 v5.4：版本号往前走，v5.4 的行为都还在 */
  assert.ok(["v5.4", "v6", "v6.0"].indexOf(V.APP_VERSION) !== -1);
  assert.ok(sw.indexOf('"xingcheng-map-shell-v18"') !== -1);
  assert.ok(sw.indexOf("xingcheng-map-shell-v16") === -1);
});

check("hotel prefill: explicit day / first day / no dates blank / never today / invalid range", function () {
  assert.deepStrictEqual(F.hotelDates("2026-12-04", ["2026-12-02", "2026-12-08"], "2026-11-16"), {
    checkIn: "2026-12-04",
    checkOut: "2026-12-05"
  });
  assert.deepStrictEqual(F.hotelDates("", ["2026-12-08", "2026-12-02"], "2026-11-16"), {
    checkIn: "2026-12-02",
    checkOut: "2026-12-03"
  });
  assert.strictEqual(F.hotelDates("", [], "2026-11-16"), null, "empty trip: both blank, today ignored");
  assert.strictEqual(F.hotelDates("all", [], "2026-11-16"), null);
  const stBlank = F.hotelDateState("", "");
  assert.strictEqual(stBlank.ok, false);
  assert.strictEqual(stBlank.reason, "blank");
  assert.strictEqual(stBlank.hint, "先选入住和退房日期");
  const stBad = F.hotelDateState("2026-12-05", "2026-12-05");
  assert.strictEqual(stBad.ok, false);
  assert.strictEqual(stBad.reason, "invalid");
  assert.strictEqual(stBad.hint, "退房要晚于入住");
  const stBad2 = F.hotelDateState("2026-12-05", "2026-12-04");
  assert.strictEqual(stBad2.ok, false);
  const stOk = F.hotelDateState("2026-12-04", "2026-12-06");
  assert.strictEqual(stOk.ok, true);
  assert.strictEqual(stOk.nights, 2);
  assert.strictEqual(F.hotelNights("2026-12-04", "2026-12-05"), 1);
  assert.ok(html.indexOf("什么时候住？") !== -1 && tl.indexOf("openHotelDateSheet") !== -1);
  assert.ok(html.indexOf("hotel-date-sheet") !== -1 && html.indexOf("加进行程") !== -1);
  assert.ok(/afterHotelReady\(/.test(tl) && /openHotelDateSheet\(/.test(tl));
  assert.ok(/dayPickedByUser \? selectedDateOrEmpty\(\) : ""/.test(tl), "only an explicit tap counts as the selected day");
  assert.ok(!/function applyHotelDates[\s\S]{0,500}todayIso\(/.test(tl), "no todayIso fallback on the hotel-date path");
});

check("drag order persistence, flight lock, long-press, undo toast 5s", function () {
  const a = { id: "p1", type: "place", nameZh: "甲", date: "2026-12-04", time: "10:00", lat: 51.5, lng: -0.12 };
  const b = { id: "p2", type: "place", nameZh: "乙", date: "2026-12-04", time: "14:00", lat: 51.51, lng: -0.12 };
  const f = { id: "f1", type: "flight", flightNo: "BA1", departDate: "2026-12-04", departTime: "12:00", arriveDate: "2026-12-04", arriveTime: "13:00", fromAirport: "LHR", toAirport: "CDG" };
  const items = [a, b, f];
  L.applyDayOrder(items, "2026-12-04", ["p2", "f1", "p1"]);
  assert.strictEqual(a.dayOrder, 2);
  assert.strictEqual(b.dayOrder, 0);
  assert.strictEqual(f.dayOrder, 1);
  const sorted = L.sortedItems(items);
  assert.deepStrictEqual(sorted.map((x) => x.id), ["p2", "f1", "p1"]);
  assert.ok(/LONG_PRESS_MS = 400/.test(tl) && /LONG_PRESS_MOVE_PX = 10/.test(tl));
  assert.ok(tl.indexOf("有固定时间，不能拖") !== -1 && /flight-lock/.test(tl) && /flightLockSvg/.test(tl));
  assert.ok(!/drag-handle|6-dot|six-dot/.test(tl), "no drag handle");
  assert.ok(tl.indexOf("已换顺序") !== -1 && /showToast\("已换顺序"/.test(tl) && /,\s*5000\)/.test(tl));
  assert.ok(tl.indexOf("orderUndoSnapshot") !== -1);
  const moved = { id: "p2", type: "place", nameZh: "乙", date: "2026-12-04", time: "14:00" };
  const early = { id: "p1", type: "place", nameZh: "甲", date: "2026-12-04", time: "10:00" };
  /* p2 (14:00) moved before p1 (10:00) → time no longer fits, suggest a time before 10:00 */
  const sug = L.suggestTimeForMove([moved, early], "p2");
  assert.ok(sug, "suggests a time when order and clock disagree");
  assert.ok(/^\d{2}:\d{2}$/.test(sug));
  const okSug = L.suggestTimeForMove([early, moved], "p2");
  assert.strictEqual(okSug, null, "no prompt when times already fit");
  assert.ok(tl.indexOf("要把时间改成 ") !== -1 && tl.indexOf('okText: "改"') !== -1 && tl.indexOf('cancelText: "不改"') !== -1);
  assert.ok(css.indexOf("0 8px 24px rgba(0, 0, 0, 0.15)") !== -1 && css.indexOf("scale(1.02)") !== -1);
  assert.ok(/background: #0F9D8A/.test(css) && /drop-line/.test(css));
  assert.ok(tl.indexOf("长按卡片，拖动换顺序") !== -1 && tl.indexOf("wishlist-map-drag-tip-v1") !== -1);
});

check("pill text formatting, 300km cutoff, flight gap, missing coords, last-stop-to-hotel", function () {
  assert.strictEqual(L.formatStraightPill(0.85), "直线 850 米 · 路线 ›");
  assert.strictEqual(L.formatStraightPill(0.001), "直线 1 米 · 路线 ›");
  assert.strictEqual(L.formatStraightPill(1.2), "直线 1.2 公里 · 路线 ›");
  assert.strictEqual(L.formatStraightPill(1), "直线 1 公里 · 路线 ›");
  assert.strictEqual(L.formatStraightPill(300), "直线 300 公里 · 路线 ›");
  assert.strictEqual(L.formatStraightPill(300.1), null);
  assert.strictEqual(L.formatStraightPill(null), null);
  const london = { id: "a", type: "place", nameZh: "甲", date: "2026-12-04", lat: 51.51, lng: -0.12 };
  const near = { id: "b", type: "place", nameZh: "乙", date: "2026-12-04", lat: 51.512, lng: -0.121 };
  const paris = { id: "c", type: "place", nameZh: "巴黎", date: "2026-12-04", lat: 48.8566, lng: 2.3522 };
  const missing = { id: "d", type: "place", nameZh: "待补", date: "2026-12-04" };
  const flight = {
    id: "f1", type: "flight", flightNo: "BA1",
    departDate: "2026-12-04", departTime: "10:00", arriveDate: "2026-12-04", arriveTime: "12:00",
    fromAirport: "LHR", toAirport: "CDG", fromLat: 51.47, fromLng: -0.45, lat: 49.01, lng: 2.55
  };
  const nav = L.navPillSpec(london, near);
  assert.strictEqual(nav.show, true);
  assert.strictEqual(nav.kind, "nav");
  assert.ok(/^直线 \d+ 米 · 路线 ›$/.test(nav.label), nav.label);
  const far = L.navPillSpec(london, paris);
  assert.strictEqual(far.show, false);
  assert.strictEqual(far.reason, "far");
  assert.ok(far.km > 300);
  const gap1 = L.navPillSpec(london, flight);
  assert.strictEqual(gap1.show, false);
  assert.strictEqual(gap1.reason, "flight");
  const gap2 = L.navPillSpec(flight, near);
  assert.strictEqual(gap2.show, false);
  const fix = L.navPillSpec(london, missing);
  assert.strictEqual(fix.show, true);
  assert.strictEqual(fix.kind, "fix");
  assert.strictEqual(fix.label, "补位置 ›");
  assert.strictEqual(fix.fixId, "d");
  const first = L.firstOfDayPill(london);
  assert.ok(!first.show, "no pill before the first stop");
  const firstFix = L.firstOfDayPill(missing);
  assert.ok(!firstFix.show, "no fix pill before the first stop either");
  const dayStart = L.dayPills([london, near], "2026-12-04");
  assert.ok(dayStart.length >= 1, "between-stop pills still appear");
  assert.ok(dayStart.every(function (p) { return p.kind !== "here"; }), "dayPills has no first-stop here pill");
  assert.strictEqual(dayStart[0].kind, "nav", "first pill of the day is between the first two stops, not before the first stop");
  const hotel = {
    id: "h1", type: "hotel", nameZh: "当晚酒店",
    checkIn: "2026-12-04", checkOut: "2026-12-06",
    lat: 51.51, lng: -0.13, date: "2026-12-04"
  };
  /* hotel display date is check-in, so it appears in the day's list; trailing only if not already last */
  const trailSame = L.trailingHotelPill([london, near, hotel], [london, near, hotel], "2026-12-04");
  assert.ok(!trailSame.show, "no extra pill when the hotel is already last");
  const trail = L.trailingHotelPill([london, near], [london, near, hotel], "2026-12-04");
  assert.strictEqual(trail.show, true);
  assert.ok(/^回酒店 · 直线 /.test(trail.label) && / ›$/.test(trail.label), trail.label);
  const night2 = L.trailingHotelPill([london], [london, hotel], "2026-12-05");
  assert.strictEqual(night2.show, true, "stay night after check-in still gets a pill to that night's hotel");
  const checkout = L.nightHotel([hotel], "2026-12-06");
  assert.strictEqual(checkout, null, "check-out day is not a hotel night");
  const checkoutTrail = L.trailingHotelPill([london], [london, hotel], "2026-12-06");
  assert.ok(!checkoutTrail.show, "checkout day hides 回酒店");
  const noHotel = L.trailingHotelPill([london], [london], "2026-12-04");
  assert.ok(!noHotel.show, "no-hotel night hides 回酒店");
  assert.ok(/spec\.label \|\| "补位置 ›"/.test(tl), "fix pills use the computed label including 回酒店");
  assert.ok(/leg-pill/.test(css) && /height: 28px/.test(css) && /#6B7A8F/.test(css) && /#D9E2E0/.test(css));
});

check("nav URLs: card button omits origin (current location); between-stop pills include origin; no first-stop pill", function () {
  const dest = { name: "萨沃伊酒店", address: "Strand, London WC2R 0EZ", lat: 51.51015, lng: -0.12047 };
  const origin = { name: "大英博物馆", address: "Great Russell St", lat: 51.5194, lng: -0.127 };
  const fromHere = G.buildFlexibleNavLinks(null, dest, "公共交通");
  assert.ok(fromHere.google.indexOf("origin=") === -1, "Google has no origin → maps app uses current location");
  assert.ok(fromHere.google.indexOf("destination=") !== -1);
  assert.ok(!/(?:^|&)from=/.test(fromHere.amap.split("?")[1] || ""), "Amap has no from=");
  const between = G.buildFlexibleNavLinks(origin, dest, "公共交通");
  assert.ok(between.google.indexOf("origin=") !== -1, "between-stop Google includes origin");
  assert.ok(tl.indexOf("buildFlexibleNavLinks(null, dest") !== -1, "card go button starts from current location");
  assert.ok(tl.indexOf("legPillHtml(Legs.firstOfDayPill") === -1, "list render does not draw a pill before the first stop");
  assert.ok(tl.indexOf("从我的位置出发") === -1, "timeline copy does not mention the removed first-stop pill");
  assert.ok(tl.indexOf("geolocation") === -1, "never calls geolocation");
  assert.ok(/class="card-go-btn"/.test(tl) && /card-go-btn \{[^}]*background: #E8F5F2;/.test(css));
  assert.ok(tl.indexOf("function cardNavHtml") === -1, "old in-card 带我去 removed");
});

check("flight import: landing earlier than departure goes to 待补 with 对的 / 改日期", function () {
  const r = ImportUtil.parseImport("机票 | XX201 | HND - LAX | 2026-12-10 17:00 ~ 2026-12-09 10:30 |");
  const item = r.items[0];
  assert.strictEqual(item.pendingKind, "flight-reversed");
  assert.strictEqual(item.pendingDate, true);
  const kept = ItemEdit.acceptEarlyArrival(item);
  assert.ok(!kept.pendingDate && kept.arriveEarlyOk);
  assert.strictEqual(kept.departDate, "2026-12-10");
  assert.strictEqual(kept.arriveDate, "2026-12-09");
  assert.strictEqual(ItemEdit.rangeProblem(kept), "");
  assert.ok(tl.indexOf("落地比起飞早，日期对吗？") !== -1);
  assert.ok(/data-flight-ok/.test(tl) && /data-flight-edit/.test(tl));
  const same = ImportUtil.parseImport("机票 | BA300 | LHR - CDG | 2026-12-10 09:00 ~ 2026-12-10 11:00 |").items[0];
  assert.ok(!same.pendingDate);
});

check("help and announcement mention long-press drag, 带我去 button, and pills", function () {
  assert.ok(tl.indexOf("卡片右边的『带我去』，从你现在的位置出发；两站中间的『路线』，从上一站去下一站") !== -1);
  assert.ok(tl.indexOf("长按卡片，拖动换顺序") !== -1);
  const v54 = V.CHANGELOG.find((e) => e.version === "v5.4");
  if (V.APP_VERSION === "v5.4") {
    assert.deepStrictEqual(V.ANNOUNCEMENT.bullets, [
      "加酒店先选入住和退房日期，退房那天也会显示",
      "长按卡片就能拖动换顺序，拖错了可以撤销",
      "卡片右边的『带我去』，从你现在的位置出发",
      "两站中间的『路线』，从上一站去下一站"
    ]);
    assert.strictEqual(V.ANNOUNCEMENT.draft, false);
  }
  assert.deepStrictEqual(v54.lines, [
    "新增：长按卡片，在同一天里拖动换顺序，机票固定不动；拖完 5 秒内可以撤销",
    "新增：两站之间显示直线距离和『路线』，点一下从上一站导航到下一站；当天最后一站显示『回酒店』；缺位置的显示「补位置」",
    "新增：往返机票自动标「去程」「回程」；手动加机票可以点『再加一张返程』",
    "调整：加酒店要先选入住和退房日期，退房那天多一张「退房」卡；『带我去』挪到卡片右边，从你现在的位置出发",
    "调整：导入机票时，落地比起飞早的会先问一句；几处界面颜色和间距统一了"
  ]);
  const copy = V.ANNOUNCEMENT.bullets.join("\n") + "\n" + v54.lines.join("\n");
  assert.ok(copy.indexOf("从我的位置出发") === -1, "公告/更新说明 do not mention the removed first-stop pill");
});

check("style fixes: hotel-add 12px gap, old blues → teal except locate dot, ig-note 13px #6B7A8F 12px margins", function () {
  assert.ok(/#add-sheet\.is-hotel \.search-results \{ margin-top: 12px; \}/.test(css));
  assert.ok(/#add-sheet\.is-hotel #search-status:empty/.test(css));
  const blues = [];
  css.replace(/background:\s*(#[0-9A-Fa-f]{3,8})/g, function (_, c) { blues.push(c.toUpperCase()); return _; });
  const leftover = blues.filter((c) => c === "#4C8DFF" || c === "#3A78E6");
  assert.deepStrictEqual(leftover, ["#4C8DFF"], "only the locate dot stays #4C8DFF");
  assert.ok(/\.me-dot \{[^}]*background: #4C8DFF;/.test(css));
  assert.ok(/\.update-now \{[^}]*background: #0F9D8A;/.test(css));
  assert.ok(/\.changelog-now \{[^}]*background: #0F9D8A;/.test(css));
  assert.ok(/\.announce-ok:active \{ background: #0C8574; \}/.test(css));
  assert.ok(/\.ig-note \{ margin: 12px 0; font-size: 13px;[^}]*color: #6B7A8F;/.test(css));
  const ig = fs.readFileSync(path.join(__dirname, "install-guide.js"), "utf8");
  assert.ok(/function showItemsNote\(guide, hasItems\)/.test(ig));
  assert.ok(/note\.hidden = !withNote/.test(tl), "已有行程 hint only when trips exist");
  assert.ok(/\.card-go-btn \{[^}]*height: 28px;/.test(css) && /card-meta-row/.test(css) && /card-meta-row/.test(tl));
  assert.ok(tl.indexOf("<span>带我去</span>") !== -1 && /title="带我去"/.test(tl) && /aria-label="带我去"/.test(tl));
  assert.ok(/\.drag-tip \{[^}]*left: 50%/.test(css), "tip centered above the card, not on the nav button");
  assert.ok(!/\.drag-tip \{[^}]*right: 8px/.test(css));
  assert.ok(/\.hotel-date-summary \{[^}]*font-size: 13px;[^}]*color: #6B7A8F/.test(css));
  assert.ok(/hotel-date-time-box/.test(css) && /width: 140px/.test(css) && html.indexOf("退房时间") !== -1);
  assert.ok(/type="text" id="hotel-check-out-time"/.test(html) && html.indexOf("几点退房？") !== -1 && html.indexOf('type="time" id="hotel-check-out-time"') === -1);
  assert.ok(html.indexOf("按航班自动算") !== -1 && /\.hotel-date-time-auto \{[^}]*font-size: 12px;[^}]*color: #9AA6B2/.test(css));
  assert.ok(/\.card\.is-drag-clone \{[^}]*z-index: 1000;/.test(css) && /\.card\.is-drag-clone \{[^}]*opacity: 1;/.test(css) && /background: #fff/.test(css.slice(css.indexOf(".card.is-drag-clone"))));
  assert.ok(/\.card\.is-drag-source \{[^}]*display: none;/.test(css));
  assert.ok(/\.day-rail\.is-dragging \.conn-slot/.test(css));
});

check("checkout card: two views from one record, default time, lock, no 回酒店, no double-count", function () {
  const hotel = {
    id: "h1", type: "hotel", nameZh: "当晚酒店",
    checkIn: "2026-12-04", checkOut: "2026-12-06",
    lat: 51.51, lng: -0.13
  };
  const place = { id: "p1", type: "place", nameZh: "店", date: "2026-12-05", time: "14:00", lat: 51.512, lng: -0.12 };
  const raw = [hotel, place];
  const views = L.expandViewItems(raw);
  assert.strictEqual(raw.length, 2, "raw trip is still one hotel + one place");
  assert.strictEqual(views.filter((v) => L.sourceId(v) === "h1").length, 2, "two cards from one hotel");
  const cout = views.find((v) => v.viewRole === "checkout");
  assert.ok(cout && cout.id === "h1::checkout" && cout.sourceId === "h1");
  assert.strictEqual(L.itemDisplayDate(cout), "2026-12-06");
  assert.strictEqual(L.suggestedCheckoutTime([place], "2026-12-06").time, "12:00", "no flight -> 12:00");
  assert.strictEqual(L.suggestedCheckoutTime([place], "2026-12-06").autoFromFlight, false);
  const flight8 = { id: "f1", type: "flight", flightNo: "BA1", fromAirport: "LHR", toAirport: "CDG", departDate: "2026-12-06", departTime: "08:00" };
  const sug8 = L.suggestedCheckoutTime([flight8], "2026-12-06");
  assert.strictEqual(sug8.time, "05:00", "08:00 flight -> 05:00 (3h)");
  assert.strictEqual(sug8.autoFromFlight, true);
  const train8 = { id: "t1", type: "train", nameZh: "火车", date: "2026-12-06", time: "08:00" };
  const sugT = L.suggestedCheckoutTime([train8], "2026-12-06");
  assert.strictEqual(sugT.time, "07:00", "08:00 train -> 07:00 (1h)");
  assert.strictEqual(sugT.autoFromFlight, true);
  const boat8 = { id: "b1", type: "boat", nameZh: "船", date: "2026-12-06", time: "08:00" };
  const sugB = L.suggestedCheckoutTime([boat8], "2026-12-06");
  assert.strictEqual(sugB.time, "07:00", "08:00 boat -> 07:00 (1h)");
  assert.strictEqual(sugB.autoFromFlight, true);
  const flight16 = { id: "f16", type: "flight", flightNo: "BA2", fromAirport: "LHR", toAirport: "CDG", departDate: "2026-12-06", departTime: "16:00" };
  const sug16 = L.suggestedCheckoutTime([flight16], "2026-12-06");
  assert.strictEqual(sug16.time, "12:00", "16:00 flight computed 13:00 -> 12:00");
  assert.strictEqual(sug16.autoFromFlight, false);
  const flightEarly = { id: "f0", type: "flight", flightNo: "BA0", fromAirport: "LHR", toAirport: "CDG", departDate: "2026-12-06", departTime: "02:30" };
  const sug0 = L.suggestedCheckoutTime([flightEarly], "2026-12-06");
  assert.strictEqual(sug0.time, "", "departure before 03:00 -> empty, not 12:00");
  assert.strictEqual(sug0.autoFromFlight, false);
  const withFlight = L.expandViewItems([hotel, flight8]);
  const dayOut = L.sortedItems(withFlight).filter((it) => L.itemDisplayDate(it) === "2026-12-06");
  assert.deepStrictEqual(dayOut.map((it) => it.id), ["h1::checkout", "f1"], "05:00 checkout sorts before 08:00 flight");
  const withEarly = L.expandViewItems([hotel, flightEarly, place]);
  const dayEarly = L.sortedItems(withEarly).filter((it) => L.itemDisplayDate(it) === "2026-12-06");
  assert.strictEqual(dayEarly[0].id, "h1::checkout", "empty checkout time sorts at the start of the day");
  assert.strictEqual(dayEarly[0].displayTime, "");
  hotel.checkOutTime = "15:00";
  assert.strictEqual(L.checkoutTimeInfo(hotel, [flight8]).time, "15:00", "user-set checkOutTime always wins");
  delete hotel.checkOutTime;
  const viewsOut = L.expandViewItems([hotel, flight8]);
  const outCard = viewsOut.find((v) => v.viewRole === "checkout");
  const trailOut = L.trailingHotelPill([outCard, flight8], [hotel, flight8], "2026-12-06");
  assert.ok(!trailOut.show, "checkout card does not create a 回酒店 pill");
  assert.ok(tl.indexOf("入住和退房两张都删掉吗？") !== -1 && tl.indexOf('okText: "都删"') !== -1);
  assert.ok(/cardIsCheckout/.test(tl) && /有固定时间，不能拖/.test(tl), "checkout card uses the same lock as flights");
  assert.ok(/stay-tag/.test(tl) && /几点退房？/.test(tl) && / · 共 /.test(tl));
  assert.ok(/card-go-btn/.test(tl), "checkout card can still have 带我去");
});

check("round-trip pairing and 再加一张返程; documented 2-row import", function () {
  const out = { id: "a", type: "flight", flightNo: "BA123", fromAirport: "LHR", toAirport: "HND", departDate: "2026-12-01", departTime: "09:30" };
  const back = { id: "b", type: "flight", flightNo: "BA124", fromAirport: "HND", toAirport: "LHR", departDate: "2026-12-10", departTime: "11:00" };
  const other = { id: "c", type: "flight", flightNo: "BA200", fromAirport: "LHR", toAirport: "CDG", departDate: "2026-12-20", departTime: "08:00" };
  const pairs = L.pairRoundTrips([out, back]);
  assert.strictEqual(pairs.a.role, "out");
  assert.strictEqual(pairs.a.label, "去程");
  assert.strictEqual(pairs.a.otherDate, "2026-12-10");
  assert.strictEqual(pairs.b.role, "back");
  assert.strictEqual(pairs.b.otherDate, "2026-12-01");
  assert.deepStrictEqual(L.pairRoundTrips([out, other]), {}, "unrelated flights do not pair");
  const mid = { id: "d", type: "flight", flightNo: "NH1", fromAirport: "HND", toAirport: "NRT", departDate: "2026-12-05", departTime: "10:00" };
  const three = L.pairRoundTrips([out, mid, back]);
  assert.strictEqual(three.a.otherId, "b");
  assert.strictEqual(three.b.otherId, "a");
  assert.ok(!three.d, "middle leg stays unpaired");
  const sameOut = { id: "s1", type: "flight", flightNo: "BA7", fromAirport: "LHR", toAirport: "EDI", departDate: "2026-12-04", departTime: "07:00" };
  const sameBack = { id: "s2", type: "flight", flightNo: "BA8", fromAirport: "EDI", toAirport: "LHR", departDate: "2026-12-04", departTime: "20:00" };
  const sameDay = L.pairRoundTrips([sameOut, sameBack]);
  assert.strictEqual(sameDay.s1.label, "去程", "same-day later return still pairs");
  assert.strictEqual(sameDay.s2.label, "返程");
  assert.strictEqual(sameDay.s1.otherId, "s2");
  const ret = L.buildReturnFlight(out);
  assert.strictEqual(ret.fromAirport, "HND");
  assert.strictEqual(ret.toAirport, "LHR");
  assert.strictEqual(ret.flightNo || "", "");
  assert.strictEqual(ret.departDate || "", "");
  assert.ok(tl.indexOf("function openReturnFlightForm") !== -1);
  assert.ok(html.indexOf("再加一张返程") !== -1);
  const ai = fs.readFileSync(path.join(__dirname, "ai-prompt.js"), "utf8");
  const guide = fs.readFileSync(path.join(__dirname, "导入格式说明.txt"), "utf8");
  assert.ok(ai.indexOf("往返机票必须拆成两行") !== -1);
  assert.ok(guide.indexOf("往返必须拆成两行") !== -1);
  const parsed = ImportUtil.parseImport(
    "机票 | BA123 | LHR - HND | 2026-12-01 09:30 ~ 2026-12-02 07:00 |\n" +
    "机票 | BA124 | HND - LHR | 2026-12-10 11:00 ~ 2026-12-10 15:00 |"
  );
  const flights = parsed.items.filter((it) => it.type === "flight");
  assert.strictEqual(flights.length, 2, "round trip imports as two flights");
  assert.strictEqual(flights[0].fromAirport, "LHR");
  assert.strictEqual(flights[0].toAirport, "HND");
  assert.strictEqual(flights[0].departDate, "2026-12-01");
  assert.strictEqual(flights[1].fromAirport, "HND");
  assert.strictEqual(flights[1].toAirport, "LHR");
  assert.strictEqual(flights[1].departDate, "2026-12-10");
});

if (failures) {
  console.log("\n" + failures + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll v5.4 checks passed.");
