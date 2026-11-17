/**
 * 行程列表 / 地图 / 添加与导航。默认空行程，不强制载入示例。
 * 连接规则见 legs.js；图标见 icons.js（线性 SVG，不用系统 emoji）。
 */
(function () {
  "use strict";

  /* v6：行程 + 地点库存在 TripStore.KEY（wishlist-map-data-v2），旧的 wishlist-map-trips-v1 只读，用来搬家。见 trip-store.js */
  var LEG_STORAGE_KEY = "wishlist-map-legs-v1";
  var trips = [];
  var places = [];
  var activeTripId = null;
  var examplesLoaded = false;
  var demoMode = false;
  var tripMap = null;
  var mapTiles = "osm"; // 现在只用 OpenStreetMap（WGS-84）；以后换高德底图时改成 "gcj02"，定位点会自动转换
  var tripMarkers = [];
  var expanded = {};
  var pendingPick = null;
  var selectedDay = "all";
  var dayPickedByUser = false; /* v5.4：只有用户自己点过某一天才算，自动选中的「今天」不算 */
  var currentView = "list";
  var listEventsBound = false;
  var DRAG_TIP_KEY = "wishlist-map-drag-tip-v1";
  var LONG_PRESS_MS = 400;
  var LONG_PRESS_MOVE_PX = 10; /* 0.4 秒内移动超过这个距离，当作滚动，取消拖动 */
  var dragTipItemId = "";
  var hotelDatePending = null;
  var hotelOutTimeUserEdited = false;
  var hotelOutTimeSetting = false;
  var flightPairs = {};
  var returnFlightDraft = null;

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

  /* v6：火车 / 船 / 大巴（见 transport.js） */
  function isTransit(item) {
    return window.Transport ? Transport.isTransit(item) : !!item && item.type === "flight";
  }
  /** v6：机票、火车、船有固定时间，跟机票一样上锁、不能拖 */
  function isFixedTime(item) {
    return window.Transport ? Transport.isFixedTime(item) : !!item && item.type === "flight";
  }
  function isGround(item) {
    return !!(window.Transport && Transport.isGround(item));
  }
  function formatGroundLocal(item) {
    var offset = formatDayOffset(civilDayOffset(item.departDate, item.arriveDate));
    var k = Transport.kind(item);
    var no = item.number ? item.number + " " : "";
    return no + (item.departTime ? item.departTime + " " : "") + (item.fromNameZh || k.fromFallback) + " → " +
      (item.arriveTime ? item.arriveTime + offset + " " : "") + (item.nameZh || k.toFallback);
  }
  function formatTransitLocal(item) {
    return isGround(item) ? formatGroundLocal(item) : formatFlightLocal(item);
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

  function loadAllTrips(opts) {
    if (!window.TripStore) return null;
    var res = TripStore.load(localStorage, { readOnly: !!(opts && opts.readOnly), today: todayIso() });
    return res.state;
  }

  function saveAllTrips() {
    if (demoMode || !window.TripStore) return;
    /* 地点缺的坐标 / 城市，用后来补上位置的条目补齐（不覆盖） */
    if (window.Places) {
      trips.forEach(function (t) {
        (t.items || []).forEach(function (it) {
          var p = it && it.placeId ? Places.byId(places, it.placeId) : null;
          if (p) Places.fillFromItem(p, it);
        });
      });
    }
    TripStore.save(localStorage, { trips: trips, places: places, activeTripId: activeTripId, examplesLoaded: examplesLoaded });
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
    if (isTransit(item)) {
      if (!item.departTime && !item.arriveTime) return "";
      var offset = formatDayOffset(civilDayOffset(item.departDate, item.arriveDate));
      return (item.departTime || "") + " – " + (item.arriveTime || "") + offset;
    }
    if (item.type === "hotel") {
      if (item.viewRole === "checkout") {
        var nights = window.FixCand && FixCand.hotelNights ? FixCand.hotelNights(item.checkIn, item.checkOut) : null;
        var when = item.displayTime || item.checkOutTime || "几点退房？";
        return nights ? (when + " · 共 " + nights + " 晚") : when;
      }
      return item.checkInTime || "";
    }
    return item.time || "";
  }

  function itemTitle(item) {
    if (item.type === "flight") return item.flightNo || "航班";
    if (isGround(item)) return Transport.title(item);
    return item.nameZh || item.nameEn || "未命名";
  }

  /** 折叠卡片标题：只改展示，不改存储。店名去掉后面单独的城市；没店名就显示门牌+街道。 */
  function cardHeading(item) {
    if (item.type === "flight" || isGround(item)) return itemTitle(item);
    if (window.Lookup && Lookup.displayTitleForItem) {
      var t = Lookup.displayTitleForItem(item);
      if (t) return t;
    }
    return itemTitle(item);
  }

  function cardAddressRowHtml(address) {
    var a = String(address || "").trim();
    if (!a) return "";
    var ico = '<svg class="addr-ico" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 14.5s4.5-4.2 4.5-7.7A4.5 4.5 0 0 0 3.5 6.8C3.5 10.3 8 14.5 8 14.5z"/><circle cx="8" cy="6.8" r="1.6"/></svg>';
    return '<p class="card-address" data-copy-address="1">' + ico + '<span>' + escapeHtml(a) + "</span></p>";
  }

  function cardTarget(item) {
    if (window.Legs && isTransit(item)) return Legs.endpointFor(item, "dest");
    return {
      id: item.id,
      name: item.nameZh || item.nameEn || "",
      address: item.address || "",
      lat: item.lat,
      lng: item.lng
    };
  }

  function itemUnlocated(item) {
    /* v6：火车 / 船 / 大巴搜不到车站只留名字，不算「待补」 */
    if (isGround(item)) return false;
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
    var list = items || [];
    if (window.Legs) {
      if (Legs.expandViewItems) list = Legs.expandViewItems(list);
      list = Legs.sortedItems(list);
    }
    list.forEach(function (it) {
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

  var stripFocusDay = "";
  var stripNeedScroll = false;
  function rememberStripFocus(items) {
    stripFocusDay = window.TripCalendar && TripCalendar.initialStripFocus
      ? TripCalendar.initialStripFocus(items, todayIso())
      : "";
    stripNeedScroll = true;
  }
  function defaultSelectedDay(items) {
    rememberStripFocus(items);
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
    var monthIso = selectedDay !== "all" && col[selectedDay] ? selectedDay
      : (stripFocusDay && col[stripFocusDay] ? stripFocusDay : (col[today] ? today : days[0]));
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
    var scrollIso = selectedDay !== "all" && col[selectedDay] ? selectedDay
      : (stripFocusDay && col[stripFocusDay] ? stripFocusDay : null);
    if (selectedDay !== "all") scrollStripTo(scrollIso, false);
    else if (stripNeedScroll) {
      scrollStripTo(scrollIso, false);
      stripNeedScroll = false;
    }
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

  function selectDay(iso, fromUser) {
    selectedDay = iso || "all";
    if (fromUser) dayPickedByUser = !!(iso && iso !== "all");
    renderAll();
    scrollStripTo(selectedDay !== "all" ? selectedDay : (stripFocusDay || null), true);
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
          selectDay(today, true);
          return;
        }
        var seg = ev.target.closest && ev.target.closest("[data-seg-label]");
        if (seg) {
          showToast(seg.getAttribute("data-seg-label"), null, 3000);
          return;
        }
        var cell = ev.target.closest && ev.target.closest("[data-day]");
        if (cell) selectDay(cell.getAttribute("data-day"), true);
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
        selectDay(picked, true);
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

  function trimTripName(name) {
    var t = String(name || "");
    var chars = Array.from(t);
    if (chars.length <= 6) return t;
    return chars.slice(0, 6).join("") + "…";
  }

  var TRIP_TIP_KEY = "wishlist-map-trip-tip-v1";
  function maybeShowTripTip() {
    var tip = $("trip-tip");
    if (!tip) return;
    try {
      if (localStorage.getItem(TRIP_TIP_KEY) === "1") {
        tip.hidden = true;
        return;
      }
    } catch (err) {}
    tip.hidden = false;
  }
  function dismissTripTip() {
    var tip = $("trip-tip");
    if (tip) tip.hidden = true;
    try { localStorage.setItem(TRIP_TIP_KEY, "1"); } catch (err) {}
  }

  function updateTopBar() {
    var trip = currentTrip();
    var nameBtn = $("trip-name-btn");
    var dates = $("trip-dates");
    var name = (trip && trip.nameZh) || "我的行程";
    var nameText = $("trip-name-text");
    /* 还是默认名（也没被用户亲手定成这个名字）时，胶囊里直接写「点这里起名」+ 铅笔 */
    var isDefault = (window.TripName ? TripName.isDefaultName(name) : name === "我的行程") &&
      lsGet(window.TripName ? TripName.RENAMED_KEY : "") !== "1";
    var shown = isDefault && window.TripName ? TripName.COPY.hint : trimTripName(name);
    if (nameText) nameText.textContent = shown;
    if ($("trip-pill")) $("trip-pill").classList.toggle("is-default", isDefault);
    if (nameBtn) nameBtn.setAttribute("aria-label", isDefault ? "行程还没有名字，点一下起名" : "行程名称：" + name + "，点一下可以改");
    var countEl = $("trip-count");
    if (countEl) countEl.textContent = " · 共 " + (trips || []).length + " 趟";
    if (dates) {
      dates.hidden = true;
      dates.textContent = "";
    }
    maybeShowTripTip();
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

  /* ---------- v5.2 导航按钮：「带我去」+「看位置」 ---------- */
  var NAV_COPY = {
    go: "带我去",
    look: "看位置",
    noAddr: "位置待确认",
    fixLink: "补上地址 ›",
    far: "这两站之间要坐飞机或火车",
    transitTip: "公交算不出来就换成驾车试试",
    noCoords: "在中国大陆选高德，其他地方选 Google",
    google: "Google 地图",
    amap: "高德"
  };

  /** 你现在在哪：只用定位按钮已经拿到、留在内存里的位置；没有就是 null。从不为了导航主动定位。 */
  function hereInMemory() {
    return window.LocateMe && typeof LocateMe.lastPoint === "function" ? LocateMe.lastPoint() : null;
  }
  var NAV_FAR_KM = 300;

  function pinSvg() {
    return '<svg class="nav-look-ico" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 14.5s4.5-4.2 4.5-7.7A4.5 4.5 0 0 0 3.5 6.8C3.5 10.3 8 14.5 8 14.5z"/><circle cx="8" cy="6.8" r="1.6"/></svg>';
  }

  /**
   * 决定一对按钮的状态。origin 为空 = 从我现在的位置出发。
   * - 终点既没地址也没坐标：两个按钮都灰，写「待补地址」；
   * - 两站之间要坐飞机（上一站是航班）或直线超过 300 公里：不给「带我去」，只留「看位置」；
   */
  function navPlan(origin, dest, opts) {
    opts = opts || {};
    var G = window.GeoUtil;
    if (!G || !dest || !G.pointUsable(dest)) return { state: "noaddr" };
    var far = !!opts.flightBetween;
    if (!far && origin && G.hasPointCoords(origin) && G.hasPointCoords(dest) && G.haversineKm(origin, dest) > NAV_FAR_KM) far = true;
    var here = hereInMemory();
    var place = G.buildPlaceLink(dest, here);
    if (far) return { state: "far", placeHref: place.href };
    var links = G.buildFlexibleNavLinks(origin || null, dest, "公共交通", here);
    /* 没坐标、也不知道你在哪：不替你猜，给「Google 地图」「高德」两个按钮 + 提示（IT老板） */
    if (G.navChoice(dest, here) === "choose") {
      return { state: "choose", googleHref: links.google, amapHref: links.amap };
    }
    return { state: "ok", navHref: links.href, placeHref: place.href, app: links.recommended };
  }

  function isAmapWebHref(href) {
    return !!(href && String(href).indexOf("uri.amap.com") !== -1);
  }

  function mapLinkAttrs(cls, href, extra) {
    href = href || "";
    extra = extra || "";
    if (isAmapWebHref(href)) {
      return 'class="' + cls + ' js-amap-open" href="#" data-amap-web="' + escapeHtml(href) + '"' + extra;
    }
    return 'class="' + cls + '" href="' + escapeHtml(href) + '" target="_blank" rel="noopener"' + extra;
  }

  var amapInstallWebHref = "";
  var amapInstallStoreTimer = null;

  function closeAmapInstall() {
    var el = $("amap-install");
    if (el) el.hidden = true;
    if (amapInstallStoreTimer) {
      clearTimeout(amapInstallStoreTimer);
      amapInstallStoreTimer = null;
    }
  }

  function showAmapInstallDialog(webHref) {
    amapInstallWebHref = webHref || "";
    var el = $("amap-install");
    if (el) el.hidden = false;
  }

  function openAmapWeb(href) {
    if (!href || typeof window === "undefined") return;
    window.open(href, "_blank", "noopener");
  }

  function openAmapFromUi(webHref) {
    if (!webHref) return;
    if (!window.GeoUtil || typeof GeoUtil.openAmap !== "function") {
      openAmapWeb(webHref);
      return;
    }
    GeoUtil.openAmap(webHref, { showInstall: showAmapInstallDialog, openWeb: openAmapWeb });
  }

  function onAmapInstallGo() {
    var G = window.GeoUtil;
    var links = G && G.amapInstallLinks ? G.amapInstallLinks() : null;
    if (!links) return;
    if (amapInstallStoreTimer) {
      clearTimeout(amapInstallStoreTimer);
      amapInstallStoreTimer = null;
    }
    if (links.primary && links.fallback && links.primary !== links.fallback) {
      try { window.location.href = links.primary; } catch (err) {}
      amapInstallStoreTimer = setTimeout(function () {
        amapInstallStoreTimer = null;
        if (links.fallback) openAmapWeb(links.fallback);
      }, 1500);
    } else if (links.primary) {
      openAmapWeb(links.primary);
    }
  }

  function onAmapInstallWeb() {
    var href = amapInstallWebHref;
    closeAmapInstall();
    openAmapWeb(href);
  }

  function navPairHtml(plan, ariaGo, itemId) {
    var go, look, line = "", lineHtml = "";
    if (plan.state === "choose") {
      go = '<a class="nav-look nav-app" href="' + escapeHtml(plan.googleHref) + '" target="_blank" rel="noopener">' + NAV_COPY.google + "</a>";
      look = '<a ' + mapLinkAttrs("nav-look nav-app", plan.amapHref) + ">" + NAV_COPY.amap + "</a>";
      line = NAV_COPY.noCoords;
    } else if (plan.state === "noaddr") {
      go = '<span class="nav-go is-off" aria-disabled="true">' + NAV_COPY.go + "</span>";
      look = '<span class="nav-look is-off" aria-disabled="true">' + pinSvg() + NAV_COPY.look + "</span>";
      /* UI：灰按钮下不再重复「待补地址」，换成可点的「补上地址 ›」，直接打开预填好的搜索 */
      if (itemId) lineHtml = '<button type="button" class="nav-fix-link" data-fix="' + escapeHtml(itemId) + '">' + NAV_COPY.fixLink + "</button>";
      else line = NAV_COPY.noAddr;
    } else {
      look = '<a ' + mapLinkAttrs("nav-look", plan.placeHref) + ">" + pinSvg() + NAV_COPY.look + "</a>";
      if (plan.state === "far") {
        go = "";
        line = NAV_COPY.far;
      } else {
        go = "<a " + mapLinkAttrs("nav-go", plan.navHref, ' aria-label="' + escapeHtml(ariaGo || NAV_COPY.go) + '"') + ">" + NAV_COPY.go + "</a>";
        if (plan.app === "google") line = NAV_COPY.transitTip;
      }
    }
    return (
      '<div class="nav-pair' + (plan.state === "far" ? " is-far" : "") + '">' + go + look + "</div>" +
      (lineHtml || (line ? '<p class="nav-line">' + escapeHtml(line) + "</p>" : ""))
    );
  }

  function navPillHtml(href, label) {
    return (
      '<div class="conn-slot">' +
      '<span class="dash-seg" aria-hidden="true"></span>' +
      "<a " +
      mapLinkAttrs("nav-pill", href) +
      ">" +
      ico("bus", "ico-sm") +
      "<span>" +
      escapeHtml(label) +
      "</span></a>" +
      '<span class="dash-seg" aria-hidden="true"></span>' +
      "</div>"
    );
  }

  function transferHtml(label, changeAirport) {
    var badge = changeAirport ? '<span class="change-airport">要换机场</span>' : "";
    return (
      '<div class="conn-slot">' +
      '<span class="dash-seg" aria-hidden="true"></span>' +
      '<div class="transfer-bar" aria-label="' +
      escapeHtml(label) + (changeAirport ? "，要换机场" : "") +
      '">' +
      ico("transfer") +
      "<span>" +
      escapeHtml(label) +
      "</span>" + badge + "</div>" +
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
    if (item.pendingKind === "flight-reversed") return reversedQuestion(item);
    if (item.pendingKind === "date-ambiguous" && item.pendingReason) return item.pendingReason;
    return item.dateRaw ? "这个时间看不懂：" + item.dateRaw + "，点我改一下" : "没写日期，点我改一下";
  }

  /** 机票「落地比起飞早，日期对吗？」；火车 / 船 / 大巴「到达比出发早，日期对吗？」 */
  function reversedQuestion(item) {
    return isGround(item) ? "到达比出发早，日期对吗？" : "落地比起飞早，日期对吗？";
  }

  /**
   * v6：退房卡第二行「12:00 · 共 2 晚」。宽屏放不下时「· 共 X 晚」先藏起来；
   * 360 窄屏改到第三行（12px #9AA6B2），不再丢掉，也不被「带我去」挡住。
   */
  var TZ_NOTE = "当地时间";
  function checkoutTimeHtml(label) {
    var i = String(label).indexOf(" · ");
    var when = i === -1 ? label : label.slice(0, i);
    var nights = i === -1 ? "" : label.slice(i + 3);
    return '<span class="card-time card-checkout-time"><span class="co-when">' + escapeHtml(when) + "</span>" +
      (nights ? '<span class="card-sub co-sub"><span class="co-dot">· </span><span class="co-nights">' + escapeHtml(nights) + "</span></span>" : "") + "</span>";
  }

  function isPendingItem(item) {
    return !!(item && item.pendingDate);
  }

  /**
   * v5.4：每张卡片只留一个「带我去」——右上角圆形按钮，从你现在的位置出发（不读、不存定位，把起点交给地图 App）。
   * 展开后的内容里只保留「看位置」和「补上地址 ›」，不再放第二个「带我去」。
   * 两站之间的路线交给中间的胶囊。
   */
  function locArrowSvg() {
    return '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M4.2 11.2l15.3-6.7-6.7 15.3-2-7z"/></svg>';
  }
  /* v6：不能拖的两种说法 —— 机票 / 火车 / 船按固定时间；酒店入住、退房两张卡跟着入住日期走 */
  var LOCK_COPY = { fixed: "有固定时间，不能拖", hotel: "跟着入住日期走，不能拖" };
  function lockReason(item) {
    if (!item) return "";
    if (item.type === "hotel" || (window.Legs && Legs.isCheckoutView && Legs.isCheckoutView(item))) return LOCK_COPY.hotel;
    if (isFixedTime(item)) return LOCK_COPY.fixed;
    return "";
  }
  function flightLockSvg(text) {
    text = text || LOCK_COPY.fixed;
    return '<span class="flight-lock" title="' + text + '" aria-label="' + text + '"><svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6.2" width="8" height="6.2" rx="1.2"/><path d="M5 6.2V4.6a2 2 0 0 1 4 0v1.6"/></svg></span>';
  }
  function cardGoHref(item) {
    var dest = cardTarget(item);
    var G = window.GeoUtil;
    if (!G || !dest || !G.pointUsable(dest)) return "";
    var links = G.buildFlexibleNavLinks(null, dest, "公共交通", hereInMemory());
    return links.href || links.google || "";
  }
  function cardGoBtnHtml(item) {
    /* v6.1：机票 / 火车 / 大巴 / 船也放『带我去』，导航到出发机场或车站（不带起点） */
    if (!item) return "";
    var href = cardGoHref(item);
    if (!href) return "";
    return (
      "<a " + mapLinkAttrs("card-go-btn", href, ' title="带我去" aria-label="带我去"') + ">" +
      locArrowSvg() + "<span>带我去</span></a>"
    );
  }
  /** 展开后只放「看位置」或「补上地址 ›」，不要「带我去」。 */
  function cardLookHtml(item) {
    if (!item || isTransit(item)) return "";
    var plan = navPlan(null, cardTarget(item));
    if (plan.state === "noaddr") {
      if (item.id) {
        return '<button type="button" class="nav-fix-link" data-fix="' + escapeHtml(item.id) + '">' + NAV_COPY.fixLink + "</button>";
      }
      return '<p class="nav-line">' + escapeHtml(NAV_COPY.noAddr) + "</p>";
    }
    if (!plan.placeHref) return "";
    return (
      '<div class="card-nav"><a ' + mapLinkAttrs("nav-look", plan.placeHref) + ">" + pinSvg() + NAV_COPY.look + "</a></div>"
    );
  }

  function cardHtml(item, conn) {
    var meta = typeStyle(item);
    var pendingLine = isPendingItem(item)
      ? '<p class="card-raw">' + escapeHtml(pendingText(item)).replace(/(\d{2}\/\d{2} ~ \d{2}\/\d{2})/, '<span class="nowrap">$1</span>') + "</p>"
      : "";
    var open = expanded[item.id] ? " is-open" : "";
    var extra = [];
    var needsAddr = !isTransit(item) && itemUnlocated(item);
    /* 展开后第一行才是完整地址；折叠卡不显示地址。没位置只留一行「位置待确认 ›」，不再叠其他提示。 */
    if (!isTransit(item) && item.address) extra.push(cardAddressRowHtml(item.address));
    var locPendingHtml = needsAddr
      ? '<button type="button" class="loc-pending" data-fix-loc="' + escapeHtml(item.id) + '">位置待确认 ›</button>'
      : "";
    if (item.note) extra.push("<p>" + escapeHtml(item.note) + "</p>");
    if (item.confirmationNo) extra.push("<p>确认号 " + secretToggleHtml(item.confirmationNo) + "</p>");
    if (item.seat) extra.push("<p>座位 " + escapeHtml(item.seat) + "</p>");
    if (item.checkIn && item.checkOut) {
      extra.push("<p>入住 " + escapeHtml(item.checkIn) + "，退房 " + escapeHtml(item.checkOut) + "</p>");
    }
    if (isTransit(item)) extra.push("<p>" + escapeHtml(formatTransitLocal(item)) + "</p>");
    if (item.type === "flight" && flightPairs[item.id] && flightPairs[item.id].otherDate) {
      var pairInfo = flightPairs[item.id];
      extra.push("<p>" + (pairInfo.role === "out" ? "返程 " : "去程 ") + escapeHtml(formatMd(pairInfo.otherDate)) + "</p>");
    }
    /* v5.4：展开后只放「看位置 / 补上地址」，「带我去」在第二行右侧 */
    if (!needsAddr) extra.push(cardLookHtml(item));
    var isCheckout = !!(window.Legs && Legs.isCheckoutView && Legs.isCheckoutView(item));
    var tagHtml = "";
    if (window.Legs && Legs.hasValidHotelStay && Legs.hasValidHotelStay(item)) {
      tagHtml = '<span class="stay-tag">' + (isCheckout ? "退房" : "入住") + "</span>";
    } else if (item.type === "flight" && flightPairs[item.id]) {
      tagHtml = '<span class="leg-tag">' + escapeHtml(flightPairs[item.id].label) + "</span>";
    }
    var timeLabel = itemTimeLabel(item);
    var lockText = lockReason(item);
    var metaMain = tagHtml +
      (timeLabel ? (isCheckout ? checkoutTimeHtml(timeLabel) : '<span class="card-time">' + escapeHtml(timeLabel) + "</span>") : "") +
      /* v6：机票、火车、船的时间都是各自当地时间，旁边小字注明 */
      (timeLabel && isFixedTime(item) ? '<span class="card-sub tz-note">' + TZ_NOTE + "</span>" : "") +
      (lockText ? flightLockSvg(lockText) : "");
    var goBtn = cardGoBtnHtml(item);
    var metaHtml = "";
    if (!pendingLine && (metaMain || goBtn)) {
      metaHtml = '<div class="card-meta-row"><div class="card-meta-main">' + metaMain + "</div>" + goBtn + "</div>";
    }
    if (item.pendingKind === "flight-reversed") {
      pendingLine =
        '<div class="pending-ask"><p class="pending-ask-q">' + escapeHtml(reversedQuestion(item)) + "</p>" +
        '<div class="pending-ask-btns">' +
        '<button type="button" class="pending-ask-ok" data-flight-ok="' + escapeHtml(item.id) + '">对的</button>' +
        '<button type="button" class="pending-ask-edit" data-flight-edit="' + escapeHtml(item.id) + '">改日期</button>' +
        "</div></div>";
    } else if (item.pendingKind === "date-ambiguous" && item.pendingChoices && item.pendingChoices.length === 2) {
      /* v6：「是12月4日还是4月12日？」两个按钮各是一种读法，不替用户猜 */
      pendingLine =
        '<div class="pending-ask"><p class="pending-ask-q">' + escapeHtml(pendingText(item)) + "</p>" +
        '<div class="pending-ask-btns">' +
        item.pendingChoices.map(function (c, k) {
          return '<button type="button" class="' + (k === 0 ? "pending-ask-ok" : "pending-ask-edit") + '" data-date-choice="' + escapeHtml(item.id) + '" data-choice="' + k + '">' + escapeHtml(c.label) + "</button>";
        }).join("") +
        "</div></div>";
    }
    var tipHtml = item.id && item.id === dragTipItemId
      ? '<button type="button" class="drag-tip" data-drag-tip="1">长按卡片拖动，能换顺序或换日子</button>'
      : "";
    return (
      '<article class="card' +
      open +
      (pendingLine ? " is-pending" : "") +
      (tipHtml ? " has-drag-tip" : "") +
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
      "<div class=\"card-copy\">" +
      '<div class="card-name-line"><h3 class="card-name">' +
      escapeHtml(cardHeading(item)) +
      "</h3>" +
      '<button type="button" class="expand-btn" data-expand="' +
      escapeHtml(item.id) +
      '" aria-expanded="' +
      (expanded[item.id] ? "true" : "false") +
      '" aria-label="展开详情">' +
      ico("chevron") +
      "</button></div>" +
      metaHtml +
      pendingLine +
      locPendingHtml +
      (justFixed[item.id] && !needsAddr
        ? '<span class="fixed-pill" role="status"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>' + escapeHtml(FC_COPY.fixed || "已补上") + "</span>"
        : "") +
      "</div>" +
      "</div>" +
      tipHtml +
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

  /* v5.4：相邻两站之间画直线距离胶囊；航班之间仍用转机条。 */
  function connectorSlot(conn) {
    if (!conn) return "";
    if (conn.kind === "transfer") return transferHtml(conn.label, conn.changeAirport);
    return "";
  }

  function legPillHtml(spec) {
    if (!spec || !spec.show || !String(spec.label || "").trim()) return "";
    var origin = spec.from || null;
    var dest = spec.to;
    var href = "#";
    if (window.GeoUtil && dest) {
      var links = GeoUtil.buildFlexibleNavLinks(origin, dest, "公共交通", hereInMemory());
      href = links.href || links.google || "#";
    }
    return (
      '<div class="conn-slot has-leg-pill">' +
      "<a " + mapLinkAttrs("leg-pill", href) + ">" +
      escapeHtml(spec.label) +
      "</a></div>"
    );
  }

  /** 进入这一项的连线（上一站 → 这一项），给卡片里的导航当起点 */
  function connectorInto(connectors, id) {
    for (var i = 0; i < connectors.length; i++) {
      if (connectors[i].toItemId === id) return connectors[i];
    }
    return null;
  }

  var EMPTY_TRIP_COPY = { title: "这趟还是空的", hint: "点『＋ 添加』，加这趟的第一个地方" };

  /* v6：「全部」最下面一组，放还没定日期的（不是待补；待补在最上面单独一块） */
  var UNDATED_KEY = "未标明日期";
  var UNDATED_TITLE = "还没定哪天";
  /** 卡片之间不放路线胶囊；空的时候藏起来，拖动时才露出来当落点 */
  function undatedBlockHtml(g) {
    var items = (g && g.items) || [];
    var out = '<section class="day-block undated-block' + (items.length ? "" : " is-empty") + '" id="day-undated" data-drop-day="">';
    out += '<h3 class="day-subhead">' + UNDATED_TITLE + "</h3>";
    out += '<div class="day-rail">';
    items.forEach(function (item) { out += cardHtml(item, null); });
    out += "</div></section>";
    return out;
  }
  /** 有没有日期定死的条目（酒店、机票、火车、船、大巴）：有才用日程表样式 */
  var ANCHOR_TYPES = ["hotel", "flight", "train", "boat", "bus"];
  function hasAnchorItems(items) {
    return (items || []).some(function (it) {
      return it && ANCHOR_TYPES.indexOf(it.type) !== -1 && !isPendingItem(it) && !!(window.Legs && Legs.itemDisplayDate(it));
    });
  }

  /**
   * 第一天到最后一天之间没有安排的日子补成空组（只给「全部」用；不改数据）。
   * 范围：机票 / 火车 / 船 / 大巴 / 酒店最早的出发 / 入住到最晚的到达 / 退房；别的有日期的条目在外面就再放宽。
   */
  function fillEmptyDays(groups, rawItems) {
    var dated = groups.filter(function (g) { return g.date !== UNDATED_KEY; });
    var rest = groups.filter(function (g) { return g.date === UNDATED_KEY; });
    if (!dated.length || !window.ItemEdit || !ItemEdit.shiftIso) return groups;
    var byDate = {};
    dated.forEach(function (g) { byDate[g.date] = g; });
    var out = [];
    var d = dated[0].date;
    var last = dated[dated.length - 1].date;
    (rawItems || []).forEach(function (it) {
      if (!it || isPendingItem(it) || ANCHOR_TYPES.indexOf(it.type) === -1) return;
      var end = it.type === "hotel" ? it.checkOut : it.arriveDate;
      if (/^\d{4}-\d{2}-\d{2}$/.test(end || "") && end > last && end <= ItemEdit.shiftIso(last, 60)) last = end;
    });
    var guard = 0;
    while (d && d <= last && guard < 400) {
      out.push(byDate[d] || { date: d, header: Legs.formatDayHeader(d), items: [] });
      d = ItemEdit.shiftIso(d, 1);
      guard += 1;
    }
    return out.concat(rest);
  }

  /** 日期小标题吸在日期条下面：量一下顶栏 + 日期条的高度 */
  function syncStickyOffset() {
    var chips = $("day-chips");
    if (!chips) return;
    /* 日期条自己是 sticky（top = 顶栏高度），小标题吸在它下面 */
    var top = parseFloat(getComputedStyle(chips).top) || 0;
    var h = top + chips.offsetHeight;
    try { document.documentElement.style.setProperty("--subhead-top", h + "px"); } catch (err) {}
  }
  /* v6.1：时间不换行、不收缩；后面的小字（当地时间、· 共 N 晚）放不下就整段藏起来，绝不半截截断。 */
  function fitCardMetaSubs(root) {
    root = root || $("timeline") || document;
    var nodes = root.querySelectorAll(".card-meta-main .card-sub");
    Array.prototype.forEach.call(nodes, function (el) {
      el.classList.remove("is-clipped");
    });
    Array.prototype.forEach.call(nodes, function (el) {
      if (el.scrollWidth > el.clientWidth + 1) el.classList.add("is-clipped");
    });
  }

  function renderList() {
    updateFixBanner();
    var root = $("timeline");
    if (!root) return;
    var trip = currentTrip();
    var items = (trip && trip.items) || [];
    updateListHead(items);
    if (!items.length) {
      /* v6：空的这一趟（新建的、清空过的） */
      root.innerHTML = '<div class="empty-state"><strong>' + EMPTY_TRIP_COPY.title + "</strong><p>" + EMPTY_TRIP_COPY.hint + "</p></div>";
      return;
    }
    var pending = items.filter(isPendingItem);
    var datedRaw = items.filter(function (it) { return !isPendingItem(it); });
    flightPairs = (window.Legs && Legs.pairRoundTrips) ? Legs.pairRoundTrips(datedRaw) : {};
    var dated = (window.Legs && Legs.expandViewItems) ? Legs.expandViewItems(datedRaw) : datedRaw;
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
      if (allBtn) allBtn.addEventListener("click", function () { selectDay("all", true); });
      bindListEvents(root);
      return;
    }
    var connectors = Legs.buildConnectors(datedRaw);
    var all = Legs.sortedItems(dated);
    dragTipItemId = "";
    if (!dragTipSeen()) {
      var ti;
      for (ti = 0; ti < all.length; ti++) {
        if (all[ti] && !lockReason(all[ti])) {
          dragTipItemId = all[ti].id;
          break;
        }
      }
    }
    var html = pendingBanner;
    if (pending.length && selectedDay === "all") {
      html += '<section class="day-block pending-block" id="day-pending" aria-label="待确认日期">';
      html += '<h3 class="pending-head">' + ico("calendar", "ico-sm") + "<span>待确认日期</span><span class=\"pending-count\">" + pending.length + " 条 · 点一下改日期</span></h3>";
      pending.forEach(function (item) {
        html += cardHtml(item);
      });
      html += "</section>";
    }
    /*
     * v6（日程表样式）：「全部」里有酒店 / 机票 / 火车 / 船（日期定死的）时，从第一天到最后一天每天一条日期带，
     * 没安排的日子留一块空白当落点，最下面是「还没定哪天」。一个都没有就还是原来的普通列表。
     */
    var agenda = selectedDay === "all" && hasAnchorItems(datedRaw);
    var showAll = agenda;
    var undatedGroup = null;
    if (agenda) groups = fillEmptyDays(groups, datedRaw);
    groups.forEach(function (g) {
      if (selectedDay !== "all" && g.date !== selectedDay) return;
      /* v6：没日期的放到最下面的「还没定哪天」（只在「全部」里出现） */
      if (agenda && g.date === UNDATED_KEY) {
        undatedGroup = g;
        return;
      }
      html += '<section class="day-block" id="day-' + escapeHtml(g.date) + '" data-drop-day="' + escapeHtml(g.date) + '">';
      if (showAll) html += '<h3 class="day-subhead">' + escapeHtml(g.header || formatMd(g.date)) + "</h3>";
      if (!g.items.length) {
        html += '<div class="day-rail day-empty"></div></section>';
        return;
      }
      html += '<div class="day-rail">';
      var untimedHeadDone = false;
      g.items.forEach(function (item, i) {
        var timed = window.Legs && Legs.itemHasTime ? Legs.itemHasTime(item) : true;
        if (!timed && !untimedHeadDone) {
          html += '<h4 class="untimed-head">没定时间</h4>';
          untimedHeadDone = true;
        }
        html += cardHtml(item, i === 0 ? null : connectorInto(connectors, item.id));
        var next = g.items[i + 1];
        if (next) {
          if (item.type === "flight" && next.type === "flight") {
            html += connectorSlot(findConnector(connectors, item.id, next.id));
          }
          if (window.Legs && Legs.navPillSpec) {
            html += legPillHtml(Legs.navPillSpec(item, next));
          }
        } else if (selectedDay === "all") {
          var pos = -1;
          var k;
          for (k = 0; k < all.length; k++) {
            if (all[k].id === item.id) pos = k;
          }
          if (pos >= 0 && pos < all.length - 1) {
            var cross = findConnector(connectors, item.id, all[pos + 1].id);
            if (cross && cross.kind === "transfer") html += connectorSlot(cross);
          }
        }
      });
      if (window.Legs && Legs.trailingHotelPill) html += legPillHtml(Legs.trailingHotelPill(g.items, datedRaw, g.date));
      html += "</div></section>";
    });
    if (showAll) html += undatedBlockHtml(undatedGroup);
    root.innerHTML = html;
    syncStickyOffset();
    bindSecretToggles(root);
    bindListEvents(root);
    fitCardMetaSubs(root);
  }

  function currentViewItems() {
    var items = (currentTrip() && currentTrip().items) || [];
    if (window.Legs && Legs.viewItems) return Legs.viewItems(items, selectedDay);
    return { visible: items, count: (items || []).length, unlocated: [], pins: [], days: [], undated: [], pending: [] };
  }

  function updateListHead(items) {
    var count = $("list-count");
    var btn = $("clear-all-btn");
    var n = (window.Legs && Legs.viewItems) ? Legs.viewItems(items, selectedDay).count : (items || []).length;
    if (count) count.textContent = n ? "共 " + n + " 项" : "";
    if (btn) {
      btn.disabled = !n;
      btn.setAttribute("aria-disabled", n ? "false" : "true");
    }
  }

  function findItem(id) {
    if (returnFlightDraft && (returnFlightDraft.id === id || (!id && returnFlightDraft))) return returnFlightDraft;
    var want = window.Legs && Legs.sourceId ? Legs.sourceId(id) : String(id || "").replace(/::checkout$/, "");
    var items = (currentTrip().items || []);
    var i;
    for (i = 0; i < items.length; i++) {
      if (items[i].id === id || items[i].id === want) return items[i];
    }
    return null;
  }

  function bindListEvents(root) {
    if (listEventsBound) return;
    listEventsBound = true;
    root.addEventListener("click", function (ev) {
      if (dragSuppressClick) {
        ev.preventDefault();
        ev.stopPropagation();
        dragSuppressClick = false;
        return;
      }
      var tip = ev.target.closest && ev.target.closest("[data-drag-tip]");
      if (tip) {
        ev.preventDefault();
        ev.stopPropagation();
        dismissDragTip();
        renderList();
        return;
      }
      var flightOk = ev.target.closest && ev.target.closest("[data-flight-ok]");
      if (flightOk) {
        ev.preventDefault();
        ev.stopPropagation();
        acceptFlightDates(flightOk.getAttribute("data-flight-ok"));
        return;
      }
      var dateChoice = ev.target.closest && ev.target.closest("[data-date-choice]");
      if (dateChoice) {
        ev.preventDefault();
        ev.stopPropagation();
        chooseImportDate(dateChoice.getAttribute("data-date-choice"), Number(dateChoice.getAttribute("data-choice")));
        return;
      }
      var flightEdit = ev.target.closest && ev.target.closest("[data-flight-edit]");
      if (flightEdit) {
        ev.preventDefault();
        ev.stopPropagation();
        enterEditMode(flightEdit.getAttribute("data-flight-edit"));
        return;
      }
      var expand = ev.target.closest && ev.target.closest("[data-expand]");
      if (expand) {
        ev.preventDefault();
        ev.stopPropagation();
        var eid = expand.getAttribute("data-expand");
        expanded[eid] = !expanded[eid];
        renderList();
        /* 展开没坐标的卡片：如果定位权限早就允许过，悄悄取一次位置（不弹窗），拿到后自动选好一个地图 */
        var eit = findItem(eid);
        if (expanded[eid] && eit && !isTransit(eit) && itemUnlocated(eit) && !hereInMemory() && window.LocateMe && LocateMe.warmIfGranted) {
          LocateMe.warmIfGranted(renderList);
        }
        /* v5.3：展开待补的卡片 → 后台找候选（已经找过就直接用内存里的） */
        if (expanded[eid] && eit && !isTransit(eit) && itemUnlocated(eit)) queueCandidates(eit);
        return;
      }
      var fcRow = ev.target.closest && ev.target.closest("[data-fc-item]");
      if (fcRow) {
        ev.preventDefault();
        ev.stopPropagation();
        var fit = findItem(fcRow.getAttribute("data-fc-item"));
        var flist = (fit && window.FixCand && FixCand.getCached(fit)) || [];
        var fc = flist[Number(fcRow.getAttribute("data-fc-i"))];
        if (fc) {
          fcRow.classList.add("is-picked");
          applyCandidate(fit.id, fc);
        }
        return;
      }
      var fcNone = ev.target.closest && ev.target.closest("[data-fc-none]");
      if (fcNone) {
        ev.preventDefault();
        ev.stopPropagation();
        candNone[fcNone.getAttribute("data-fc-none")] = true;
        renderList();
        return;
      }
      var fcMap = ev.target.closest && ev.target.closest("[data-fc-map]");
      if (fcMap) {
        ev.preventDefault();
        ev.stopPropagation();
        openMapPick(fcMap.getAttribute("data-fc-map"));
        return;
      }
      var del = ev.target.closest && ev.target.closest("[data-delete]");
      if (del) {
        ev.preventDefault();
        ev.stopPropagation();
        askDeleteItem(del.getAttribute("data-delete"));
        return;
      }
      var fix = ev.target.closest && ev.target.closest("[data-fix]");
      if (fix) {
        ev.preventDefault();
        ev.stopPropagation();
        openFixAddress(fix.getAttribute("data-fix"));
        return;
      }
      var fixLoc = ev.target.closest && ev.target.closest("[data-fix-loc]");
      if (fixLoc) {
        ev.preventDefault();
        ev.stopPropagation();
        openLocPending(fixLoc.getAttribute("data-fix-loc"));
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
        selectDay("all", true);
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
    bindCardDrag(root);
  }

  function dragTipSeen() {
    try { return localStorage.getItem(DRAG_TIP_KEY) === "1"; } catch (err) { return false; }
  }
  function dismissDragTip() {
    try { localStorage.setItem(DRAG_TIP_KEY, "1"); } catch (err) {}
    dragTipItemId = "";
  }
  function acceptFlightDates(id) {
    var item = findItem(id);
    if (!item || !window.ItemEdit || !ItemEdit.acceptEarlyArrival) return;
    var next = ItemEdit.acceptEarlyArrival(item);
    var trip = currentTrip();
    trip.items = ItemEdit.updateItem(trip.items || [], id, next);
    saveAllTrips();
    renderAll();
  }

  /** v6：导入时月日分不清，用户点了一种读法 */
  function chooseImportDate(id, index) {
    var item = findItem(id);
    if (!item || !window.ImportUtil || !ImportUtil.applyDateChoice) return;
    var next = ImportUtil.applyDateChoice(item, index);
    if (next === item) return;
    var trip = currentTrip();
    trip.items = ItemEdit.updateItem(trip.items || [], id, next);
    saveAllTrips();
    renderAll();
  }

  var dragSuppressClick = false;
  var dragTimer = null;
  var dragState = null;
  var orderUndoSnapshot = null;

  function vibrateBrief() {
    try { if (navigator.vibrate) navigator.vibrate(15); } catch (err) {}
  }

  function clearDragTimer() {
    if (dragTimer) {
      clearTimeout(dragTimer);
      dragTimer = null;
    }
  }

  function interactiveFrom(el) {
    return el && el.closest && el.closest("a, button, input, textarea, select, .leg-pill, .drag-tip, .nav-fix-link, .card-address");
  }

  function bindCardDrag(root) {
    if (root._dragBound) return;
    root._dragBound = true;
    var moveGuard = function (ev) {
      if (dragState && dragState.dragging) ev.preventDefault();
    };
    root.addEventListener("touchmove", moveGuard, { passive: false });
    /* v6：长按卡片不出系统的选字 / 菜单（输入框里照旧），免得把拖动打断 */
    var noNative = function (ev) {
      var t = ev.target;
      if (t && t.nodeType === 3) t = t.parentElement;
      if (!t || !t.closest) return;
      if (t.closest("input, textarea, select, [contenteditable], .card-address")) return;
      if (t.closest(".card")) ev.preventDefault();
    };
    root.addEventListener("contextmenu", noNative);
    root.addEventListener("selectstart", noNative);

    root.addEventListener("pointerdown", function (ev) {
      if (ev.button != null && ev.button !== 0) return;
      if (interactiveFrom(ev.target)) return;
      var card = ev.target.closest && ev.target.closest(".card");
      if (!card || !root.contains(card)) return;
      var id = card.getAttribute("data-item");
      var item = findItem(id);
      if (!item) return;
      var cardIsCheckout = /::checkout$/.test(String(id || "")) || (window.Legs && Legs.isCheckoutView && Legs.isCheckoutView(item));
      var rail = card.closest(".day-rail");
      if (!rail) return;
      var block = card.closest(".day-block");
      if (block && block.classList.contains("pending-block")) return;
      var startX = ev.clientX;
      var startY = ev.clientY;
      var pointerId = ev.pointerId;
      clearDragTimer();
      var cancelled = false;
      var onMoveEarly = function (mv) {
        if (cancelled || (dragState && dragState.dragging)) return;
        var dx = mv.clientX - startX;
        var dy = mv.clientY - startY;
        if (dx * dx + dy * dy > LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX) {
          cancelled = true;
          clearDragTimer();
          cleanupEarly();
        }
      };
      var onUpEarly = function () { cancelled = true; clearDragTimer(); cleanupEarly(); };
      var cleanupEarly = function () {
        root.removeEventListener("pointermove", onMoveEarly);
        root.removeEventListener("pointerup", onUpEarly);
        root.removeEventListener("pointercancel", onUpEarly);
      };
      root.addEventListener("pointermove", onMoveEarly);
      root.addEventListener("pointerup", onUpEarly);
      root.addEventListener("pointercancel", onUpEarly);
      dragTimer = setTimeout(function () {
        dragTimer = null;
        cleanupEarly();
        if (cancelled) return;
        var locked = cardIsCheckout ? LOCK_COPY.hotel : lockReason(item);
        if (locked) {
          dragSuppressClick = true;
          card.classList.remove("is-shake");
          void card.offsetWidth;
          card.classList.add("is-shake");
          setTimeout(function () { card.classList.remove("is-shake"); }, 400);
          showToast(locked, null, 2500);
          return;
        }
        startCardDrag(card, item, rail, startX, startY, pointerId);
      }, LONG_PRESS_MS);
    });
  }

  /**
   * v6：拖动可以跨天。落点是 #timeline 里每一块 .day-block[data-drop-day]（单日视图只有这一天；
   * 「全部」的日程表样式里每天一块，没安排的日子是一块空白，最下面「还没定哪天」）。
   * 拖到哪一块上那块变浅绿；放下：同一天 = 换顺序（v5.4），别的日子 = 改日期，不弹「放哪天？」。
   * 触摸时浏览器可能发 pointercancel（以为要滚动），这时改听 touchmove / touchend 接着拖，不中断。
   */
  function dragBlocks() {
    var root = $("timeline");
    if (!root) return [];
    return Array.prototype.slice.call(root.querySelectorAll(".day-block[data-drop-day]")).map(function (el) {
      return {
        el: el,
        day: el.getAttribute("data-drop-day") || "",
        rail: el.querySelector(".day-rail"),
        cards: Array.prototype.slice.call(el.querySelectorAll(".day-rail .card"))
      };
    });
  }

  function startCardDrag(card, item, rail, startX, startY, pointerId) {
    dismissDragTip();
    vibrateBrief();
    var root = $("timeline");
    if (root) root.classList.add("is-dragging-any");
    var blocks = dragBlocks();
    var home = blocks.filter(function (b) { return b.el.contains(card); })[0];
    if (!home) {
      if (root) root.classList.remove("is-dragging-any");
      return;
    }
    var rect = card.getBoundingClientRect();
    var clone = card.cloneNode(true);
    clone.classList.add("is-drag-clone", "is-lifting");
    clone.style.width = rect.width + "px";
    clone.style.left = rect.left + "px";
    clone.style.top = rect.top + "px";
    document.body.appendChild(clone);
    card.classList.add("is-drag-source");
    var line = document.createElement("div");
    line.className = "drop-line";
    line.setAttribute("aria-hidden", "true");
    dragState = {
      dragging: true,
      id: item.id,
      day: home.day,
      ids: home.cards.map(function (c) { return c.getAttribute("data-item"); }),
      blocks: blocks,
      home: home,
      target: home,
      rail: rail,
      clone: clone,
      source: card,
      line: line,
      insertAt: home.cards.indexOf(card),
      offsetX: startX - rect.left,
      offsetY: startY - rect.top,
      pointerId: pointerId,
      lastX: startX,
      lastY: startY,
      pointerLost: false,
      scrollTimer: null
    };
    try { card.setPointerCapture && card.setPointerCapture(pointerId); } catch (err) {}
    blocks.forEach(function (b) { if (b.rail) b.rail.classList.add("is-dragging"); });
    placeDropLine(home, dragState.insertAt);
    window.addEventListener("pointermove", onDragMove, true);
    window.addEventListener("pointerup", onDragEnd, true);
    window.addEventListener("pointercancel", onPointerLost, true);
    window.addEventListener("touchmove", onDragTouchMove, { capture: true, passive: false });
    window.addEventListener("touchend", onDragTouchEnd, true);
    window.addEventListener("touchcancel", onDragTouchEnd, true);
    dragState.scrollTimer = setInterval(dragAutoScroll, 30);
  }

  function placeDropLine(block, index) {
    var st = dragState;
    if (!st || !block) return;
    var line = st.line;
    if (line.parentNode) line.parentNode.removeChild(line);
    var others = block.cards.filter(function (c) { return c !== st.source; });
    if (index < 0 || index > others.length) index = others.length;
    if (!others.length) {
      if (block.rail) block.rail.appendChild(line);
    } else if (index >= others.length) {
      var last = others[others.length - 1];
      last.parentNode.insertBefore(line, last.nextSibling);
    } else {
      others[index].parentNode.insertBefore(line, others[index]);
    }
    st.blocks.forEach(function (b) { b.el.classList.toggle("is-drop-target", b === block); });
    st.target = block;
    st.insertAt = index;
  }

  /** 手指 / 鼠标在 (x, y)：找落在哪一天、排第几 */
  function dragMoveTo(x, y) {
    var st = dragState;
    if (!st || !st.dragging) return;
    st.lastX = x;
    st.lastY = y;
    st.clone.style.left = x - st.offsetX + "px";
    st.clone.style.top = y - st.offsetY + "px";
    var best = null;
    var bestDist = Infinity;
    st.blocks.forEach(function (b) {
      var r = b.el.getBoundingClientRect();
      if (!r.height) return;
      var dist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (dist < bestDist) {
        bestDist = dist;
        best = b;
      }
    });
    if (!best) return;
    var others = best.cards.filter(function (c) { return c !== st.source; });
    var idx = others.length;
    var i, r2;
    for (i = 0; i < others.length; i++) {
      r2 = others[i].getBoundingClientRect();
      if (y < r2.top + r2.height / 2) {
        idx = i;
        break;
      }
    }
    if (best !== st.target || idx !== st.insertAt) placeDropLine(best, idx);
  }

  function onDragMove(ev) {
    var st = dragState;
    if (!st || !st.dragging || st.pointerLost) return;
    ev.preventDefault();
    dragMoveTo(ev.clientX, ev.clientY);
  }

  /** 浏览器把这次触摸交给了滚动 / 系统手势：不结束拖动，改听 touch 事件 */
  function onPointerLost() {
    if (dragState && dragState.dragging) dragState.pointerLost = true;
  }
  function onDragTouchMove(ev) {
    var st = dragState;
    if (!st || !st.dragging) return;
    ev.preventDefault();
    var t = ev.touches && ev.touches[0];
    if (st.pointerLost && t) dragMoveTo(t.clientX, t.clientY);
  }
  function onDragTouchEnd(ev) {
    var st = dragState;
    if (!st || !st.dragging || !st.pointerLost) return;
    onDragEnd(ev);
  }

  /** 拖到屏幕上下边缘时自动滚一点，好拖到看不见的日子 */
  function dragAutoScroll() {
    var st = dragState;
    if (!st || !st.dragging) return;
    var topEdge = 0;
    var chips = $("day-chips");
    if (chips) topEdge = chips.getBoundingClientRect().bottom;
    var step = 0;
    if (st.lastY < topEdge + 48) step = -12;
    else if (st.lastY > window.innerHeight - 64) step = 12;
    if (!step) return;
    window.scrollBy(0, step);
    dragMoveTo(st.lastX, st.lastY);
  }

  function endDragVisuals() {
    var st = dragState;
    if (!st) return;
    window.removeEventListener("pointermove", onDragMove, true);
    window.removeEventListener("pointerup", onDragEnd, true);
    window.removeEventListener("pointercancel", onPointerLost, true);
    window.removeEventListener("touchmove", onDragTouchMove, { capture: true, passive: false });
    window.removeEventListener("touchend", onDragTouchEnd, true);
    window.removeEventListener("touchcancel", onDragTouchEnd, true);
    if (st.scrollTimer) clearInterval(st.scrollTimer);
    if (st.clone && st.clone.parentNode) st.clone.parentNode.removeChild(st.clone);
    if (st.line && st.line.parentNode) st.line.parentNode.removeChild(st.line);
    if (st.source) st.source.classList.remove("is-drag-source", "is-lifting");
    (st.blocks || []).forEach(function (b) {
      b.el.classList.remove("is-drop-target");
      if (b.rail) b.rail.classList.remove("is-dragging");
    });
    var root = $("timeline");
    if (root) root.classList.remove("is-dragging-any");
  }

  function onDragEnd(ev) {
    var st = dragState;
    if (!st || !st.dragging) return;
    if (ev && ev.cancelable) ev.preventDefault();
    if (ev) ev.stopPropagation();
    dragSuppressClick = true;
    setTimeout(function () { dragSuppressClick = false; }, 400);
    var target = st.target || st.home;
    var insertAt = st.insertAt;
    var moving = st.id;
    var fromDay = st.day;
    var fromIds = st.ids.slice();
    endDragVisuals();
    dragState = null;
    var newIds = target.cards.map(function (c) { return c.getAttribute("data-item"); }).filter(function (id) { return id !== moving; });
    if (insertAt < 0 || insertAt > newIds.length) insertAt = newIds.length;
    newIds.splice(insertAt, 0, moving);
    if (target.day === fromDay) {
      var same = newIds.length === fromIds.length && newIds.every(function (id, i) { return id === fromIds[i]; });
      if (same) return;
      applyReorder(fromDay, newIds, moving);
      return;
    }
    moveItemToDay(moving, target.day, newIds);
  }

  /** 拖到别的日子（或「还没定哪天」）：改日期，按落点排好；底部「已移到 11月17日」+ 撤销 5 秒 */
  var MOVE_COPY = { moved: "已移到 ", undated: "已放进「还没定哪天」" };
  function moveItemToDay(id, day, orderedIds) {
    var trip = currentTrip();
    var item = findItem(id);
    if (!item || !window.ItemEdit || !ItemEdit.moveToDay) return;
    var next = ItemEdit.moveToDay(item, day);
    if (next === item) return;
    var snapshot = snapshotItems();
    trip.items = ItemEdit.updateItem(trip.items || [], id, next);
    if (window.Legs && Legs.applyDayOrder) Legs.applyDayOrder(trip.items, day, orderedIds);
    saveAllTrips();
    renderAll();
    showToast(day ? MOVE_COPY.moved + formatMd(day) : MOVE_COPY.undated, function () {
      var t = currentTrip();
      t.items = snapshot;
      saveAllTrips();
      renderAll();
    }, 5000);
  }

  function snapshotItems() {
    try { return JSON.parse(JSON.stringify((currentTrip().items || []))); } catch (err) { return (currentTrip().items || []).slice(); }
  }

  function applyReorder(day, newIds, movedId) {
    var trip = currentTrip();
    orderUndoSnapshot = snapshotItems();
    if (window.Legs && Legs.applyDayOrder) Legs.applyDayOrder(trip.items || [], day, newIds);
    saveAllTrips();
    renderList();
    var ordered = (window.Legs ? Legs.sortedItems(trip.items) : trip.items || []).filter(function (it) {
      return ((window.Legs && Legs.itemDisplayDate(it)) || "") === day;
    });
    var suggested = window.Legs && Legs.suggestTimeForMove ? Legs.suggestTimeForMove(ordered, movedId) : null;
    function showOrderToast() {
      showToast("已换顺序", function () {
        closeConfirm();
        var t = currentTrip();
        if (orderUndoSnapshot) t.items = orderUndoSnapshot;
        orderUndoSnapshot = null;
        saveAllTrips();
        renderAll();
      }, 5000);
    }
    if (suggested) {
      var moved = findItem(movedId);
      pendingOrderToast = showOrderToast;
      openConfirm({
        title: "要把时间改成 " + suggested + " 吗？",
        okText: "改",
        cancelText: "不改",
        ask: true,
        onOk: function () {
          if (moved && window.Legs && Legs.applySuggestedTime) Legs.applySuggestedTime(moved, suggested);
          saveAllTrips();
          renderAll();
        }
      });
    } else {
      showOrderToast();
    }
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
    if (listView) listView.hidden = isMap;
    if (mapView) mapView.hidden = !isMap;
    paintTopActions();
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
    var host = el.parentElement || el;
    if (window.MapTiles && MapTiles.attach) MapTiles.attach(tripMap, host);
    else {
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(tripMap);
    }
    tripMap.setView([51.5074, -0.1278], 3);
  }

  function renderMap() {
    if (!tripMap) return;
    tripMarkers.forEach(function (m) {
      tripMap.removeLayer(m);
    });
    tripMarkers = [];
    var view = currentViewItems();
    var rows = (view && view.pins) || (Legs.numberedList ? Legs.numberedList(visibleItems()) : []);
    var bounds = [];
    rows.forEach(function (row) {
      var pt = row.marker;
      if (!pt || typeof pt.lat !== "number" || typeof pt.lng !== "number") return;
      var ll = (window.MapTiles && MapTiles.displayLatLng) ? MapTiles.displayLatLng(pt.lat, pt.lng) : pt;
      var meta = typeStyle(row.item);
      var num = row.n ? '<span class="n">' + row.n + "</span>" : "";
      var html =
        '<div class="map-marker" style="' +
        (meta.category === "other" ? "background:" + meta.tint + ";color:" + meta.color : "background:" + meta.color) +
        '">' +
        ico(meta.icon) +
        num +
        "</div>";
      var icon = L.divIcon({
        className: "map-marker-wrap",
        html: html,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      });
      var marker = L.marker([ll.lat, ll.lng], { icon: icon, title: cardHeading(row.item) });
      marker.on("click", function () {
        expanded[row.item.id] = true;
        setView("list");
        renderList();
        var el = document.querySelector('[data-item="' + row.item.id + '"]');
        if (el && el.scrollIntoView) el.scrollIntoView({ block: "center" });
      });
      marker.addTo(tripMap);
      tripMarkers.push(marker);
      bounds.push([ll.lat, ll.lng]);
    });
    if (bounds.length === 1) tripMap.setView(bounds[0], 13);
    else if (bounds.length > 1) tripMap.fitBounds(bounds, { padding: [40, 40] });
    paintMapMiss(view);
  }

  function paintMapMiss(view) {
    var miss = $("map-miss");
    if (!miss) return;
    var list = (view && view.unlocated) || [];
    if (!list.length) {
      miss.hidden = true;
      miss.textContent = "";
      return;
    }
    miss.hidden = false;
    miss.textContent = list.length + " 项还没位置 ›";
    miss.onclick = function () {
      var first = list[0];
      setView("list");
      renderList();
      setTimeout(function () {
        var el = document.querySelector(first ? '[data-item="' + first.id + '"]' : ".card");
        if (el) {
          el.classList.add("is-flash");
          if (el.scrollIntoView) el.scrollIntoView({ block: "center" });
          setTimeout(function () { el.classList.remove("is-flash"); }, 1600);
        }
      }, 80);
    };
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

  function resetAddPasteUi() {
    if ($("add-text")) $("add-text").value = "";
    showAddStatus("");
  }

  function resetSheetScroll(root) {
    if (!root) return;
    function zap(el) {
      if (!el) return;
      try {
        if (el.scrollTop) el.scrollTop = 0;
        if (el.scrollLeft) el.scrollLeft = 0;
      } catch (err) {}
    }
    zap(root);
    Array.prototype.forEach.call(root.querySelectorAll("*"), function (el) {
      if (el.scrollTop || el.scrollLeft) zap(el);
    });
  }

  function syncManualActions() {
    var sheet = $("add-sheet");
    var actions = $("manual-actions");
    var fold = $("manual-fold");
    if (!actions) return;
    var editing = !!(sheet && sheet.classList.contains("is-editing"));
    var open = !!(fold && fold.open);
    actions.hidden = !(editing || open);
  }

  function bindSheetKeyboard() {
    function kbInset() {
      var vv = window.visualViewport;
      if (!vv) return 0;
      return Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    }
    function placeFocusedField() {
      var ae = document.activeElement;
      if (!ae) return;
      var tag = (ae.tagName || "").toLowerCase();
      if (tag !== "input" && tag !== "textarea" && tag !== "select") return;
      var panel = ae.closest && (ae.closest(".sheet-panel") || ae.closest(".hotel-date-panel") || ae.closest(".confirm-panel"));
      if (!panel) return;
      var scroller = panel.querySelector(".sheet-scroll") || panel;
      var bar = panel.querySelector(".sheet-actions:not([hidden])");
      var field = ae.getBoundingClientRect();
      var barTop = bar
        ? bar.getBoundingClientRect().top
        : (window.visualViewport ? window.visualViewport.offsetTop + window.visualViewport.height : window.innerHeight);
      var need = field.bottom + 16 - barTop;
      if (need > 0 && scroller && scroller.scrollTop !== undefined) scroller.scrollTop += need;
    }
    function syncKb() {
      document.documentElement.style.setProperty("--kb-inset", kbInset() + "px");
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(placeFocusedField);
      else placeFocusedField();
    }
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", syncKb);
      window.visualViewport.addEventListener("scroll", syncKb);
    }
    window.addEventListener("focusin", syncKb);
    window.addEventListener("resize", syncKb);
  }

  function openSheet(id) {
    var el = $(id);
    if (id === "add-sheet") {
      resetAddPasteUi();
      syncManualActions();
    }
    if (el) {
      el.hidden = false;
      resetSheetScroll(el);
    }
  }

  function closeSheet(id) {
    var el = $(id);
    var wasOpen = el && !el.hidden;
    if (el) el.hidden = true;
    if (id === "add-sheet") {
      exitFixMode();
      if (wasOpen) setAddPreset("place");
      if (hotelMode) setHotelMode(false);
    }
    if (wasOpen && pendingNameSuggest) setTimeout(flushNameSuggest, 250);
  }

  var HELP_HIDE_KEY = "wishlist-map-help-hide-v1";
  var installPromptEvent = null;

  /* ---------- v5.2 使用说明：三层卡片（文案都在这里一处；第 2、3 层是占位文案，等广告文案宣传大师定稿） ---------- */
  var HELP_PRIVACY_LINE = "发截图前，把护照号、银行卡、手机号裁掉或涂掉";
  /* 界面不用 emoji（UI 要求）：提醒前面放一个 14px 线条提示图标 */
  var HELP_ALERT_SVG = '<svg class="help-alert-ico" viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 1.6l5.6 10H1.4z"/><path d="M7 5.6v2.8"/><path d="M7 10.2v.1"/></svg>';
  /* 新手 3 条文案集中在这一处，改字只动这里。插图放到 cards[].svg（规格 160×96，描边 #0F9D8A、2px；UI 正式稿已内联）。 */
  var HELP_STARTER = {
    title: "新手先看这 3 条",
    subtitle: "把要去的地方放进来，按天排好，出门跟着走",
    cards: [
      { key: "add", title: "想去的地方，先存进来", text: "点底部『＋ 添加』，输入店名或地址，点一下结果就存好了", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 96" width="160" height="96" fill="none" stroke="#0F9D8A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="6" width="54" height="84" rx="8"/><path d="M16 18h38M16 28h30M16 38h34"/><rect x="14" y="66" width="14" height="16" rx="4"/><rect x="32" y="66" width="24" height="16" rx="5" fill="#0F9D8A"/><path d="M44 70v8M40 74h8" stroke="#fff"/><circle cx="44" cy="74" r="13" stroke-width="1.5" stroke-dasharray="2 3"/><path d="M66 48h10M72 44l4 4-4 4"/><rect x="82" y="6" width="70" height="84" rx="8"/><rect x="88" y="14" width="58" height="14" rx="7"/><circle cx="96" cy="21" r="3"/><path d="M98.5 23.5l2 2M104 21h20"/><rect x="88" y="34" width="58" height="18" rx="5"/><path d="M96 38.5c-2.2 0-3.5 1.6-3.5 3.4 0 2.6 3.5 5.6 3.5 5.6s3.5-3 3.5-5.6c0-1.8-1.3-3.4-3.5-3.4z"/><path d="M104 40h28M104 46h18"/><circle cx="118" cy="43" r="13" stroke-width="1.5" stroke-dasharray="2 3"/><path d="M88 64h58" stroke-dasharray="3 3"/><path d="M88 74h30M88 82h22"/></svg>' },
      {
        key: "ai",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 96" width="160" height="96" fill="none" stroke="#0F9D8A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="14" width="40" height="64" rx="7"/><path d="M10 24h24M10 32h28M10 40h18"/><rect x="10" y="48" width="22" height="11" rx="5.5" fill="#0F9D8A"/><path d="M16 53.5h10" stroke="#fff"/><circle cx="21" cy="53.5" r="10" stroke-width="1.5" stroke-dasharray="2 3"/><path d="M47 46h8M51 42l4 4-4 4"/><rect x="58" y="14" width="44" height="64" rx="7"/><path d="M80 20l1.8 4 4 1.8-4 1.8-1.8 4-1.8-4-4-1.8 4-1.8z"/><rect x="74" y="38" width="22" height="9" rx="4.5"/><rect x="84" y="50" width="12" height="15" rx="2"/><rect x="80" y="53" width="12" height="15" rx="2" fill="#fff"/><rect x="63" y="38" width="8" height="8" rx="2" opacity="0"/><rect x="63" y="68" width="22" height="0" opacity="0"/><rect x="63" y="56" width="13" height="8" rx="4"/><path d="M105 46h8M109 42l4 4-4 4"/><rect x="116" y="14" width="40" height="64" rx="7"/><path d="M122 24h24M122 32h18"/><rect x="121" y="58" width="30" height="12" rx="6" fill="#0F9D8A"/><path d="M128 64h16" stroke="#fff"/><circle cx="136" cy="64" r="11" stroke-width="1.5" stroke-dasharray="2 3"/></svg>',
        title: "各种订单、攻略截图，都能变成行程",
        lead: "车票机票、酒店订单、小红书、抖音、大众点评都行",
        steps: [
          "在这里点『复制』，复制一段给 AI 的话",
          "打开你手机上的 AI App（豆包、DeepSeek、ChatGPT 都行），先粘贴，再把截图发过去，一张或好几张都行",
          "把 AI 的回复全部复制，回到这里点『粘贴并导入』"
        ]
      },
      { key: "map", title: "到了当天，一键导航", text: "点卡片上的『带我去』，手机地图会直接带你过去", line: "长按卡片拖动，能换顺序或换日子", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 96" width="160" height="96" fill="none" stroke="#0F9D8A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="12" width="88" height="40" rx="8"/><path d="M14 26h34M14 36h22"/><rect x="58" y="22" width="30" height="20" rx="10" fill="#0F9D8A"/><path d="M67 32h11M75 29l3 3-3 3" stroke="#fff"/><circle cx="73" cy="32" r="15" stroke-width="1.5" stroke-dasharray="2 3"/><path d="M98 34c14 0 10 22 22 22s10-24 20-30" stroke-dasharray="3 4"/><path d="M140 8c-5 0-8 4-8 8 0 6 8 13 8 13s8-7 8-13c0-4-3-8-8-8z"/><circle cx="140" cy="16" r="2.5"/><rect x="6" y="68" width="20" height="20" rx="5"/><path d="M10 74l4-2 4 2 4-2v10l-4 2-4-2-4 2z"/><rect x="32" y="68" width="62" height="20" rx="6" fill="#0F9D8A"/><path d="M63 73v10M58 78h10" stroke="#fff"/></svg>' }
    ]
  };

  var HELP_TIERS = {
    starter: HELP_STARTER,
    /* 第 2、3 层：广告文案宣传大师定稿（v5.2）。每条都对过代码：分享会去掉确认号 / 座位；按钮名「完整备份」「导入」「清空本机数据」；地图按钮在底部『添加』左边、定位按钮在地图右下角；没有账号。 */
    common: {
      title: "常用",
      items: [
        { key: "day", icon: "calendar", title: "看行程", text: "顶部日期条左右滑，点哪天就看哪天" },
        { key: "edit", icon: "trash", title: "改和删", text: "点开卡片就能改。删错了，马上点底部的『撤销』就能恢复" },
        { key: "map", icon: "map", title: "地图", text: "点『添加』左边的『地图』，所有地点一眼看全，再点『列表』回来。右下角的按钮能定位到你自己" },
        { key: "share", icon: "share", title: "分享我的行程", text: "发给同行的人，订单号和座位会自动隐藏" },
        { key: "install", icon: "device", title: "放到桌面", text: "像 App 一样，点图标就打开" },
        { key: "rename", icon: "pencil", title: "多个行程", text: "点『＋ 新行程』再建一趟；点左上角的行程名，能切换、改名、删除" },
        /* v5.3 定稿 */
        { key: "fixplace", icon: "pin", title: "补位置", text: "卡片上写着「位置待确认」的，点它就能补，不补也不影响用" }
      ]
    },
    faq: {
      title: "需要时再看",
      items: [
        { q: "换手机", a: "在设置里点『完整备份』，到新手机上点『导入』" },
        { q: "更新", a: "看到「有新版本」就点『立即更新』，行程不会丢。还是旧版，就把网页彻底关掉再打开" },
        { q: "隐私", a: "行程只存在你手机里，没有账号，我们看不到。看地图、找位置和导航时，看的区域、地址和邮编会发给地图和邮编查询服务。在国内搜地点时，搜的字会发给高德" },
        { q: "清空", a: "在使用说明最下面点『清空本机数据』，会删掉所有行程" }
      ]
    }
  };

  /* 新手 3 条插图：卡片可带完整 inline SVG（UI 定稿规格：160×96，描边 #0F9D8A、2px）。
     有 c.svg 且是以 <svg 开头的字符串就原样放入（补上 help-card-illu 类名）；否则用同规格占位图。 */
  var HELP_ILLU_PLACEHOLDER = {
    add: '<rect x="48" y="16" width="64" height="68" rx="8"/><path d="M80 38v24M68 50h24"/>',
    ai: '<rect x="30" y="16" width="44" height="64" rx="6"/><path d="M40 30h24M40 40h24M40 50h16"/><path d="M86 48h18"/><path d="M98 40l8 8-8 8"/><path d="M124 28l4 8 8 4-8 4-4 8-4-8-8-4 8-4z"/>',
    map: '<path d="M20 24l36-10 42 12 38-10v60l-38 10-42-12-36 10z"/><path d="M56 14v60M98 26v60"/><circle cx="82" cy="46" r="6"/>'
  };

  function helpIllu(card) {
    var raw = card && typeof card.svg === "string" ? String(card.svg).trim() : "";
    if (raw && /^<svg[\s>]/i.test(raw) && raw.toLowerCase().indexOf("</svg>") !== -1) {
      if (raw.indexOf("help-card-illu") === -1) {
        raw = raw.replace(/<svg\b/i, '<svg class="help-card-illu"');
      }
      return raw;
    }
    var key = typeof card === "string" ? card : (card && card.key) || "";
    var body = HELP_ILLU_PLACEHOLDER[key] || "";
    return '<svg class="help-card-illu" viewBox="0 0 160 96" width="160" height="96" fill="none" stroke="#0F9D8A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-hidden="true">' + body + "</svg>";
  }

  function renderHelpBody() {
    var box = $("help-body");
    if (!box) return;
    /* v6：「清空本机数据」放在使用说明最下面（内容区里，滚到底才看到）；先拿出来，重画后放回最后 */
    var danger = document.querySelector(".help-danger");
    if (danger && danger.parentNode) danger.parentNode.removeChild(danger);
    var T = HELP_TIERS;
    var cards = T.starter.cards.map(function (c, i) {
      var paras = (c.texts && c.texts.length ? c.texts : (c.text ? [c.text] : [])).map(function (para) {
        return "<p>" + escapeHtml(para) + "</p>";
      }).join("");
      var lead = c.lead ? '<p class="help-card-lead">' + escapeHtml(c.lead) + "</p>" : "";
      var steps = "";
      if (c.steps && c.steps.length) {
        steps = '<ol class="ai-steps">' + c.steps.map(function (s, n) {
          return '<li class="ai-step" data-step="' + (n + 1) + '"><p class="ai-step-text">' + escapeHtml(s) + "</p></li>";
        }).join("") + "</ol>";
      }
      return (
        '<div class="help-card" data-card="' + c.key + '">' + helpIllu(c) +
        '<div class="help-card-n">' + (i + 1) + " / " + T.starter.cards.length + "</div>" +
        "<h4>" + escapeHtml(c.title) + "</h4>" + lead + paras + steps +
        (c.line ? '<p class="help-card-line">' + escapeHtml(c.line) + "</p>" : "") + "</div>"
      );
    }).join("");
    var dots = T.starter.cards.map(function (c, i) {
      return '<span class="help-dot' + (i === 0 ? " is-on" : "") + '"></span>';
    }).join("");
    var grid = T.common.items.map(function (it) {
      return (
        '<button type="button" class="help-tile" data-tile="' + it.key + '"' + (it.key === "install" ? ' id="help-install-tile"' : "") + ' aria-expanded="false">' +
        ico(it.icon) + "<span>" + escapeHtml(it.title) + "</span></button>"
      );
    }).join("");
    var faq = T.faq.items.map(function (f) {
      return '<details class="help-faq"><summary>' + escapeHtml(f.q) + "</summary><p>" + escapeHtml(f.a) + "</p></details>";
    }).join("");
    box.innerHTML =
      '<section class="help-tier help-tier-1"><h3>' + escapeHtml(T.starter.title) + "</h3>" +
      (T.starter.subtitle ? '<p class="help-tier-sub">' + escapeHtml(T.starter.subtitle) + "</p>" : "") +
      '<p class="help-privacy">' + HELP_ALERT_SVG + "<span>" + escapeHtml(HELP_PRIVACY_LINE) + "</span></p>" +
      '<div class="help-cards" id="help-cards">' + cards + "</div>" +
      '<div class="help-dots" aria-hidden="true">' + dots + "</div>" +
      '<button type="button" class="help-more" id="help-more">看更多说明</button></section>' +
      '<section class="help-tier help-tier-2"><h3>' + escapeHtml(T.common.title) + "</h3>" +
      '<div class="help-grid">' + grid + "</div>" +
      '<div class="help-tile-detail" id="help-tile-detail" hidden></div></section>' +
      '<section class="help-tier help-tier-3"><h3>' + escapeHtml(T.faq.title) + "</h3>" + faq + "</section>";
    if (danger) box.appendChild(danger);
    var strip = $("help-cards");
    if (strip) {
      strip.addEventListener("scroll", function () {
        var w = strip.firstElementChild ? strip.firstElementChild.getBoundingClientRect().width + 12 : 1;
        var n = Math.round(strip.scrollLeft / w);
        Array.prototype.forEach.call(box.querySelectorAll(".help-dot"), function (d, i) {
          d.classList.toggle("is-on", i === n);
        });
      }, { passive: true });
    }
    var more = $("help-more");
    if (more) more.addEventListener("click", function () {
      var sh = $("help-sheet");
      if (sh) sh.classList.remove("help-first");
    });
    Array.prototype.forEach.call(box.querySelectorAll(".help-tile"), function (b) {
      b.addEventListener("click", function () { showHelpTile(b.getAttribute("data-tile")); });
    });
    applyInstallVisibility(currentEnv());
  }

  function showHelpTile(key) {
    var detail = $("help-tile-detail");
    if (!detail) return;
    var it = HELP_TIERS.common.items.filter(function (x) { return x.key === key; })[0];
    var already = !detail.hidden && detail.getAttribute("data-key") === key;
    Array.prototype.forEach.call(document.querySelectorAll(".help-tile"), function (b) {
      var on = !already && b.getAttribute("data-tile") === key;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-expanded", on ? "true" : "false");
    });
    if (!it || already) {
      detail.hidden = true;
      detail.removeAttribute("data-key");
      return;
    }
    detail.setAttribute("data-key", key);
    detail.innerHTML =
      "<strong>" + escapeHtml(it.title) + "</strong>：" + escapeHtml(it.text) +
      (key === "install"
        ? '<button type="button" class="help-install-btn" id="help-install-btn">' + ico("device") + "<span>放到手机桌面</span></button>"
        : "");
    detail.hidden = false;
    var btn = $("help-install-btn");
    if (btn) btn.addEventListener("click", function () {
      closeSheet("help-sheet");
      openInstall();
    });
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

  /** mode "first"：第一次打开自动弹，只显示「新手先看这 3 条」，点「看更多说明」再展开；手动打开显示全部三层。 */
  function openHelp(mode) {
    var sh = $("help-sheet");
    if (sh) sh.classList.toggle("help-first", mode === "first");
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
    var span = btn.querySelector(":scope > span:last-child");
    var prev = btn.getAttribute("data-label") || (span ? span.textContent : btn.textContent);
    btn.setAttribute("data-label", prev);
    if (span) span.textContent = AI_WIZARD_COPY.copied;
    else btn.textContent = AI_WIZARD_COPY.copied;
    /* 向导里的复制按钮一直显示描边的「已复制」，直到下次打开向导 */
    if (btn.id === "ai-copy-btn") {
      setAiStep(Math.max(aiStep, 2));
      return;
    }
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
    var label = btn.getAttribute("data-label") || AI_WIZARD_COPY.copyBtn;
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

  /* ---------- v5.2 AI 向导：文案都在这一处 ---------- */
  /* v5.3（IT老板 批准，文案定稿）：点「＋ 添加」先弹「添加什么？」，文案都在这里 */
  var ADD_MENU_COPY = {
    title: "添加什么？",
    flight: "加机票",
    flightSub: "截图交给 AI，自动整理",
    hotel: "加酒店",
    hotelSub: "搜酒店名，点一下加进行程",
    place: "加地点",
    placeSub: "吃的、玩的、逛的",
    whole: "有整份行程截图？交给 AI 一次整理 ›",
    hotelPlaceholder: "输入酒店名，或粘贴地址",
    hotelTitle: "加酒店",
    back: "返回「添加什么？」",
    /* v6：「找不到？在地图上选」和「手动填地址」合成一行，点开再选（文案定稿 19:43） */
    fallback: "找不到？换个方式加 ›",
    fallbackTitle: "找不到？换个方式加",
    fallbackMap: "在地图上选",
    fallbackManual: "手动填地址",
    mapHotelName: "未命名酒店",
    placePlaceholder: "输入店名，或粘贴地址"
  };
  var addPreset = ""; /* "酒店" = 从「加酒店」进来，搜到的结果按酒店加 */
  var hotelMode = false; /* 「加酒店」页：标题「加酒店」、‹ 返回、没有 AI 大按钮和手动填写、能在地图上选 */
  var HOTEL_BED_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 18V7"/><path d="M3 14h18v4"/><path d="M21 14v-3a3 3 0 0 0-3-3h-7v6"/><circle cx="7" cy="11" r="2"/></svg>';

  /** v5.4：建议日期不再用今天。真正写入要等面板上点「加进行程」。 */
  function hotelPrefillSelected() {
    return dayPickedByUser ? selectedDateOrEmpty() : "";
  }
  function applyHotelDates(item) {
    if (!item || item.type !== "hotel") return item;
    var d = FC().hotelDates(hotelPrefillSelected(), tripDays(currentTrip().items || []), "");
    if (d) {
      item.checkIn = d.checkIn;
      item.checkOut = d.checkOut;
      delete item.date;
    }
    return item;
  }
  function normalizeHmInput(raw) {
    var s = String(raw || "").trim();
    if (!s) return "";
    if (/[ap]\.?m\.?/i.test(s)) return "";
    var m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) {
      var digits = s.replace(/\D/g, "");
      if (digits.length === 3 || digits.length === 4) {
        if (digits.length === 3) digits = "0" + digits;
        m = ["", digits.slice(0, 2), digits.slice(2)];
      }
    }
    if (!m) return "";
    var h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) return "";
    return (h < 10 ? "0" : "") + h + ":" + (min < 10 ? "0" : "") + min;
  }
  function syncHotelDateUi() {
    var inn = ($("hotel-check-in") && $("hotel-check-in").value) || "";
    var out = ($("hotel-check-out") && $("hotel-check-out").value) || "";
    var st = FC().hotelDateState(inn, out);
    if ($("hotel-out-box")) $("hotel-out-box").classList.toggle("is-invalid", st.reason === "invalid");
    if ($("hotel-date-hint")) $("hotel-date-hint").textContent = st.hint || "";
    if ($("hotel-date-nights")) $("hotel-date-nights").textContent = st.nights ? ("共 " + st.nights + " 晚") : "共 — 晚";
    if ($("hotel-check-out-time") && !hotelOutTimeUserEdited && window.Legs && Legs.checkoutTimeInfo) {
      var pending = hotelDatePending && hotelDatePending.item;
      var info = Legs.checkoutTimeInfo({
        checkOut: out,
        checkOutTime: hotelOutTimeUserEdited ? $("hotel-check-out-time").value : (pending && pending.checkOutTime) || ""
      }, (currentTrip().items || []));
      if (!pending || !pending.checkOutTime) {
        hotelOutTimeSetting = true;
        $("hotel-check-out-time").value = info.time || "";
        hotelOutTimeSetting = false;
        if ($("hotel-date-time-auto")) $("hotel-date-time-auto").hidden = !info.autoFromFlight;
      } else if ($("hotel-date-time-auto")) {
        $("hotel-date-time-auto").hidden = true;
      }
    } else if ($("hotel-date-time-auto")) {
      $("hotel-date-time-auto").hidden = true;
    }
    if ($("hotel-date-summary")) {
      $("hotel-date-summary").textContent = (inn && out) ? (formatMd(inn) + "入住，" + formatMd(out) + "退房") : "";
    }
    var go = $("hotel-date-go");
    if (go) {
      go.disabled = !st.ok;
      go.classList.toggle("is-off", !st.ok);
    }
  }
  function closeHotelDateSheet() {
    hotelDatePending = null;
    hotelOutTimeUserEdited = false;
    closeSheet("hotel-date-sheet");
  }
  function openHotelDateSheet(item, addFn) {
    hotelDatePending = { item: item, addFn: addFn };
    hotelOutTimeUserEdited = !!(item && item.checkOutTime);
    var d = FC().hotelDates(hotelPrefillSelected(), tripDays(currentTrip().items || []), "");
    if ($("hotel-check-in")) $("hotel-check-in").value = (d && d.checkIn) || "";
    if ($("hotel-check-out")) $("hotel-check-out").value = (d && d.checkOut) || "";
    if ($("hotel-check-out-time")) $("hotel-check-out-time").value = (item && item.checkOutTime) || "";
    syncHotelDateUi();
    openSheet("hotel-date-sheet");
  }
  function confirmHotelDates() {
    if (!hotelDatePending) return;
    var inn = ($("hotel-check-in") && $("hotel-check-in").value) || "";
    var out = ($("hotel-check-out") && $("hotel-check-out").value) || "";
    var st = FC().hotelDateState(inn, out);
    if (!st.ok) {
      if ($("hotel-date-hint")) $("hotel-date-hint").textContent = st.hint || "先选入住和退房日期";
      return;
    }
    var item = hotelDatePending.item;
    var addFn = hotelDatePending.addFn;
    item.checkIn = inn;
    item.checkOut = out;
    var outTime = normalizeHmInput(($("hotel-check-out-time") && $("hotel-check-out-time").value) || "");
    if (hotelOutTimeUserEdited && outTime) item.checkOutTime = outTime;
    else delete item.checkOutTime;
    delete item.date;
    hotelDatePending = null;
    hotelOutTimeUserEdited = false;
    closeSheet("hotel-date-sheet");
    addFn(item);
  }
  function afterHotelReady(item, addFn) {
    if (item && item.type === "hotel") openHotelDateSheet(item, addFn);
    else addFn(item);
  }
  function bindHotelDateSheet() {
    ["hotel-check-in", "hotel-check-out"].forEach(function (id) {
      if ($(id)) {
        $(id).addEventListener("input", syncHotelDateUi);
        $(id).addEventListener("change", syncHotelDateUi);
      }
    });
    if ($("hotel-check-out-time")) {
      $("hotel-check-out-time").addEventListener("input", function () {
        if (hotelOutTimeSetting) return;
        hotelOutTimeUserEdited = true;
        if ($("hotel-date-time-auto")) $("hotel-date-time-auto").hidden = true;
      });
      $("hotel-check-out-time").addEventListener("change", function () {
        if (hotelOutTimeSetting) return;
        hotelOutTimeUserEdited = true;
        if ($("hotel-date-time-auto")) $("hotel-date-time-auto").hidden = true;
        this.value = normalizeHmInput(this.value);
      });
      $("hotel-check-out-time").addEventListener("blur", function () {
        if (hotelOutTimeSetting) return;
        var next = normalizeHmInput(this.value);
        if (this.value && !next) this.value = "";
        else if (next) this.value = next;
      });
    }
    if ($("hotel-date-go")) $("hotel-date-go").addEventListener("click", confirmHotelDates);
  }

  function setHotelMode(on) {
    hotelMode = !!on;
    var sheet = $("add-sheet");
    if (sheet) sheet.classList.toggle("is-hotel", hotelMode);
    if ($("add-sheet-back")) $("add-sheet-back").hidden = !hotelMode;
    syncAddFallback();
    var title = $("add-sheet-title");
    if (title && !editingId && !fixingId) title.textContent = hotelMode ? ADD_MENU_COPY.hotelTitle : "添加";
  }

  var AI_WIZARD_COPY = {
    bigSub: "截图交给 AI，自动排好行程",
    title: "截图交给 AI，自动排好行程",
    /* v6：一个按钮「给 AI 的话」先打开全文，下面「复制」（文案定稿） */
    step1: "点『给 AI 的话』看一眼，再点下面的『复制』",
    promptBtn: "给 AI 的话",
    copyBtn: "复制",
    copied: "已复制",
    step2: "打开你常用的 AI（豆包、Kimi、DeepSeek、ChatGPT 都行），先粘贴，再把截图发过去，好几张可以一起发",
    /* v5.3 定稿：步骤 2 下面的小字 */
    step2Small: "不会截图？同时按侧边键和音量加键",
    privacy: "发截图前，把护照号、银行卡、手机号裁掉或涂掉",
    step3: "把 AI 的回复整段复制，回来点『粘贴并导入』",
    step3Small: "手机弹出「粘贴」或「允许」时，再点一下就行",
    pasteBtn: "粘贴并导入",
    fallbackHint: "长按这里，选『粘贴』，再点『添加』",
    fail: "没认出来，把 AI 的回复整段复制过来再试一次"
  };

  /* v6.1 导入结果（文案可再由文案定稿，都放这里） */
  var IMPORT_COPY = {
    toastOk: function (n) { return "已导入 " + n + " 项"; },
    toastNeed: function (n, y) { return "已导入 " + n + " 项，其中 " + y + " 项要补信息"; },
    none: "没读到行程，把 AI 的回复整段粘贴进来再试一次",
    lineDate: function (n) { return "第 " + n + " 行：日期不对"; },
    lineCols: function (n) { return "第 " + n + " 行：没认出来"; },
    fileBad: "这个文件打不开，要用这里导出的备份或分享文件"
  };
  var aiStep = 1;

  /** v6：打开 / 收起「给 AI 的话」全文（下面是「复制」） */
  function showAiPrompt(on) {
    var box = $("ai-prompt-box");
    if (!box) return;
    if (on && $("ai-prompt-view")) $("ai-prompt-view").textContent = aiPromptText();
    box.hidden = !on;
    if ($("ai-prompt-open")) $("ai-prompt-open").setAttribute("aria-expanded", on ? "true" : "false");
  }

  function setAiStep(n) {
    aiStep = n;
    Array.prototype.forEach.call(document.querySelectorAll("#ai-progress .ai-prog-seg"), function (seg) {
      seg.classList.toggle("is-on", Number(seg.getAttribute("data-step")) <= n);
    });
    var bar = $("ai-progress");
    if (bar) bar.setAttribute("aria-valuenow", String(n));
    Array.prototype.forEach.call(document.querySelectorAll("#ai-help .ai-step"), function (li) {
      var k = Number(li.getAttribute("data-step"));
      li.classList.toggle("is-current", k === n);
      li.classList.remove("is-done");
    });
  }

  function fillAiWizardText() {
    var C = AI_WIZARD_COPY;
    var put = function (id, t) { var el = $(id); if (el) el.textContent = t; };
    put("ai-big-sub", C.bigSub);
    put("ai-wiz-title", C.title);
    put("ai-step1-text", C.step1);
    put("ai-step2-text", C.step2);
    put("ai-step2-small", C.step2Small);
    put("ai-step2-privacy", C.privacy);
    put("ai-step3-text", C.step3);
    put("ai-step3-small", C.step3Small);
    put("ai-paste-btn", C.pasteBtn);
    var ta = $("add-text");
    if (ta) ta.setAttribute("placeholder", C.fallbackHint);
  }

  function openAiWizard(show) {
    var box = $("ai-help");
    var btn = $("ai-big-btn");
    if (!box) return;
    var open = show == null ? box.hidden : !!show;
    box.hidden = !open;
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      fillAiWizardText();
      var copy = $("ai-copy-btn");
      if (copy) {
        copy.classList.remove("is-copied");
        decorateCopyBtn();
      }
      showAiPrompt(false);
      var fb = $("ai-fallback");
      if (fb) fb.hidden = true;
      setAiStep(1);
    }
  }

  function showAiFallback() {
    var fb = $("ai-fallback");
    if (fb) fb.hidden = false;
    var ta = $("add-text");
    if (ta) ta.setAttribute("placeholder", AI_WIZARD_COPY.fallbackHint);
  }

  /** 向导里的导入：认不出任何一行就提示，并展开手动粘贴框。 */
  function wizardImport(text) {
    var t = String(text || "");
    var ok = t.trim() && looksStructured(t) && window.ImportUtil && (ImportUtil.parseImport(t).items || []).length;
    if (!ok) {
      showAddStatus('<p class="err">' + escapeHtml(AI_WIZARD_COPY.fail) + "</p>");
      showAiFallback();
      return false;
    }
    runStructuredImport(t);
    return true;
  }

  function pasteAndImport() {
    setAiStep(3);
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== "function") {
      showAiFallback();
      return;
    }
    navigator.clipboard.readText().then(function (text) {
      if (!String(text || "").trim()) {
        showAiFallback();
        return;
      }
      if ($("add-text")) $("add-text").value = text;
      wizardImport(text);
    }, function () {
      showAiFallback();
    });
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
      showManualStatus('<p class="err">机票请用『给 AI 的话』整理截图，或把「机票 | 航班号 | LHR - HND | 起飞时间 ~ 落地时间 | 」粘贴到「用 AI 帮我整理」里的框中。</p>');
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
      if (pickedIcon) hotel.icon = pickedIcon;
      afterHotelReady(hotel, function (h) {
        showManualStatus('<p class="ok">正在查找位置…</p>');
        Geocode.resolveItem(h, dayArgsFor(h))
          .then(function (res) {
            finishImport([h], [res], []);
          })
          .catch(function () {
            finishImport(
              [h],
              [{ item: h, status: "none", message: Geocode.FRIENDLY_NOT_FOUND, candidates: [], chosen: null }],
              []
            );
          });
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
    if (pickedIcon) item.icon = pickedIcon;
    showManualStatus('<p class="ok">正在查找位置…</p>');
    Geocode.resolveItem(item, dayArgsFor(item))
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


  /* ---------- 详情 / 修改 / 删除 / 清空这趟 ---------- */
  var UNDO_MS = (window.ItemEdit && ItemEdit.UNDO_MS) || 5000;
  var CLEAR_UNDO_MS = (window.ItemEdit && ItemEdit.CLEAR_UNDO_MS) || 10000;
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
    } else if (isGround(item)) {
      row(Transport.kind(item).numberLabel, escapeHtml(item.number || ""));
      row("路线", escapeHtml(Transport.routeText(item)));
      row("出发", escapeHtml(((item.departDate ? formatMd(item.departDate) : "") + " " + (item.departTime || "")).trim()));
      row("到达", escapeHtml(((item.arriveDate && item.arriveDate !== item.departDate ? formatMd(item.arriveDate) : "") + " " + (item.arriveTime || "")).trim()));
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
      /* v6：火车 / 船 / 大巴不放导航 */
      (isGround(item) ? "" : '<div class="detail-nav">' + navPairHtml(navPlan(null, cardTarget(item)), "从我的位置导航到 " + itemTitle(item)) + "</div>");
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

  /**
   * 应用内确认框。v6 加了：cancelText / onCancel（点「取消」那个按钮时调用）、
   * checkbox: { label, checked }（勾选框，结果作为 onOk(checked) 的参数）、tone: "primary"（不是删除，确定按钮用主色）。
   */
  var confirmCancelAction = null;
  var confirmAltAction = null; /* v6：第三个按钮（altText / onAlt） */
  var confirmCloseAction = null; /* v6：不管怎么关（确定 / 取消 / 点外面）都在最后调一次，排队问的时候用 */
  function openConfirm(opts) {
    $("confirm-title").textContent = opts.title;
    $("confirm-sub").textContent = opts.sub || "";
    $("confirm-sub").hidden = !opts.sub;
    $("confirm-ok").textContent = opts.okText || "删除";
    $("confirm-ok").classList.toggle("is-primary", opts.tone === "primary");
    if ($("confirm-cancel")) $("confirm-cancel").textContent = opts.cancelText || "取消";
    var row = $("confirm-check-row");
    var showCheck = !!(opts.checkbox && opts.checkbox.label);
    if (row) {
      row.hidden = !showCheck;
      if (showCheck) {
        $("confirm-check-text").textContent = opts.checkbox.label || "";
        $("confirm-check").checked = !!opts.checkbox.checked;
      } else if ($("confirm-check")) {
        $("confirm-check").checked = false;
      }
    }
    var panel = document.querySelector("#confirm-sheet .confirm-panel");
    if (panel) panel.classList.toggle("has-check", showCheck);
    var sheet = $("confirm-sheet");
    if (sheet) sheet.classList.toggle("is-ask", !!opts.ask);
    confirmAction = opts.onOk;
    confirmCancelAction = opts.onCancel || null;
    confirmCloseAction = opts.onClose || null;
    confirmAltAction = opts.onAlt || null;
    if ($("confirm-alt")) {
      $("confirm-alt").hidden = !opts.altText;
      $("confirm-alt").textContent = opts.altText || "";
      $("confirm-alt").parentNode.classList.toggle("has-alt", !!opts.altText);
    }
    openSheet("confirm-sheet");
    try { $("confirm-cancel").focus(); } catch (err) {}
  }

  var pendingOrderToast = null;
  function closeConfirm() {
    confirmAction = null;
    confirmCancelAction = null;
    var later = pendingOrderToast;
    pendingOrderToast = null;
    var onClose = confirmCloseAction;
    confirmCloseAction = null;
    confirmAltAction = null;
    if ($("confirm-alt")) {
      $("confirm-alt").hidden = true;
      $("confirm-alt").parentNode.classList.remove("has-alt");
    }
    if (typeof onClose === "function") setTimeout(onClose, 0);
    var sheet = $("confirm-sheet");
    if (sheet) sheet.classList.remove("is-ask");
    if ($("confirm-cancel")) $("confirm-cancel").textContent = "取消";
    if ($("confirm-ok")) $("confirm-ok").textContent = "删除";
    if ($("confirm-check-row")) $("confirm-check-row").hidden = true;
    if ($("confirm-check")) $("confirm-check").checked = false;
    var panel = document.querySelector("#confirm-sheet .confirm-panel");
    if (panel) panel.classList.remove("has-check");
    if ($("confirm-ok")) $("confirm-ok").classList.remove("is-primary");
    closeSheet("confirm-sheet");
    if (typeof later === "function") setTimeout(later, 0);
  }

  function fixSelectedDay(items) {
    if (selectedDay !== "all" && tripDays(items).indexOf(selectedDay) === -1) {
      selectedDay = "all";
      dayPickedByUser = false;
    }
  }

  /** v6.1：删行程和删条目共用确认框。标题「删除“名字”吗？」 */
  function deleteConfirmTitle(name) {
    return "删除“" + (name || "这一项") + "”吗？";
  }

  /** 足迹页已上线，且这条/这趟真有到访记录时，才出示「同时删掉足迹」勾选框。默认不勾。 */
  function footprintsReady() {
    return !!(window.Favorites && Favorites.pageShipped);
  }

  function footprintsCheckbox(kind, hasVisits) {
    if (!footprintsReady() || !hasVisits) return null;
    return {
      label: kind === "trip" ? "同时删掉这趟的足迹" : "同时删掉这里的足迹",
      checked: false
    };
  }

  function askDeleteItem(id) {
    var item = findItem(id);
    if (!item) return;
    var realId = window.Legs && Legs.sourceId ? Legs.sourceId(item.id || id) : id;
    var real = findItem(realId) || item;
    var trip = currentTrip();
    var isHotelStay = real.type === "hotel" && window.Legs && Legs.hasValidHotelStay && Legs.hasValidHotelStay(real);
    var hasVisit = !!(window.Places && Places.itemHasVisit && trip && Places.itemHasVisit(places, real, trip.id));
    openConfirm({
      title: deleteConfirmTitle(itemTitle(real) || real.nameZh),
      sub: isHotelStay ? "入住和退房会一起删掉，删除后 5 秒内可以撤销。" : "删除后 5 秒内可以撤销。",
      okText: "删除",
      cancelText: "取消",
      checkbox: footprintsCheckbox("item", hasVisit),
      onOk: function (alsoVisits) {
        deleteItemNow(realId, alsoVisits);
      }
    });
  }

  function deleteItemNow(id, alsoVisits) {
    var trip = currentTrip();
    var res = ItemEdit.removeItem(trip.items || [], id);
    if (!res.removed) return;
    var prevDay = selectedDay;
    trip.items = res.items;
    delete expanded[id];
    var visitSnap = null;
    if (alsoVisits && window.Places && Places.removeItemVisits) {
      visitSnap = JSON.parse(JSON.stringify(places));
      Places.removeItemVisits(places, trip.id, res.removed);
    }
    fixSelectedDay(trip.items);
    saveAllTrips();
    closeSheet("detail-sheet");
    detailId = null;
    renderAll();
    showToast("已删除", function () {
      var t = currentTrip();
      t.items = ItemEdit.restoreItem(t.items || [], res.removed, res.index);
      if (visitSnap) places = visitSnap;
      if (prevDay !== "all" && tripDays(t.items).indexOf(prevDay) !== -1) selectedDay = prevDay;
      saveAllTrips();
      renderAll();
    }, UNDO_MS);
  }

  /** v6：「清空这趟」只清当前这一趟，其他行程不动 */
  function askClearAll() {
    var trip = currentTrip();
    if (!(trip.items || []).length) return;
    openConfirm({
      title: "清空『" + (trip.nameZh || "我的行程") + "』里的所有内容吗？",
      sub: "其他行程不受影响",
      okText: "清空这趟",
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
    }, CLEAR_UNDO_MS);
  }

  function setAddMode(isEdit) {
    if (isEdit && hotelMode) setHotelMode(false);
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
    /* 类型相关显隐必须压过 edit-only：避免改地点时露出『再加一张返程』 */
    if (typeof paintEditLabels === "function") paintEditLabels(getVal("manual-type") || "地点");
    syncManualActions();
  }

  function setVal(id, v) {
    if ($(id)) $(id).value = v == null ? "" : v;
  }
  function getVal(id) {
    return $(id) ? $(id).value : "";
  }

  /* ---------- v5.2 自选图标：4×2，颜色见 icons.js 的 PALETTE ---------- */
  var pickedIcon = "";
  var pickedLegRole = "auto";

  function paintLegRoleSeg(role) {
    role = role || "auto";
    Array.prototype.forEach.call(document.querySelectorAll(".leg-role-opt"), function (btn) {
      var on = btn.getAttribute("data-leg-role") === role;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  function flightsForRoleHint() {
    var items = ((currentTrip() && currentTrip().items) || []).slice();
    var item = editingId ? findItem(editingId) : null;
    if (!item || item.type !== "flight") return items;
    var over = Object.assign({}, item);
    delete over.legRole;
    var d = getVal("edit-date");
    var t = getVal("edit-time");
    var ed = getVal("edit-end-date");
    var et = getVal("edit-end-time");
    if (d) over.departDate = d;
    if (t) over.departTime = t;
    if (ed) over.arriveDate = ed;
    if (et) over.arriveTime = et;
    var found = false;
    items = items.map(function (it) {
      if (it.id === over.id) {
        found = true;
        return over;
      }
      return it;
    });
    if (!found) items.push(over);
    return items;
  }

  function paintLegRoleHint() {
    var el = $("leg-role-hint");
    if (!el) return;
    var text = "没认出来，可以自己选";
    if (window.Legs && Legs.autoRoleHintText && Legs.autoRoleFor && editingId) {
      text = Legs.autoRoleHintText(Legs.autoRoleFor(flightsForRoleHint(), editingId));
    }
    el.textContent = text;
  }

  function setPickedLegRole(role) {
    if (role !== "out" && role !== "back" && role !== "transfer") role = "auto";
    pickedLegRole = role;
    paintLegRoleSeg(role);
  }

  function defaultCategoryFor(item) {
    if (!item || !window.Icons) return "";
    if (item.icon) return item.icon;
    var k = Icons.typeKind(item);
    return { hotel: "hotel", restaurant: "food", attraction: "sight" }[k] || "";
  }

  function renderIconPicker(boxId, current) {
    var box = $(boxId || "icon-picker");
    if (boxId == null) current = pickedIcon;
    if (!box || !window.Icons || !Icons.CATEGORIES) return;
    var cats = Icons.CATEGORIES;
    if (box.id === "icon-picker" && Icons.MANUAL_PICKER_KEYS) {
      cats = cats.filter(function (c) { return Icons.MANUAL_PICKER_KEYS.indexOf(c.key) !== -1; });
    }
    box.innerHTML = cats.map(function (c) {
      var m = Icons.categoryMeta(c.key);
      var on = current === c.key;
      var style = c.key === "other"
        ? "background:" + m.tint + ";color:" + m.color
        : on ? "background:" + m.color + ";color:#fff" : "background:" + m.tint + ";color:" + m.color;
      return (
        '<button type="button" class="icon-opt' + (on ? " is-on" : "") + '" role="radio" aria-checked="' + (on ? "true" : "false") + '" data-icon="' + c.key + '" style="--opt:' + m.color + '">' +
        '<span class="icon-dot" style="' + style + '">' + ico(m.icon) + "</span>" +
        '<span class="icon-name">' + escapeHtml(c.label) + "</span></button>"
      );
    }).join("");
  }

  function setPickedIcon(key) {
    pickedIcon = pickedIcon === key ? "" : key;
    renderIconPicker();
  }

  function openReturnFlightForm(src) {
    if (!src || src.type !== "flight") return;
    var draft = (window.Legs && Legs.buildReturnFlight) ? Legs.buildReturnFlight(src) : {
      type: "flight",
      flightNo: "",
      fromAirport: src.toAirport || "",
      toAirport: src.fromAirport || "",
      departDate: "",
      departTime: "",
      arriveDate: "",
      arriveTime: ""
    };
    draft.id = "flight-" + Date.now();
    returnFlightDraft = draft;
    exitEditMode();
    returnFlightDraft = draft;
    enterEditMode(draft.id);
  }

  function enterEditMode(id) {
    var item = findItem(id);
    if (!item) return;
    editingId = id;
    var f = ItemEdit.formFields(item);
    var sel = $("manual-type");
    var isFlight = isTransit(item);
    if (sel) {
      /* v6：火车 / 船 / 大巴只在修改时临时加进下拉框（手动添加交通等第 3 批的表单） */
      if (isGround(item) && !Array.prototype.some.call(sel.options, function (o) { return o.value === f.type; })) {
        var opt = document.createElement("option");
        opt.value = f.type;
        opt.textContent = f.type;
        opt.setAttribute("data-temp", "1");
        sel.appendChild(opt);
      }
      Array.prototype.forEach.call(sel.options, function (o) {
        o.disabled = isFlight ? o.value !== f.type : o.value === "机票";
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
    pickedLegRole = (item.type === "flight" && (f.legRole === "out" || f.legRole === "back" || f.legRole === "transfer")) ? f.legRole : "auto";
    pickedIcon = isFlight ? "" : defaultCategoryFor(item);
    renderIconPicker();
    if ($("icon-pick-row")) $("icon-pick-row").hidden = isFlight;
    if ($("manual-status")) $("manual-status").innerHTML = "";
    setAddMode(true);
    paintEditLabels(f.type);
    if ($("edit-address-row")) $("edit-address-row").hidden = item.type === "flight";
    closeSheet("detail-sheet");
    openSheet("add-sheet");
  }

  var GROUND_LABELS = { "火车": "车次", "船": "班次", "大巴": "班次" };
  function paintEditLabels(type) {
    var isGroundType = Object.prototype.hasOwnProperty.call(GROUND_LABELS, type);
    var isFlight = type === "机票";
    var isMove = isFlight || isGroundType;
    var isHotel = type === "酒店";
    var nameLabel = document.querySelector('label[for="manual-name"]');
    if (nameLabel) nameLabel.textContent = isFlight ? "航班号" : isGroundType ? GROUND_LABELS[type] + "（可不填）" : "名称";
    var addrLabel = document.querySelector('label[for="edit-address"]');
    if (addrLabel) addrLabel.textContent = isGroundType ? "出发站 - 到达站" : "地址";
    if ($("edit-date-label")) $("edit-date-label").textContent = isFlight ? "起飞日期" : isGroundType ? "出发日期" : isHotel ? "入住日期" : "日期";
    if ($("edit-time-label")) $("edit-time-label").textContent = isFlight ? "起飞时间" : isGroundType ? "出发时间" : isHotel ? "入住时间" : "时间";
    if ($("edit-end-row")) $("edit-end-row").hidden = !(isMove || isHotel);
    if ($("edit-end-date-label")) $("edit-end-date-label").textContent = isMove ? "到达日期" : "退房日期";
    if ($("edit-end-time-box")) $("edit-end-time-box").hidden = !(isMove || isHotel);
    var endTimeLabel = document.querySelector('label[for="edit-end-time"]');
    if (endTimeLabel) endTimeLabel.textContent = isHotel ? "退房时间" : "到达时间";
    if ($("edit-add-return")) $("edit-add-return").hidden = !isFlight;
    if ($("leg-role-row")) $("leg-role-row").hidden = !isFlight;
    /* 地点图标格只给地点用；酒店和交通不出现 */
    if ($("icon-pick-row")) $("icon-pick-row").hidden = isMove || isHotel;
    if (isFlight) {
      paintLegRoleSeg(pickedLegRole);
      paintLegRoleHint();
    }
  }

  function exitEditMode() {
    editingId = null;
    var sel = $("manual-type");
    if (sel) {
      Array.prototype.slice.call(sel.querySelectorAll('option[data-temp="1"]')).forEach(function (o) { o.remove(); });
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
    pickedLegRole = "auto";
    paintEditLabels("地点");
    pickedIcon = "";
    renderIconPicker();
    if ($("icon-pick-row")) $("icon-pick-row").hidden = false;
    if ($("manual-status")) $("manual-status").innerHTML = "";
    var fold = $("manual-fold");
    if (fold) fold.open = false;
    setAddMode(false);
  }

  function saveEdit() {
    var id = editingId;
    var item = findItem(id);
    var isReturnDraft = !!(returnFlightDraft && item && item.id === returnFlightDraft.id);
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
      endDate: type === "酒店" || isTransit(item) ? getVal("edit-end-date") : null,
      endTime: getVal("edit-end-time"),
      note: getVal("edit-note"),
      legRole: item.type === "flight" ? pickedLegRole : undefined
    };
    var res = ItemEdit.applyForm(item, form);
    if (res.error) {
      showManualStatus('<p class="err">' + escapeHtml(res.error) + "</p>");
      return;
    }
    if (!isTransit(item)) {
      if (pickedIcon) res.item.icon = pickedIcon;
      else delete res.item.icon;
    }
    var trip = currentTrip();
    if (isReturnDraft) {
      if (!res.item.id) res.item.id = returnFlightDraft.id || ("flight-" + Date.now());
      trip.items = (trip.items || []).concat([res.item]);
      returnFlightDraft = null;
    } else {
      trip.items = ItemEdit.updateItem(trip.items || [], id, res.item);
      /* v6：备注跟着地点走 —— 改了备注，同一个地点在其他行程里的条目也一起改 */
      if (window.Places && res.item.placeId && String(res.item.note || "") !== String(item.note || "")) {
        Places.setNote(places, trips, res.item.placeId, res.item.note || "", todayIso());
      }
    }
    fixSelectedDay(trip.items);
    saveAllTrips();
    exitEditMode();
    closeSheet("add-sheet");
    renderAll();
    if (res.addressChanged && window.Geocode && isGround(res.item)) {
      showToast("已保存修改");
      Geocode.resolveItem(res.item, dayArgsFor(res.item)).then(function (r) {
        var cur = findItem(id);
        if (!cur || !r) return;
        var fresh = Object.assign({}, cur);
        Geocode.applyChoice(fresh, r.chosen, r.fromChosen);
        var t = currentTrip();
        t.items = ItemEdit.updateItem(t.items || [], id, fresh);
        saveAllTrips();
        renderAll();
      }).catch(function () {});
    } else if (res.addressChanged && window.Geocode && res.item.address) {
      showToast("已保存，正在找新地址的位置…");
      Geocode.resolveItem(res.item, dayArgsFor(res.item))
        .then(function (r) {
          var cur = findItem(id);
          if (!cur) return;
          var fresh = Object.assign({}, cur);
          if (r && r.chosen) Geocode.applyChoice(fresh, r.chosen, r.fromChosen);
          else if (r && r.candidates && r.candidates.length && window.FixCand) FixCand.setCached(fresh, r.candidates);
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
    if ($("confirm-cancel")) $("confirm-cancel").addEventListener("click", function () {
      var fn = confirmCancelAction;
      closeConfirm();
      if (typeof fn === "function") fn();
    });
    if ($("confirm-alt")) $("confirm-alt").addEventListener("click", function () {
      var fn = confirmAltAction;
      closeConfirm();
      if (typeof fn === "function") fn();
    });
    if ($("confirm-ok")) {
      $("confirm-ok").addEventListener("click", function () {
        var fn = confirmAction;
        var checked = !!($("confirm-check") && !$("confirm-check-row").hidden && $("confirm-check").checked);
        closeConfirm();
        if (typeof fn === "function") fn(checked);
      });
    }
    if ($("clear-all-btn")) $("clear-all-btn").addEventListener("click", askClearAll);
    if ($("edit-cancel")) {
      $("edit-cancel").addEventListener("click", function () {
        exitEditMode();
        closeSheet("add-sheet");
      });
    }
    if ($("edit-add-return")) {
      $("edit-add-return").addEventListener("click", function () {
        if (editingId) openReturnFlightForm(findItem(editingId));
      });
    }
    if ($("manual-type")) {
      $("manual-type").addEventListener("change", function () {
        if (editingId) paintEditLabels(getVal("manual-type"));
      });
    }
    var roleRow = $("leg-role-row");
    if (roleRow && !roleRow.getAttribute("data-bound")) {
      roleRow.setAttribute("data-bound", "1");
      roleRow.addEventListener("click", function (ev) {
        var btn = ev.target.closest && ev.target.closest("[data-leg-role]");
        if (!btn) return;
        ev.preventDefault();
        setPickedLegRole(btn.getAttribute("data-leg-role"));
      });
    }
    ["edit-date", "edit-time", "edit-end-date", "edit-end-time"].forEach(function (id) {
      if (!$(id) || $(id).getAttribute("data-leg-hint-bound")) return;
      $(id).setAttribute("data-leg-hint-bound", "1");
      $(id).addEventListener("input", paintLegRoleHint);
      $(id).addEventListener("change", paintLegRoleHint);
    });
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
    var stored = loadAllTrips({ readOnly: true });
    return !!(stored && stored.trips && stored.trips.some(function (t) {
      return t && t.items && t.items.length;
    }));
  }

  function runOpenFlow() {
    if (!window.AppVersion) {
      if (!helpHidden()) openHelp("first");
      return;
    }
    var decision = AppVersion.decideOnOpen({
      lastSeen: lsGet(AppVersion.LAST_SEEN_KEY),
      hasTrips: storedHasTrips(),
      helpHidden: helpHidden()
    });
    if (decision.markSeenNow) lsSet(AppVersion.LAST_SEEN_KEY, AppVersion.APP_VERSION);
    if (decision.show === "announce") openAnnouncement();
    else if (decision.show === "help") openHelp("first");
    /* 第一次打开的说明、更新公告：这次不弹引导，等下次打开。
       之后每次自动弹的说明（没勾「不再自动弹出」）：等说明关掉再接着弹引导，一前一后，不同时出现。 */
    var repeatHelp = decision.show === "help" && !decision.markSeenNow;
    openFlowPopup = decision.show === "announce" || (decision.show === "help" && !!decision.markSeenNow);
    guideAfterHelp = repeatHelp;
    if (!repeatHelp) maybeAutoGuide(openFlowPopup);
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
    var helpBtn = $("help-install-tile");
    var go = $("install-banner-go");
    var dismiss = $("install-banner-dismiss");
    if (settingsBtn) settingsBtn.hidden = hideAll;
    if (helpBtn) helpBtn.hidden = hideAll;
    if (banner) banner.hidden = hideAll || installBannerDismissed();
    if (go && go.getAttribute("data-filled") !== "1") {
      go.setAttribute("data-filled", "1");
      go.innerHTML = ico("device") + "<span>" + escapeHtml(window.InstallGuide ? InstallGuide.COPY.bannerText : "放到手机桌面") + "</span>";
    }
    if (dismiss && dismiss.getAttribute("data-filled") !== "1") {
      dismiss.setAttribute("data-filled", "1");
      dismiss.innerHTML = ico("close");
    }
  }

  /* ---------- v5.2「放到手机桌面」引导（文案和规则在 install-guide.js） ---------- */
  var guideShownThisOpen = false;

  function guideHere() {
    if (!window.InstallGuide) return { kind: "none", variant: "", ipad: false };
    return InstallGuide.guideFor(currentEnv(), navigator.userAgent || "", {
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints
    }, { hasPrompt: !!(installPromptEvent && typeof installPromptEvent.prompt === "function") });
  }

  /* v5.2 引导图（UI 出图，放在 ./guide/）：圆角 12，宽度铺满面板内容，高度按原图比例。
     非微信 App 的「右上角菜单」暂时也用微信那张。 */
  var GUIDE_IMAGES = {
    "wechat": { src: "./guide/01-wechat.webp", w: 720, h: 1163 },
    "inapp-menu": { src: "./guide/01-wechat.webp", w: 720, h: 1163 },
    /* iOS 步骤用裁好的局部图（*-focus），面板高度约 1000px；微信遮罩和 iPad 仍用整张 */
    "old-safari": { src: "./guide/02-safari-classic-share-focus.webp", w: 720, h: 458 },
    "new-safari-more": { src: "./guide/03-safari-ios26-more-focus.webp", w: 720, h: 366 },
    "share-menu": { src: "./guide/04-share-sheet-add-focus.webp", w: 720, h: 553 },
    "add-confirm": { src: "./guide/05-add-confirm-focus.webp", w: 720, h: 420 },
    "ipad-share": { src: "./guide/ipad-share.webp", w: 720, h: 594 }
  };

  function igSlot(name, cap, dark) {
    var img = GUIDE_IMAGES[name];
    if (img) {
      return '<img class="ig-img" data-slot="' + escapeHtml(name) + '" src="' + img.src + '" width="' + img.w + '" height="' + img.h + '" alt="' + escapeHtml(cap) + '" decoding="async">';
    }
    var line = dark ? "#FFFFFF" : "#B9B1A1";
    return (
      '<div class="ig-slot" data-slot="' + escapeHtml(name) + '">' +
      '<svg viewBox="0 0 120 56" role="img" aria-label="' + escapeHtml(InstallGuide.COPY.placeholder + "：" + cap) + '">' +
      '<rect x="44" y="3" width="32" height="50" rx="6" fill="none" stroke="' + line + '" stroke-width="1.5"/>' +
      '<path d="M50 44h20M50 12h20" stroke="' + line + '" stroke-width="1.5" stroke-linecap="round"/>' +
      '<path d="M16 16l12 12M28 16L16 28M92 16l12 12M104 16L92 28" stroke="' + line + '" stroke-width="1.2" stroke-linecap="round" opacity=".6"/>' +
      "</svg>" +
      '<span class="ig-slot-cap">' + escapeHtml(InstallGuide.COPY.placeholder + " · " + cap) + "</span></div>"
    );
  }

  function copyText(text, done) {
    function fallback() {
      var ok = false;
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch (err) {}
      done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else {
      fallback();
    }
  }

  function openInAppOverlay(variant) {
    var el = $("inapp-overlay");
    if (!el || !window.InstallGuide) return;
    var C = InstallGuide.COPY;
    $("inapp-text").textContent = InstallGuide.overlayText(variant);
    $("inapp-copy").textContent = C.copyUrl;
    $("inapp-close").setAttribute("aria-label", C.close);
    var arrow = $("inapp-arrow");
    if (arrow) arrow.classList.toggle("is-off", variant === "ios-other");
    $("inapp-illus").classList.add("ig-illus-img");
    $("inapp-illus").innerHTML = igSlot(variant === "wechat" ? "wechat" : "inapp-menu", variant === "wechat" ? "微信右上角菜单" : "右上角菜单", true);
    closeSheet("settings-sheet");
    closeSheet("help-sheet");
    closeSheet("install-sheet");
    el.hidden = false;
    document.body.classList.add("ig-open");
  }

  function closeInAppOverlay() {
    var el = $("inapp-overlay");
    if (el) el.hidden = true;
    document.body.classList.remove("ig-open");
  }

  function openIosSheet(ipad) {
    var el = $("ios-install-sheet");
    if (!el || !window.InstallGuide) return;
    var C = InstallGuide.COPY;
    var slots = [
      [["old-safari", "旧版 Safari 底栏"], ["new-safari-more", "新版 Safari「···」"]],
      [["share-menu", "分享菜单"]],
      [["add-confirm", "右上角「添加」"]]
    ];
    $("ig-title").textContent = C.iosTitle;
    $("ig-steps").innerHTML = C.iosSteps.map(function (text, i) {
      if (i === 0 && ipad) text = C.ipadStep1;
      return (
        '<li><div class="ig-step-row"><span class="ig-n">' + (i + 1) + "</span><span>" + escapeHtml(text) + "</span></div>" +
        '<div class="ig-illus ig-illus-img">' + (i === 0 && ipad ? [["ipad-share", "iPad 地址栏右边的分享按钮"]] : slots[i]).map(function (s) { return igSlot(s[0], s[1], false); }).join("") + "</div></li>"
      );
    }).join("");
    var note = $("ig-note");
    var withNote = InstallGuide.showItemsNote({ kind: "ios-sheet" }, storedHasTrips());
    note.textContent = C.hasItemsNote;
    note.hidden = !withNote;
    $("ig-done").textContent = C.done;
    $("ig-later").textContent = C.later;
    el.classList.toggle("is-ipad", !!ipad);
    closeSheet("settings-sheet");
    closeSheet("help-sheet");
    closeSheet("install-sheet");
    el.hidden = false;
    resetSheetScroll(el);
    document.body.classList.add("ig-open");
  }

  function closeIosSheet() {
    var el = $("ios-install-sheet");
    if (el) el.hidden = true;
    document.body.classList.remove("ig-open");
  }

  function guideSnooze() {
    if (window.InstallGuide) lsSet(InstallGuide.SNOOZE_KEY, String(Date.now()));
  }

  function guideDone() {
    if (window.InstallGuide) lsSet(InstallGuide.DONE_KEY, "1");
    closeIosSheet();
  }

  function guideLater() {
    guideSnooze();
    closeIosSheet();
  }

  /** 打开时决定要不要自动弹引导。popupThisOpen：这次打开已经弹了公告或使用说明，就留到下次打开。 */
  function maybeAutoGuide(popupThisOpen) {
    if (!window.InstallGuide || guideShownThisOpen) return;
    /* 起名建议优先：它在等着或开着时，引导不弹 */
    if (pendingNameSuggest || namePopOpen) return;
    var g = guideHere();
    var hasItems = storedHasTrips();
    var ok = InstallGuide.shouldAutoShow({
      guide: g,
      done: lsGet(InstallGuide.DONE_KEY) === "1",
      snoozedAt: lsGet(InstallGuide.SNOOZE_KEY),
      now: Date.now(),
      hasItems: hasItems,
      itemsShown: lsGet(InstallGuide.ITEMS_SHOWN_KEY) === "1",
      popupThisOpen: !!popupThisOpen
    });
    if (!ok) return;
    guideShownThisOpen = true;
    guideSnooze();
    if (hasItems) lsSet(InstallGuide.ITEMS_SHOWN_KEY, "1");
    if (g.kind === "inapp") openInAppOverlay(g.variant);
    else openIosSheet(g.ipad);
  }

  /* 第一次说明 / 公告关掉后不接着弹引导（留到下次打开）；之后每次自动弹的说明关掉后，才轮到引导。 */
  var guideAfterHelp = false;
  function afterOpenDialogClosed() {
    if (!guideAfterHelp) return;
    guideAfterHelp = false;
    setTimeout(function () { maybeAutoGuide(false); }, 250);
  }

  function renderInstallBody(kind) {
    var box = $("install-body");
    if (!box || !window.InstallGuide) return;
    var C = InstallGuide.COPY;
    if (kind === "android-steps") {
      box.innerHTML = '<ol class="install-steps">' + C.androidSteps.map(function (t) {
        return "<li>" + escapeHtml(t) + "</li>";
      }).join("") + "</ol>";
      return;
    }
    box.innerHTML = '<p class="install-tip">' + escapeHtml(C.desktopNote) + "</p>";
  }

  /** 设置里「放到手机桌面」：按环境打开对应的引导。从桌面图标打开时这个入口是隐藏的。 */
  function openInstall(forceKind) {
    var env = currentEnv();
    if (env.hideInstall && !forceKind) return;
    var g = guideHere();
    var kind = forceKind || g.kind;
    if (kind === "none") return;
    if (kind === "inapp") return openInAppOverlay(forceKind ? "wechat" : g.variant);
    if (kind === "ios-sheet") return openIosSheet(g.ipad);
    if (kind === "android-prompt" && installPromptEvent && typeof installPromptEvent.prompt === "function") {
      installPromptEvent.prompt();
      installPromptEvent = null;
      return;
    }
    renderInstallBody(kind === "android-prompt" ? "android-steps" : kind);
    closeSheet("settings-sheet");
    openSheet("install-sheet");
  }

  var toastFadeTimer = null;

  function finishToastHide() {
    var el = $("toast");
    if (el) {
      el.hidden = true;
      el.classList.remove("is-import", "is-tap", "is-out");
      el.onclick = null;
    }
    var ck = $("toast-check");
    if (ck) ck.hidden = true;
  }

  function hideToast() {
    disarmToast();
    toastUndo = null;
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    var el = $("toast");
    if (!el || el.hidden) {
      if (toastFadeTimer) {
        clearTimeout(toastFadeTimer);
        toastFadeTimer = null;
      }
      finishToastHide();
      return;
    }
    if (toastFadeTimer) return;
    el.classList.add("is-out");
    var reduce = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var ms = reduce ? 0 : 150;
    toastFadeTimer = setTimeout(function () {
      toastFadeTimer = null;
      finishToastHide();
    }, ms);
  }

  /* 撤销提示：新的会替换旧的（旧的那次删除就算完成）；✕、点别处、滚动都会提前关掉。没有进度条，也不能按住暂停。 */
  var toastArmTimer = null;
  function toastOutside(ev) {
    var el = $("toast");
    if (el && !el.hidden && !el.contains(ev.target)) hideToast();
  }
  function toastScroll() {
    var el = $("toast");
    if (el && !el.hidden && toastUndo) hideToast();
  }
  function disarmToast() {
    if (toastArmTimer) {
      clearTimeout(toastArmTimer);
      toastArmTimer = null;
    }
    document.removeEventListener("pointerdown", toastOutside, true);
    window.removeEventListener("scroll", toastScroll, true);
  }

  function showToast(message, onUndo, ms) {
    var el = $("toast");
    var msg = $("toast-msg");
    if (!el || !msg) return;
    disarmToast();
    if (toastFadeTimer) {
      clearTimeout(toastFadeTimer);
      toastFadeTimer = null;
    }
    el.classList.remove("is-out");
    msg.textContent = message;
    toastUndo = onUndo || null;
    var undoBtn = $("toast-undo");
    if (undoBtn) undoBtn.hidden = !toastUndo;
    var closeBtn = $("toast-close");
    if (closeBtn) closeBtn.hidden = true;
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms || 5000);
    if (toastUndo) {
      /* 稍等一下再开始监听，避免把刚才确认删除的那一下、或重新排版引起的滚动算进去 */
      toastArmTimer = setTimeout(function () {
        toastArmTimer = null;
        document.addEventListener("pointerdown", toastOutside, true);
        window.addEventListener("scroll", toastScroll, true);
      }, 350);
    }
  }

  function onToastSurfaceClick(ev) {
    if (ev.target && ev.target.closest && ev.target.closest("#toast-undo")) return;
    hideToast();
  }

  /*
   * v5.2 结果的名字：店名（name / namedetails）优先。没有店名时，display_name 的第一段
   * 常是「Suite X01」「12」这种楼内单元 / 门牌号，不能当名字 —— 以前就是这样把店名换成了单元号。
   */
  function candidateName(c, typed) {
    if (!c) return "";
    var unit = window.GeoUtil && GeoUtil.isUnitLikeName ? GeoUtil.isUnitLikeName : function () { return false; };
    var n = String(c.name || "").trim();
    if (n && !unit(n)) return n;
    n = String(c.nameDetail || "").trim();
    if (n && !unit(n)) return n;
    var d = String(c.displayName || "");
    var first = (d.split(",")[0] || "").trim();
    if (first && !unit(first)) return first;
    return String(typed || "").trim();
  }

  /** 完整地址（存进行程，导航用）：display_name 去掉开头的店名 */
  function candidateShortAddr(c, name) {
    var display = String((c && c.displayName) || "").trim();
    var rest = display;
    if (name && display.indexOf(name) === 0) {
      rest = display.slice(name.length).replace(/^[,，\s]+/, "");
    }
    return rest || display;
  }

  /** 搜索结果第二行：「城市 邮编 · 门牌 街道」，例如「London WC2H · 1 Example Pl」；没有分项时退回 display_name */
  function candidateAddrLine(c, name) {
    var a = c && c.address;
    if (a && (a.road || a.city || a.postcode)) {
      var pc = String(a.postcode || "").trim();
      if (/^[A-Z]{1,2}\d[A-Z\d]?\s+\d[A-Z]{2}$/i.test(pc)) pc = pc.split(/\s+/)[0];
      var head = [a.city, pc].filter(Boolean).join(" ");
      var street = [a.house_number, a.road].filter(Boolean).join(" ");
      var line = [head, street].filter(Boolean).join(" · ");
      if (line) return line;
    }
    return candidateShortAddr(c, name);
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

  function addPlaceAndToast(item, msg) {
    var added = appendItems([item], { keepDay: true }) || [item];
    var real = findItem((added[0] || item).id) || added[0] || item;
    closeSheet("add-sheet");
    clearSearchUi(true);
    showToast(msg || "已添加：" + (real.nameZh || nameOrBlank(real)), function () {
      var trip = currentTrip();
      trip.items = (trip.items || []).filter(function (it) {
        return it.id !== real.id;
      });
      saveAllTrips();
      renderAll();
    });
    return real;
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
    hideDirectAdd();
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
    updateFallbackLabel(query);
    if (!box) return;
    if (!searchHits.length) {
      box.hidden = true;
      box.innerHTML = "";
      if (String(query || "").trim() && !($("search-status") && $("search-status").classList.contains("is-error"))) {
        setSearchStatus(DIRECT_COPY.fixNone);
      }
      return;
    }
    setSearchStatus("");
    box.hidden = false;
    box.innerHTML = searchHits
      .map(function (c, i) {
        var name = candidateName(c, query) || "未命名地点";
        var addr = candidateAddrLine(c, name);
        var text = '<span class="search-hit-name">' + escapeHtml(name) + "</span>" +
          (addr ? '<span class="search-hit-addr">' + escapeHtml(addr) + "</span>" : "");
        /* v5.3「加酒店」页：结果行前面放紫色床图标 */
        if (hotelMode && !fixingId) {
          return '<li><button type="button" class="search-hit has-ico" data-hit="' + i + '"><span class="search-hit-ico" aria-hidden="true">' +
            HOTEL_BED_SVG + '</span><span class="search-hit-text">' + text + "</span></button></li>";
        }
        return '<li><button type="button" class="search-hit" data-hit="' + i + '">' + text + "</button></li>";
      })
      .join("");
  }

  function pickSearchHit(index) {
    var c = searchHits[index];
    if (!c) return;
    var name = candidateName(c, ($("place-search") && $("place-search").value) || "");
    if (!name) return;
    if (fixingId) {
      fixItemFromHit(c, name);
      return;
    }
    var item = itemFromType(
      name,
      candidateShortAddr(c, name) || c.displayName || name,
      addPreset || guessLabel(c),
      { lat: c.lat, lng: c.lng },
      selectedDateOrEmpty()
    );
    /* v5.2：存下地图服务给的城市（只有这一个新字段） */
    if (c.city && String(c.city).trim()) item.city = String(c.city).trim();
    afterHotelReady(item, function (it) { addPlaceAndToast(it); });
  }

  /* ---------- v5.2 搜不到也能加：「＋ 直接添加「xxx」」→ 选图标 → 加进行程（没地址、没坐标，卡片显示「待补地址」） ---------- */
  var DIRECT_COPY = {
    btn: "＋ 直接添加「{q}」",
    sub: "没有地图位置，也能放进行程",
    pickTitle: "给「{q}」选个图标（可不选）",
    go: "添加",
    added: "已添加。点卡片上的『位置待确认』，就能出现在地图上",
    fixBtn: "位置待确认",
    fixTitle: "补地址",
    fixHead: "给「{name}」找位置，点一个结果就补上",
    fixDone: "已补上位置",
    fixManual: "手动填地址",
    fixNone: (window.Geocode && Geocode.FRIENDLY_NOT_FOUND) || "没搜到，换个名字试试，或点『找不到？换个方式加』"
  };
  var directName = "";
  var directIcon = "";

  function updateFallbackLabel(query) {
    var q = String(query || "").trim();
    var main = $("sf-main");
    if (main) main.textContent = DIRECT_COPY.btn.replace("{q}", q);
    var fb = $("search-fallback");
    if (fb) fb.setAttribute("aria-label", DIRECT_COPY.btn.replace("{q}", q) + "，" + DIRECT_COPY.sub);
  }

  function hideDirectAdd() {
    var box = $("direct-add");
    if (box) box.hidden = true;
    directName = "";
    directIcon = "";
  }

  function addByTypedName() {
    var name = String(($("place-search") && $("place-search").value) || "").trim();
    if (!name) {
      setSearchStatus("请先输入地名，比如 大英博物馆", true);
      return;
    }
    directName = name;
    directIcon = "";
    if ($("direct-add-title")) $("direct-add-title").textContent = DIRECT_COPY.pickTitle.replace("{q}", name);
    renderIconPicker("direct-icon-picker", directIcon);
    var list = $("search-results");
    if (list) list.hidden = true;
    var fb = $("search-fallback");
    if (fb) fb.hidden = true;
    setSearchStatus("");
    var box = $("direct-add");
    if (box) {
      box.hidden = false;
      if (box.scrollIntoView) box.scrollIntoView({ block: "nearest" });
    }
  }

  /** 直接添加的那一条：只有名字（和选的图标、当天日期），地址留空、没坐标 */
  function directItem(name, icon, date) {
    var item = itemFromType(name, "", addPreset || "地点", null, date);
    item.address = "";
    if (icon) item.icon = icon;
    return item;
  }

  function finishDirectAdd() {
    if (!directName) return;
    var item = directItem(directName, directIcon, selectedDateOrEmpty());
    hideDirectAdd();
    afterHotelReady(item, function (it) {
      var real = addPlaceAndToast(it, DIRECT_COPY.added);
      queueCandidates(real || it);
    });
  }

  /* ---------- v5.2 补地址：卡片上点「待补地址」→ 搜索（名字已填好，自动补上当天城市）→ 选一个，更新同一条 ---------- */
  var fixingId = null;

  function itemDay(item) {
    if (!item) return "";
    if (isTransit(item)) return item.departDate || "";
    return item.type === "hotel" ? item.checkIn || "" : item.date || "";
  }

  /**
   * 重搜时补的城市文字和大概区域：补地址时看那条的日子，新加时看当前选中的日子。
   * 城市只来自地图服务存下的 item.city；区域只来自行程里条目的坐标（geocode.js 会先四舍五入），从不用用户自己的位置。
   */
  function searchDayArgs() {
    if (!window.TripName || !TripName.dayCity) return { city: "", bias: null };
    var items = currentTrip().items || [];
    var item = fixingId ? findItem(fixingId) : null;
    var day = item ? itemDay(item) : selectedDateOrEmpty();
    var opts = { excludeId: item ? item.id : null, time: item ? item.time || item.checkInTime || "" : "" };
    var c = TripName.dayCity(items, day, opts);
    return { city: (c && c.query) || "", bias: TripName.dayArea ? TripName.dayArea(items, day, opts) : null };
  }

  /* ---------- v5.3 待补地址：自动候选（点一下才补）、批量补位置、在地图上选 ---------- */
  var FC = function () { return window.FixCand || null; };
  var FC_COPY = (window.FixCand && FixCand.COPY) || {};
  var candState = {}; /* id → "loading" | "done"（只在内存） */
  var candNone = {}; /* id → 点过「都不是」 */
  var justFixed = {}; /* id → 刚补上，2 秒内显示「已补上」 */
  var candChain = Promise.resolve();

  /** 某条的当天城市文字 + 大概区域（和补地址搜索同一套规则；extra = 正在导入、还没存的条目） */
  function dayArgsFor(item, extra) {
    if (!window.TripName || !TripName.dayCity || !item) return { city: "", bias: null };
    var items = (currentTrip().items || []).concat(extra || []);
    var day = itemDay(item) || (item.pendingDate ? "" : selectedDateOrEmpty());
    var opts = { excludeId: item.id, time: item.time || item.checkInTime || "" };
    var c = TripName.dayCity(items, day, opts);
    var tripPts = [];
    items.forEach(function (it) {
      if (it && it.id !== item.id && typeof it.lat === "number" && typeof it.lng === "number") {
        tripPts.push({ lat: it.lat, lng: it.lng });
      }
    });
    return { city: (c && c.query) || "", bias: TripName.dayArea ? TripName.dayArea(items, day, opts) : null, places: places, tripPoints: tripPts };
  }

  function locPinSvg(color) {
    return '<svg class="fc-ico" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="' + (color || "currentColor") + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 14.5s4.5-4.2 4.5-7.7A4.5 4.5 0 0 0 3.5 6.8C3.5 10.3 8 14.5 8 14.5z"/><circle cx="8" cy="6.8" r="1.6"/></svg>';
  }

  /** 后台找候选（一条一条排队，Nominatim 本来就 1 秒 1 次）；只填内存缓存，不改条目 */
  function queueCandidates(item) {
    var F = FC();
    if (!F || !item || !F.needsFix(item) || !window.Geocode) return;
    if (F.getCached(item) || candState[item.id] === "loading") return;
    candState[item.id] = "loading";
    var snapshot = JSON.parse(JSON.stringify(item));
    candChain = candChain.then(function () {
      return F.findCandidates(snapshot, dayArgsFor(snapshot), {
        search: function (q, o) { return Geocode.searchAddress(q, o); }
      });
    }).then(function () {
      candState[snapshot.id] = "done";
      renderList();
      refreshFixPanelPage();
    }, function () {
      candState[snapshot.id] = "done";
      renderList();
      refreshFixPanelPage();
    });
  }

  function candRowsHtml(item, attr) {
    var F = FC();
    var list = (F && F.getCached(item)) || [];
    return list.map(function (c, j) {
      var l = F.candidateLines(c);
      return '<li><button type="button" class="fc-row" ' + attr + '="' + escapeHtml(item.id) + '" data-fc-i="' + j + '">' +
        locPinSvg("#0F9D8A") +
        '<span class="fc-txt"><span class="fc-name">' + escapeHtml(l.name) + "</span>" +
        (l.sub ? '<span class="fc-sub">' + escapeHtml(l.sub) + "</span>" : "") +
        "</span></button></li>";
    }).join("");
  }

  function mapPickBtnHtml(id) {
    return '<button type="button" class="fc-map" data-fc-map="' + escapeHtml(id) + '">' + locPinSvg() + "<span>" + escapeHtml(FC_COPY.mapPick) + "</span></button>";
  }

  /** 这张卡片正在列候选吗（有至少 1 个候选） */
  function candShowing(item) {
    var F = FC();
    var list = F && item ? F.getCached(item) : null;
    return !!(list && list.length);
  }

  /** 卡片展开后，地址那一行的位置：「是这里吗？」+ 最多 3 个候选 +「都不是」→「在地图上选」 */
  function candBoxHtml(item) {
    var F = FC();
    if (!F) return "";
    var list = F.getCached(item);
    if (!list) {
      return '<div class="fc-box" data-fc-box="' + escapeHtml(item.id) + '"><p class="fc-head">' + escapeHtml(FC_COPY.loading) + "</p>" + mapPickBtnHtml(item.id) + "</div>";
    }
    if (!list.length) return '<div class="fc-box" data-fc-box="' + escapeHtml(item.id) + '">' + mapPickBtnHtml(item.id) + "</div>";
    return '<div class="fc-box" data-fc-box="' + escapeHtml(item.id) + '"><p class="fc-head">' + escapeHtml(FC_COPY.heading) + "</p>" +
      '<ul class="fc-list">' + candRowsHtml(item, "data-fc-item") + "</ul>" +
      (candNone[item.id] ? mapPickBtnHtml(item.id) : '<button type="button" class="fc-none" data-fc-none="' + escapeHtml(item.id) + '">' + escapeHtml(FC_COPY.none) + "</button>") +
      "</div>";
  }

  /** 用户点了一个候选：只更新这一条的坐标、地址、城市（WGS-84）；名字 / 日期 / 图标 / 备注不动 */
  function applyCandidate(id, cand, opts) {
    opts = opts || {};
    var old = findItem(id);
    if (!old || !cand) return false;
    var before = JSON.parse(JSON.stringify(old));
    var name = itemTitle(old);
    var next = ItemEdit.applyFoundPlace(old, cand, candidateShortAddr(cand, name) || cand.displayName || "");
    if (typeof next.lat !== "number") return false;
    var trip = currentTrip();
    trip.items = ItemEdit.updateItem(trip.items || [], id, next);
    if (window.Lookup && Lookup.saveUserPosition) places = Lookup.saveUserPosition(places, next, next.lat, next.lng);
    saveAllTrips();
    expanded[id] = false;
    markJustFixed(id);
    renderAll();
    if (!opts.quiet) {
      showToast("已补上位置", function () {
        var t = currentTrip();
        t.items = ItemEdit.updateItem(t.items || [], id, before);
        saveAllTrips();
        renderAll();
      });
    }
    return true;
  }

  function markJustFixed(id) {
    justFixed[id] = true;
    setTimeout(function () {
      delete justFixed[id];
      renderList();
    }, 2000);
  }

  /* ---------- 顶部「N 个地点待补位置」 ---------- */
  function updateFixBanner() {
    /* v6.1 UI 评审：去掉顶部黄色「N 个地点待补位置」条 */
    var el = $("fix-banner");
    if (el) el.hidden = true;
  }

  /* ---------- 批量面板 ---------- */
  var fixPanel = null;
  var fixPanelNone = false;

  function openFixPanel() {
    var F = FC();
    if (!F) return;
    var items = F.unlocated(currentTrip().items || []).slice();
    items.sort(function (a, b) {
      var da = itemDay(a) || "9999";
      var db = itemDay(b) || "9999";
      return da < db ? -1 : da > db ? 1 : 0;
    });
    if (!items.length) return;
    fixPanel = F.createPanel(items.map(function (it) { return it.id; }), {
      onPage: renderFixPanel,
      onDone: fixPanelDone
    });
    fixPanelNone = false;
    if ($("fp-done")) $("fp-done").hidden = true;
    if ($("fp-page")) $("fp-page").hidden = false;
    if ($("fp-skip")) $("fp-skip").hidden = false;
    if ($("fp-map")) $("fp-map").hidden = false;
    openSheet("fix-panel");
    renderFixPanel();
  }

  function renderFixPanel() {
    if (!fixPanel || fixPanel.done) return;
    fixPanelNone = false;
    var id = fixPanel.current();
    var item = findItem(id);
    if (!item) {
      fixPanel.skip();
      return;
    }
    var F = FC();
    queueCandidates(item);
    if ($("fp-title")) $("fp-title").textContent = fixPanel.title();
    var args = dayArgsFor(item);
    var meta = [itemDay(item) ? formatMd(itemDay(item)) : "", args.city].filter(Boolean).join(" · ");
    var list = F.getCached(item);
    var html = '<h3 class="fp-name">' + escapeHtml(itemTitle(item)) + "</h3>" +
      (meta ? '<p class="fp-meta">' + escapeHtml(meta) + "</p>" : "") +
      '<div class="fp-cands">';
    if (!list) html += '<p class="fc-head">' + escapeHtml(FC_COPY.loading) + "</p>";
    else if (list.length) {
      html += '<p class="fc-head">' + escapeHtml(FC_COPY.heading) + "</p>" +
        '<ul class="fc-list">' + candRowsHtml(item, "data-fp-item") + "</ul>" +
        '<button type="button" class="fc-none" data-fp-none="1">' + escapeHtml(FC_COPY.none) + "</button>";
    }
    html += "</div>";
    if ($("fp-page")) $("fp-page").innerHTML = html;
    if ($("fp-map")) $("fp-map").setAttribute("data-fc-map", id);
  }

  function refreshFixPanelPage() {
    if (fixPanel && !fixPanel.done && $("fix-panel") && !$("fix-panel").hidden && !fixPanelNone) renderFixPanel();
  }

  function fixPanelChose() {
    if (!fixPanel) return;
    fixPanel.chose();
  }

  function fixPanelDone(st) {
    if (!st.allFixed()) {
      /* 有跳过的：安静关掉，跳过的照样留在顶部提示里，不再追问 */
      closeSheet("fix-panel");
      fixPanel = null;
      return;
    }
    if ($("fp-page")) $("fp-page").hidden = true;
    if ($("fp-skip")) $("fp-skip").hidden = true;
    if ($("fp-map")) $("fp-map").hidden = true;
    if ($("fp-title")) $("fp-title").textContent = "";
    if ($("fp-done")) $("fp-done").hidden = false;
    setTimeout(function () {
      closeSheet("fix-panel");
      fixPanel = null;
    }, 1500);
  }

  /* ---------- 在地图上选 ---------- */
  var pickMap = null;
  var pickMarker = null;
  var pickId = null;
  var pickAfter = null;
  var pickNew = null; /* v5.3「加酒店」页：在地图上选一个新酒店 { label, name } */

  function openMapPick(id, after, newSpec) {
    var item = newSpec ? null : findItem(id);
    var ov = $("map-pick");
    if ((!item && !newSpec) || !ov || typeof L === "undefined") return;
    pickId = newSpec ? null : id;
    pickNew = newSpec || null;
    pickAfter = after || null;
    ov.hidden = false;
    if ($("mp-save")) $("mp-save").disabled = true;
    if (!pickMap) {
      pickMap = L.map($("mp-map"), { tapHold: true, zoomControl: true, attributionControl: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(pickMap);
      pickMap.on("contextmenu", function (e) { dropPickPin(e.latlng); });
      bindLongPress($("mp-map"));
    }
    if (pickMarker) {
      pickMap.removeLayer(pickMarker);
      pickMarker = null;
    }
    var mc = tripMap ? tripMap.getCenter() : null;
    var c = FC().pickCenter(currentTrip().items || [], item ? itemDay(item) : selectedDateOrEmpty(), { excludeId: id }, mc ? { lat: mc.lat, lng: mc.lng, zoom: tripMap.getZoom() } : null);
    setTimeout(function () {
      pickMap.invalidateSize();
      if (c) pickMap.setView([c.lat, c.lng], c.zoom || 15);
      else pickMap.setView([20, 0], 2);
    }, 30);
  }

  /** 自己做的长按（500ms、手指不动）：有些浏览器不给 Leaflet 发 contextmenu */
  function bindLongPress(el) {
    if (!el) return;
    var timer = null;
    var start = null;
    function clear() {
      if (timer) clearTimeout(timer);
      timer = null;
    }
    el.addEventListener("pointerdown", function (ev) {
      if (ev.isPrimary === false || (ev.target && ev.target.closest && ev.target.closest(".leaflet-marker-icon, .leaflet-control"))) return;
      start = { x: ev.clientX, y: ev.clientY };
      clear();
      timer = setTimeout(function () {
        timer = null;
        if (!pickMap) return;
        var r = el.getBoundingClientRect();
        dropPickPin(pickMap.containerPointToLatLng([start.x - r.left, start.y - r.top]));
      }, 500);
    });
    el.addEventListener("pointermove", function (ev) {
      if (start && timer && Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > 10) clear();
    });
    el.addEventListener("pointerup", clear);
    el.addEventListener("pointercancel", clear);
  }

  function dropPickPin(latlng) {
    if (!pickMap || !latlng) return;
    if (pickMarker) pickMarker.setLatLng(latlng);
    else {
      pickMarker = L.marker(latlng, {
        draggable: true,
        icon: L.divIcon({ className: "mp-pin-wrap", html: '<div class="mp-pin">' + locPinSvg("#fff") + "</div>", iconSize: [36, 44], iconAnchor: [18, 42] })
      }).addTo(pickMap);
    }
    if ($("mp-save")) $("mp-save").disabled = false;
  }

  function closeMapPick() {
    if ($("map-pick")) $("map-pick").hidden = true;
    pickId = null;
    pickNew = null;
    pickAfter = null;
  }

  /** 「就放这里」：只存坐标，不查地址，不发请求 */
  function saveMapPick() {
    if (pickNew && pickMarker) {
      var spec = pickNew;
      var p = pickMarker.getLatLng();
      var fresh = itemFromType(spec.name, "", spec.label, null, selectedDateOrEmpty());
      fresh.address = "";
      fresh = FC().applyMapPick(fresh, { lat: p.lat, lng: p.lng }, mapTiles);
      closeMapPick();
      afterHotelReady(fresh, function (it) { addPlaceAndToast(it); });
      return;
    }
    if (!pickId || !pickMarker) return;
    var id = pickId;
    var after = pickAfter;
    var old = findItem(id);
    if (!old) return closeMapPick();
    var before = JSON.parse(JSON.stringify(old));
    var ll = pickMarker.getLatLng();
    var next = FC().applyMapPick(old, { lat: ll.lat, lng: ll.lng }, mapTiles);
    var trip = currentTrip();
    trip.items = ItemEdit.updateItem(trip.items || [], id, next);
    saveAllTrips();
    closeMapPick();
    expanded[id] = false;
    markJustFixed(id);
    renderAll();
    if (after) after();
    else {
      showToast("已补上位置", function () {
        var t = currentTrip();
        t.items = ItemEdit.updateItem(t.items || [], id, before);
        saveAllTrips();
        renderAll();
      });
    }
  }

  /** v5.3：搜索框粘贴复制来的地址（小红书 / 微信）：去掉 emoji、「地址：」、换行、话题标签再搜；链接一律丢掉，不解析 */
  /* ---------- v5.3 「添加什么？」 ---------- */
  function openAddMenu() {
    exitFixMode();
    if (editingId) exitEditMode();
    openSheet("add-menu");
    /* 焦点放到面板上（不在第一行画焦点框），键盘按 Tab 就到三行 */
    var panel = $("add-menu") && $("add-menu").querySelector(".sheet-panel");
    if (panel) {
      try { panel.focus(); } catch (err) {}
    }
  }

  /** 搜索页按类型准备：kind = "hotel" | "place"；酒店把搜到的结果按酒店加（之后的日期流程和以前一样） */
  function setAddPreset(kind) {
    addPreset = kind === "hotel" ? "酒店" : "";
    var box = $("place-search");
    if (box) box.setAttribute("placeholder", kind === "hotel" ? ADD_MENU_COPY.hotelPlaceholder : ADD_MENU_COPY.placePlaceholder);
  }

  function openAddFor(kind) {
    closeSheet("add-menu");
    if (kind === "flight" || kind === "whole") {
      setAddPreset("place");
      openSheet("add-sheet");
      openAiWizard(true);
      var box = $("ai-help");
      if (box && box.scrollIntoView) box.scrollIntoView({ block: "start" });
      return;
    }
    setAddPreset(kind);
    openSheet("add-sheet");
    setHotelMode(kind === "hotel");
    if ($("place-search")) {
      try { $("place-search").focus(); } catch (err) {}
    }
  }

  function bindAddMenu() {
    var C = ADD_MENU_COPY;
    var put = function (id, t) { if ($(id)) $(id).textContent = t; };
    put("am-title", C.title);
    put("am-flight-main", C.flight);
    put("am-flight-sub", C.flightSub);
    put("am-hotel-main", C.hotel);
    put("am-hotel-sub", C.hotelSub);
    put("am-place-main", C.place);
    put("am-place-sub", C.placeSub);
    put("am-whole", C.whole);
    put("add-fallback", C.fallback);
    if ($("add-sheet-back")) {
      $("add-sheet-back").setAttribute("aria-label", C.back);
      $("add-sheet-back").addEventListener("click", function () {
        closeSheet("add-sheet");
        openAddMenu();
      });
    }
    if ($("add-fallback")) $("add-fallback").addEventListener("click", openAddFallback);
    var menu = $("add-menu");
    if (!menu) return;
    menu.addEventListener("click", function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-add-kind]");
      if (b) openAddFor(b.getAttribute("data-add-kind"));
    });
  }

  function bindPasteSearch() {
    var box = $("place-search");
    if (!box) return;
    box.setAttribute("placeholder", ADD_MENU_COPY.placePlaceholder);
    box.addEventListener("paste", function (ev) {
      var dt = ev.clipboardData || window.clipboardData;
      var text = dt && dt.getData ? dt.getData("text") : "";
      if (!text || !window.FixCand || !FixCand.looksPasted(text)) return;
      var clean = FixCand.cleanPasted(text);
      if (!clean) return;
      ev.preventDefault();
      box.value = clean;
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function bindFixUi() {
    if ($("fix-banner")) $("fix-banner").addEventListener("click", openFixPanel);
    if ($("fp-skip")) $("fp-skip").addEventListener("click", function () {
      if (fixPanel) fixPanel.skip();
    });
    if ($("fp-map")) $("fp-map").addEventListener("click", function () {
      var id = $("fp-map").getAttribute("data-fc-map");
      if (id) openMapPick(id, fixPanelChose);
    });
    if ($("fp-page")) $("fp-page").addEventListener("click", function (ev) {
      var row = ev.target.closest && ev.target.closest("[data-fp-item]");
      if (row) {
        var it = findItem(row.getAttribute("data-fp-item"));
        var list = (it && FC().getCached(it)) || [];
        var c = list[Number(row.getAttribute("data-fc-i"))];
        if (c && applyCandidate(it.id, c, { quiet: true })) {
          row.classList.add("is-picked");
          fixPanelChose();
        }
        return;
      }
      if (ev.target.closest && ev.target.closest("[data-fp-none]")) {
        fixPanelNone = true;
        var box = $("fp-page").querySelector(".fp-cands");
        if (box) box.innerHTML = '<p class="fc-head">' + escapeHtml("那就在地图上选，或点右上角「跳过」") + "</p>";
      }
    });
    if ($("mp-close")) $("mp-close").addEventListener("click", closeMapPick);
    if ($("mp-save")) $("mp-save").addEventListener("click", saveMapPick);
  }

  function openFixAddress(id) {
    var item = findItem(id);
    if (!item) return;
    setAddPreset("place");
    setHotelMode(false);
    if (editingId) exitEditMode();
    fixingId = id;
    var sheet = $("add-sheet");
    if (sheet) sheet.classList.add("is-fixing");
    var title = $("add-sheet-title");
    if (title) title.textContent = DIRECT_COPY.fixTitle;
    var head = $("fix-head");
    if (head) {
      head.textContent = DIRECT_COPY.fixHead.replace("{name}", item.nameZh || itemTitle(item));
      head.hidden = false;
    }
    syncAddFallback();
    openSheet("add-sheet");
    clearSearchUi(false);
    var q = item.nameZh || itemTitle(item) || "";
    if ($("place-search")) $("place-search").value = q;
    runLiveSearch(q);
  }

  function exitFixMode() {
    var sheet = $("add-sheet");
    var was = !!fixingId || (sheet && sheet.classList.contains("is-fixing"));
    fixingId = null;
    if (!was) return;
    if (sheet) sheet.classList.remove("is-fixing");
    var title = $("add-sheet-title");
    if (title && !editingId) title.textContent = "添加";
    if ($("fix-head")) $("fix-head").hidden = true;
    syncAddFallback();
  }

  /** 选中搜索结果：只改这一条的地址和坐标（名字、日期、图标、备注不动），可撤销 */
  function fixItemFromHit(c, name) {
    var id = fixingId;
    var old = findItem(id);
    if (!old) return;
    var before = JSON.parse(JSON.stringify(old));
    var next = ItemEdit.applyFoundPlace(old, c, candidateShortAddr(c, name) || c.displayName || "");
    var trip = currentTrip();
    trip.items = ItemEdit.updateItem(trip.items || [], id, next);
    saveAllTrips();
    closeSheet("add-sheet");
    clearSearchUi(true);
    renderAll();
    showToast(DIRECT_COPY.fixDone, function () {
      var t = currentTrip();
      t.items = ItemEdit.updateItem(t.items || [], id, before);
      saveAllTrips();
      renderAll();
    });
  }

  /** v6：一行「找不到？换个方式加 ›」：加酒店页、补地址页都有；点开选「在地图上选」或「手动填地址」 */
  function syncAddFallback() {
    var b = $("add-fallback");
    if (b) b.hidden = !(hotelMode || fixingId);
  }
  function openAddFallback() {
    var C = ADD_MENU_COPY;
    var q = String(($("place-search") && $("place-search").value) || "").trim();
    var fixId = fixingId;
    openConfirm({
      title: C.fallbackTitle,
      okText: C.fallbackMap,
      tone: "primary",
      altText: C.fallbackManual,
      onOk: function () {
        if (fixId) openMapPick(fixId);
        else openMapPick(null, null, { label: "酒店", name: q || C.mapHotelName });
      },
      onAlt: function () {
        if (fixId) fixManually();
        else manualHotelFromSearch(q);
      }
    });
  }
  /** 加酒店页选「手动填地址」：打开手动填写，类型选好「酒店」，名字带上搜索框里的字 */
  function manualHotelFromSearch(q) {
    setHotelMode(false);
    clearSearchUi(true);
    var fold = $("manual-fold");
    if (fold) fold.open = true;
    if ($("manual-type")) $("manual-type").value = "酒店";
    setVal("manual-name", q);
    setTimeout(function () {
      var n = $("manual-name");
      if (n) {
        try {
          n.focus();
          if (n.scrollIntoView) n.scrollIntoView({ block: "center" });
        } catch (err) {}
      }
    }, 120);
  }

  /** 搜不到：改成手动填地址（打开这条的修改，光标放在地址栏） */
  function fixManually() {
    var id = fixingId;
    if (!id) return;
    exitFixMode();
    clearSearchUi(true);
    enterEditMode(id);
    setTimeout(function () {
      var a = $("edit-address");
      if (a) {
        try {
          a.focus();
          if (a.scrollIntoView) a.scrollIntoView({ block: "center" });
        } catch (err) {}
      }
    }, 120);
  }

  var SEARCH_FAIL_MSG = (window.Geocode && Geocode.FRIENDLY_NOT_FOUND) || "没搜到，换个名字试试，或点『找不到？换个方式加』";

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
      setSearchStatus(SEARCH_FAIL_MSG, true);
      renderSearchHits(q, []);
      return;
    }
    /* 搜不到（或补地址时）再搜一次「名字 + 当天城市」 */
    var job = typeof Geocode.searchWithCity === "function"
      ? (function (d) {
          return Geocode.searchWithCity(q, d.city, { prefer: !!fixingId, bias: d.bias }).then(function (r) { return r.results; });
        })(searchDayArgs())
      : Geocode.searchAddress(q);
    job
      .then(function (list) {
        if (gen !== searchGen) return;
        renderSearchHits(q, list || []);
      })
      .catch(function () {
        if (gen !== searchGen) return;
        setSearchStatus(SEARCH_FAIL_MSG, true);
        renderSearchHits(q, []);
        var fb = $("search-fallback");
        if (fb) fb.hidden = false;
      });
  }

  function scheduleLiveSearch() {
    var q = String(($("place-search") && $("place-search").value) || "");
    var fb = $("search-fallback");
    if (fb) fb.hidden = !q.trim();
    updateFallbackLabel(q);
    hideDirectAdd();
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
      if ($("direct-icon-picker")) $("direct-icon-picker").addEventListener("click", function (ev) {
        var b = ev.target.closest && ev.target.closest("[data-icon]");
        if (!b) return;
        var k = b.getAttribute("data-icon");
        directIcon = directIcon === k ? "" : k;
        renderIconPicker("direct-icon-picker", directIcon);
      });
      if ($("direct-add-go")) $("direct-add-go").addEventListener("click", finishDirectAdd);
      if ($("direct-add-back")) $("direct-add-back").addEventListener("click", function () {
        hideDirectAdd();
        runLiveSearch(($("place-search") && $("place-search").value) || "");
      });
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
    var fab = $("view-fab");
    if (fab) {
      fab.innerHTML = ico(isMap ? "list" : "map", "view-toggle-ico") +
        '<span class="view-toggle-label">' + (isMap ? "列表" : "地图") + "</span>";
      fab.setAttribute("aria-label", isMap ? "回到列表" : "查看地图");
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

  /* ---------- v5.2 行程名胶囊：点名字或铅笔改名；第一次导入后建议一个名字（只问一次） ---------- */
  var renaming = false;

  function startRename() {
    var trip = currentTrip();
    var btn = $("trip-name-btn");
    var box = $("trip-rename-box");
    var input = $("trip-name-input");
    if (!btn || !input || !box || !trip) return;
    closeNamePop(false);
    input.value = trip.nameZh || "我的行程";
    btn.hidden = true;
    box.hidden = false;
    renaming = true;
    input.focus();
    input.select();
  }

  function flashPill() {
    var pill = $("trip-pill");
    if (!pill) return;
    pill.classList.remove("is-flash");
    void pill.offsetWidth;
    pill.classList.add("is-flash");
    setTimeout(function () { pill.classList.remove("is-flash"); }, 900);
  }

  function setTripName(name) {
    var trip = currentTrip();
    if (!trip) return;
    trip.nameZh = name;
    saveAllTrips();
    if (window.TripName && !TripName.isDefaultName(name)) lsSet(TripName.RENAMED_KEY, "1");
    updateTopBar();
    flashPill();
  }

  /* ---------- v6「我的行程」：切换 / 新建 / 改名 / 删除 ---------- */
  var tripsRenamingId = null;

  function tripSummary(trip) {
    var items = (trip && trip.items) || [];
    if (!items.length) return "还没有内容";
    var days = tripDays(items);
    var range = days.length ? formatMd(days[0]) + (days.length > 1 ? " – " + formatMd(days[days.length - 1]) : "") : "还没定哪天";
    return range + " · " + items.length + " 项";
  }

  function renderTripsList() {
    var box = $("trips-list");
    if (!box) return;
    box.innerHTML = trips.map(function (t) {
      var cur = t.id === activeTripId;
      var id = escapeHtml(t.id);
      if (tripsRenamingId === t.id) {
        return '<li class="trip-row is-renaming' + (cur ? " is-current" : "") + '">' +
          '<input type="text" class="trip-row-input" id="trip-row-input" maxlength="40" value="' + escapeHtml(t.nameZh || "") + '" aria-label="行程名称" enterkeyhint="done">' +
          '<button type="button" class="trip-row-btn trip-row-save" data-trip-save="' + id + '">完成</button></li>';
      }
      return '<li class="trip-row' + (cur ? " is-current" : "") + '">' +
        '<button type="button" class="trip-row-main" data-trip-switch="' + id + '"' + (cur ? ' aria-current="true"' : "") + ">" +
        '<span class="trip-row-name">' + escapeHtml(t.nameZh || "我的行程") + (cur ? '<span class="trip-row-tag">正在看</span>' : "") + "</span>" +
        '<span class="trip-row-sub">' + escapeHtml(tripSummary(t)) + "</span></button>" +
        '<button type="button" class="trip-row-btn" data-trip-rename="' + id + '">改名</button>' +
        '<button type="button" class="trip-row-btn trip-row-del" data-trip-delete="' + id + '">删除</button></li>';
    }).join("");
    var input = $("trip-row-input");
    if (input) {
      input.focus();
      input.select();
    }
  }

  function openTrips() {
    tripsRenamingId = null;
    closeNamePop(false);
    renderTripsList();
    openSheet("trips-sheet");
  }

  function tripById(id) {
    var i;
    for (i = 0; i < trips.length; i++) if (trips[i].id === id) return trips[i];
    return null;
  }

  function switchTrip(id, quiet) {
    var t = tripById(id);
    if (!t) return;
    activeTripId = id;
    expanded = {};
    selectedDay = defaultSelectedDay(t.items || []);
    saveAllTrips();
    closeSheet("trips-sheet");
    renderAll();
    if (!quiet) showToast("已切换到「" + (t.nameZh || "我的行程") + "」", null, 3000);
  }

  function createTrip() {
    var t = {
      id: TripStore.newTripId(trips),
      nameZh: TripStore.newTripName(trips),
      nameEn: "",
      items: [],
      legs: [],
      imported: true
    };
    trips.push(t);
    activeTripId = t.id;
    expanded = {};
    selectedDay = "all";
    saveAllTrips();
    renderAll();
    tripsRenamingId = t.id;
    renderTripsList();
  }

  function saveTripRename(id) {
    var t = tripById(id);
    var input = $("trip-row-input");
    tripsRenamingId = null;
    if (t && input) {
      t.nameZh = String(input.value || "").trim() || t.nameZh || "我的行程";
      if (t.id === activeTripId && window.TripName && !TripName.isDefaultName(t.nameZh)) lsSet(TripName.RENAMED_KEY, "1");
      saveAllTrips();
      updateTopBar();
    }
    renderTripsList();
  }

  function askDeleteTrip(id) {
    var t = tripById(id);
    if (!t) return;
    var n = (t.items || []).length;
    var hasVisits = !!(window.Places && Places.tripVisitCount && Places.tripVisitCount(places, t.id) > 0);
    openConfirm({
      title: deleteConfirmTitle(t.nameZh || "我的行程"),
      sub: n ? "这趟的 " + n + " 项会一起删掉，删除后不能撤销。" : "删除后不能撤销。",
      okText: "删除",
      cancelText: "取消",
      checkbox: footprintsCheckbox("trip", hasVisits),
      onOk: function (alsoVisits) {
        deleteTripNow(id, alsoVisits);
      }
    });
  }

  function deleteTripNow(id, alsoVisits) {
    var t = tripById(id);
    if (!t) return;
    trips = trips.filter(function (x) { return x.id !== id; });
    if (alsoVisits && window.Places) Places.removeTripVisits(places, id);
    if (!trips.length) trips = [emptyTrip()];
    if (activeTripId === id || !tripById(activeTripId)) {
      activeTripId = trips[0].id;
      expanded = {};
      selectedDay = defaultSelectedDay(trips[0].items || []);
    }
    saveAllTrips();
    renderAll();
    renderTripsList();
    showToast("已删除「" + (t.nameZh || "我的行程") + "」", null, 3000);
  }

  function bindTripsSheet() {
    var list = $("trips-list");
    if (list) {
      list.addEventListener("click", function (ev) {
        var b = ev.target.closest ? ev.target.closest("button") : null;
        if (!b) return;
        if (b.hasAttribute("data-trip-switch")) switchTrip(b.getAttribute("data-trip-switch"));
        else if (b.hasAttribute("data-trip-rename")) {
          tripsRenamingId = b.getAttribute("data-trip-rename");
          renderTripsList();
        } else if (b.hasAttribute("data-trip-save")) saveTripRename(b.getAttribute("data-trip-save"));
        else if (b.hasAttribute("data-trip-delete")) askDeleteTrip(b.getAttribute("data-trip-delete"));
      });
      list.addEventListener("keydown", function (ev) {
        if (ev.target && ev.target.id === "trip-row-input") {
          if (ev.key === "Enter") saveTripRename(tripsRenamingId);
          if (ev.key === "Escape") {
            tripsRenamingId = null;
            renderTripsList();
          }
        }
      });
    }
    if ($("trips-new")) $("trips-new").addEventListener("click", createTrip);
  }

  function finishRename(cancel) {
    if (!renaming) return;
    renaming = false;
    var trip = currentTrip();
    var btn = $("trip-name-btn");
    var box = $("trip-rename-box");
    var input = $("trip-name-input");
    if (!btn || !input || !box || !trip) return;
    box.hidden = true;
    btn.hidden = false;
    if (cancel === true) {
      updateTopBar();
      return;
    }
    setTripName(String(input.value || "").trim() || "我的行程");
  }

  var pendingNameSuggest = null;
  var namePopOpen = false;
  var openFlowPopup = false;

  function anyPopupOpen() {
    var open = Array.prototype.some.call(document.querySelectorAll(".sheet"), function (el) { return !el.hidden; });
    var ov = $("inapp-overlay");
    return open || !!(ov && !ov.hidden) || namePopOpen;
  }

  /** 导入后调用：名字还是默认、从没问过，就准备问一次（等别的弹窗都关了再显示）。 */
  function queueNameSuggest(addedCount) {
    if (!window.TripName) return;
    var trip = currentTrip();
    var ok = TripName.shouldAsk({
      name: trip && trip.nameZh,
      asked: lsGet(TripName.ASKED_KEY) === "1",
      addedCount: addedCount
    });
    if (!ok) return;
    var sug = TripName.suggestName((trip && trip.items) || []);
    if (!sug) return;
    lsSet(TripName.ASKED_KEY, "1");
    pendingNameSuggest = sug;
    setTimeout(flushNameSuggest, 300);
  }

  function flushNameSuggest() {
    if (!pendingNameSuggest || anyPopupOpen() || renaming) return;
    var pop = $("name-pop");
    if (!pop) return;
    $("name-pop-text").textContent = pendingNameSuggest.text;
    $("name-pop-yes").textContent = TripName.COPY.yes;
    $("name-pop-self").textContent = TripName.COPY.self;
    var anchor = $("trip-name-btn");
    if (anchor) {
      var r = anchor.getBoundingClientRect();
      pop.style.top = Math.round(r.bottom + 10) + "px";
      pop.style.left = Math.round(Math.max(12, r.left - 4)) + "px";
    }
    pop.hidden = false;
    namePopOpen = true;
    setTimeout(function () {
      document.addEventListener("pointerdown", namePopOutside, true);
    }, 0);
  }

  function namePopOutside(ev) {
    var pop = $("name-pop");
    if (pop && !pop.contains(ev.target)) closeNamePop(true);
  }

  /** 关掉起名建议。之后按规则看要不要接着弹「放到手机桌面」引导（顺序：先起名，再引导）。 */
  function closeNamePop(thenGuide) {
    document.removeEventListener("pointerdown", namePopOutside, true);
    var pop = $("name-pop");
    var was = namePopOpen;
    if (pop) pop.hidden = true;
    namePopOpen = false;
    pendingNameSuggest = null;
    if (was && thenGuide) setTimeout(function () { maybeAutoGuide(openFlowPopup); }, 250);
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
    /* v5.2：AI 回复里夹着解释文字或 ``` 代码块的 JSON 也算 */
    if (/```/.test(t) || /^\s*[\[{]/m.test(t)) return true;
    return false;
  }

  function appendItems(incoming, opts) {
    var trip = currentTrip();
    if (!trip.items) trip.items = [];
    var added = uniqueItemIds(trip.items, incoming);
    trip.items = trip.items.concat(added);
    /* v6：酒店 / 地点连到地点库。够得上「自动」的直接连；像是上次那家的（批量导入也一样）一条一条问 */
    var asks = linkAddedItems(added);
    saveAllTrips();
    if (!(opts && opts.keepDay)) {
      selectedDay = defaultSelectedDay(trip.items);
      dayPickedByUser = false;
    }
    renderAll();
    askSamePlaces(asks);
    return added;
  }

  /** 连地点库；返回要问「是上次那家吗？」的 [{ item, place }]（还没连，等用户答） */
  function linkAddedItems(list) {
    if (!window.Places || demoMode) return [];
    var asks = [];
    list.forEach(function (it) {
      var r = Places.linkItem(it, places, { onAsk: "defer", today: todayIso() });
      if (r.action === "ask") asks.push({ item: it, place: r.place });
    });
    return asks;
  }

  /** 排队一条一条问。没答就关掉（点外面）当「不是」：建新地点，不合并 */
  function askSamePlaces(queue) {
    if (!queue || !queue.length) return;
    var a = queue.shift();
    askSamePlace(a.item, a.place, function () { askSamePlaces(queue); });
  }

  /** 「是上次那家吗？」：是 → 连到那个地点（备注跟过来）；不是 → 建一个新地点 */
  function askSamePlace(item, place, then) {
    var where = [place.city, place.address].filter(Boolean)[0] || "";
    var noteLine = place.note ? "上次的备注：" + String(place.note).split("\n")[0] : "";
    var asking = item.nameZh || item.nameEn || "";
    openConfirm({
      title: Places.ASK_TITLE,
      sub: (asking && asking !== place.name ? "这次加的「" + asking + "」，" : "") + "本机已经有「" + (place.name || "") + "」" + (where ? "（" + where + "）" : "") + "。" + (noteLine ? "\n" + noteLine : ""),
      okText: "是同一家",
      cancelText: "不是",
      tone: "primary",
      onOk: function () {
        var cur = findItem(item.id);
        if (cur) Places.linkTo(cur, place);
        saveAllTrips();
        renderAll();
      },
      onClose: function () {
        var cur = findItem(item.id);
        if (cur && !cur.placeId) {
          Places.linkItem(cur, places, { onAsk: "new", exclude: [place.id], today: todayIso() });
          saveAllTrips();
        }
        if (typeof then === "function") then();
      }
    });
  }

  /**
   * 合并导入时本机已有同一趟（同 id）：一趟一趟问「已经有一趟『…』了」覆盖 / 另存一份 / 取消。
   * done({ id: "overwrite" | "copy" })；点「取消」或点外面关掉 → done(null)，什么都不导入。
   */
  /* 文案（19:17 定）：标题「已经有一趟『<行程名>』了」，小字「覆盖会换掉原来的内容」，按钮 覆盖 / 另存一份 / 取消 */
  var TRIP_CONFLICT_COPY = { sub: "覆盖会换掉原来的内容", overwrite: "覆盖", copy: "另存一份", cancel: "取消" };
  function tripConflictTitle(name) {
    return "已经有一趟『" + (name || "我的行程") + "』了";
  }
  function askTripConflicts(list, done) {
    var answers = {};
    var queue = (list || []).slice();
    function next() {
      if (!queue.length) {
        done(answers);
        return;
      }
      var c = queue.shift();
      var answered = false;
      openConfirm({
        title: tripConflictTitle(c.localName || c.name),
        sub: TRIP_CONFLICT_COPY.sub,
        okText: TRIP_CONFLICT_COPY.overwrite,
        altText: TRIP_CONFLICT_COPY.copy,
        cancelText: TRIP_CONFLICT_COPY.cancel,
        onOk: function () { answered = true; answers[c.id] = "overwrite"; },
        onAlt: function () { answered = true; answers[c.id] = "copy"; },
        onClose: function () {
          if (answered) next();
          else done(null);
        }
      });
    }
    next();
  }

  function resolutionNote(res) {
    if (res.status === "none" || res.status === "error") {
      return res.message || (window.Geocode && Geocode.FRIENDLY_NOT_FOUND) || "暂时找不到位置，可以先直接添加，之后再补地址";
    }
    return res.message || "";
  }

  function renderPickList(resolutions) {
    var box = $("add-pick");
    if (!box) return;
    var need = (resolutions || []).filter(function (r) {
      return r.status === "ambiguous" || r.status === "far" || r.status === "none" || r.status === "error";
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
        if (res.autoLocated && (items[i] || res.item)) (items[i] || res.item).autoLocated = true;
      }
    });
  }

  /**
   * v5.3（IT老板）：导入后没坐标的条目进待补。搜到多个结果（或唯一结果离当天太远）时，把这些结果当候选放进内存；
   * 没有结果的，后台再按当天城市 / 区域 / 简化名找一次。都要用户点一下才补。
   */
  function seedCandidates(items, resolutions) {
    if (!window.FixCand) return;
    items.forEach(function (it, i) {
      var cur = findItem(it.id) || it;
      if (!FixCand.needsFix(cur)) return;
      var res = resolutions[i];
      if (res && res.candidates && res.candidates.length && (res.status === "ambiguous" || res.status === "far")) {
        FixCand.setCached(cur, res.candidates);
        candState[cur.id] = "done";
      } else queueCandidates(cur);
    });
  }

  function itemsNeedingFix(items) {
    return (items || []).filter(function (it) {
      if (!it) return false;
      var cur = findItem(it.id) || it;
      if (isPendingItem(cur)) return true;
      if (isTransit(cur)) return false;
      if (itemUnlocated(cur)) return true;
      return !!(window.FixCand && FixCand.needsFix(cur));
    });
  }

  function showImportError(errors, notes) {
    showAiFallback();
    var lines = (errors || []).concat(notes || []).filter(Boolean);
    if (!lines.length) lines = [IMPORT_COPY.none];
    var html = lines.map(function (e) {
      return '<p class="err import-err">' + escapeHtml(e) + "</p>";
    }).join("");
    showAddStatus(html);
    var ta = $("add-text");
    if (ta && ta.scrollIntoView) ta.scrollIntoView({ block: "center" });
  }

  function showImportToast(n, y) {
    var text = y ? IMPORT_COPY.toastNeed(n, y) : IMPORT_COPY.toastOk(n);
    showToast(text, null, 2500);
    var el = $("toast");
    var ck = $("toast-check");
    if (ck) ck.hidden = false;
    if (el) el.classList.add("is-import");
  }

  function goToPendingOrFix() {
    setView("list");
    selectDay("all", true);
    renderAll();
    var blk = $("day-pending") || $("fix-banner") || document.querySelector(".card.is-pending, .fc-box, .nav-fix-link");
    if (blk && blk.scrollIntoView) blk.scrollIntoView({ block: "start" });
  }

  function flashImported(ids) {
    justImported = {};
    (ids || []).forEach(function (id) {
      justImported[id] = true;
      justImported[String(id) + "::checkout"] = true;
    });
    renderList();
    setTimeout(function () {
      var nodes = document.querySelectorAll(".card.is-just-imported");
      Array.prototype.forEach.call(nodes, function (el) { el.classList.add("is-fading"); });
    }, 40);
    setTimeout(function () {
      justImported = {};
      renderList();
    }, 1600);
  }

  var justImported = {};
  var importConfirm = null;

  function finishStructuredImport(items, resolutions, errors, notes) {
    applyResolutions(items, resolutions || []);
    (resolutions || []).forEach(function (res) {
      if (res && res.autoLocated && res.item) res.item.autoLocated = true;
      if (res && res.status === "ok" && res.autoLocated && res.item) res.item.autoLocated = true;
    });
    var added = [];
    if (items.length) added = appendItems(items, { keepDay: true }) || items;
    seedCandidates(items, resolutions || []);
    if (items.length) queueNameSuggest(items.length);
    resetAddPasteUi();
    closeSheet("add-sheet");
    closeSheet("add-menu");
    closeSheet("settings-sheet");
    setView("list");
    selectDay("all", true);
    renderAll();
    flashImported((added || items).map(function (it) { return it.id; }));
    /* 导入过程不弹确认：位置找不到也照样进行程，卡片上留「位置待确认 ›」 */
    var n = (added || items).length;
    var y = itemsNeedingFix(added || items).length;
    showImportToast(n, y);
  }

  function startImportConfirm(items, resolutions, done) {
    var F = window.FixCand;
    if (!F) { if (done) done(); return; }
    importConfirm = {
      queue: items.slice(),
      resolutions: resolutions || [],
      left: items.length,
      done: done
    };
    paintImportConfirm();
  }

  function paintImportConfirm() {
    var st = importConfirm;
    var bar = $("confirm-remain");
    var sheet = $("import-confirm-sheet");
    if (!st || !st.queue.length) {
      if (bar) bar.hidden = true;
      if (sheet) sheet.hidden = true;
      var cb = st && st.done;
      importConfirm = null;
      if (cb) cb();
      return;
    }
    if (bar) {
      bar.hidden = false;
      bar.textContent = FixCand.remainText(st.left);
    }
    var item = st.queue[0];
    var res = null;
    (st.resolutions || []).forEach(function (r) {
      if (r && r.item && item && r.item.id === item.id) res = r;
    });
    var list = (res && res.candidates) || (FixCand.getCached(item) || []);
    var kind = res && res.status === "far" ? "far" : "ask";
    var ranked = FixCand.rankCandidates ? FixCand.rankCandidates(item, list, dayArgsFor(item)) : list;
    if (!sheet) {
      sheet = document.createElement("div");
      sheet.id = "import-confirm-sheet";
      sheet.className = "import-confirm-sheet";
      document.body.appendChild(sheet);
    }
    var title = FixCand.askTitle(item, ranked, kind);
    var cards = ranked.map(function (c, j) {
      var name = (c.name || c.nameDetail || itemTitle(item) || "");
      var addr = FixCand.fullAddress ? FixCand.fullAddress(c) : (c.displayName || "");
      var mini = FixCand.staticMapHtml ? FixCand.staticMapHtml(c.lat, c.lng) : "";
      return '<button type="button" class="cand-card" data-ci="' + j + '">' +
        mini +
        '<span class="cand-name">' + escapeHtml(name) + "</span>" +
        (addr ? '<span class="cand-addr">' + escapeHtml(addr) + "</span>" : "") +
        "</button>";
    }).join("");
    sheet.innerHTML =
      '<div class="import-confirm-panel">' +
      '<h2 class="import-confirm-title">' + escapeHtml(title) + "</h2>" +
      '<div class="cand-cards">' + cards + "</div>" +
      '<button type="button" class="text-link-btn" id="import-confirm-skip">' + escapeHtml(FixCand.COPY.skip) + "</button>" +
      "</div>";
    sheet.hidden = false;
      resetSheetScroll(sheet);
    Array.prototype.forEach.call(sheet.querySelectorAll(".cand-card"), function (btn) {
      btn.addEventListener("click", function () {
        var c = ranked[Number(btn.getAttribute("data-ci"))];
        if (c) applyCandidate(item.id, c, { quiet: true });
        var cur = findItem(item.id);
        if (cur) delete cur.autoLocated;
        st.queue.shift();
        st.left = st.queue.length;
        paintImportConfirm();
      });
    });
    var skip = $("import-confirm-skip");
    if (skip) skip.addEventListener("click", function () {
      /* 先跳过：进待补，不写地点 */
      st.queue.shift();
      st.left = st.queue.length;
      paintImportConfirm();
    });
  }

  function finishImport(items, resolutions, errors, notes, opts) {
    opts = opts || {};
    if (opts.structured) {
      if (!items || !items.length) {
        showImportError(errors, notes);
        return;
      }
      finishStructuredImport(items, resolutions, errors, notes);
      return;
    }
    if (opts.paste && items.length) {
      applyResolutions(items, resolutions || []);
      if (items.length) appendItems(items);
      seedCandidates(items, resolutions || []);
      if (items.length) queueNameSuggest(items.length);
      resetAddPasteUi();
      closeSheet("add-sheet");
      closeSheet("add-menu");
      setView("list");
      showImportToast(items.length, itemsNeedingFix(items).length);
      return;
    }
    applyResolutions(items, resolutions || []);
    if (items.length) appendItems(items);
    seedCandidates(items, resolutions || []);
    if (items.length) queueNameSuggest(items.length);
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
    if (!parts.length) parts.push('<p class="err">' + escapeHtml(IMPORT_COPY.none) + "</p>");
    showAddStatus(parts.join(""));
    renderPickList(resolutions || []);
  }

  function runStructuredImport(text) {
    var cur = currentTrip();
    var result = ImportUtil.parseImport(text, { items: cur && cur.items });
    var items = result.items || [];
    var errors = result.errors || [];
    var notes = result.notes || [];
    if (!items.length) {
      showImportError(errors, notes);
      return;
    }
    showAddStatus('<p class="ok">正在查找位置…</p>');
    /* v5.3（IT老板）：导入也用当天城市 + 区域（bounded=1 → 0）；酒店先找，后面的地点能用上 */
    Geocode.resolveAll(items, null, function (it) { return dayArgsFor(it, items); })
      .then(function (resolutions) {
        finishImport(items, resolutions, errors, result.notes, { structured: true });
      })
      .catch(function () {
        finishImport(
          items,
          items.map(function (it) {
            return { item: it, status: "none", message: Geocode.FRIENDLY_NOT_FOUND, candidates: [], chosen: null };
          }),
          errors,
          result.notes,
          { structured: true }
        );
      });
  }

  function runPlaceSearch(text) {
    var name = String(text || "").trim();
    if (!name) {
      showAddStatus('<p class="err">先输入店名，或粘贴地址</p>');
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
    Geocode.resolveItem(item, dayArgsFor(item))
      .then(function (res) {
        finishImport([item], [res], [], [], { paste: true });
      })
      .catch(function () {
        finishImport(
          [item],
          [{ item: item, status: "none", message: Geocode.FRIENDLY_NOT_FOUND, candidates: [], chosen: null }],
          [],
          [],
          { paste: true }
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
      places: places,
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

  /**
   * 导入备份 / 分享文件。v6：
   *   replace：整份替换行程和地点库；
   *   merge：文件里的每个行程都加成单独的行程（id 撞了就换），不再并进同名行程；地点能自动认作同一个的用本机的。
   * 旧文件（v5.3 及以前，没有 places）也照样导入：条目会现连地点库。
   */
  function importState(state, mode, opts) {
    var incomingLegs = state && state.legs && typeof state.legs === "object" ? state.legs : {};
    var next = TripStore.importInto(
      { trips: trips, places: places, activeTripId: activeTripId, examplesLoaded: examplesLoaded },
      state || {},
      mode === "replace" ? "replace" : "merge",
      { today: todayIso(), onConflict: (opts && opts.onConflict) || {} }
    );
    trips = next.trips;
    places = next.places;
    activeTripId = next.activeTripId;
    examplesLoaded = next.examplesLoaded;
    try {
      var legs = mode === "replace" ? {} : JSON.parse(localStorage.getItem(LEG_STORAGE_KEY) || "{}");
      Object.keys(incomingLegs).forEach(function (k) {
        legs[k] = incomingLegs[k];
      });
      localStorage.setItem(LEG_STORAGE_KEY, JSON.stringify(legs));
    } catch (e) {}
    if (!trips.length) {
      trips = [emptyTrip()];
      activeTripId = trips[0].id;
    }
    expanded = {};
    selectedDay = defaultSelectedDay((currentTrip().items || []));
    dayPickedByUser = false;
    saveAllTrips();
    renderAll();
  }

  window.LocConfirmMap = {
    getMap: function () { return locConfirmMap; },
    syncSize: syncLocConfirmMapSize,
    scheduleSize: scheduleLocConfirmMapSize,
    pinTipContainerPoint: function () {
      var el = $("loc-confirm-map");
      if (!el) return null;
      return { x: el.clientWidth / 2, y: el.clientHeight / 2 };
    },
    pinTipLatLng: function () {
      if (!locConfirmMap || typeof L === "undefined") return null;
      var p = window.LocConfirmMap.pinTipContainerPoint();
      if (!p) return null;
      var ll = locConfirmMap.containerPointToLatLng(L.point(p.x, p.y));
      return { lat: ll.lat, lng: ll.lng };
    },
    savedLatLng: function () {
      if (!locConfirmMap) return null;
      var c = locConfirmMap.getCenter();
      return { lat: c.lat, lng: c.lng };
    }
  };

  window.TripApp = {
    exportState: exportState,
    importState: importState,
    /** 合并导入前：文件里哪些行程本机已经有了 */
    tripConflicts: function (state) {
      return TripStore.tripConflicts({ trips: trips }, state || {});
    },
    askTripConflicts: askTripConflicts,
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
    refresh: renderAll,
    openFixPanel: openFixPanel,
    openMapPick: openMapPick,
    openIosSheet: openIosSheet,
    openInAppOverlay: openInAppOverlay,
    maybeAutoGuide: maybeAutoGuide,
    getMap: function () {
      return tripMap;
    },
    mapTileKind: function () {
      return mapTiles;
    },
    toast: function (msg) {
      showToast(msg, null, 5000);
    },
    openHotelDateSheet: function (item, addFn) {
      openHotelDateSheet(item || { type: "hotel", nameZh: "示例酒店" }, addFn || function () {});
    },
    setDayPickedByUser: function (on) { dayPickedByUser = !!on; },
    selectedDay: function () { return selectedDay; }
  };

  function applyDemo(which) {
    demoMode = true;
    if (which === "empty") {
      trips = [emptyTrip()];
      activeTripId = trips[0].id;
      examplesLoaded = false;
      selectedDay = "all";
      dayPickedByUser = false;
    } else {
      trips = [which === "japan" || which === "japan-month" ? demoJapanTrip() : demoTrip()];
      activeTripId = trips[0].id;
      examplesLoaded = true;
      selectedDay = defaultSelectedDay(trips[0].items);
      dayPickedByUser = false;
    }
  }


  function bindAddressCopy() {
    if (bindAddressCopy._on) return;
    bindAddressCopy._on = true;
    var timer = 0;
    var startEl = null;
    document.addEventListener("pointerdown", function (ev) {
      var el = ev.target.closest && ev.target.closest("[data-copy-address]");
      if (!el) return;
      startEl = el;
      clearTimeout(timer);
      timer = setTimeout(function () {
        timer = 0;
        var text = (startEl && startEl.textContent || "").trim();
        if (!text) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () {
            showToast("已复制地址", null, 1600);
          }).catch(function () {});
        }
      }, 550);
    });
    ["pointerup", "pointercancel", "pointermove"].forEach(function (name) {
      document.addEventListener(name, function () {
        if (timer) {
          clearTimeout(timer);
          timer = 0;
        }
      }, name === "pointermove" ? { passive: true } : undefined);
    });
  }

  function locProgressText(i, n) {
    var s = (window.Lookup && Lookup.COPY && Lookup.COPY.progress) || "第 {i} 个，共 {n} 个";
    return s.replace("{i}", String(i)).replace("{n}", String(n));
  }

  var locConfirm = null;
  var locConfirmMap = null;

  function unlocatedPlaceItems() {
    var items = (currentTrip() && currentTrip().items) || [];
    return items.filter(function (it) { return !isTransit(it) && itemUnlocated(it); });
  }

  function destroyLocConfirmMap() {
    if (locConfirmMap) {
      try { locConfirmMap.remove(); } catch (err) {}
      locConfirmMap = null;
    }
    var el = $("loc-confirm-map");
    if (el) {
      el.className = "import-confirm-map";
      el.innerHTML = "";
    }
  }

  function closeLocConfirm() {
    locConfirm = null;
    destroyLocConfirmMap();
    var sheet = $("import-confirm-sheet");
    if (sheet) {
      sheet.hidden = true;
      sheet.innerHTML = "";
    }
  }

  function syncLocConfirmMapSize() {
    if (!locConfirmMap) return;
    locConfirmMap.invalidateSize({ animate: false });
  }

  function scheduleLocConfirmMapSize() {
    syncLocConfirmMapSize();
    requestAnimationFrame(function () {
      syncLocConfirmMapSize();
      requestAnimationFrame(syncLocConfirmMapSize);
    });
    setTimeout(syncLocConfirmMapSize, 0);
    setTimeout(syncLocConfirmMapSize, 100);
  }

  function bindLocConfirmResize() {
    if (window.__locConfirmResizeBound) return;
    window.__locConfirmResizeBound = true;
    window.addEventListener("resize", syncLocConfirmMapSize);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", syncLocConfirmMapSize);
  }

  function locConfirmStartView(item, cand) {
    if (cand && isFinite(cand.lat) && isFinite(cand.lng)) return { lat: cand.lat, lng: cand.lng, zoom: 15 };
    var mc = tripMap ? tripMap.getCenter() : null;
    var hint = mc ? { lat: mc.lat, lng: mc.lng, zoom: tripMap.getZoom() } : null;
    var day = item ? itemDay(item) : "";
    var c = FC().pickCenter && FC().pickCenter((currentTrip() && currentTrip().items) || [], day, { excludeId: item && item.id }, hint);
    if (c && isFinite(c.lat) && isFinite(c.lng)) return { lat: c.lat, lng: c.lng, zoom: c.zoom || 15 };
    return { lat: 51.5074, lng: -0.1278, zoom: 3 };
  }

  function bindLocConfirmMap(el, start) {
    if (!el || typeof L === "undefined") return;
    destroyLocConfirmMap();
    locConfirmMap = L.map(el, { scrollWheelZoom: true, attributionControl: true, zoomControl: true });
    if (window.MapTiles && MapTiles.attach) MapTiles.attach(locConfirmMap, el);
    else {
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
      }).addTo(locConfirmMap);
    }
    var lat = start && isFinite(start.lat) ? start.lat : 51.5074;
    var lng = start && isFinite(start.lng) ? start.lng : -0.1278;
    var zoom = start && start.zoom ? start.zoom : 15;
    locConfirmMap.setView([lat, lng], zoom);
    if (locConfirm) locConfirm.userMoved = false;
    locConfirmMap.on("dragstart", function () { if (locConfirm) locConfirm.userMoved = true; });
    locConfirmMap.on("zoomstart", function () { if (locConfirm) locConfirm.userMoved = true; });
    locConfirmMap.on("click", function (e) {
      if (!e || !e.latlng || !locConfirmMap) return;
      if (locConfirm) locConfirm.userMoved = true;
      locConfirmMap.panTo(e.latlng);
    });
    bindLocConfirmResize();
    scheduleLocConfirmMapSize();
  }

  function applyLocConfirmPoint(item) {
    if (!item || !locConfirmMap) return false;
    var c = locConfirmMap.getCenter();
    if (!c || !isFinite(c.lat) || !isFinite(c.lng)) return false;
    var old = findItem(item.id);
    if (!old) return false;
    var next = FC().applyMapPick(old, { lat: c.lat, lng: c.lng }, mapTiles);
    var trip = currentTrip();
    trip.items = ItemEdit.updateItem(trip.items || [], item.id, next);
    if (window.Lookup && Lookup.saveUserPosition) places = Lookup.saveUserPosition(places, next, next.lat, next.lng);
    saveAllTrips();
    return true;
  }

  function locConfirmAdvance() {
    if (!locConfirm) return;
    locConfirm.index += 1;
    if (locConfirm.index >= locConfirm.queue.length) {
      closeLocConfirm();
      renderAll();
      return;
    }
    paintLocConfirm();
  }

  function openLocPending(id) {
    var all = unlocatedPlaceItems();
    var first = [];
    var rest = [];
    all.forEach(function (it) {
      if (String(it.id) === String(id)) first.push(it);
      else rest.push(it);
    });
    if (!first.length) {
      var one = findItem(id);
      if (one) first = [one];
    }
    if (!first.length) return;
    locConfirm = { queue: first.concat(rest), index: 0 };
    paintLocConfirm();
  }

  function paintLocConfirm() {
    var st = locConfirm;
    if (!st || !st.queue[st.index]) {
      closeLocConfirm();
      return;
    }
    if (locConfirmMap && st.paintedId && st.paintedId !== st.queue[st.index].id) {
      destroyLocConfirmMap();
    }
    var item = findItem(st.queue[st.index].id) || st.queue[st.index];
    var i = st.index + 1;
    var n = st.queue.length;
    var Lkp = window.Lookup && Lookup.COPY ? Lookup.COPY : {};
    var sheet = $("import-confirm-sheet");
    if (!sheet) {
      sheet = document.createElement("div");
      sheet.id = "import-confirm-sheet";
      sheet.className = "import-confirm-sheet";
      document.body.appendChild(sheet);
    }
    var cached = (window.FixCand && FixCand.getCached && FixCand.getCached(item)) || [];
    function paintMeta(cand) {
      var nameEl = sheet.querySelector(".import-confirm-name");
      var addrEl = sheet.querySelector(".import-confirm-addr");
      var titleEl = sheet.querySelector(".import-confirm-title");
      var name = (cand && (cand.name || cand.nameDetail)) || itemTitle(item) || "";
      var addr = cand
        ? ((window.FixCand && FixCand.fullAddress) ? FixCand.fullAddress(cand) : (cand.displayName || ""))
        : (item.address || "");
      var title = cand
        ? ((window.FixCand && FixCand.COPY && FixCand.COPY.askFar) || "是这里吗？")
        : (Lkp.notFound || "地图上没找到这里");
      if (titleEl) titleEl.textContent = title;
      if (nameEl) nameEl.textContent = name;
      if (addrEl) {
        if (addr) addrEl.textContent = addr;
        else addrEl.parentNode && addrEl.parentNode.removeChild(addrEl);
      } else if (addr && nameEl) {
        var p = document.createElement("div");
        p.className = "import-confirm-addr";
        p.textContent = addr;
        nameEl.parentNode.appendChild(p);
      }
    }
    function finish(list) {
      if (!locConfirm || locConfirm.queue[locConfirm.index].id !== item.id) return;
      var cand = (list && list[0]) || null;
      var here = Lkp.confirmHere || "就放这里";
      var head = Lkp.confirmHead || "确认位置";
      var skipLabel = Lkp.skip || "先跳过";
      var hint = Lkp.confirmHint || "拖动地图或点一下，把点对准那个地方";
      var already = locConfirmMap && locConfirm.paintedId === item.id;
      if (already) {
        paintMeta(cand);
        if (cand && isFinite(cand.lat) && isFinite(cand.lng) && !locConfirm.userMoved) {
          locConfirmMap.setView([cand.lat, cand.lng], 15);
        }
        return;
      }
      var name = (cand && (cand.name || cand.nameDetail)) || itemTitle(item) || "";
      var addr = cand
        ? ((window.FixCand && FixCand.fullAddress) ? FixCand.fullAddress(cand) : (cand.displayName || ""))
        : (item.address || "");
      var title = cand
        ? ((window.FixCand && FixCand.COPY && FixCand.COPY.askFar) || "是这里吗？")
        : (Lkp.notFound || "地图上没找到这里");
      destroyLocConfirmMap();
      sheet.innerHTML =
        '<div class="import-confirm-panel">' +
        '<div class="import-confirm-top"><b>' + escapeHtml(head) + "</b><span>" + escapeHtml(locProgressText(i, n)) + "</span></div>" +
        '<div class="import-confirm-map-wrap">' +
        '<div class="import-confirm-map" id="loc-confirm-map"></div>' +
        '<span class="import-confirm-pin-anchor" aria-hidden="true"><span class="import-confirm-pin"></span></span>' +
        "</div>" +
        '<p class="import-confirm-hint">' + escapeHtml(hint) + "</p>" +
        '<div class="import-confirm-info">' +
        '<h2 class="import-confirm-title">' + escapeHtml(title) + "</h2>" +
        '<div class="import-confirm-name">' + escapeHtml(name) + "</div>" +
        (addr ? '<div class="import-confirm-addr">' + escapeHtml(addr) + "</div>" : "") +
        "</div>" +
        '<div class="import-confirm-actions">' +
        '<button type="button" class="btn primary" id="loc-pending-here">' + escapeHtml(here) + "</button>" +
        '<button type="button" class="text-link-btn" id="loc-pending-skip">' + escapeHtml(skipLabel) + "</button>" +
        "</div></div>";
      sheet.hidden = false;
      resetSheetScroll(sheet);
      locConfirm.paintedId = item.id;
      bindLocConfirmMap($("loc-confirm-map"), locConfirmStartView(item, cand));
      var hereBtn = $("loc-pending-here");
      if (hereBtn) {
        hereBtn.addEventListener("click", function () {
          applyLocConfirmPoint(item);
          locConfirmAdvance();
        });
      }
      var skip = $("loc-pending-skip");
      if (skip) skip.addEventListener("click", locConfirmAdvance);
    }
    finish(cached);
    if (window.Lookup && Lookup.searchByName) {
      Lookup.searchByName(item.nameZh || item.nameEn || item.name || "", dayArgsFor(item)).then(function (list) {
        finish(list && list.length ? list : cached);
      }).catch(function () { finish(cached); });
    }
  }

  function initChrome() {
    decorateChrome();
    if (!window.__cardMetaResizeBound) {
      window.__cardMetaResizeBound = true;
      window.addEventListener("resize", function () { fitCardMetaSubs(); });
    }
    if ($("view-fab")) {
      $("view-fab").addEventListener("click", function () {
        setView(currentView === "map" ? "list" : "map");
      });
    }
    $("settings-btn").addEventListener("click", function () {
      openSheet("settings-sheet");
    });
    $("add-fab").addEventListener("click", openAddMenu);
    bindAddMenu();
    $("add-go").addEventListener("click", function () {
      wizardImport(($("add-text") && $("add-text").value) || "");
    });
    if ($("ai-big-btn")) $("ai-big-btn").addEventListener("click", function () { openAiWizard(); });
    if ($("ai-paste-btn")) $("ai-paste-btn").addEventListener("click", pasteAndImport);
    fillAiWizardText();
    if ($("ai-copy-btn")) $("ai-copy-btn").addEventListener("click", copyAiPrompt);
    if ($("ai-prompt-open")) {
      $("ai-prompt-open").textContent = AI_WIZARD_COPY.promptBtn;
      $("ai-prompt-open").addEventListener("click", function () {
        var box = $("ai-prompt-box");
        showAiPrompt(!!(box && box.hidden));
      });
    }
    if ($("manual-save")) $("manual-save").addEventListener("click", handleManualSave);
    if ($("manual-fold")) $("manual-fold").addEventListener("toggle", syncManualActions);
    bindSheetKeyboard();
    renderIconPicker();
    if ($("icon-picker")) $("icon-picker").addEventListener("click", function (ev) {
      var btn = ev.target.closest && ev.target.closest("[data-icon]");
      if (btn) setPickedIcon(btn.getAttribute("data-icon"));
    });
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
    $("trip-name-btn").addEventListener("click", function () {
      dismissTripTip();
      openTrips();
    });
    if ($("trip-add-btn")) {
      $("trip-add-btn").addEventListener("click", function () {
        dismissTripTip();
        createTrip();
        openTrips();
      });
    }
    if ($("trip-tip")) {
      $("trip-tip").addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        dismissTripTip();
      });
    }
    bindAddressCopy();
    bindTripsSheet();
    $("trip-name-input").addEventListener("blur", function () { finishRename(); });
    $("trip-name-input").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        finishRename();
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        finishRename(true);
      }
    });
    if ($("trip-name-done")) {
      /* 按下「完成」时输入框会先失焦并保存；这里兜底 */
      $("trip-name-done").addEventListener("mousedown", function (ev) { ev.preventDefault(); });
      $("trip-name-done").addEventListener("click", function () { finishRename(); });
    }
    if ($("name-pop-yes")) $("name-pop-yes").addEventListener("click", function () {
      var sug = pendingNameSuggest;
      closeNamePop(true);
      if (sug) setTripName(sug.name);
    });
    if ($("name-pop-self")) $("name-pop-self").addEventListener("click", function () {
      closeNamePop(false);
      startRename();
    });
    bindStrip();
    document.addEventListener("click", function (ev) {
      var closer = ev.target.closest && ev.target.closest("[data-close]");
      if (closer) {
        var which = closer.getAttribute("data-close");
        if (which === "confirm-sheet") closeConfirm();
        else if (which === "hotel-date-sheet") closeHotelDateSheet();
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
        if ($("hotel-date-sheet") && !$("hotel-date-sheet").hidden) {
          closeHotelDateSheet();
          return;
        }
        closeSheet("detail-sheet");
        if (editingId) exitEditMode();
        closeSheet("add-sheet");
        closeSheet("settings-sheet");
        closeSheet("install-sheet");
        closeSheet("month-sheet");
        closeSheet("fix-panel");
        closeSheet("add-menu");
        closeMapPick();
      }
    });
    bindAddPick();
    bindEditDelete();
    bindFixUi();
    bindPasteSearch();
    bindHotelDateSheet();
    if ($("changelog-open")) $("changelog-open").addEventListener("click", openChangelog);
    if ($("announce-ok")) $("announce-ok").addEventListener("click", dismissAnnouncement);
    if ($("inapp-close")) $("inapp-close").addEventListener("click", function () {
      guideSnooze();
      closeInAppOverlay();
    });
    if ($("inapp-copy")) $("inapp-copy").addEventListener("click", function () {
      var C = window.InstallGuide ? InstallGuide.COPY : {};
      copyText(InstallGuide.shareableUrl(window.location), function (ok) {
        showToast(ok ? C.copied : C.copyFailed, null, 4000);
      });
    });
    if ($("ig-done")) $("ig-done").addEventListener("click", guideDone);
    if ($("toast-close")) $("toast-close").hidden = true;
    if ($("toast")) $("toast").addEventListener("click", onToastSurfaceClick);
    if ($("amap-install")) {
      $("amap-install").addEventListener("click", function (ev) {
        if (ev.target === $("amap-install")) closeAmapInstall();
      });
    }
    if ($("amap-install-go")) $("amap-install-go").addEventListener("click", onAmapInstallGo);
    if ($("amap-install-web")) $("amap-install-web").addEventListener("click", onAmapInstallWeb);
    document.addEventListener("click", function (ev) {
      var a = ev.target && ev.target.closest ? ev.target.closest("a.js-amap-open") : null;
      if (!a) return;
      var href = a.getAttribute("data-amap-web");
      if (!href) return;
      ev.preventDefault();
      openAmapFromUi(href);
    });
    if ($("ig-later")) $("ig-later").addEventListener("click", guideLater);
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
        places = stored.places || [];
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
      dayPickedByUser = false;
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
      openAiWizard(true);
    }
    if (demo === "settings" || demo === "more") openSheet("settings-sheet");
    if (demo === "help" || demo === "help-bottom") openHelp();
    if (demo === "help-first") openHelp("first");
    if (demo === "install-ios") openInstall("ios-safari");
    if (demo === "ios-guide") openIosSheet(false);
    if (demo === "wechat-overlay") openInAppOverlay("wechat");
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
