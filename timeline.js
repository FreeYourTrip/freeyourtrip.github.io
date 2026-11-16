/**
 * 行程列表 / 地图 / 添加与导航。默认空行程，不强制载入示例。
 * 连接规则见 legs.js；图标见 icons.js（线性 SVG，不用系统 emoji）。
 */
(function () {
  "use strict";

  var TRIP_STORE = "wishlist-map-trips-v1";
  var LEG_STORAGE_KEY = "wishlist-map-legs-v1";
  var trips = [];
  var activeTripId = null;
  var examplesLoaded = false;
  var demoMode = false;
  var tripMap = null;
  var mapTiles = "osm"; // 现在只用 OpenStreetMap（WGS-84）；以后换高德底图时改成 "gcj02"，定位点会自动转换
  var tripMarkers = [];
  var expanded = {};
  var pendingPick = null;
  var selectedDay = "all";
  var currentView = "list";
  var listEventsBound = false;

  function $(id) {
    return document.getElementById(id);
  }

  function ico(name, cls) {
    return window.Icons && Icons.html ? Icons.html(name, cls) : "";
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function maskSecret(s) {
    s = String(s == null ? "" : s);
    if (s.length <= 4) return "****";
    return s.slice(0, 2) + "****" + s.slice(-2);
  }

  function secretToggleHtml(value) {
    if (!value) return "";
    return (
      '<button type="button" class="secret-toggle" data-secret="' +
      escapeHtml(value) +
      '" aria-label="点击显示或隐藏确认号">' +
      escapeHtml(maskSecret(value)) +
      "</button>"
    );
  }

  function bindSecretToggles(root) {
    if (!root || root.getAttribute("data-secret-bound") === "1") return;
    root.setAttribute("data-secret-bound", "1");
    root.addEventListener("click", function (ev) {
      var btn = ev.target.closest ? ev.target.closest(".secret-toggle") : null;
      if (!btn || !root.contains(btn)) return;
      ev.preventDefault();
      ev.stopPropagation();
      var raw = btn.getAttribute("data-secret") || "";
      if (btn.getAttribute("data-open") === "1") {
        btn.textContent = maskSecret(raw);
        btn.removeAttribute("data-open");
      } else {
        btn.textContent = raw;
        btn.setAttribute("data-open", "1");
      }
    });
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function parseCivilDate(isoDate) {
    if (!isoDate || typeof isoDate !== "string") return null;
    var parts = isoDate.split("-");
    if (parts.length !== 3) return null;
    var y = Number(parts[0]);
    var m = Number(parts[1]);
    var d = Number(parts[2]);
    if (!y || !m || !d) return null;
    return { y: y, m: m, d: d };
  }

  function civilDayOffset(fromDate, toDate) {
    var a = parseCivilDate(fromDate);
    var b = parseCivilDate(toDate);
    if (!a || !b) return 0;
    return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
  }

  function formatDayOffset(n) {
    if (!n) return "";
    return n > 0 ? "+" + n : String(n);
  }

  function formatMd(iso) {
    var p = parseCivilDate(iso);
    if (!p) return iso || "";
    return p.m + "月" + p.d + "日";
  }

  function formatChipDate(iso) {
    var p = parseCivilDate(iso);
    if (!p) return iso || "";
    return p.m + "/" + p.d;
  }

  var todayOverride = "";

  function todayIso() {
    if (todayOverride) return todayOverride;
    var n = new Date();
    return n.getFullYear() + "-" + pad2(n.getMonth() + 1) + "-" + pad2(n.getDate());
  }

  function formatFlightLocal(item) {
    var offset = formatDayOffset(civilDayOffset(item.departDate, item.arriveDate));
    var no = item.flightNo ? item.flightNo + " " : "";
    return no + item.departTime + " " + item.fromAirport + " → " + item.arriveTime + offset + " " + item.toAirport;
  }

  function emptyTrip() {
    return { id: "my-trip", nameZh: "我的行程", nameEn: "", items: [], legs: [], imported: true };
  }

  function currentTrip() {
    var i;
    for (i = 0; i < trips.length; i++) {
      if (trips[i].id === activeTripId) return trips[i];
    }
    return trips[0] || emptyTrip();
  }

  function loadAllTrips() {
    try {
      var raw = localStorage.getItem(TRIP_STORE);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.trips)) return parsed;
      }
    } catch (err) {}
    try {
      var old = localStorage.getItem("wishlist-map-imported-trips-v1");
      if (old) {
        var list = JSON.parse(old);
        if (Array.isArray(list) && list.length) {
          return { trips: list, activeTripId: list[0].id, examplesLoaded: false };
        }
      }
    } catch (err) {}
    return null;
  }

  function saveAllTrips() {
    if (demoMode) return;
    try {
      localStorage.setItem(
        TRIP_STORE,
        JSON.stringify({ trips: trips, activeTripId: activeTripId, examplesLoaded: examplesLoaded })
      );
    } catch (err) {}
  }

  function uniqueItemIds(existing, incoming) {
    var used = {};
    (existing || []).forEach(function (it) {
      if (it.id) used[it.id] = true;
    });
    return (incoming || []).map(function (it) {
      var copy = Object.assign({}, it);
      var base = copy.id || "item";
      var id = base;
      var n = 1;
      while (used[id]) {
        n += 1;
        id = base + "-" + n;
      }
      used[id] = true;
      copy.id = id;
      return copy;
    });
  }

  function demoTrip() {
    return {
      id: "demo-trip",
      nameZh: "我的行程",
      example: true,
      items: [
        {
          id: "demo-savoy",
          type: "hotel",
          nameZh: "萨沃伊酒店",
          nameEn: "The Savoy",
          address: "Strand, London WC2R 0EZ",
          checkIn: "2026-12-04",
          checkInTime: "09:00",
          checkOut: "2026-12-05",
          confirmationNo: "SAV-EXAMPLE-001",
          lat: 51.51015,
          lng: -0.12047,
          example: true
        },
        {
          id: "demo-dishoom",
          type: "place",
          subtype: "餐厅",
          nameZh: "Dishoom Covent Garden",
          address: "12 Upper St Martin's Ln, London WC2H 9FB",
          date: "2026-12-04",
          time: "12:00",
          note: "印度早餐，建议早去排队",
          lat: 51.5116,
          lng: -0.1268,
          example: true
        },
        {
          id: "demo-museum",
          type: "place",
          subtype: "景点",
          nameZh: "大英博物馆",
          address: "Great Russell St, London WC1B 3DG",
          date: "2026-12-04",
          time: "14:30",
          note: "免费，建议预约",
          lat: 51.5194,
          lng: -0.127,
          example: true
        },
        {
          id: "demo-oxford",
          type: "place",
          subtype: "街道",
          nameZh: "牛津街",
          address: "Oxford Street, London",
          date: "2026-12-04",
          time: "16:30",
          lat: 51.5152,
          lng: -0.1419,
          example: true
        },
        {
          id: "demo-ba300",
          type: "flight",
          flightNo: "BA300",
          fromAirport: "LHR",
          toAirport: "CDG",
          fromNameZh: "希思罗机场",
          nameZh: "戴高乐机场",
          fromLat: 51.47002,
          fromLng: -0.454295,
          lat: 49.0097,
          lng: 2.5479,
          departDate: "2026-12-05",
          departTime: "10:00",
          arriveDate: "2026-12-05",
          arriveTime: "12:00",
          confirmationNo: "EXG1BA",
          seat: "14A",
          example: true
        },
        {
          id: "demo-az332",
          type: "flight",
          flightNo: "AZ332",
          fromAirport: "CDG",
          toAirport: "FCO",
          fromNameZh: "戴高乐机场",
          nameZh: "菲乌米奇诺机场",
          fromLat: 49.0097,
          fromLng: 2.5479,
          lat: 41.800278,
          lng: 12.238889,
          departDate: "2026-12-05",
          departTime: "14:30",
          arriveDate: "2026-12-05",
          arriveTime: "16:30",
          example: true
        }
      ]
    };
  }

  /* 日期条演示用的假行程（?demo=japan），只含公开景点，不含真实个人信息。 */
  function demoJapanTrip() {
    function place(id, sub, name, date, time, lat, lng) {
      return { id: id, type: "place", subtype: sub, nameZh: name, address: name, date: date, time: time, lat: lat, lng: lng, example: true };
    }
    return {
      id: "demo-japan",
      nameZh: "日本示例行程",
      example: true,
      items: [
        { id: "j-f1", type: "flight", flightNo: "XX101", fromAirport: "LHR", toAirport: "HND", fromNameZh: "希思罗机场", nameZh: "羽田机场",
          fromLat: 51.47, fromLng: -0.4543, lat: 35.5494, lng: 139.7798, departDate: "2026-11-09", departTime: "19:00", arriveDate: "2026-11-10", arriveTime: "16:00", example: true },
        { id: "j-h1", type: "hotel", nameZh: "东京示例酒店", city: "东京", address: "Shinjuku, Tokyo", checkIn: "2026-11-10", checkInTime: "18:00", checkOut: "2026-11-14", lat: 35.6938, lng: 139.7034, example: true },
        place("j-p1", "景点", "浅草寺", "2026-11-11", "10:00", 35.7148, 139.7967),
        place("j-p2", "餐厅", "筑地场外市场", "2026-11-12", "09:00", 35.6655, 139.7707),
        { id: "j-h2", type: "hotel", nameZh: "京都示例旅馆", city: "京都", address: "Higashiyama, Kyoto", checkIn: "2026-11-14", checkInTime: "16:00", checkOut: "2026-11-17", lat: 34.9961, lng: 135.7786, example: true },
        place("j-p3", "景点", "伏见稻荷大社", "2026-11-15", "09:00", 34.9671, 135.7727),
        place("j-p4", "景点", "清水寺", "2026-11-16", "10:00", 34.9949, 135.785),
        place("j-p5", "街道", "花见小路", "2026-11-16", "17:00", 35.0025, 135.7751),
        { id: "j-h4", type: "hotel", nameZh: "奈良示例民宿", city: "奈良", address: "Nara", checkIn: "2026-11-17", checkInTime: "16:00", checkOut: "2026-11-18", lat: 34.6851, lng: 135.8048, example: true },
        place("j-p7", "景点", "奈良公园", "2026-11-17", "11:00", 34.685, 135.843),
        { id: "j-h3", type: "hotel", nameZh: "大阪示例酒店", city: "大阪难波心斋桥一带", address: "Namba, Osaka", checkIn: "2026-11-18", checkInTime: "15:00", checkOut: "2026-11-20", lat: 34.6659, lng: 135.5013, example: true },
        place("j-p6", "餐厅", "道顿堀", "2026-11-19", "19:00", 34.6687, 135.5013),
        { id: "j-f2", type: "flight", flightNo: "XX102", fromAirport: "KIX", toAirport: "LHR", fromNameZh: "关西机场", nameZh: "希思罗机场",
          fromLat: 34.4347, fromLng: 135.244, lat: 51.47, lng: -0.4543, departDate: "2026-11-20", departTime: "11:00", arriveDate: "2026-11-20", arriveTime: "16:00", example: true }
      ]
    };
  }

  function itemTimeLabel(item) {
    if (item.type === "flight") {
      var offset = formatDayOffset(civilDayOffset(item.departDate, item.arriveDate));
      return (item.departTime || "") + " – " + (item.arriveTime || "") + offset;
    }
    if (item.type === "hotel") return item.checkInTime || "入住";
    return item.time || "";
  }

  function itemTitle(item) {
    if (item.type === "flight") return item.flightNo || "航班";
    return item.nameZh || item.nameEn || "未命名";
  }

  function cardTarget(item) {
    if (window.Legs && item.type === "flight") return Legs.endpointFor(item, "dest");
    return {
      id: item.id,
      name: item.nameZh || item.nameEn || "",
      address: item.address || "",
      lat: item.lat,
      lng: item.lng
    };
  }

  function itemUnlocated(item) {
    if (item.type === "flight") {
      return typeof item.fromLat !== "number" && typeof item.lat !== "number";
    }
    return typeof item.lat !== "number" || typeof item.lng !== "number";
  }

  function typeStyle(item) {
    return window.Icons && Icons.typeMeta ? Icons.typeMeta(item) : { icon: "place", color: "#27AE60", tint: "#E3F7EA", label: "地点" };
  }

  function transitHref(origin, dest) {
    if (!window.GeoUtil || !dest) return "#";
    var links = GeoUtil.buildFlexibleNavLinks(origin, dest, "公共交通");
    return links.href || links.google || "#";
  }

  function tripDays(items) {
    var seen = {};
    var days = [];
    (window.Legs ? Legs.sortedItems(items) : items || []).forEach(function (it) {
      var key = (window.Legs && Legs.itemDisplayDate(it)) || "";
      if (!key || seen[key]) return;
      seen[key] = true;
      days.push(key);
    });
    return days;
  }

  function tripDateRangeText(items) {
    var days = tripDays(items);
    if (!days.length) return "";
    if (days.length === 1) return formatMd(days[0]);
    return formatMd(days[0]) + " – " + formatMd(days[days.length - 1]);
  }

  function defaultSelectedDay(items) {
    if (window.TripCalendar) return TripCalendar.defaultDay(items, todayIso());
    var days = tripDays(items);
    var today = todayIso();
    if (days.indexOf(today) !== -1) return today;
    return "all";
  }

  /* ---------- 顶部日期条（规则见 calendar.js） ---------- */
  var CAL_CELL = 52;
  var SEG_LABEL_MIN = 72;
  var SEG_GAP_PX = 4; // .seg-range 的 margin-left 0.3em ≈ 3.3px，向上取整
  var segCtx = null;

  /** 住宿段文字里地名之后的部分，以「·」开头，前面不带空格（空隙由 .seg-range 的 margin 给）。 */
  function segRest(sg) {
    return sg.label.slice(sg.city.length).replace(/^\s+/, "");
  }

  /** 量 11px 600 文字宽度（与 .cal-seg-text 一致）；量不了就按 CJK 11px、其他 6.5px 估算。 */
  function measureSegText(text) {
    try {
      if (!segCtx) {
        var cv = document.createElement("canvas");
        segCtx = cv.getContext && cv.getContext("2d");
        if (segCtx) segCtx.font = "600 11px " + getComputedStyle(document.body).fontFamily;
      }
      if (segCtx) return Math.ceil(segCtx.measureText(String(text)).width);
    } catch (err) {}
    var w = 0;
    String(text).split("").forEach(function (ch) { w += /[\u2E80-\uFFFF]/.test(ch) ? 11 : 6.5; });
    return Math.ceil(w);
  } // 住宿段文字最小宽度；放不下就只显示 4px 横条，点它弹出完整名称
  var monthView = null;

  function reducedMotion() {
    try {
      return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (err) {
      return false;
    }
  }

  function dotHtml(entry, size) {
    var meta = typeStyle(entry.item);
    return '<i class="cal-dot" style="background:' + (meta.color || "#27AE60") + '"></i>';
  }

  function renderStrip(items) {
    var box = $("day-chips");
    if (!box) return;
    var C = window.TripCalendar;
    var today = todayIso();
    var days = C.stripDays(items, today);
    if (!days.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    box.classList.add("cal");
    var dots = C.dotsByDay(items);
    var segs = C.deriveSegments(items, today);
    var col = {};
    days.forEach(function (d, i) { col[d] = i + 2; });
    var monthIso = selectedDay !== "all" && col[selectedDay] ? selectedDay : (col[today] ? today : days[0]);
    var hasToday = !!col[today];
    var segHtml = segs.map(function (sg, i) {
      var start = col[sg.start];
      if (!start) return "";
      var endDay = sg.end;
      var next = segs[i + 1];
      if (next && next.start <= endDay && next.start > sg.start) endDay = C.addDays(next.start, -1);
      var end = col[endDay] || start;
      var span = Math.max(1, end - start + 1);
      var room = (next && col[next.start] ? col[next.start] : days.length + 2) - start;
      var textW = Math.max(span, room) * CAL_CELL - 8;
      return (
        '<div class="cal-seg' + (sg.past ? " is-past" : "") + (textW < SEG_LABEL_MIN ? " is-bar-only" : "") + '" style="grid-column:' + start + " / span " + span +
        '" title="' + escapeHtml(sg.label) + '" data-seg-label="' + escapeHtml(sg.label) + '" role="button" tabindex="0" aria-label="' + escapeHtml(sg.label) + '">' +
        '<span class="cal-seg-bar"></span>' +
        (textW < SEG_LABEL_MIN
          ? ""
          : '<span class="cal-seg-text" style="max-width:' + textW + 'px"><span class="seg-city">' +
            escapeHtml(C.fitCity(sg.city, segRest(sg), textW, measureSegText, SEG_GAP_PX)) +
            '</span><span class="seg-range">' + escapeHtml(segRest(sg)) + "</span></span>") +
        "</div>"
      );
    }).join("");
    var cells =
      '<button type="button" class="cal-cell cal-all' + (selectedDay === "all" ? " is-active" : "") + '" data-day="all" role="tab" aria-selected="' + (selectedDay === "all") + '" style="grid-column:1"><span class="cal-date">全部</span><span class="cal-wd">' + C.daysWithItems(items).length + ' 天</span></button>' +
      days.map(function (d) {
        var cls = "cal-cell";
        if (C.isPast(d, today)) cls += " is-past";
        if (d === today) cls += " is-today";
        if (d === selectedDay) cls += " is-active";
        var ds = (dots[d] || []).map(function (e) { return dotHtml(e); }).join("");
        return (
          '<button type="button" class="' + cls + '" data-day="' + d + '" role="tab" aria-selected="' + (d === selectedDay) + '" aria-label="' +
          escapeHtml(formatMd(d) + " " + C.weekday(d) + (d === today ? " 今天" : "") + (ds ? " 有安排" : "")) + '" style="grid-column:' + col[d] + '">' +
          '<span class="cal-date">' + C.shortDate(d) + "</span>" +
          '<span class="cal-wd">' + C.weekday(d) + "</span>" +
          '<span class="cal-dots">' + ds + "</span></button>"
        );
      }).join("");
    box.innerHTML =
      '<div class="cal-top"><button type="button" class="cal-month" id="cal-month" aria-haspopup="dialog">' +
      escapeHtml(C.monthLabel(monthIso)) + ico("chevron", "ico-sm") + "</button></div>" +
      '<div class="cal-row"><div class="cal-scroll" id="cal-scroll"><div class="cal-grid' + (segHtml ? " has-segs" : "") + '" style="grid-template-columns:repeat(' + (days.length + 1) + "," + CAL_CELL + 'px)">' +
      segHtml + cells + "</div></div>" +
      (hasToday ? '<button type="button" class="cal-today" id="cal-today">今天</button>' : "") +
      "</div>";
    scrollStripTo(selectedDay === "all" ? null : selectedDay, false);
  }

  function scrollStripTo(iso, smooth) {
    var sc = $("cal-scroll");
    if (!sc) return;
    var cell = iso ? sc.querySelector('[data-day="' + iso + '"]') : sc.querySelector(".cal-all");
    if (!cell) return;
    var target = cell.offsetLeft - (sc.clientWidth - cell.offsetWidth) / 2;
    var left = Math.max(0, target);
    if (smooth && !reducedMotion() && sc.scrollTo) sc.scrollTo({ left: left, behavior: "smooth" });
    else sc.scrollLeft = left;
  }

  function selectDay(iso) {
    selectedDay = iso || "all";
    renderAll();
    scrollStripTo(selectedDay === "all" ? null : selectedDay, true);
    if (currentView === "list") {
      var el = selectedDay === "all" ? $("timeline") : document.getElementById("day-" + selectedDay);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: "start" });
    }
  }

  function openMonth() {
    var items = currentTrip().items || [];
    var C = window.TripCalendar;
    var today = todayIso();
    var days = C.stripDays(items, today);
    var base = selectedDay !== "all" ? selectedDay : (days.indexOf(today) !== -1 ? today : days[0]);
    if (!base) return;
    monthView = { year: +base.slice(0, 4), month: +base.slice(5, 7) };
    renderMonth();
    openSheet("month-sheet");
  }

  function renderMonth() {
    if (!monthView) return;
    var C = window.TripCalendar;
    var items = currentTrip().items || [];
    var today = todayIso();
    var days = C.stripDays(items, today);
    var dots = C.dotsByDay(items);
    var g = C.monthGrid(monthView.year, monthView.month);
    $("month-title").textContent = g.label;
    var html = '<div class="mg-head">' + ["一", "二", "三", "四", "五", "六", "日"].map(function (w) { return "<span>" + w + "</span>"; }).join("") + "</div>";
    html += '<div class="mg-grid">';
    g.weeks.forEach(function (row) {
      row.forEach(function (c) {
        var ok = days.indexOf(c.iso) !== -1;
        var cls = "mg-cell";
        if (!c.inMonth) cls += " is-out";
        if (C.isPast(c.iso, today)) cls += " is-past";
        if (c.iso === today) cls += " is-today";
        if (c.iso === selectedDay) cls += " is-active";
        var ds = (dots[c.iso] || []).map(function (e) { return dotHtml(e); }).join("");
        html +=
          '<button type="button" class="' + cls + '" data-pick-day="' + c.iso + '"' + (ok ? "" : " disabled") +
          ' aria-label="' + escapeHtml(formatMd(c.iso) + " " + C.weekday(c.iso)) + '"><span class="mg-num">' + c.day + '</span><span class="cal-dots">' + ds + "</span></button>";
      });
    });
    html += "</div>";
    html += '<p class="mg-note">只有行程里的日子可以点；有圆点的是有安排的日子。</p>';
    $("month-body").innerHTML = html;
  }

  function bindStrip() {
    var box = $("day-chips");
    if (box) {
      box.addEventListener("click", function (ev) {
        if (ev.target.closest && ev.target.closest("#cal-month")) {
          openMonth();
          return;
        }
        if (ev.target.closest && ev.target.closest("#cal-today")) {
          var today = todayIso();
          selectDay(today);
          return;
        }
        var seg = ev.target.closest && ev.target.closest("[data-seg-label]");
        if (seg) {
          showToast(seg.getAttribute("data-seg-label"), null, 3000);
          return;
        }
        var cell = ev.target.closest && ev.target.closest("[data-day]");
        if (cell) selectDay(cell.getAttribute("data-day"));
      });
      box.addEventListener("keydown", function (ev) {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        var seg = ev.target.closest && ev.target.closest("[data-seg-label]");
        if (!seg) return;
        ev.preventDefault();
        showToast(seg.getAttribute("data-seg-label"), null, 3000);
      });
    }
    var body = $("month-body");
    if (body) {
      body.addEventListener("click", function (ev) {
        var b = ev.target.closest && ev.target.closest("[data-pick-day]");
        if (!b || b.disabled) return;
        var C = window.TripCalendar;
        var picked = C.pickFromGrid(b.getAttribute("data-pick-day"), C.stripDays(currentTrip().items || [], todayIso()));
        if (!picked) return;
        closeSheet("month-sheet");
        selectDay(picked);
      });
    }
    if ($("month-prev")) $("month-prev").addEventListener("click", function () {
      var m = TripCalendar.shiftMonth(monthView.year, monthView.month, -1);
      monthView = m;
      renderMonth();
    });
    if ($("month-next")) $("month-next").addEventListener("click", function () {
      var m = TripCalendar.shiftMonth(monthView.year, monthView.month, 1);
      monthView = m;
      renderMonth();
    });
  }

  function updateTopBar() {
    var trip = currentTrip();
    var nameBtn = $("trip-name-btn");
    var dates = $("trip-dates");
    var name = (trip && trip.nameZh) || "我的行程";
    if (nameBtn && nameBtn.hidden === false) nameBtn.textContent = name;
    if (nameBtn && nameBtn.hidden) {
      /* input is showing */
    }
    var range = tripDateRangeText((trip && trip.items) || []);
    if (dates) {
      if (range) {
        dates.hidden = false;
        dates.textContent = range;
      } else {
        dates.hidden = true;
        dates.textContent = "";
      }
    }
    if (window.TripCalendar) {
      renderStrip((trip && trip.items) || []);
      return;
    }
    var chips = $("day-chips");
    var days = tripDays((trip && trip.items) || []);
    if (!chips) return;
    if (!days.length) {
      chips.hidden = true;
      chips.innerHTML = "";
      return;
    }
    chips.hidden = false;
    var today = todayIso();
    var html = '<button type="button" class="day-chip' + (selectedDay === "all" ? " is-active" : "") + '" data-day="all" role="tab" aria-selected="' + (selectedDay === "all" ? "true" : "false") + '">全部</button>';
    days.forEach(function (iso, i) {
      var isToday = iso === today;
      var active = selectedDay === iso;
      html +=
        '<button type="button" class="day-chip' +
        (active ? " is-active" : "") +
        '" data-day="' +
        escapeHtml(iso) +
        '" role="tab" aria-selected="' +
        (active ? "true" : "false") +
        '">第' +
        (i + 1) +
        "天 " +
        formatChipDate(iso) +
        (isToday ? '<span class="today-tag">今天</span>' : "") +
        "</button>";
    });
    chips.innerHTML = html;
  }

  function navPillHtml(href, label) {
    return (
      '<div class="conn-slot">' +
      '<span class="dash-seg" aria-hidden="true"></span>' +
      '<a class="nav-pill" href="' +
      escapeHtml(href) +
      '" target="_blank" rel="noopener">' +
      ico("bus", "ico-sm") +
      "<span>" +
      escapeHtml(label) +
      "</span></a>" +
      '<span class="dash-seg" aria-hidden="true"></span>' +
      "</div>"
    );
  }

  function transferHtml(label) {
    return (
      '<div class="conn-slot">' +
      '<span class="dash-seg" aria-hidden="true"></span>' +
      '<div class="transfer-bar" aria-label="' +
      escapeHtml(label) +
      '">' +
      ico("transfer") +
      "<span>" +
      escapeHtml(label) +
      "</span></div>" +
      '<span class="dash-seg" aria-hidden="true"></span>' +
      "</div>"
    );
  }

  function mmdd(iso) {
    var m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso || "");
    return m ? m[1] + "/" + m[2] : String(iso || "");
  }

  /** 黄色「待确认」卡片上的一句话，写给不懂技术的人看。 */
  function pendingText(item) {
    if (item.pendingKind === "hotel-reversed") {
      return "退房比入住还早：" + mmdd(item.pendingFrom) + " ~ " + mmdd(item.pendingTo) + "，点我改一下";
    }
    if (item.pendingKind === "flight-reversed") return "到达比出发早太多，点我改一下";
    return item.dateRaw ? "这个时间看不懂：" + item.dateRaw + "，点我改一下" : "没写日期，点我改一下";
  }

  function isPendingItem(item) {
    return !!(item && item.pendingDate);
  }

  function cardHtml(item) {
    var meta = typeStyle(item);
    var pendingLine = isPendingItem(item)
      ? '<p class="card-raw">' + escapeHtml(pendingText(item)).replace(/(\d{2}\/\d{2} ~ \d{2}\/\d{2})/, '<span class="nowrap">$1</span>') + "</p>"
      : "";
    var open = expanded[item.id] ? " is-open" : "";
    var extra = [];
    if (item.address) extra.push("<p>" + escapeHtml(item.address) + "</p>");
    if (item.note) extra.push("<p>" + escapeHtml(item.note) + "</p>");
    if (item.confirmationNo) extra.push("<p>确认号 " + secretToggleHtml(item.confirmationNo) + "</p>");
    if (item.seat) extra.push("<p>座位 " + escapeHtml(item.seat) + "</p>");
    if (item.checkIn && item.checkOut) {
      extra.push("<p>入住 " + escapeHtml(item.checkIn) + "，退房 " + escapeHtml(item.checkOut) + "</p>");
    }
    if (item.type === "flight") extra.push("<p>" + escapeHtml(formatFlightLocal(item)) + "</p>");
    var href = transitHref(null, cardTarget(item));
    extra.push(
      '<p><a class="here-link" href="' +
        escapeHtml(href) +
        '" target="_blank" rel="noopener">从我的位置导航</a></p>'
    );
    if (itemUnlocated(item)) {
      extra.push(
        '<button type="button" class="pick-location" data-pick="' + escapeHtml(item.id) + '">选一下位置</button>'
      );
    }
    return (
      '<article class="card' +
      open +
      (pendingLine ? " is-pending" : "") +
      '" data-item="' +
      escapeHtml(item.id) +
      '" style="--type:' +
      (meta.color || "#27AE60") +
      ";--type-tint:" +
      (meta.tint || "#E3F7EA") +
      '">' +
      '<div class="card-stripe" aria-hidden="true"></div>' +
      '<div class="card-main">' +
      '<div class="card-top">' +
      '<div class="type-badge" title="' +
      escapeHtml(meta.label) +
      '">' +
      ico(meta.icon) +
      "</div>" +
      "<div>" +
      '<h3 class="card-name">' +
      escapeHtml(itemTitle(item)) +
      "</h3>" +
      (pendingLine ? "" : itemTimeLabel(item) ? '<p class="card-time">' + escapeHtml(itemTimeLabel(item)) + "</p>" : "") +
      pendingLine +
      "</div>" +
      '<button type="button" class="expand-btn" data-expand="' +
      escapeHtml(item.id) +
      '" aria-expanded="' +
      (expanded[item.id] ? "true" : "false") +
      '" aria-label="展开详情">' +
      ico("chevron") +
      "</button>" +
      "</div>" +
      '<div class="card-extra">' +
      extra.join("") +
      "</div>" +
      "</div>" +
      '<button type="button" class="card-del" data-delete="' +
      escapeHtml(item.id) +
      '" aria-label="删除 ' +
      escapeHtml(itemTitle(item)) +
      '">' +
      ico("trash") +
      "<span>删除</span></button>" +
      "</article>"
    );
  }

  function findConnector(connectors, fromId, toId) {
    var i;
    for (i = 0; i < connectors.length; i++) {
      if (connectors[i].fromItemId === fromId && connectors[i].toItemId === toId) return connectors[i];
    }
    return null;
  }

  function connectorSlot(conn) {
    if (!conn) return "";
    if (conn.kind === "transfer") return transferHtml(conn.label);
    var name = (conn.to && conn.to.name) || "下一项";
    return navPillHtml(transitHref(conn.from, conn.to), "带我去 → " + name);
  }

  function firstPill(group) {
    if (!group || !group.firstTarget || !group.items.length) return "";
    var name = group.firstTarget.name || itemTitle(group.items[0]);
    return navPillHtml(transitHref(null, group.firstTarget), "从我的位置 带我去 → " + name);
  }

  function renderList() {
    var root = $("timeline");
    if (!root) return;
    var trip = currentTrip();
    var items = (trip && trip.items) || [];
    updateListHead(items);
    if (!items.length) {
      root.innerHTML = '<div class="empty-state">点＋添加你的第一个地方</div>';
      return;
    }
    var pending = items.filter(isPendingItem);
    var dated = items.filter(function (it) { return !isPendingItem(it); });
    var pendingBanner = pending.length && selectedDay !== "all"
      ? '<button type="button" class="pending-banner" data-pending-show="1">' + ico("calendar", "ico-sm") +
        "<span>有 " + pending.length + " 条日期待确认</span><span class=\"pending-banner-go\" aria-hidden=\"true\">›</span></button>"
      : "";
    var groups = Legs.groupByDay(dated);
    if (selectedDay !== "all" && !groups.some(function (g) { return g.date === selectedDay; })) {
      root.innerHTML = pendingBanner +
        '<div class="empty-state empty-day">' + escapeHtml(formatMd(selectedDay)) + ' 没有安排' +
        '<button type="button" class="text-link-btn" data-day-all="1">看全部日子</button></div>';
      var allBtn = root.querySelector("[data-day-all]");
      if (allBtn) allBtn.addEventListener("click", function () { selectDay("all"); });
      bindListEvents(root);
      return;
    }
    var connectors = Legs.buildConnectors(dated);
    var all = Legs.sortedItems(dated);
    var html = pendingBanner;
    if (pending.length && selectedDay === "all") {
      html += '<section class="day-block pending-block" id="day-pending" aria-label="待确认日期">';
      html += '<h3 class="pending-head">' + ico("calendar", "ico-sm") + "<span>待确认日期</span><span class=\"pending-count\">" + pending.length + " 条 · 点一下改日期</span></h3>";
      pending.forEach(function (item) {
        html += cardHtml(item);
      });
      html += "</section>";
    }
    groups.forEach(function (g) {
      if (selectedDay !== "all" && g.date !== selectedDay) return;
      html += '<section class="day-block" id="day-' + escapeHtml(g.date) + '">';
      html += '<div class="day-rail">';
      html += firstPill(g);
      g.items.forEach(function (item, i) {
        html += cardHtml(item);
        var next = g.items[i + 1];
        if (next) {
          html += connectorSlot(findConnector(connectors, item.id, next.id));
        } else if (selectedDay === "all") {
          var pos = -1;
          var k;
          for (k = 0; k < all.length; k++) {
            if (all[k].id === item.id) pos = k;
          }
          if (pos >= 0 && pos < all.length - 1) {
            html += connectorSlot(findConnector(connectors, item.id, all[pos + 1].id));
          }
        }
      });
      html += "</div></section>";
    });
    root.innerHTML = html;
    bindSecretToggles(root);
    bindListEvents(root);
  }

  function updateListHead(items) {
    var count = $("list-count");
    var btn = $("clear-all-btn");
    var n = (items || []).length;
    if (count) count.textContent = n ? "共 " + n + " 项" : "还没有行程";
    if (btn) {
      btn.disabled = !n;
      btn.setAttribute("aria-disabled", n ? "false" : "true");
    }
  }

  function findItem(id) {
    var items = (currentTrip().items || []);
    var i;
    for (i = 0; i < items.length; i++) {
      if (items[i].id === id) return items[i];
    }
    return null;
  }

  function bindListEvents(root) {
    if (listEventsBound) return;
    listEventsBound = true;
    root.addEventListener("click", function (ev) {
      var expand = ev.target.closest && ev.target.closest("[data-expand]");
      if (expand) {
        ev.preventDefault();
        ev.stopPropagation();
        var eid = expand.getAttribute("data-expand");
        expanded[eid] = !expanded[eid];
        renderList();
        return;
      }
      var del = ev.target.closest && ev.target.closest("[data-delete]");
      if (del) {
        ev.preventDefault();
        ev.stopPropagation();
        askDeleteItem(del.getAttribute("data-delete"));
        return;
      }
      var pick = ev.target.closest && ev.target.closest("[data-pick]");
      if (pick) {
        ev.preventDefault();
        ev.stopPropagation();
        openPickForItem(findItem(pick.getAttribute("data-pick")));
        return;
      }
      var pb = ev.target.closest && ev.target.closest("[data-pending-show]");
      if (pb) {
        selectDay("all");
        var blk = $("day-pending");
        if (blk && blk.scrollIntoView) blk.scrollIntoView({ block: "start" });
        return;
      }
      var card = ev.target.closest && ev.target.closest(".card");
      if (card && !ev.target.closest("a, button")) {
        if (card.classList.contains("is-pending")) enterEditMode(card.getAttribute("data-item"));
        else openDetail(card.getAttribute("data-item"));
      }
    });
  }

  function visibleItems() {
    var items = (currentTrip().items || []);
    if (selectedDay === "all") return items;
    return items.filter(function (it) {
      return ((window.Legs && Legs.itemDisplayDate(it)) || "") === selectedDay;
    });
  }

  function setView(which) {
    currentView = which === "map" ? "map" : "list";
    var isMap = currentView === "map";
    var listView = $("list-view");
    var mapView = $("map-view");
    var btn = $("view-toggle-btn");
    if (listView) listView.hidden = isMap;
    if (mapView) mapView.hidden = !isMap;
    if (btn) paintTopActions();
    if (isMap) {
      initTripMap();
      renderMap();
      setTimeout(function () {
        if (tripMap) tripMap.invalidateSize();
      }, 80);
    }
  }

  function initTripMap() {
    if (tripMap || typeof L === "undefined") return;
    var el = $("trip-map");
    if (!el) return;
    tripMap = L.map(el, { scrollWheelZoom: true, attributionControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(tripMap);
    tripMap.setView([51.5074, -0.1278], 3);
  }

  function renderMap() {
    if (!tripMap) return;
    tripMarkers.forEach(function (m) {
      tripMap.removeLayer(m);
    });
    tripMarkers = [];
    var rows = Legs.numberedList(visibleItems());
    var bounds = [];
    rows.forEach(function (row) {
      var pt = row.marker;
      if (!pt || typeof pt.lat !== "number" || typeof pt.lng !== "number") return;
      var meta = typeStyle(row.item);
      var html =
        '<div class="map-marker" style="background:' +
        meta.color +
        '">' +
        ico(meta.icon) +
        '<span class="n">' +
        row.n +
        "</span></div>";
      var icon = L.divIcon({
        className: "map-marker-wrap",
        html: html,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      });
      var marker = L.marker([pt.lat, pt.lng], { icon: icon, title: itemTitle(row.item) });
      marker.on("click", function () {
        expanded[row.item.id] = true;
        setView("list");
        renderList();
        var el = document.querySelector('[data-item="' + row.item.id + '"]');
        if (el && el.scrollIntoView) el.scrollIntoView({ block: "center" });
      });
      marker.addTo(tripMap);
      tripMarkers.push(marker);
      bounds.push([pt.lat, pt.lng]);
    });
    if (bounds.length === 1) tripMap.setView(bounds[0], 13);
    else if (bounds.length > 1) tripMap.fitBounds(bounds, { padding: [40, 40] });
  }

  /** 双屏设备（左右两块屏）：列表和地图同时显示，地图在右屏。其他设备返回 false，行为不变。 */
  function isDualScreen() {
    try {
      return !!(window.matchMedia && window.matchMedia("(horizontal-viewport-segments: 2)").matches);
    } catch (err) {
      return false;
    }
  }

  function renderAll() {
    updateTopBar();
    renderList();
    if (currentView === "map" || isDualScreen()) {
      initTripMap();
      renderMap();
    }
  }

  function openSheet(id) {
    var el = $(id);
    if (el) el.hidden = false;
  }

  function closeSheet(id) {
    var el = $(id);
    if (el) el.hidden = true;
  }

  var HELP_HIDE_KEY = "wishlist-map-help-hide-v1";
  var installPromptEvent = null;

  var HELP_ITEMS = [
    { icon: "plus", title: "添加", text: "点“＋ 添加”，输入地名，从结果里点一下就加好了。" },
    { icon: "copy", title: "用 AI 整理截图", text: "在添加页点“复制给 AI 的话”，连同机票、酒店截图一起发给任意 AI，再把它回复的内容粘贴回来。" },
    { icon: "pencil", title: "手动填写", text: "搜不到的地方，可以在添加页选“手动填写”。" },
    { icon: "calendar", title: "看行程", text: "按日期自动排好。顶部日期条左右滑，点某一天只看那天，点最前面的“全部”看所有日子；“今天”回到今天，点月份打开整月日历。紫色横条是每段住宿，过去的标“已去”。点卡片看详情。" },
    { icon: "trash", title: "修改和删除", text: "卡片右边的“删除”可以删掉这一项，点开卡片还能修改；列表右上角“清空全部”一次删光。删错了 10 秒内点底部的“撤销”就能恢复。" },
    { icon: "map", title: "看地图", text: "点顶部的地图图标，所有地点都标在地图上。" },
    { icon: "locate", title: "定位", text: "地图右下角的定位按钮可以显示你现在在哪（位置只在你手机上用，不保存不上传）" },
    { icon: "bus", title: "带我去", text: "点两站之间的“带我去”，自动打开高德或 Google 地图导航。" },
    { icon: "share", title: "分享我的行程", text: "在“设置”里点“分享我的行程”，把文件发给同行的人，对方点“导入”就能看到。分享时会自动隐藏订单号和座位。想把这个工具推荐给别人，点“推荐这个工具”，只发网址，不含你的行程。" },
    { icon: "device", title: "放到桌面", text: "点“添加到桌面”，以后像 App 一样打开。iPhone 请用 Safari 打开，按提示操作。" },
    { icon: "backup", title: "备份", text: "换手机前，在“设置”里点“完整备份”，到新手机上再点“导入”。" },
    { icon: "trash", title: "清空", text: "在“设置”里点“清空本机数据”，所有行程都会删除。" },
    { icon: "refresh", title: "更新", text: "更新不会删除你的行程。如果看到的还是旧版：把网页彻底关掉再打开。放在桌面的，就从后台划掉，再点图标打开。" },
    { icon: "lock", title: "隐私", text: "行程只存在你的手机里，没有账号，也没有服务器，我们看不到。只有搜索、显示地图和导航时，地名或地址会发给地图服务（OpenStreetMap、高德或 Google 地图）。" }
  ];

  function renderHelpBody() {
    var box = $("help-body");
    if (!box) return;
    box.innerHTML =
      HELP_ITEMS.map(function (it) {
        return (
          '<div class="help-item">' +
          ico(it.icon) +
          "<div><strong>" +
          escapeHtml(it.title) +
          "</strong>：" +
          escapeHtml(it.text) +
          "</div></div>"
        );
      }).join("") +
      '<button type="button" class="help-install-btn" id="help-install-btn">' +
      ico("device") +
      "<span>添加到桌面</span></button>";
    var helpInstall = $("help-install-btn");
    if (helpInstall && helpInstall.getAttribute("data-bound") !== "1") {
      helpInstall.setAttribute("data-bound", "1");
      helpInstall.addEventListener("click", function () {
        closeSheet("help-sheet");
        openInstall();
      });
    }
    applyInstallVisibility(currentEnv());
  }

  function helpHidden() {
    try {
      return localStorage.getItem(HELP_HIDE_KEY) === "1";
    } catch (err) {
      return false;
    }
  }

  function dismissHelp() {
    var box = $("help-dont-show");
    try {
      if (box && box.checked) localStorage.setItem(HELP_HIDE_KEY, "1");
      else localStorage.removeItem(HELP_HIDE_KEY);
    } catch (err) {}
    closeSheet("help-sheet");
    afterOpenDialogClosed();
  }

  function openHelp() {
    var box = $("help-dont-show");
    if (box) box.checked = helpHidden();
    closeSheet("settings-sheet");
    closeSheet("add-sheet");
    closeSheet("install-sheet");
    openSheet("help-sheet");
  }

  function aiPromptText() {
    return (window.AiPrompt && AiPrompt.TEXT) || "";
  }

  function markCopied(btn) {
    if (!btn) return;
    btn.classList.add("is-copied");
    var span = btn.querySelector("span");
    var prev = btn.getAttribute("data-label") || (span ? span.textContent : btn.textContent);
    btn.setAttribute("data-label", prev);
    if (span) span.textContent = "已复制";
    else btn.textContent = "已复制";
    setTimeout(function () {
      btn.classList.remove("is-copied");
      if (span) span.textContent = prev;
      else btn.textContent = prev;
      decorateCopyBtn();
    }, 1800);
  }

  function decorateCopyBtn() {
    var btn = $("ai-copy-btn");
    if (!btn) return;
    var label = btn.getAttribute("data-label") || "复制给 AI 的话";
    if (btn.classList.contains("is-copied")) return;
    btn.innerHTML = ico("copy") + "<span>" + escapeHtml(label) + "</span>";
  }

  function copyAiPrompt() {
    var text = aiPromptText();
    var btn = $("ai-copy-btn");
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (err) {
        ok = false;
      }
      document.body.removeChild(ta);
      if (ok) markCopied(btn);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          markCopied(btn);
        },
        fallback
      );
    } else {
      fallback();
    }
  }

  function selectedDateOrEmpty() {
    return selectedDay && selectedDay !== "all" ? selectedDay : "";
  }

  function showManualStatus(html) {
    var box = $("manual-status");
    if (box) box.innerHTML = html || "";
    else showAddStatus(html);
  }

  function handleManualSave() {
    if (editingId) {
      saveEdit();
      return;
    }
    var type = (($("manual-type") && $("manual-type").value) || "地点").trim() || "地点";
    var name = (($("manual-name") && $("manual-name").value) || "").trim();
    if (!name) {
      showManualStatus('<p class="err">请先填写名称，比如「大英博物馆」。</p>');
      return;
    }
    if (type === "机票") {
      showManualStatus('<p class="err">机票请用「复制给 AI 的话」整理截图，或把「机票 | 航班号 | LHR - HND | 起飞时间 ~ 落地时间 | 」粘贴到「用 AI 帮我整理」里的框中。</p>');
      return;
    }
    var day = selectedDateOrEmpty();
    if (type === "酒店") {
      var hotel = {
        id: "hotel-" + Date.now(),
        type: "hotel",
        nameZh: name,
        nameEn: "",
        address: name,
        checkIn: day || "",
        checkOut: "",
        example: false
      };
      showManualStatus('<p class="ok">正在查找位置…</p>');
      Geocode.resolveItem(hotel)
        .then(function (res) {
          finishImport([hotel], [res], []);
        })
        .catch(function () {
          finishImport(
            [hotel],
            [{ item: hotel, status: "none", message: Geocode.FRIENDLY_NOT_FOUND, candidates: [], chosen: null }],
            []
          );
        });
      return;
    }
    var subtype = "";
    if (type.indexOf("/") !== -1) subtype = type.split("/")[1] || "";
    var item = {
      id: "place-" + Date.now(),
      type: "place",
      subtype: subtype,
      nameZh: name,
      address: name,
      example: false
    };
    if (day) item.date = day;
    showManualStatus('<p class="ok">正在查找位置…</p>');
    Geocode.resolveItem(item)
      .then(function (res) {
        finishImport([item], [res], []);
      })
      .catch(function () {
        finishImport(
          [item],
          [{ item: item, status: "none", message: Geocode.FRIENDLY_NOT_FOUND, candidates: [], chosen: null }],
          []
        );
      });
  }


  /* ---------- 详情 / 修改 / 删除 / 清空全部 ---------- */
  var UNDO_MS = (window.ItemEdit && ItemEdit.UNDO_MS) || 10000;
  var detailId = null;
  var editingId = null;
  var confirmAction = null;

  function detailRowsHtml(item) {
    var meta = typeStyle(item);
    var rows = [];
    function row(label, valueHtml) {
      if (!valueHtml) return;
      rows.push('<div class="detail-row"><span class="detail-label">' + escapeHtml(label) + "</span><span class=\"detail-value\">" + valueHtml + "</span></div>");
    }
    row("类型", escapeHtml(item.type === "place" && item.subtype ? item.subtype : meta.label || ""));
    if (item.type === "flight") {
      row("航班", escapeHtml(formatFlightLocal(item)));
      row("日期", escapeHtml(item.departDate ? formatMd(item.departDate) : ""));
    } else if (item.type === "hotel") {
      row("入住", escapeHtml(((item.checkIn ? formatMd(item.checkIn) : "") + " " + (item.checkInTime || "")).trim()));
      row("退房", escapeHtml(item.checkOut ? formatMd(item.checkOut) : ""));
    } else {
      row("日期", escapeHtml(item.date ? formatMd(item.date) : ""));
      row("时间", escapeHtml(item.time || ""));
    }
    row("地址", escapeHtml(item.address || ""));
    row("备注", escapeHtml(item.note || ""));
    if (item.confirmationNo) row("确认号", secretToggleHtml(item.confirmationNo));
    row("座位", escapeHtml(item.seat || ""));
    var html =
      '<div class="detail-hero" style="--type:' + (meta.color || "#27AE60") + ";--type-tint:" + (meta.tint || "#E3F7EA") + '">' +
      '<div class="type-badge">' + ico(meta.icon) + "</div>" +
      '<div><p class="detail-name">' + escapeHtml(itemTitle(item)) + "</p>" +
      (itemTimeLabel(item) ? '<p class="card-time">' + escapeHtml(itemTimeLabel(item)) + "</p>" : "") +
      "</div></div>" +
      rows.join("") +
      '<p class="detail-nav"><a class="here-link" href="' + escapeHtml(transitHref(null, cardTarget(item))) + '" target="_blank" rel="noopener">从我的位置导航</a></p>';
    if (itemUnlocated(item)) {
      html += '<p class="detail-hint">还没有位置，地图上不显示。可以点“修改”改一下地址。</p>';
    }
    return html;
  }

  function openDetail(id) {
    var item = findItem(id);
    if (!item) return;
    detailId = id;
    var body = $("detail-body");
    if (body) {
      body.innerHTML = detailRowsHtml(item);
      bindSecretToggles(body);
    }
    var title = $("detail-title");
    if (title) title.textContent = "详情";
    openSheet("detail-sheet");
  }

  function openConfirm(opts) {
    $("confirm-title").textContent = opts.title;
    $("confirm-sub").textContent = opts.sub || "";
    $("confirm-sub").hidden = !opts.sub;
    $("confirm-ok").textContent = opts.okText || "删除";
    confirmAction = opts.onOk;
    openSheet("confirm-sheet");
    try { $("confirm-cancel").focus(); } catch (err) {}
  }

  function closeConfirm() {
    confirmAction = null;
    closeSheet("confirm-sheet");
  }

  function fixSelectedDay(items) {
    if (selectedDay !== "all" && tripDays(items).indexOf(selectedDay) === -1) selectedDay = "all";
  }

  function askDeleteItem(id) {
    var item = findItem(id);
    if (!item) return;
    openConfirm({
      title: "确定删除这一项吗？",
      sub: "删除后 10 秒内可以撤销。",
      okText: "删除",
      onOk: function () {
        deleteItemNow(id);
      }
    });
  }

  function deleteItemNow(id) {
    var trip = currentTrip();
    var res = ItemEdit.removeItem(trip.items || [], id);
    if (!res.removed) return;
    var prevDay = selectedDay;
    trip.items = res.items;
    delete expanded[id];
    fixSelectedDay(trip.items);
    saveAllTrips();
    closeSheet("detail-sheet");
    detailId = null;
    renderAll();
    showToast("已删除", function () {
      var t = currentTrip();
      t.items = ItemEdit.restoreItem(t.items || [], res.removed, res.index);
      if (prevDay !== "all" && tripDays(t.items).indexOf(prevDay) !== -1) selectedDay = prevDay;
      saveAllTrips();
      renderAll();
    }, UNDO_MS);
  }

  function askClearAll() {
    var trip = currentTrip();
    if (!(trip.items || []).length) return;
    openConfirm({
      title: "确定清空全部行程吗？",
      sub: "建议先备份（在“设置”里点“完整备份”导出文件）。删除后 10 秒内可以撤销。",
      okText: "清空全部",
      onOk: clearAllNow
    });
  }

  function clearAllNow() {
    var trip = currentTrip();
    var res = ItemEdit.clearItems(trip.items || []);
    var prevDay = selectedDay;
    trip.items = res.items;
    expanded = {};
    selectedDay = "all";
    saveAllTrips();
    renderAll();
    showToast("已清空", function () {
      var t = currentTrip();
      t.items = res.removed.concat(t.items || []);
      if (prevDay !== "all" && tripDays(t.items).indexOf(prevDay) !== -1) selectedDay = prevDay;
      saveAllTrips();
      renderAll();
    }, UNDO_MS);
  }

  function setAddMode(isEdit) {
    var sheet = $("add-sheet");
    if (sheet) sheet.classList.toggle("is-editing", !!isEdit);
    Array.prototype.forEach.call(document.querySelectorAll("#add-sheet .add-only"), function (el) {
      el.hidden = !!isEdit;
    });
    Array.prototype.forEach.call(document.querySelectorAll("#add-sheet .edit-only"), function (el) {
      el.hidden = !isEdit;
    });
    var title = $("add-sheet-title");
    if (title) title.textContent = isEdit ? "修改" : "添加";
    var save = $("manual-save");
    if (save) save.textContent = isEdit ? "保存修改" : "保存";
    var fold = $("manual-fold");
    if (fold && isEdit) fold.open = true;
  }

  function setVal(id, v) {
    if ($(id)) $(id).value = v == null ? "" : v;
  }
  function getVal(id) {
    return $(id) ? $(id).value : "";
  }

  function enterEditMode(id) {
    var item = findItem(id);
    if (!item) return;
    editingId = id;
    var f = ItemEdit.formFields(item);
    var sel = $("manual-type");
    var isFlight = item.type === "flight";
    if (sel) {
      Array.prototype.forEach.call(sel.options, function (o) {
        o.disabled = isFlight ? o.value !== "机票" : o.value === "机票";
      });
      sel.value = f.type;
      sel.disabled = isFlight;
    }
    setVal("manual-name", f.name);
    setVal("edit-address", f.address);
    setVal("edit-date", f.date);
    setVal("edit-time", f.time);
    setVal("edit-end-date", f.endDate);
    setVal("edit-end-time", f.endTime);
    setVal("edit-note", f.note);
    paintEditLabels(isFlight ? "机票" : f.type);
    if ($("manual-status")) $("manual-status").innerHTML = "";
    setAddMode(true);
    if ($("edit-address-row")) $("edit-address-row").hidden = isFlight;
    closeSheet("detail-sheet");
    openSheet("add-sheet");
  }

  function paintEditLabels(type) {
    var isFlight = type === "机票";
    var isHotel = type === "酒店";
    var nameLabel = document.querySelector('label[for="manual-name"]');
    if (nameLabel) nameLabel.textContent = isFlight ? "航班号" : "名称";
    if ($("edit-date-label")) $("edit-date-label").textContent = isFlight ? "起飞日期" : isHotel ? "入住日期" : "日期";
    if ($("edit-time-label")) $("edit-time-label").textContent = isFlight ? "起飞时间" : isHotel ? "入住时间" : "时间";
    if ($("edit-end-row")) $("edit-end-row").hidden = !(isFlight || isHotel);
    if ($("edit-end-date-label")) $("edit-end-date-label").textContent = isFlight ? "到达日期" : "退房日期";
    if ($("edit-end-time-box")) $("edit-end-time-box").hidden = !isFlight;
  }

  function exitEditMode() {
    editingId = null;
    var sel = $("manual-type");
    if (sel) {
      sel.disabled = false;
      Array.prototype.forEach.call(sel.options, function (o) {
        o.disabled = false;
      });
      sel.value = "地点";
    }
    setVal("manual-name", "");
    ["edit-address", "edit-date", "edit-time", "edit-end-date", "edit-end-time", "edit-note"].forEach(function (id) {
      setVal(id, "");
    });
    paintEditLabels("地点");
    if ($("manual-status")) $("manual-status").innerHTML = "";
    var fold = $("manual-fold");
    if (fold) fold.open = false;
    setAddMode(false);
  }

  function saveEdit() {
    var id = editingId;
    var item = findItem(id);
    if (!item) {
      exitEditMode();
      closeSheet("add-sheet");
      return;
    }
    var type = getVal("manual-type");
    var form = {
      type: type,
      name: getVal("manual-name"),
      address: item.type === "flight" ? "" : getVal("edit-address"),
      date: getVal("edit-date"),
      time: getVal("edit-time"),
      endDate: type === "酒店" || item.type === "flight" ? getVal("edit-end-date") : null,
      endTime: getVal("edit-end-time"),
      note: getVal("edit-note")
    };
    var res = ItemEdit.applyForm(item, form);
    if (res.error) {
      showManualStatus('<p class="err">' + escapeHtml(res.error) + "</p>");
      return;
    }
    var trip = currentTrip();
    trip.items = ItemEdit.updateItem(trip.items || [], id, res.item);
    fixSelectedDay(trip.items);
    saveAllTrips();
    exitEditMode();
    closeSheet("add-sheet");
    renderAll();
    if (res.addressChanged && window.Geocode && res.item.address) {
      showToast("已保存，正在找新地址的位置…");
      Geocode.resolveItem(res.item)
        .then(function (r) {
          var cur = findItem(id);
          if (!cur) return;
          var fresh = Object.assign({}, cur);
          if (r && r.chosen) Geocode.applyChoice(fresh, r.chosen, r.fromChosen);
          var t = currentTrip();
          t.items = ItemEdit.updateItem(t.items || [], id, fresh);
          saveAllTrips();
          renderAll();
          showToast(r && r.chosen ? "已保存，位置已更新" : "已保存。" + Geocode.FRIENDLY_NOT_FOUND);
        })
        .catch(function () {
          showToast("已保存。" + Geocode.FRIENDLY_NOT_FOUND);
        });
    } else {
      showToast("已保存修改");
    }
  }

  function bindEditDelete() {
    if ($("detail-edit")) {
      $("detail-edit").addEventListener("click", function () {
        if (detailId) enterEditMode(detailId);
      });
    }
    if ($("detail-delete")) {
      $("detail-delete").addEventListener("click", function () {
        if (detailId) askDeleteItem(detailId);
      });
    }
    if ($("confirm-cancel")) $("confirm-cancel").addEventListener("click", closeConfirm);
    if ($("confirm-ok")) {
      $("confirm-ok").addEventListener("click", function () {
        var fn = confirmAction;
        closeConfirm();
        if (typeof fn === "function") fn();
      });
    }
    if ($("clear-all-btn")) $("clear-all-btn").addEventListener("click", askClearAll);
    if ($("edit-cancel")) {
      $("edit-cancel").addEventListener("click", function () {
        exitEditMode();
        closeSheet("add-sheet");
      });
    }
    if ($("manual-type")) {
      $("manual-type").addEventListener("change", function () {
        if (editingId) paintEditLabels(getVal("manual-type"));
      });
    }
  }

  /* ---------- 版本号、更新记录、新版本公告 ---------- */
  function lsGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }
  function lsSet(key, val) {
    try {
      localStorage.setItem(key, val);
    } catch (err) {}
  }

  function storedHasTrips() {
    var stored = loadAllTrips();
    return !!(stored && stored.trips && stored.trips.some(function (t) {
      return t && t.items && t.items.length;
    }));
  }

  function runOpenFlow() {
    if (!window.AppVersion) {
      if (!helpHidden()) openHelp();
      return;
    }
    var decision = AppVersion.decideOnOpen({
      lastSeen: lsGet(AppVersion.LAST_SEEN_KEY),
      hasTrips: storedHasTrips(),
      helpHidden: helpHidden()
    });
    if (decision.markSeenNow) lsSet(AppVersion.LAST_SEEN_KEY, AppVersion.APP_VERSION);
    if (decision.show === "announce") openAnnouncement();
    else if (decision.show === "help") openHelp();
    if (decision.show === "none") maybeAutoIosGuide();
    else iosGuidePending = true;
  }

  function renderVersionInfo() {
    if (!window.AppVersion) return;
    var label = $("version-label");
    if (label) label.textContent = AppVersion.versionLabel();
  }

  function openChangelog() {
    var body = $("changelog-body");
    if (body && window.AppVersion) {
      body.innerHTML = AppVersion.CHANGELOG.map(function (v) {
        return (
          '<section class="changelog-item">' +
          '<h3><span class="changelog-ver">' + escapeHtml(v.version) + "</span>" +
          '<span class="changelog-date">' + escapeHtml(v.date) + "</span>" +
          (v.version === AppVersion.APP_VERSION ? '<span class="changelog-now">当前</span>' : "") +
          "</h3><ul>" +
          v.lines.map(function (l) {
            return "<li>" + escapeHtml(l) + "</li>";
          }).join("") +
          "</ul></section>"
        );
      }).join("");
    }
    openSheet("changelog-sheet");
  }

  function openAnnouncement() {
    if (!window.AppVersion) return;
    var a = AppVersion.ANNOUNCEMENT;
    $("announce-title").textContent = a.title;
    $("announce-list").innerHTML = a.bullets.slice(0, 5).map(function (b) {
      return "<li>" + escapeHtml(b) + "</li>";
    }).join("");
    $("announce-tip").textContent = a.tip;
    closeSheet("help-sheet");
    openSheet("announce-sheet");
  }

  function dismissAnnouncement() {
    if (window.AppVersion) lsSet(AppVersion.LAST_SEEN_KEY, AppVersion.APP_VERSION);
    closeSheet("announce-sheet");
    afterOpenDialogClosed();
  }

  var SEARCH_DEBOUNCE_MS = 600;
  var searchTimer = null;
  var searchGen = 0;
  var searchHits = [];
  var toastTimer = null;
  var toastUndo = null;

  function currentEnv(forceKind) {
    var env;
    if (window.InstallEnv && typeof InstallEnv.currentInstallEnv === "function") {
      env = InstallEnv.currentInstallEnv();
    } else if (window.InstallEnv && typeof InstallEnv.detectInstallEnv === "function") {
      env = InstallEnv.detectInstallEnv("");
    } else {
      env = { kind: "other", hideInstall: false };
    }
    if (forceKind) {
      env = {
        kind: forceKind,
        hideInstall: forceKind === "standalone",
        inApp: forceKind === "inapp",
        ios: forceKind === "ios-safari",
        safari: forceKind === "ios-safari",
        standalone: forceKind === "standalone"
      };
    }
    return env;
  }

  var INSTALL_BANNER_HIDE_KEY = "wishlist-map-install-banner-hide-v1";

  function installBannerDismissed() {
    try {
      return localStorage.getItem(INSTALL_BANNER_HIDE_KEY) === "1";
    } catch (err) {
      return false;
    }
  }

  function dismissInstallBanner() {
    try {
      localStorage.setItem(INSTALL_BANNER_HIDE_KEY, "1");
    } catch (err) {}
    applyInstallVisibility(currentEnv());
  }

  function applyInstallVisibility(env) {
    env = env || currentEnv();
    var hideAll = !!(env && env.hideInstall);
    var banner = $("install-banner");
    var settingsBtn = $("install-btn");
    var helpBtn = $("help-install-btn");
    var go = $("install-banner-go");
    var dismiss = $("install-banner-dismiss");
    if (settingsBtn) settingsBtn.hidden = hideAll;
    if (helpBtn) helpBtn.hidden = hideAll;
    if (banner) banner.hidden = hideAll || installBannerDismissed();
    if (go && go.getAttribute("data-filled") !== "1") {
      go.setAttribute("data-filled", "1");
      go.innerHTML = ico("device") + "<span>添加到桌面，以后像 App 一样打开</span>";
    }
    if (dismiss && dismiss.getAttribute("data-filled") !== "1") {
      dismiss.setAttribute("data-filled", "1");
      dismiss.innerHTML = ico("close");
    }
  }

  function iosShareSvg() {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M8 9v-3a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3"/>' +
      '<rect x="4" y="9" width="16" height="12" rx="2"/>' +
      "</svg>"
    );
  }

  /* Larger iOS-style share illustration: box + arrow up. */
  function iosShareIllu() {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 14V3"/>' +
      '<path d="M8 6.5L12 2.5 16 6.5"/>' +
      '<path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/>' +
      "</svg>"
    );
  }

  function iosHomeIllu() {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="4" y="4" width="16" height="16" rx="4"/>' +
      '<path d="M12 8v8M8 12h8"/>' +
      "</svg>"
    );
  }

  function arrowSvg() {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h14"/><path d="M13 6l6 6-6 6"/></svg>'
    );
  }

  function renderInstallBody(kind) {
    var box = $("install-body");
    if (!box) return;
    if (kind === "inapp") {
      box.innerHTML =
        '<p class="install-inapp">请点右上角 ···，选“在浏览器打开”（苹果手机用 Safari）</p>';
      return;
    }
    if (kind === "ios-safari") {
      box.innerHTML =
        '<div class="install-ios">' +
        '<div class="install-ios-row"><div class="install-illu">' +
        iosShareIllu() +
        "</div><p>1. 点底部分享按钮</p></div>" +
        '<div class="install-arrow">' +
        arrowSvg() +
        "</div>" +
        '<div class="install-ios-row"><div class="install-illu">' +
        iosHomeIllu() +
        "</div><p>2. 选择「添加到主屏幕」</p></div>" +
        "</div>" +
        '<p class="install-tip">在微信里打开的话，先点右上角 ··· 选“在浏览器打开”。</p>';
      return;
    }
    box.innerHTML =
      '<p class="install-tip">在浏览器菜单里选择添加到主屏幕或安装应用。安卓 Chrome 通常会出现安装提示。</p>' +
      '<p class="install-tip">在微信里打开的话，先点右上角 ··· 选“在浏览器打开”。</p>';
  }

  /* ---------- iPhone Safari「添加到主屏幕」引导卡 ---------- */
  var iosGuidePending = false;

  function iosGuideEligibleHere() {
    if (!window.InstallEnv || typeof InstallEnv.iosGuideEligible !== "function") return false;
    var env = currentEnv();
    if (env.kind !== "ios-safari") return false;
    return InstallEnv.iosGuideEligible(navigator.userAgent || "", {
      standalone: env.standalone,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints
    });
  }

  function openIosGuide() {
    var el = $("ios-guide");
    if (!el) return;
    closeSheet("settings-sheet");
    closeSheet("help-sheet");
    closeSheet("install-sheet");
    el.hidden = false;
    document.body.classList.add("ios-guide-open");
  }

  function closeIosGuide() {
    var el = $("ios-guide");
    if (el) el.hidden = true;
    document.body.classList.remove("ios-guide-open");
    if (window.InstallEnv) lsSet(InstallEnv.IOS_GUIDE_KEY, String(Date.now()));
  }

  function maybeAutoIosGuide() {
    if (!window.InstallEnv || typeof InstallEnv.shouldAutoShowIosGuide !== "function") return;
    var ok = InstallEnv.shouldAutoShowIosGuide({
      eligible: iosGuideEligibleHere(),
      closedAt: lsGet(InstallEnv.IOS_GUIDE_KEY),
      now: Date.now()
    });
    if (ok) openIosGuide();
  }

  /* 说明或公告关掉之后，再按规则决定要不要弹引导，避免叠在一起。 */
  function afterOpenDialogClosed() {
    if (!iosGuidePending) return;
    iosGuidePending = false;
    maybeAutoIosGuide();
  }

  function openInstall(forceKind) {
    var env = currentEnv(forceKind);
    if (env.hideInstall) return;
    if (!forceKind && iosGuideEligibleHere()) {
      openIosGuide();
      return;
    }
    applyInstallVisibility(env);
    if (!forceKind && env.kind === "other" && installPromptEvent && typeof installPromptEvent.prompt === "function") {
      installPromptEvent.prompt();
      installPromptEvent = null;
      return;
    }
    renderInstallBody(env.kind);
    closeSheet("settings-sheet");
    openSheet("install-sheet");
  }

  function hideToast() {
    var el = $("toast");
    if (el) el.hidden = true;
    toastUndo = null;
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
  }

  function showToast(message, onUndo, ms) {
    var el = $("toast");
    var msg = $("toast-msg");
    if (!el || !msg) return;
    msg.textContent = message;
    toastUndo = onUndo || null;
    var undoBtn = $("toast-undo");
    if (undoBtn) undoBtn.hidden = !toastUndo;
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms || 5000);
  }

  function candidateName(c) {
    if (!c) return "";
    if (c.name) return String(c.name).trim();
    var d = String(c.displayName || "");
    return (d.split(",")[0] || d).trim();
  }

  function candidateShortAddr(c, name) {
    var display = String((c && c.displayName) || "").trim();
    var rest = display;
    if (name && display.indexOf(name) === 0) {
      rest = display.slice(name.length).replace(/^[,，\s]+/, "");
    }
    var parts = rest.split(/,\s*/).filter(Boolean);
    if (parts.length > 3) parts = parts.slice(0, 3);
    return parts.join(", ");
  }

  function guessLabel(c) {
    if (window.GuessType && typeof GuessType.guessType === "function") {
      return GuessType.guessType(c);
    }
    return "地点";
  }

  function itemFromType(name, address, label, coords, date) {
    var item = {
      id: (label === "酒店" ? "hotel-" : "place-") + Date.now(),
      type: label === "酒店" ? "hotel" : "place",
      nameZh: name,
      address: address || name,
      example: false
    };
    if (label === "餐厅" || label === "景点" || label === "街道") item.subtype = label;
    if (label === "酒店") {
      if (date) item.checkIn = date;
    } else if (date) {
      item.date = date;
    }
    if (coords && isFinite(coords.lat) && isFinite(coords.lng)) {
      item.lat = Number(coords.lat);
      item.lng = Number(coords.lng);
    }
    return item;
  }

  function addPlaceAndToast(item) {
    var added = appendItems([item], { keepDay: true }) || [item];
    var real = added[0] || item;
    closeSheet("add-sheet");
    clearSearchUi(true);
    showToast("已添加：" + (real.nameZh || nameOrBlank(real)), function () {
      var trip = currentTrip();
      trip.items = (trip.items || []).filter(function (it) {
        return it.id !== real.id;
      });
      saveAllTrips();
      renderAll();
    });
  }

  function nameOrBlank(item) {
    return (item && (item.nameZh || item.address)) || "";
  }

  function clearSearchUi(clearInput) {
    searchHits = [];
    searchGen += 1;
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    if (clearInput && $("place-search")) $("place-search").value = "";
    var list = $("search-results");
    if (list) {
      list.hidden = true;
      list.innerHTML = "";
    }
    var fb = $("search-fallback");
    if (fb) fb.hidden = true;
    setSearchStatus("");
  }

  function setSearchStatus(text, isError) {
    var el = $("search-status");
    if (!el) return;
    el.textContent = text || "";
    if (isError) el.classList.add("is-error");
    else el.classList.remove("is-error");
  }

  function renderSearchHits(query, list) {
    searchHits = (list || []).slice(0, 5);
    var box = $("search-results");
    var fb = $("search-fallback");
    if (fb) fb.hidden = !String(query || "").trim();
    if (!box) return;
    if (!searchHits.length) {
      box.hidden = true;
      box.innerHTML = "";
      if (String(query || "").trim() && !($("search-status") && $("search-status").classList.contains("is-error"))) {
        setSearchStatus("没有找到匹配的地点");
      }
      return;
    }
    setSearchStatus("");
    box.hidden = false;
    box.innerHTML = searchHits
      .map(function (c, i) {
        var name = candidateName(c) || "未命名地点";
        var addr = candidateShortAddr(c, name);
        return (
          '<li><button type="button" class="search-hit" data-hit="' +
          i +
          '"><span class="search-hit-name">' +
          escapeHtml(name) +
          '</span>' +
          (addr ? '<span class="search-hit-addr">' + escapeHtml(addr) + "</span>" : "") +
          "</button></li>"
        );
      })
      .join("");
  }

  function pickSearchHit(index) {
    var c = searchHits[index];
    if (!c) return;
    var name = candidateName(c) || String(($("place-search") && $("place-search").value) || "").trim();
    if (!name) return;
    var item = itemFromType(
      name,
      candidateShortAddr(c, name) || c.displayName || name,
      guessLabel(c),
      { lat: c.lat, lng: c.lng },
      selectedDateOrEmpty()
    );
    addPlaceAndToast(item);
  }

  function addByTypedName() {
    var name = String(($("place-search") && $("place-search").value) || "").trim();
    if (!name) {
      setSearchStatus("请先输入地名，比如 大英博物馆", true);
      return;
    }
    addPlaceAndToast(itemFromType(name, name, "地点", null, selectedDateOrEmpty()));
  }

  function runLiveSearch(query) {
    var q = String(query || "").trim();
    var gen = (searchGen += 1);
    if (!q) {
      renderSearchHits("", []);
      setSearchStatus("");
      var fb = $("search-fallback");
      if (fb) fb.hidden = true;
      return;
    }
    setSearchStatus("正在搜索…");
    if (!window.Geocode || typeof Geocode.searchAddress !== "function") {
      setSearchStatus("暂时找不到位置，请再试一次，或点下面「找不到？直接用这个名字添加」。", true);
      renderSearchHits(q, []);
      return;
    }
    Geocode.searchAddress(q)
      .then(function (list) {
        if (gen !== searchGen) return;
        renderSearchHits(q, list || []);
      })
      .catch(function () {
        if (gen !== searchGen) return;
        setSearchStatus("暂时找不到位置，请再试一次，或点下面「找不到？直接用这个名字添加」。", true);
        renderSearchHits(q, []);
        var fb = $("search-fallback");
        if (fb) fb.hidden = false;
      });
  }

  function scheduleLiveSearch() {
    var q = String(($("place-search") && $("place-search").value) || "");
    var fb = $("search-fallback");
    if (fb) fb.hidden = !q.trim();
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      searchTimer = null;
      runLiveSearch(q);
    }, SEARCH_DEBOUNCE_MS);
  }

  function bindPlaceSearch() {
    var input = $("place-search");
    var list = $("search-results");
    var fb = $("search-fallback");
    if (input && input.getAttribute("data-bound") !== "1") {
      input.setAttribute("data-bound", "1");
      input.addEventListener("input", scheduleLiveSearch);
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          if (searchTimer) {
            clearTimeout(searchTimer);
            searchTimer = null;
          }
          runLiveSearch(input.value);
        }
      });
    }
    if (list && list.getAttribute("data-bound") !== "1") {
      list.setAttribute("data-bound", "1");
      list.addEventListener("click", function (ev) {
        var btn = ev.target.closest && ev.target.closest("[data-hit]");
        if (!btn) return;
        pickSearchHit(Number(btn.getAttribute("data-hit")));
      });
    }
    if (fb && fb.getAttribute("data-bound") !== "1") {
      fb.setAttribute("data-bound", "1");
      fb.addEventListener("click", addByTypedName);
    }
    var undo = $("toast-undo");
    if (undo && undo.getAttribute("data-bound") !== "1") {
      undo.setAttribute("data-bound", "1");
      undo.addEventListener("click", function () {
        var fn = toastUndo;
        hideToast();
        if (typeof fn === "function") fn();
      });
    }
  }

  function paintTopActions() {
    var view = $("view-toggle-btn");
    var settings = $("settings-btn");
    var help = $("help-top-btn");
    var isMap = currentView === "map";
    if (help) {
      help.classList.add("top-action");
      help.setAttribute("aria-label", "使用说明");
      if (help.getAttribute("data-iconified") !== "1") {
        help.setAttribute("data-iconified", "1");
        help.innerHTML = ico("help") + '<span class="top-label">使用说明</span>';
      }
    }
    if (view) {
      view.classList.add("top-action");
      view.classList.remove("icon-btn");
      view.setAttribute("aria-label", isMap ? "列表" : "地图");
      view.innerHTML =
        ico(isMap ? "list" : "map") +
        '<span class="top-optional-label">' +
        (isMap ? "列表" : "地图") +
        "</span>";
    }
    if (settings) {
      settings.classList.add("top-action");
      settings.classList.remove("icon-btn");
      settings.setAttribute("aria-label", "设置");
      settings.innerHTML = ico("gear") + '<span class="top-label">设置</span>';
    }
    fitTopActions();
  }

  function fitTopActions() {
    var actions = document.querySelector(".top-actions");
    var bar = document.querySelector(".topbar");
    if (!actions || !bar) return;
    var labels = actions.querySelectorAll(".top-optional-label");
    var i;
    for (i = 0; i < labels.length; i++) labels[i].hidden = false;
    actions.classList.remove("is-compact");
    var overflow = bar.scrollWidth > bar.clientWidth + 1;
    var brand = document.querySelector(".brand-block");
    var brandRow = document.querySelector(".brand-row");
    var tight =
      (brand && brand.getBoundingClientRect().width < 72) ||
      (brand && brandRow && brandRow.scrollWidth > brand.clientWidth + 1);
    if (overflow || tight) {
      for (i = 0; i < labels.length; i++) labels[i].hidden = true;
      actions.classList.add("is-compact");
    }
  }

  function decorateChrome() {
    function put(id, name) {
      var el = $(id);
      if (!el || el.getAttribute("data-iconified") === "1") return;
      el.setAttribute("data-iconified", "1");
      var label = el.textContent;
      var sub = el.getAttribute("data-sub");
      el.innerHTML = ico(name) + (sub
        ? '<span class="more-text"><span class="more-label">' + escapeHtml(label) + '</span><span class="more-sub">' + escapeHtml(sub) + "</span></span>"
        : "<span>" + escapeHtml(label) + "</span>");
      if (sub) el.setAttribute("aria-label", label + "：" + sub);
    }
    put("help-open-btn", "help");
    put("install-btn", "device");
    put("backup-export-share", "share");
    put("recommend-btn", "heart");
    put("backup-import", "import");
    put("backup-export-full", "backup");
    put("backup-clear", "trash");
    decorateCopyBtn();
    var add = $("add-fab");
    if (add && add.getAttribute("data-iconified") !== "1") {
      add.setAttribute("data-iconified", "1");
      add.innerHTML = ico("plus") + "<span>添加</span>";
    }
    paintTopActions();
    Array.prototype.forEach.call(document.querySelectorAll(".sheet-close"), function (btn) {
      if (btn.getAttribute("data-iconified") === "1") return;
      btn.setAttribute("data-iconified", "1");
      btn.innerHTML = ico("close");
    });
  }

  function startRename() {
    var trip = currentTrip();
    var btn = $("trip-name-btn");
    var input = $("trip-name-input");
    if (!btn || !input || !trip) return;
    input.value = trip.nameZh || "我的行程";
    btn.hidden = true;
    input.hidden = false;
    input.focus();
    input.select();
  }

  function finishRename() {
    var trip = currentTrip();
    var btn = $("trip-name-btn");
    var input = $("trip-name-input");
    if (!btn || !input || !trip) return;
    var name = String(input.value || "").trim() || "我的行程";
    trip.nameZh = name;
    saveAllTrips();
    input.hidden = true;
    btn.hidden = false;
    btn.textContent = name;
  }

  function showAddStatus(html) {
    var box = $("add-status");
    if (box) box.innerHTML = html || "";
  }

  function looksStructured(text) {
    var t = String(text || "");
    if (window.ImportUtil && typeof ImportUtil.normalizeImportText === "function") {
      t = ImportUtil.normalizeImportText(t);
    }
    t = t.replace(/^\s+|\s+$/g, "");
    if (!t) return false;
    if (t.charAt(0) === "{" || t.charAt(0) === "[") return true;
    if (t.indexOf("|") !== -1 || t.indexOf("｜") !== -1) return true;
    return false;
  }

  function appendItems(incoming, opts) {
    var trip = currentTrip();
    if (!trip.items) trip.items = [];
    var added = uniqueItemIds(trip.items, incoming);
    trip.items = trip.items.concat(added);
    saveAllTrips();
    if (!(opts && opts.keepDay)) selectedDay = defaultSelectedDay(trip.items);
    renderAll();
    return added;
  }

  function resolutionNote(res) {
    if (res.status === "none" || res.status === "error") {
      return res.message || (window.Geocode && Geocode.FRIENDLY_NOT_FOUND) || "暂时找不到位置，不影响「带我去」导航";
    }
    return res.message || "";
  }

  function renderPickList(resolutions) {
    var box = $("add-pick");
    if (!box) return;
    var need = (resolutions || []).filter(function (r) {
      return r.status === "ambiguous" || r.status === "none" || r.status === "error";
    });
    if (!need.length) {
      box.hidden = true;
      box.innerHTML = "";
      pendingPick = null;
      return;
    }
    pendingPick = resolutions;
    box.hidden = false;
    var rows = need.map(function (res) {
      var idx = resolutions.indexOf(res);
      var opts = (res.candidates || []).map(function (c, j) {
        return (
          '<li><button type="button" class="pick-btn" data-res="' +
          idx +
          '" data-cand="' +
          j +
          '">' +
          escapeHtml(c.displayName || (c.lat + ", " + c.lng)) +
          "</button></li>"
        );
      }).join("");
      return (
        '<div class="pick-block" data-res="' +
        idx +
        '">' +
        "<p><strong>选一下位置</strong> · " +
        escapeHtml(res.item.nameZh || res.item.flightNo || res.item.id) +
        "</p>" +
        (res.message ? "<p>" + escapeHtml(res.message) + "</p>" : "") +
        (opts ? '<ul class="pick-list">' + opts + "</ul>" : "") +
        '<div class="retry-row"><input type="search" data-retry-q="' +
        idx +
        '" value="' +
        escapeHtml(res.query || "") +
        '" placeholder="换个关键词"><button type="button" class="retry-btn" data-retry="' +
        idx +
        '">重试</button></div>' +
        "</div>"
      );
    }).join("");
    box.innerHTML = rows;
  }

  function applyResolutions(items, resolutions) {
    resolutions.forEach(function (res, i) {
      if (window.Geocode && res.item) {
        Geocode.applyChoice(items[i] || res.item, res.chosen, res.fromChosen);
      }
    });
  }

  function finishImport(items, resolutions, errors, notes) {
    applyResolutions(items, resolutions || []);
    if (items.length) appendItems(items);
    var parts = [];
    var pendingN = items.filter(isPendingItem).length;
    var addedMsg = "已添加 " + items.length + " 条" + (pendingN ? "，" + pendingN + " 条日期待确认" : "");
    if (items.length) {
      parts.push('<p class="ok">' + escapeHtml(addedMsg) + "</p>");
      showToast(addedMsg, null, 5000);
    }
    (errors || []).forEach(function (e) {
      parts.push('<p class="err">' + escapeHtml(e) + "</p>");
    });
    (notes || []).forEach(function (n) {
      parts.push('<p class="note">' + escapeHtml(n) + "</p>");
    });
    (resolutions || []).forEach(function (res) {
      var note = resolutionNote(res);
      if (res.status === "none" || res.status === "error") {
        parts.push('<p class="err">' + escapeHtml(note) + "</p>");
      }
    });
    if (!parts.length) parts.push('<p class="err">没有可导入的内容。</p>');
    showAddStatus(parts.join(""));
    renderPickList(resolutions || []);
  }

  function runStructuredImport(text) {
    var result = ImportUtil.parseImport(text);
    var items = result.items || [];
    var errors = result.errors || [];
    var notes = result.notes || [];
    if (!items.length) {
      var bits = (errors || []).map(function (e) {
        return '<p class="err">' + escapeHtml(e) + "</p>";
      }).concat((notes || []).map(function (n) {
        return '<p class="note">' + escapeHtml(n) + "</p>";
      })).join("");
      showAddStatus(bits || '<p class="err">没有可导入的内容。</p>');
      return;
    }
    showAddStatus('<p class="ok">正在查找位置…</p>');
    Geocode.resolveAll(items)
      .then(function (resolutions) {
        finishImport(items, resolutions, errors, result.notes);
      })
      .catch(function () {
        finishImport(
          items,
          items.map(function (it) {
            return { item: it, status: "none", message: Geocode.FRIENDLY_NOT_FOUND, candidates: [], chosen: null };
          }),
          errors,
          result.notes
        );
      });
  }

  function runPlaceSearch(text) {
    var name = String(text || "").trim();
    if (!name) {
      showAddStatus('<p class="err">请先输入地名，或粘贴一份清单。</p>');
      return;
    }
    var item = {
      id: "place-" + Date.now(),
      type: "place",
      nameZh: name,
      address: name,
      example: false
    };
    if (day) item.date = day;
    showManualStatus('<p class="ok">正在查找位置…</p>');
    Geocode.resolveItem(item)
      .then(function (res) {
        finishImport([item], [res], []);
      })
      .catch(function () {
        finishImport(
          [item],
          [{ item: item, status: "none", message: Geocode.FRIENDLY_NOT_FOUND, candidates: [], chosen: null }],
          []
        );
      });
  }

  function handleAdd() {
    var text = ($("add-text") && $("add-text").value) || "";
    if (looksStructured(text)) runStructuredImport(text);
    else runPlaceSearch(text);
  }

  function openPickForItem(item) {
    if (!item) return;
    openSheet("add-sheet");
    var q0 = item.nameZh || item.address || item.flightNo || "";
    if ($("place-search")) $("place-search").value = q0;
    if ($("add-text")) $("add-text").value = q0;
    showAddStatus("<p>请选一下「" + escapeHtml(item.nameZh || itemTitle(item)) + "」的位置。</p>");
    var q = item.address || item.nameZh || "";
    Geocode.searchAddress(q)
      .then(function (list) {
        var res = {
          item: item,
          status: list.length > 1 ? "ambiguous" : list.length === 1 ? "ok" : "none",
          query: q,
          candidates: list,
          chosen: list[0] || null,
          message: list.length ? "" : (Geocode.FRIENDLY_NOT_FOUND || "")
        };
        pendingPick = [res];
        pendingPick._replaceId = item.id;
        renderPickList([res]);
      })
      .catch(function () {
        showAddStatus('<p class="err">' + escapeHtml(Geocode.FRIENDLY_NOT_FOUND) + "</p>");
      });
  }

  function bindAddPick() {
    var box = $("add-pick");
    if (!box || box.getAttribute("data-bound") === "1") return;
    box.setAttribute("data-bound", "1");
    box.addEventListener("click", function (ev) {
      var pick = ev.target.closest && ev.target.closest("[data-cand]");
      if (pick && pendingPick) {
        var i = Number(pick.getAttribute("data-res"));
        var j = Number(pick.getAttribute("data-cand"));
        var res = pendingPick[i];
        var cand = res && res.candidates && res.candidates[j];
        if (!cand || !res.item) return;
        Geocode.applyChoice(res.item, cand, res.fromChosen);
        res.chosen = cand;
        res.status = "ok";
        var replaceId = pendingPick._replaceId;
        if (replaceId) {
          var items = currentTrip().items || [];
          items.forEach(function (it, n) {
            if (it.id === replaceId) items[n] = res.item;
          });
        }
        saveAllTrips();
        renderAll();
        showAddStatus('<p class="ok">已选定位置</p>');
        renderPickList(pendingPick);
        return;
      }
      var retry = ev.target.closest && ev.target.closest("[data-retry]");
      if (retry && pendingPick) {
        var ri = Number(retry.getAttribute("data-retry"));
        var input = box.querySelector('[data-retry-q="' + ri + '"]');
        var q = (input && input.value) || "";
        Geocode.searchAddress(q).then(function (list) {
          pendingPick[ri].query = q;
          pendingPick[ri].candidates = list;
          pendingPick[ri].status = list.length > 1 ? "ambiguous" : list.length === 1 ? "ok" : "none";
          pendingPick[ri].chosen = list[0] || null;
          pendingPick[ri].message = list.length ? "" : (Geocode.FRIENDLY_NOT_FOUND || "");
          if (list[0] && pendingPick[ri].status === "ok") {
            Geocode.applyChoice(pendingPick[ri].item, list[0], pendingPick[ri].fromChosen);
            saveAllTrips();
            renderAll();
          }
          renderPickList(pendingPick);
        });
      }
    });
  }

  function exportState() {
    return {
      trips: trips,
      activeTripId: activeTripId,
      examplesLoaded: examplesLoaded,
      legs: (function () {
        try {
          return JSON.parse(localStorage.getItem(LEG_STORAGE_KEY) || "{}");
        } catch (e) {
          return {};
        }
      })()
    };
  }

  function importState(state, mode) {
    var incoming = state && Array.isArray(state.trips) ? state.trips : [];
    var incomingLegs = state && state.legs && typeof state.legs === "object" ? state.legs : {};
    if (mode === "replace") {
      trips = incoming.length ? incoming : [emptyTrip()];
      activeTripId =
        state.activeTripId && trips.some(function (t) { return t.id === state.activeTripId; })
          ? state.activeTripId
          : trips[0].id;
      examplesLoaded = !!state.examplesLoaded;
      try {
        localStorage.setItem(LEG_STORAGE_KEY, JSON.stringify(incomingLegs));
      } catch (e) {}
    } else {
      incoming.forEach(function (t) {
        var found = null;
        trips.forEach(function (x) {
          if (x.id === t.id) found = x;
        });
        if (found) {
          found.items = (found.items || []).concat(uniqueItemIds(found.items || [], t.items || []));
        } else {
          trips.push(t);
        }
      });
      if (state && state.activeTripId) activeTripId = state.activeTripId;
      examplesLoaded = examplesLoaded || !!(state && state.examplesLoaded);
      try {
        var legs = JSON.parse(localStorage.getItem(LEG_STORAGE_KEY) || "{}");
        Object.keys(incomingLegs).forEach(function (k) {
          legs[k] = incomingLegs[k];
        });
        localStorage.setItem(LEG_STORAGE_KEY, JSON.stringify(legs));
      } catch (e) {}
    }
    if (!trips.length) {
      trips = [emptyTrip()];
      activeTripId = trips[0].id;
    }
    selectedDay = defaultSelectedDay((currentTrip().items || []));
    saveAllTrips();
    renderAll();
  }

  window.TripApp = {
    exportState: exportState,
    importState: importState,
    getTrips: function () {
      return trips;
    },
    currentTrip: currentTrip,
    previewSearch: function (query, results) {
      if ($("place-search") && query != null) $("place-search").value = query;
      renderSearchHits(query || "", results || []);
    },
    openInstall: openInstall,
    openHelp: openHelp,
    openDetail: openDetail,
    confirm: openConfirm,
    openAnnouncement: openAnnouncement,
    openIosGuide: openIosGuide,
    getMap: function () {
      return tripMap;
    },
    mapTileKind: function () {
      return mapTiles;
    },
    toast: function (msg) {
      showToast(msg, null, 5000);
    }
  };

  function applyDemo(which) {
    demoMode = true;
    if (which === "empty") {
      trips = [emptyTrip()];
      activeTripId = trips[0].id;
      examplesLoaded = false;
      selectedDay = "all";
    } else {
      trips = [which === "japan" || which === "japan-month" ? demoJapanTrip() : demoTrip()];
      activeTripId = trips[0].id;
      examplesLoaded = true;
      selectedDay = defaultSelectedDay(trips[0].items);
    }
  }

  function initChrome() {
    decorateChrome();
    $("view-toggle-btn").addEventListener("click", function () {
      setView(currentView === "map" ? "list" : "map");
    });
    $("settings-btn").addEventListener("click", function () {
      openSheet("settings-sheet");
    });
    $("add-fab").addEventListener("click", function () {
      if (editingId) exitEditMode();
      openSheet("add-sheet");
      if ($("place-search")) {
        try { $("place-search").focus(); } catch (err) {}
      }
    });
    $("add-go").addEventListener("click", handleAdd);
    if ($("ai-copy-btn")) $("ai-copy-btn").addEventListener("click", copyAiPrompt);
    if ($("ai-preview-toggle")) {
      $("ai-preview-toggle").addEventListener("click", function () {
        var view = $("ai-prompt-view");
        if (!view) return;
        if (view.hidden) {
          view.textContent = aiPromptText();
          view.hidden = false;
          $("ai-preview-toggle").textContent = "收起提示词";
        } else {
          view.hidden = true;
          $("ai-preview-toggle").textContent = "查看提示词";
        }
      });
    }
    if ($("manual-save")) $("manual-save").addEventListener("click", handleManualSave);
    if ($("help-open-btn")) $("help-open-btn").addEventListener("click", openHelp);
    if ($("help-top-btn")) $("help-top-btn").addEventListener("click", openHelp);
    if ($("help-ok")) $("help-ok").addEventListener("click", dismissHelp);
    if ($("install-btn")) $("install-btn").addEventListener("click", function () { openInstall(); });
    if ($("install-banner-go")) {
      $("install-banner-go").addEventListener("click", function () { openInstall(); });
    }
    if ($("install-banner-dismiss")) {
      $("install-banner-dismiss").addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        dismissInstallBanner();
      });
    }
    window.addEventListener("beforeinstallprompt", function (ev) {
      ev.preventDefault();
      installPromptEvent = ev;
    });
    window.addEventListener("appinstalled", function () {
      installPromptEvent = null;
      applyInstallVisibility({ hideInstall: true });
    });
    window.addEventListener("resize", fitTopActions);
    try {
      var dualMq = window.matchMedia && window.matchMedia("(horizontal-viewport-segments: 2)");
      if (dualMq && dualMq.addEventListener) {
        dualMq.addEventListener("change", function () {
          renderAll();
          if (tripMap) setTimeout(function () { tripMap.invalidateSize(); }, 80);
        });
      }
    } catch (err) {}
    applyInstallVisibility(currentEnv());
    bindPlaceSearch();
    $("trip-name-btn").addEventListener("click", startRename);
    $("trip-name-input").addEventListener("blur", finishRename);
    $("trip-name-input").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        ev.target.blur();
      }
      if (ev.key === "Escape") {
        ev.target.value = currentTrip().nameZh || "我的行程";
        ev.target.blur();
      }
    });
    bindStrip();
    document.addEventListener("click", function (ev) {
      var closer = ev.target.closest && ev.target.closest("[data-close]");
      if (closer) {
        var which = closer.getAttribute("data-close");
        if (which === "confirm-sheet") closeConfirm();
        else closeSheet(which);
        if (which === "add-sheet" && editingId) exitEditMode();
      }
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") {
        if ($("confirm-sheet") && !$("confirm-sheet").hidden) {
          closeConfirm();
          return;
        }
        closeSheet("detail-sheet");
        if (editingId) exitEditMode();
        closeSheet("add-sheet");
        closeSheet("settings-sheet");
        closeSheet("install-sheet");
        closeSheet("month-sheet");
      }
    });
    bindAddPick();
    bindEditDelete();
    if ($("changelog-open")) $("changelog-open").addEventListener("click", openChangelog);
    if ($("announce-ok")) $("announce-ok").addEventListener("click", dismissAnnouncement);
    if ($("ios-guide-x")) $("ios-guide-x").addEventListener("click", closeIosGuide);
    if ($("ios-guide-later")) $("ios-guide-later").addEventListener("click", closeIosGuide);
    renderVersionInfo();
    renderHelpBody();
  }

  function init() {
    initChrome();
    var params = new URLSearchParams(window.location.search);
    var demo = params.get("demo");
    if (demo && /^\d{4}-\d{2}-\d{2}$/.test(params.get("today") || "")) todayOverride = params.get("today");
    if (demo) {
      applyDemo(demo);
    } else {
      var stored = loadAllTrips();
      if (stored && stored.trips && stored.trips.length) {
        trips = stored.trips;
        examplesLoaded = !!stored.examplesLoaded;
        activeTripId =
          stored.activeTripId && trips.some(function (t) { return t.id === stored.activeTripId; })
            ? stored.activeTripId
            : trips[0].id;
      } else {
        trips = [emptyTrip()];
        activeTripId = trips[0].id;
        examplesLoaded = false;
      }
      selectedDay = defaultSelectedDay((currentTrip().items || []));
    }
    var wantTrip = params.get("trip");
    if (wantTrip && trips.some(function (t) { return t.id === wantTrip; })) activeTripId = wantTrip;
    renderAll();
    if (demo === "map") setView("map");
    if (demo === "japan-month") openMonth();
    else setView("list");
    if (demo === "add" || demo === "add-search") {
      openSheet("add-sheet");
    }
    if (demo === "add-ai") {
      openSheet("add-sheet");
      if ($("ai-help")) $("ai-help").open = true;
    }
    if (demo === "settings" || demo === "more") openSheet("settings-sheet");
    if (demo === "help" || demo === "help-bottom") openHelp();
    if (demo === "install-ios") openInstall("ios-safari");
    if (demo === "ios-guide") openIosGuide();
    if (demo === "install-inapp") openInstall("inapp");
    if (demo === "announce") openAnnouncement();
    if (demo === "changelog") {
      openSheet("settings-sheet");
      openChangelog();
    }
    /* 打开时：版本变了的老用户弹「新版本」公告；第一次用的人弹使用说明；两者不同时弹。
       使用说明在勾「不再自动弹出」之前每次打开都弹。 */
    if (!demo) runOpenFlow();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
