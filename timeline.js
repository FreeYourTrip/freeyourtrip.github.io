/**
 * 示例行程时间线：按当地日期排列航班/酒店/地点，
 * 相邻有坐标的条目之间自动插入可点击的交通连接条。
 */
(function () {
  "use strict";

  var LEG_STORAGE_KEY = "wishlist-map-legs-v1";
  var trips = [];
  var activeTripId = null;
  var openLegKey = null;
  var tripMap = null;
  var tripMarkers = [];

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** 确认号默认遮罩，如 ABC123 → AB****23。短于等于 4 个字符时全部用星号。 */
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

  function formatCivilDateZh(isoDate) {
    var p = parseCivilDate(isoDate);
    if (!p) return isoDate || "";
    return p.y + "年" + p.m + "月" + p.d + "日";
  }

  function formatFlightLocal(item) {
    var offset = formatDayOffset(civilDayOffset(item.departDate, item.arriveDate));
    var no = item.flightNo ? item.flightNo + " " : "";
    return (
      no +
      item.departTime +
      " " +
      item.fromAirport +
      " → " +
      item.arriveTime +
      offset +
      " " +
      item.toAirport
    );
  }

  function itemDate(item, role) {
    if (item.type === "flight") {
      return role === "arrive" ? item.arriveDate : item.departDate;
    }
    if (item.type === "hotel") return item.checkIn;
    return item.date || "";
  }

  function hasCoords(item) {
    return item && typeof item.lat === "number" && typeof item.lng === "number";
  }

  function endpointForLeg(item, end) {
    /* end: "origin" if this item is the start of a ground leg (after a flight: use arrival airport) */
    return {
      id: item.id,
      name: item.nameZh,
      lat: item.lat,
      lng: item.lng
    };
  }

  function legKey(tripId, originId, destId) {
    return tripId + ":" + originId + ":" + destId;
  }

  function loadLegOverrides() {
    try {
      var raw = localStorage.getItem(LEG_STORAGE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function saveLegOverrides(all) {
    try {
      localStorage.setItem(LEG_STORAGE_KEY, JSON.stringify(all));
    } catch (err) {
      /* ignore */
    }
  }

  function getLegState(trip, originId, destId) {
    var key = legKey(trip.id, originId, destId);
    var overrides = loadLegOverrides();
    if (overrides[key]) {
      return {
        origin: originId,
        destination: destId,
        mode: overrides[key].mode || "公共交通",
        note: overrides[key].note || ""
      };
    }
    var preset = (trip.legs || []).filter(function (l) {
      return l.origin === originId && l.destination === destId;
    })[0];
    return {
      origin: originId,
      destination: destId,
      mode: (preset && preset.mode) || "公共交通",
      note: (preset && preset.note) || ""
    };
  }

  function setLegState(tripId, originId, destId, mode, note) {
    var all = loadLegOverrides();
    all[legKey(tripId, originId, destId)] = {
      origin: originId,
      destination: destId,
      mode: mode,
      note: note
    };
    saveLegOverrides(all);
  }

  function itemSortKey(item) {
    /* 航班按到达当地时间排序，以便落地后再接酒店/地点；
       酒店未写入住时刻时按 15:00 计，避免被当成当天 00:00 而排到入境航班前面。 */
    if (item.type === "flight") {
      return (item.arriveDate || item.departDate || "") + "T" + (item.arriveTime || item.departTime || "00:00");
    }
    if (item.type === "hotel") return (item.checkIn || "") + "T" + (item.checkInTime || "15:00");
    if (item.date) return item.date + "T" + (item.time || "12:00");
    return "9999-99-99T99:99";
  }

  function sortedItems(items) {
    return (items || []).slice().sort(function (a, b) {
      var ka = itemSortKey(a);
      var kb = itemSortKey(b);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      return 0;
    });
  }

  function buildSequence(trip) {
    var seq = [];
    var items = sortedItems(trip.items || []);
    var i;
    for (i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.type === "flight") {
        seq.push({ kind: "flight", date: item.departDate, time: item.departTime || "", item: item });
        if (item.arriveDate && item.arriveDate !== item.departDate) {
          seq.push({ kind: "flight-arrive", date: item.arriveDate, time: item.arriveTime || "", item: item });
        }
      } else if (item.type === "hotel") {
        seq.push({ kind: "hotel", date: item.checkIn, time: item.checkInTime || "", item: item });
      } else {
        seq.push({ kind: item.type || "place", date: item.date || "", time: item.time || "", item: item });
      }
      var next = items[i + 1];
      if (next && hasCoords(item) && hasCoords(next)) {
        var afterDate = item.type === "flight" ? item.arriveDate : itemDate(item);
        var afterTime = item.type === "flight" ? item.arriveTime : item.time || "";
        seq.push({
          kind: "leg",
          date: afterDate,
          time: afterTime,
          from: item,
          to: next,
          tripId: trip.id
        });
      }
    }
    return seq;
  }

  function groupByDate(seq) {
    var groups = [];
    var map = {};
    seq.forEach(function (row) {
      var key = row.date || "未标明日期";
      if (!map[key]) {
        map[key] = { date: key, rows: [] };
        groups.push(map[key]);
      }
      map[key].rows.push(row);
    });
    groups.sort(function (a, b) {
      if (a.date === "未标明日期") return 1;
      if (b.date === "未标明日期") return -1;
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      return 0;
    });
    return groups;
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
  function flightCardHtml(item, compactArrive) {
    var code = formatFlightLocal(item);
    var extra = [];
    if (item.confirmationNo) extra.push("确认号 " + secretToggleHtml(item.confirmationNo));
    if (item.seat) extra.push("座位 " + escapeHtml(item.seat));
    if (compactArrive) {
      return (
        '<article class="tl-card tl-flight">' +
        '<div class="tl-kind">航班到达（目的地当地）</div>' +
        "<h3>" +
        escapeHtml(item.nameZh) +
        ' <span class="en">' +
        escapeHtml(item.nameEn || "") +
        "</span></h3>" +
        '<p class="flight-code">' +
        escapeHtml(code) +
        "</p>" +
        "<p>到达 " +
        escapeHtml(formatCivilDateZh(item.arriveDate)) +
        " " +
        escapeHtml(item.arriveTime) +
        " " +
        escapeHtml(item.toAirport) +
        "</p>" +
        "</article>"
      );
    }
    return (
      '<article class="tl-card tl-flight">' +
      '<div class="tl-kind">' + (item.example ? "航班 · 示例" : "航班") + "</div>" +
      "<h3>" +
      escapeHtml(item.flightNo || "航班") +
      "　" +
      escapeHtml(item.fromNameZh || item.fromAirport) +
      " → " +
      escapeHtml(item.nameZh) +
      "</h3>" +
      '<p class="flight-code">' +
      escapeHtml(code) +
      "</p>" +
      "<dl class=\"tl-dl\">" +
      "<div><dt>出发（出发地当地）</dt><dd>" +
      escapeHtml(formatCivilDateZh(item.departDate)) +
      " " +
      escapeHtml(item.departTime) +
      " " +
      escapeHtml(item.fromAirport) +
      "</dd></div>" +
      "<div><dt>到达（目的地当地）</dt><dd>" +
      escapeHtml(formatCivilDateZh(item.arriveDate)) +
      " " +
      escapeHtml(item.arriveTime) +
      " " +
      escapeHtml(item.toAirport) +
      "</dd></div>" +
      (extra.length ? "<div><dt>其他</dt><dd>" + extra.join(" · ") + "</dd></div>" : "") +
      "</dl></article>"
    );
  }

  function hotelCardHtml(item) {
    return (
      '<article class="tl-card tl-hotel">' +
      '<div class="tl-kind">' + (item.example ? "酒店 · 示例" : "酒店") + "</div>" +
      "<h3>" +
      escapeHtml(item.nameZh) +
      ' <span class="en">' +
      escapeHtml(item.nameEn || "") +
      "</span></h3>" +
      "<p>" +
      escapeHtml(item.address || "") +
      "</p>" +
      "<dl class=\"tl-dl\">" +
      "<div><dt>入住</dt><dd>" +
      escapeHtml(formatCivilDateZh(item.checkIn)) +
      (item.checkInTime ? " " + escapeHtml(item.checkInTime) : "") +
      "</dd></div>" +
      "<div><dt>退房</dt><dd>" +
      escapeHtml(formatCivilDateZh(item.checkOut)) +
      (item.checkOutTime ? " " + escapeHtml(item.checkOutTime) : "") +
      "</dd></div>" +
      (item.confirmationNo
        ? "<div><dt>确认号</dt><dd>" + secretToggleHtml(item.confirmationNo) + "</dd></div>"
        : "") +
      "</dl></article>"
    );
  }

  function placeCardHtml(item) {
    var kind = "地点" + (item.subtype ? "/" + item.subtype : "") + (item.example ? " · 示例" : "");
    var when = "";
    if (item.date) {
      when = escapeHtml(formatCivilDateZh(item.date)) + (item.time ? " " + escapeHtml(item.time) : "");
    }
    return (
      '<article class="tl-card tl-place">' +
      '<div class="tl-kind">' +
      escapeHtml(kind) +
      "</div>" +
      "<h3>" +
      escapeHtml(item.nameZh) +
      ' <span class="en">' +
      escapeHtml(item.nameEn && item.nameEn !== item.nameZh ? item.nameEn : "") +
      "</span></h3>" +
      (item.address ? "<p>" + escapeHtml(item.address) + "</p>" : "") +
      (when ? "<p>" + when + "</p>" : "") +
      (item.note ? '<p class="note">' + escapeHtml(item.note) + "</p>" : "") +
      "</article>"
    );
  }

  function legHtml(trip, row) {
    var from = endpointForLeg(row.from, "origin");
    var to = endpointForLeg(row.to, "dest");
    var state = getLegState(trip, from.id, to.id);
    var key = legKey(trip.id, from.id, to.id);
    var open = openLegKey === key;
    var km = GeoUtil.haversineKm(from, to);
    var kmText = km >= 10 ? km.toFixed(0) : km.toFixed(1);
    var links = GeoUtil.buildNavLinks(from, to, state.mode);
    var recIsAmap = links.recommended === "amap";
    var modes = GeoUtil.MODES.map(function (m) {
      var checked = m.id === state.mode ? " checked" : "";
      return (
        '<label class="mode-opt"><input type="radio" name="mode-' +
        escapeHtml(key) +
        '" value="' +
        escapeHtml(m.id) +
        '"' +
        checked +
        "> " +
        escapeHtml(m.id) +
        "</label>"
      );
    }).join("");

    return (
      '<div class="tl-leg' +
      (open ? " is-open" : "") +
      '" data-leg-key="' +
      escapeHtml(key) +
      '" data-origin="' +
      escapeHtml(from.id) +
      '" data-dest="' +
      escapeHtml(to.id) +
      '">' +
      '<button type="button" class="leg-bar" aria-expanded="' +
      (open ? "true" : "false") +
      '">' +
      '<span class="leg-names">' +
      escapeHtml(from.name) +
      " —— " +
      escapeHtml(to.name) +
      "</span>" +
      '<span class="leg-meta">约 ' +
      escapeHtml(kmText) +
      " km 直线 · " +
      escapeHtml(state.mode) +
      "</span>" +
      "</button>" +
      '<div class="leg-panel"' +
      (open ? "" : " hidden") +
      ">" +
      '<p class="leg-hint">选择出行方式后，用下方链接打开导航应用。页面不计算路线。</p>' +
      '<div class="mode-row" role="radiogroup" aria-label="出行方式">' +
      modes +
      "</div>" +
      '<label class="leg-note-label">备注' +
      '<input type="text" class="leg-note" value="' +
      escapeHtml(state.note) +
      '" placeholder="例如：机场快线 30 分钟" maxlength="120">' +
      "</label>" +
      '<button type="button" class="leg-save">保存方式和备注</button>' +
      '<div class="nav-links">' +
      '<a class="nav-btn nav-google' +
      (recIsAmap ? "" : " is-recommended") +
      '" href="' +
      escapeHtml(links.google) +
      '" target="_blank" rel="noopener noreferrer">谷歌地图' +
      (recIsAmap ? "" : "（推荐）") +
      "</a>" +
      '<a class="nav-btn nav-amap' +
      (recIsAmap ? " is-recommended" : "") +
      '" href="' +
      escapeHtml(links.amap) +
      '" target="_blank" rel="noopener noreferrer">高德地图' +
      (recIsAmap ? "（推荐）" : "") +
      "</a>" +
      "</div>" +
      (recIsAmap
        ? '<p class="leg-limit">两端均在中国大陆，高德链接已将 WGS-84 转为 GCJ-02。高德在大陆使用 GCJ-02，境外或港澳台点未做转换。</p>'
        : '<p class="leg-limit">推荐使用谷歌地图。若仍打开高德：非中国大陆点保持 WGS-84，高德在大陆坐标系（GCJ-02）下可能有偏差。</p>') +
      "</div></div>"
    );
  }

  function renderTrip(trip) {
    var root = $("timeline");
    if (!trip || !(trip.items || []).length) {
      root.innerHTML = '<div class="empty-state"><strong>还没有行程</strong><p>在上方输入名称添加地点，或导入机票、酒店和地点。也可以先点「载入示例」看看效果。</p></div>';
      renderTripMap(trip || { items: [] });
      return;
    }
    var seq = buildSequence(trip);
    var groups = groupByDate(seq);
    var html = groups
      .map(function (g) {
        var rows = g.rows
          .map(function (row) {
            if (row.kind === "flight") return flightCardHtml(row.item, false);
            if (row.kind === "flight-arrive") return flightCardHtml(row.item, true);
            if (row.kind === "hotel") return hotelCardHtml(row.item);
            if (row.kind === "leg") return legHtml(trip, row);
            return placeCardHtml(row.item);
          })
          .join("");
        return (
          '<section class="tl-day">' +
          "<h2>" +
          escapeHtml(g.date === "未标明日期" ? g.date : formatCivilDateZh(g.date)) +
          "</h2>" +
          rows +
          "</section>"
        );
      })
      .join("");
    root.innerHTML = html;
    bindLegEvents(trip);
    renderTripMap(trip);
    bindSecretToggles($("timeline"));
  }

  function updateLegPanelLinks(panel, from, to, mode) {
    var links = GeoUtil.buildNavLinks(from, to, mode);
    var g = panel.querySelector(".nav-google");
    var a = panel.querySelector(".nav-amap");
    /* 同步写入 href，供手机直接打开已安装的导航应用；不用异步后再 window.open */
    g.href = links.google;
    a.href = links.amap;
    var recIsAmap = links.recommended === "amap";
    g.classList.toggle("is-recommended", !recIsAmap);
    a.classList.toggle("is-recommended", recIsAmap);
    g.textContent = recIsAmap ? "谷歌地图" : "谷歌地图（推荐）";
    a.textContent = recIsAmap ? "高德地图（推荐）" : "高德地图";
  }

  function bindLegEvents(trip) {
    Array.prototype.forEach.call(document.querySelectorAll(".tl-leg"), function (wrap) {
      var bar = wrap.querySelector(".leg-bar");
      var panel = wrap.querySelector(".leg-panel");
      var originId = wrap.getAttribute("data-origin");
      var destId = wrap.getAttribute("data-dest");
      var fromItem = trip.items.filter(function (it) {
        return it.id === originId;
      })[0];
      var toItem = trip.items.filter(function (it) {
        return it.id === destId;
      })[0];
      var from = endpointForLeg(fromItem, "origin");
      var to = endpointForLeg(toItem, "dest");

      bar.addEventListener("click", function () {
        var key = wrap.getAttribute("data-leg-key");
        openLegKey = openLegKey === key ? null : key;
        renderTrip(trip);
      });

      Array.prototype.forEach.call(wrap.querySelectorAll('input[type="radio"]'), function (radio) {
        radio.addEventListener("change", function () {
          updateLegPanelLinks(panel, from, to, radio.value);
          var meta = wrap.querySelector(".leg-meta");
          if (meta) {
            var km = GeoUtil.haversineKm(from, to);
            var kmText = km >= 10 ? km.toFixed(0) : km.toFixed(1);
            meta.textContent = "约 " + kmText + " km 直线 · " + radio.value;
          }
        });
      });

      var saveBtn = wrap.querySelector(".leg-save");
      if (saveBtn) {
        saveBtn.addEventListener("click", function () {
          var selected = wrap.querySelector('input[type="radio"]:checked');
          var noteEl = wrap.querySelector(".leg-note");
          var mode = selected ? selected.value : "公共交通";
          var note = noteEl ? noteEl.value : "";
          setLegState(trip.id, originId, destId, mode, note);
          saveBtn.textContent = "已保存";
          setTimeout(function () {
            saveBtn.textContent = "保存方式和备注";
          }, 1200);
        });
      }
    });
  }

  function renderTripMap(trip) {
    if (!tripMap) return;
    tripMarkers.forEach(function (m) {
      tripMap.removeLayer(m);
    });
    tripMarkers = [];
    var pts = [];
    var mapItems = sortedItems(trip.items || []);
    mapItems.forEach(function (item, idx) {
      if (!hasCoords(item)) return;
      pts.push([item.lat, item.lng]);
      var m = L.marker([item.lat, item.lng]).bindPopup(
        "<strong>" + escapeHtml(item.nameZh) + "</strong>"
      );
      m.addTo(tripMap);
      tripMarkers.push(m);
      if (idx > 0 && hasCoords(mapItems[idx - 1])) {
        var prev = mapItems[idx - 1];
        var line = L.polyline(
          [
            [prev.lat, prev.lng],
            [item.lat, item.lng]
          ],
          { color: "#9a4a2a", weight: 2, dashArray: "6 6" }
        );
        /* 直线示意，不是导航路线 */
        line.addTo(tripMap);
        tripMarkers.push(line);
      }
    });
    if (pts.length) {
      tripMap.fitBounds(pts, { padding: [32, 32], maxZoom: 12 });
    }
    setTimeout(function () {
      tripMap.invalidateSize();
    }, 80);
  }

  function initTripMap() {
    if (tripMap || typeof L === "undefined") return;
    tripMap = L.map("trip-map", { scrollWheelZoom: true, worldCopyJump: true }).setView([30, 20], 2);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(tripMap);
  }

  function currentTrip() {
    return (
      trips.filter(function (t) {
        return t.id === activeTripId;
      })[0] || trips[0]
    );
  }

  function renderTripTabs() {
    var nav = $("trip-tabs");
    nav.innerHTML = trips
      .map(function (t) {
        var on = t.id === activeTripId ? " is-active" : "";
        return (
          '<button type="button" class="trip-tab' +
          on +
          '" data-trip="' +
          escapeHtml(t.id) +
          '">' +
          escapeHtml(t.nameZh) +
          "</button>"
        );
      })
      .join("");
    Array.prototype.forEach.call(nav.querySelectorAll(".trip-tab"), function (btn) {
      btn.addEventListener("click", function () {
        activeTripId = btn.getAttribute("data-trip");
        openLegKey = null;
        renderTripTabs();
        renderTrip(currentTrip());
      });
    });
  }

  function showView(name) {
    var wPanel = $("view-wishlist-panel");
    var tPanel = $("view-timeline-panel");
    var wBtn = $("view-wishlist");
    var tBtn = $("view-timeline");
    var isTl = name === "timeline";
    wPanel.hidden = isTl;
    tPanel.hidden = !isTl;
    wBtn.classList.toggle("is-active", !isTl);
    tBtn.classList.toggle("is-active", isTl);
    wBtn.setAttribute("aria-selected", isTl ? "false" : "true");
    tBtn.setAttribute("aria-selected", isTl ? "true" : "false");
    if (isTl) {
      initTripMap();
      renderTrip(currentTrip());
    } else {
      document.dispatchEvent(new CustomEvent("wishlist-view-shown"));
    }
  }

  var TRIP_STORE = "wishlist-map-trips-v1";
  var examplesLoaded = false;
  var pendingImport = null;

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
    try {
      localStorage.setItem(
        TRIP_STORE,
        JSON.stringify({ trips: trips, activeTripId: activeTripId, examplesLoaded: examplesLoaded })
      );
    } catch (err) {}
  }

  function uniqueItemIds(existing, incoming) {
    var used = {};
    existing.forEach(function (it) {
      if (it.id) used[it.id] = true;
    });
    return incoming.map(function (it) {
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

  function emptyTrip() {
    return { id: "my-trip", nameZh: "我的行程", nameEn: "", items: [], legs: [], imported: true };
  }

  function updateExampleBanner() {
    var banner = $("example-banner");
    if (!banner) return;
    var hasExample = examplesLoaded || trips.some(function (t) { return t.example && (t.items || []).length; });
    banner.hidden = !hasExample;
  }

  function showImportMessage(result, extraOk) {
    var box = $("import-result");
    if (!box) return;
    var html = "";
    if (result.items && result.items.length) {
      var kind = result.format === "json" ? "（识别为 JSON）" : result.format === "mixed" ? "（识别为管道 + JSON）" : "（识别为管道格式）";
      html += '<p class="ok">已解析 ' + result.items.length + " 条" + kind + "。" + (extraOk || "") + "</p>";
    }
    (result.errors || []).forEach(function (e) {
      html += '<p class="err">' + escapeHtml(e) + "</p>";
    });
    if (!html) html = '<p class="err">没有可导入的内容。</p>';
    box.innerHTML = html;
  }

  function itemLabel(item) {
    if (item.type === "flight") return (item.flightNo || "航班") + " " + (item.fromAirport || "") + " → " + (item.toAirport || "");
    return item.nameZh || item.nameEn || item.id;
  }

  function renderPreview(resolutions) {
    var box = $("import-preview");
    if (!box) return;
    box.hidden = false;
    var rows = resolutions.map(function (res, idx) {
      var st = res.status || "ok";
      var warn = st === "ambiguous" || st === "none" || st === "error";
      var opts = (res.candidates || []).map(function (c, j) {
        var sel = res.chosen && c.lat === res.chosen.lat && c.lng === res.chosen.lng ? " selected" : "";
        return '<option value="' + j + '"' + sel + ">" + escapeHtml(c.displayName || (c.lat + ", " + c.lng)) + "</option>";
      }).join("");
      var pick = "";
      if ((res.candidates || []).length) {
        pick = '<label class="preview-pick">候选 <select data-preview-idx="' + idx + '">' + opts + "</select></label>";
      }
      var retry = '<div class="preview-retry"><input type="search" data-retry-q="' + idx + '" value="' + escapeHtml(res.query || "") + '" placeholder="换个关键词重试"><button type="button" data-retry="' + idx + '">重试查找</button></div>';
      var chosen = res.chosen ? '已定位：' + escapeHtml(res.chosen.displayName || (res.chosen.lat.toFixed(5) + ", " + res.chosen.lng.toFixed(5))) : "尚未定位";
      return (
        '<li class="preview-row' + (warn ? " is-warn" : "") + '" data-idx="' + idx + '">' +
        "<strong>" + escapeHtml(itemLabel(res.item)) + "</strong>" +
        '<span class="preview-type">' + escapeHtml(res.item.type === "flight" ? "机票" : res.item.type === "hotel" ? "酒店" : "地点") + "</span>" +
        '<p class="preview-geo">' + escapeHtml(chosen) + (res.message ? " · " + escapeHtml(res.message) : "") + "</p>" +
        pick + retry +
        "</li>"
      );
    }).join("");
    box.innerHTML =
      '<p class="preview-lead">请确认地点。黄色行表示没有结果或多个候选，可挑选或重试。即使没有坐标也会导入。</p>' +
      "<ul class=\"preview-list\">" + rows + "</ul>" +
      '<button type="button" class="import-confirm" id="import-confirm">确认导入</button>';

    Array.prototype.forEach.call(box.querySelectorAll("select[data-preview-idx]"), function (sel) {
      sel.addEventListener("change", function () {
        var i = Number(sel.getAttribute("data-preview-idx"));
        var res = pendingImport.resolutions[i];
        var cand = res.candidates[Number(sel.value)];
        if (cand) {
          res.chosen = { lat: cand.lat, lng: cand.lng, displayName: cand.displayName, source: "nominatim" };
          res.status = "ok";
          res.message = "";
          if (typeof Geocode !== "undefined") Geocode.applyChoice(res.item, res.chosen, res.fromChosen);
          renderPreview(pendingImport.resolutions);
        }
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll("button[data-retry]"), function (btn) {
      btn.addEventListener("click", function () {
        var i = Number(btn.getAttribute("data-retry"));
        var qInput = box.querySelector('input[data-retry-q="' + i + '"]');
        var q = qInput ? qInput.value.trim() : "";
        if (!q || typeof Geocode === "undefined") return;
        btn.disabled = true;
        btn.textContent = "查找中…";
        Geocode.nominatimSearch(q).then(function (list) {
          var res = pendingImport.resolutions[i];
          res.query = q;
          res.candidates = list;
          if (list.length === 1) {
            res.chosen = { lat: list[0].lat, lng: list[0].lng, displayName: list[0].displayName, source: "nominatim" };
            res.status = "ok";
            res.message = "";
          } else if (list.length > 1) {
            res.chosen = { lat: list[0].lat, lng: list[0].lng, displayName: list[0].displayName, source: "nominatim" };
            res.status = "ambiguous";
            res.message = "找到 " + list.length + " 个候选，请确认地点";
          } else {
            res.chosen = null;
            res.status = "none";
            res.message = "没有找到「" + q + "」的坐标";
          }
          if (res.chosen && typeof Geocode !== "undefined") Geocode.applyChoice(res.item, res.chosen, res.fromChosen);
          renderPreview(pendingImport.resolutions);
        }).catch(function (err) {
          pendingImport.resolutions[i].status = "error";
          pendingImport.resolutions[i].message = err && err.message ? err.message : String(err);
          renderPreview(pendingImport.resolutions);
        });
      });
    });
    $("import-confirm").addEventListener("click", confirmImport);
  }

  function confirmImport() {
    if (!pendingImport || !pendingImport.result) return;
    var items = pendingImport.result.items.slice();
    (pendingImport.resolutions || []).forEach(function (res) {
      if (typeof Geocode !== "undefined") Geocode.applyChoice(res.item, res.chosen, res.fromChosen);
    });
    var append = $("import-append").checked && currentTrip();
    if (append) {
      var cur = currentTrip();
      cur.items = (cur.items || []).concat(uniqueItemIds(cur.items || [], items));
      showImportMessage(pendingImport.result, "已追加到「" + cur.nameZh + "」。");
    } else {
      var trip = ImportUtil.tripFromImport(pendingImport.result, "导入的行程");
      trip.items = items;
      trips.push(trip);
      activeTripId = trip.id;
      openLegKey = null;
      showImportMessage(pendingImport.result, "");
    }
    pendingImport = null;
    var prev = $("import-preview");
    if (prev) {
      prev.hidden = true;
      prev.innerHTML = "";
    }
    saveAllTrips();
    renderTripTabs();
    renderTrip(currentTrip());
  }

  function runImport() {
    if (typeof ImportUtil === "undefined") {
      $("import-result").innerHTML = '<p class="err">导入模块未能载入。</p>';
      return;
    }
    var text = $("import-text").value;
    var result = ImportUtil.parseImport(text);
    showImportMessage(result, result.items.length ? "正在查找坐标…" : "");
    if (!result.items.length) {
      var prev = $("import-preview");
      if (prev) {
        prev.hidden = true;
        prev.innerHTML = "";
      }
      return;
    }
    pendingImport = { result: result, resolutions: [] };
    var preview = $("import-preview");
    if (preview) {
      preview.hidden = false;
      preview.innerHTML = '<p class="preview-lead">正在查找坐标，请稍候…</p>';
    }
    var progress = function (res, idx, total) {
      if (preview) preview.innerHTML = '<p class="preview-lead">正在查找坐标… ' + (idx + 1) + " / " + total + "</p>";
    };
    var done = function (resolutions) {
      pendingImport.resolutions = resolutions;
      renderPreview(resolutions);
    };
    if (typeof Geocode === "undefined") {
      done(result.items.map(function (item) {
        return { item: item, status: item.lat != null ? "ok" : "none", query: "", candidates: [], chosen: item.lat != null ? { lat: item.lat, lng: item.lng, displayName: "", source: "stored" } : null, message: item.lat != null ? "" : "未加载地理编码模块" };
      }));
      return;
    }
    Geocode.resolveAll(result.items, progress).then(done).catch(function (err) {
      showImportMessage(result, "地理编码时出错，仍可导入已解析的条目。");
      done(result.items.map(function (item) {
        return { item: item, status: item.lat != null ? "ok" : "error", query: "", candidates: [], chosen: item.lat != null ? { lat: item.lat, lng: item.lng } : null, message: err && err.message ? err.message : "" };
      }));
    });
  }

  function renderAddResults(query, list) {
    var box = $("add-place-results");
    if (!box) return;
    if (!list || !list.length) {
      box.hidden = false;
      box.innerHTML = '<p class="err">没有找到「' + escapeHtml(query) + '」。可改关键词再试。</p>';
      return;
    }
    box.hidden = false;
    box.innerHTML =
      '<p>请选择一个地点：</p><ul>' +
      list.map(function (c, i) {
        return '<li><button type="button" class="candidate-btn" data-i="' + i + '">' + escapeHtml(c.displayName) + "</button></li>";
      }).join("") +
      "</ul>";
    Array.prototype.forEach.call(box.querySelectorAll(".candidate-btn"), function (btn) {
      btn.addEventListener("click", function () {
        var c = list[Number(btn.getAttribute("data-i"))];
        if (!c) return;
        var trip = currentTrip();
        if (!trip) return;
        var q = $("add-place-q").value.trim();
        var item = {
          id: "place-" + Date.now(),
          type: "place",
          nameZh: q || c.displayName.split(",")[0],
          nameEn: "",
          address: c.displayName,
          date: "",
          time: "",
          note: "",
          lat: c.lat,
          lng: c.lng
        };
        trip.items = (trip.items || []).concat([item]);
        saveAllTrips();
        box.hidden = true;
        box.innerHTML = "";
        $("add-place-q").value = "";
        renderTrip(trip);
      });
    });
  }

  function initAddPlace() {
    var form = $("add-place-form");
    if (!form) return;
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var q = $("add-place-q").value.trim();
      var box = $("add-place-results");
      if (!q) return;
      if (typeof Geocode === "undefined") {
        box.hidden = false;
        box.innerHTML = '<p class="err">地理编码模块未能载入。</p>';
        return;
      }
      box.hidden = false;
      box.innerHTML = "<p>正在查找…</p>";
      Geocode.nominatimSearch(q).then(function (list) {
        renderAddResults(q, list);
      }).catch(function (err) {
        box.hidden = false;
        box.innerHTML = '<p class="err">查找失败：' + escapeHtml(err && err.message ? err.message : String(err)) + "</p>";
      });
    });
  }

  function loadExamples() {
    if (typeof EXAMPLE_TRIPS !== "undefined") {
      var existing = {};
      trips.forEach(function (t) { existing[t.id] = true; });
      EXAMPLE_TRIPS.forEach(function (t) {
        var copy = JSON.parse(JSON.stringify(t));
        copy.example = true;
        if (existing[copy.id]) copy.id = copy.id + "-example";
        trips.push(copy);
      });
      var first = EXAMPLE_TRIPS[0];
      if (first) activeTripId = existing[first.id] ? first.id + "-example" : first.id;
    }
    examplesLoaded = true;
    updateExampleBanner();
    saveAllTrips();
    renderTripTabs();
    renderTrip(currentTrip());
    if (window.WishlistApp && typeof window.WishlistApp.loadExamples === "function") {
      window.WishlistApp.loadExamples();
    }
  }

  function initImportUi() {
    var toggle = $("import-toggle");
    var panel = $("import-panel");
    if (toggle && panel) {
      toggle.addEventListener("click", function () {
        var open = panel.hidden;
        panel.hidden = !open;
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) $("import-text").focus();
      });
    }
    if ($("import-run")) $("import-run").addEventListener("click", runImport);
    if ($("load-examples")) $("load-examples").addEventListener("click", loadExamples);
    initAddPlace();
  }

  function exportState() {
    return {
      trips: trips,
      activeTripId: activeTripId,
      examplesLoaded: examplesLoaded,
      legs: (function () {
        try { return JSON.parse(localStorage.getItem("wishlist-map-legs-v1") || "{}"); } catch (e) { return {}; }
      })()
    };
  }

  function importState(state, mode) {
    var incoming = (state && Array.isArray(state.trips)) ? state.trips : [];
    var incomingLegs = (state && state.legs && typeof state.legs === "object") ? state.legs : {};
    if (mode === "replace") {
      trips = incoming.length ? incoming : [emptyTrip()];
      activeTripId = state.activeTripId && trips.some(function (t) { return t.id === state.activeTripId; }) ? state.activeTripId : trips[0].id;
      examplesLoaded = !!state.examplesLoaded;
      try { localStorage.setItem("wishlist-map-legs-v1", JSON.stringify(incomingLegs)); } catch (e) {}
    } else {
      var byId = {};
      trips.forEach(function (t) { byId[t.id] = t; });
      incoming.forEach(function (t) {
        if (byId[t.id]) {
          var merged = Object.assign({}, byId[t.id], t);
          merged.items = uniqueItemIds([], (byId[t.id].items || []).concat(t.items || []));
          /* 若 id 冲突导致重复内容，仍以合并后的 trip 为准；简化：同 id 用传入覆盖 items 并去重名称+日期？保留两者 */
          trips = trips.map(function (x) { return x.id === t.id ? Object.assign({}, x, t, { items: (x.items || []).concat(uniqueItemIds(x.items || [], t.items || [])) }) : x; });
        } else {
          trips.push(t);
        }
      });
      if (state.activeTripId) activeTripId = state.activeTripId;
      examplesLoaded = examplesLoaded || !!state.examplesLoaded;
      try {
        var legs = JSON.parse(localStorage.getItem("wishlist-map-legs-v1") || "{}");
        Object.keys(incomingLegs).forEach(function (k) { legs[k] = incomingLegs[k]; });
        localStorage.setItem("wishlist-map-legs-v1", JSON.stringify(legs));
      } catch (e) {}
    }
    if (!trips.length) {
      trips = [emptyTrip()];
      activeTripId = trips[0].id;
    }
    saveAllTrips();
    updateExampleBanner();
    renderTripTabs();
    if (!document.getElementById("view-timeline-panel").hidden) renderTrip(currentTrip());
  }

  window.TripApp = {
    exportState: exportState,
    importState: importState,
    getTrips: function () { return trips; },
    currentTrip: currentTrip
  };

  function init() {
    var stored = loadAllTrips();
    if (stored && stored.trips && stored.trips.length) {
      trips = stored.trips;
      examplesLoaded = !!stored.examplesLoaded;
      activeTripId = stored.activeTripId && trips.some(function (t) { return t.id === stored.activeTripId; }) ? stored.activeTripId : trips[0].id;
    } else {
      trips = [emptyTrip()];
      activeTripId = trips[0].id;
      examplesLoaded = false;
    }
    var params = new URLSearchParams(window.location.search);
    var wantTrip = params.get("trip");
    if (wantTrip && trips.some(function (t) { return t.id === wantTrip; })) activeTripId = wantTrip;
    updateExampleBanner();
    renderTripTabs();
    initImportUi();
    $("view-wishlist").addEventListener("click", function () { showView("wishlist"); });
    $("view-timeline").addEventListener("click", function () { showView("timeline"); });
    showView("timeline");
    if (params.get("import") === "1") {
      var panel = $("import-panel");
      if (panel) {
        panel.hidden = false;
        if ($("import-toggle")) $("import-toggle").setAttribute("aria-expanded", "true");
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
