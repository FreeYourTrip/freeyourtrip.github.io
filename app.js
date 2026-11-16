/**
 * 旅行心愿地图 — 交互逻辑
 * 直接用 script 标签加载，不依赖构建工具或 ES module（方便 file:// 打开）。
 */
(function () {
  "use strict";

  var STORAGE_KEY = "wishlist-map-status-v1";
  var MONTH_LABELS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
  var STATUS_OPTIONS = ["想去", "计划中", "去过"];
  var BUDGET_LABEL = { 1: "£", 2: "££", 3: "£££" };
  var BUDGET_TEXT = { 1: "较省", 2: "中等", 3: "较贵" };
  var STATUS_SLUG = { "想去": "want", "计划中": "plan", "去过": "been" };
  var LONDON = { lat: 51.5074, lng: -0.1278 };

  var places = [];
  var markers = {};
  var markerLayer = null;
  var londonMarker = null;
  var map = null;
  var activeId = null;
  var suppressFit = false;

  /* ---------- 航班当地墙钟时间（不经过浏览器时区） ---------- */

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

  /** 两个当地日历日之间的整日差。用 UTC 正午做日期算术，不是把航班时刻换到浏览器时区。 */
  function civilDayOffset(fromDate, toDate) {
    var a = parseCivilDate(fromDate);
    var b = parseCivilDate(toDate);
    if (!a || !b) return 0;
    var msA = Date.UTC(a.y, a.m - 1, a.d);
    var msB = Date.UTC(b.y, b.m - 1, b.d);
    return Math.round((msB - msA) / 86400000);
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

  /**
   * 展示为机场当地时间，例如：10:00 LHR → 06:30+1 HND
   * 时刻原样使用数据里的墙钟字符串，不做时区转换。
   */
  function formatFlightLocal(flight) {
    if (!flight) return "";
    var offset = formatDayOffset(civilDayOffset(flight.departDate, flight.arriveDate));
    return (
      flight.departTime +
      " " +
      flight.fromAirport +
      " → " +
      flight.arriveTime +
      offset +
      " " +
      flight.toAirport
    );
  }

  /* ---------- 数据与本地存储 ---------- */

  function loadStatusOverrides() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function saveStatusOverrides() {
    var mapStatus = {};
    places.forEach(function (p) {
      mapStatus[p.id] = p.status;
    });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mapStatus));
    } catch (err) {
      /* 私密模式或禁用存储时忽略 */
    }
  }

  function clonePlaces() {
    var overrides = loadStatusOverrides();
    return DESTINATIONS.map(function (src) {
      var copy = Object.assign({}, src);
      if (src.flightFromLondon) {
        copy.flightFromLondon = Object.assign({}, src.flightFromLondon);
      }
      copy.tags = src.tags.slice();
      copy.bestMonths = src.bestMonths.slice();
      if (overrides[copy.id] && STATUS_OPTIONS.indexOf(overrides[copy.id]) !== -1) {
        copy.status = overrides[copy.id];
      }
      return copy;
    });
  }

  /* ---------- 工具 ---------- */

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatHours(h) {
    if (h === Math.floor(h)) return h + " 小时";
    return String(h).replace(".", ".") + " 小时";
  }

  function formatMonths(months) {
    return months
      .slice()
      .sort(function (a, b) {
        return a - b;
      })
      .map(function (m) {
        return MONTH_LABELS[m - 1];
      })
      .join("、");
  }

  function uniqueSorted(values) {
    var seen = {};
    var out = [];
    values.forEach(function (v) {
      if (v && !seen[v]) {
        seen[v] = true;
        out.push(v);
      }
    });
    out.sort(function (a, b) {
      return String(a).localeCompare(String(b), "zh-Hans");
    });
    return out;
  }

  /* ---------- 筛选与排序 ---------- */

  function currentFilters() {
    return {
      q: $("filter-q").value.trim().toLowerCase(),
      continent: $("filter-continent").value,
      tag: $("filter-tag").value,
      status: $("filter-status").value,
      month: $("filter-month").value ? Number($("filter-month").value) : "",
      budget: $("filter-budget").value ? Number($("filter-budget").value) : "",
      sort: $("sort-by").value
    };
  }

  function matches(place, f) {
    if (f.continent && place.continent !== f.continent) return false;
    if (f.tag && place.tags.indexOf(f.tag) === -1) return false;
    if (f.status && place.status !== f.status) return false;
    if (f.month && place.bestMonths.indexOf(f.month) === -1) return false;
    if (f.budget && place.budget !== f.budget) return false;
    if (f.q) {
      var hay = [
        place.nameZh,
        place.nameEn,
        place.countryZh,
        place.countryEn,
        place.continent,
        place.note,
        place.status,
        place.tags.join(" ")
      ]
        .join(" ")
        .toLowerCase();
      if (hay.indexOf(f.q) === -1) return false;
    }
    return true;
  }

  function sortPlaces(list, sortKey) {
    var copy = list.slice();
    copy.sort(function (a, b) {
      if (sortKey === "name") {
        return a.nameZh.localeCompare(b.nameZh, "zh-Hans");
      }
      if (sortKey === "budget-asc") {
        return a.budget - b.budget || a.nameZh.localeCompare(b.nameZh, "zh-Hans");
      }
      if (sortKey === "budget-desc") {
        return b.budget - a.budget || a.nameZh.localeCompare(b.nameZh, "zh-Hans");
      }
      if (sortKey === "flight") {
        return a.flightHoursFromLondon - b.flightHoursFromLondon || a.nameZh.localeCompare(b.nameZh, "zh-Hans");
      }
      /* 默认：优先级高到低（1 最优先） */
      return a.priority - b.priority || a.nameZh.localeCompare(b.nameZh, "zh-Hans");
    });
    return copy;
  }

  function visiblePlaces() {
    var f = currentFilters();
    return sortPlaces(
      places.filter(function (p) {
        return matches(p, f);
      }),
      f.sort
    );
  }

  /* ---------- 卡片 ---------- */

  function flightBlockHtml(place) {
    var flight = place.flightFromLondon;
    if (!flight) return "";
    var code = formatFlightLocal(flight);
    var depDay = formatCivilDateZh(flight.departDate);
    var arrDay = formatCivilDateZh(flight.arriveDate);
    return (
      '<div class="flight-line">' +
      '<span class="flight-label">参考航班（机场当地时间，示例）</span>' +
      '<span class="flight-code">' +
      escapeHtml(code) +
      "</span>" +
      '<ul class="flight-days">' +
      "<li>出发日（出发地当地）：" +
      escapeHtml(depDay) +
      " " +
      escapeHtml(flight.departTime) +
      " " +
      escapeHtml(flight.fromAirport) +
      "</li>" +
      "<li>到达日（目的地当地）：" +
      escapeHtml(arrDay) +
      " " +
      escapeHtml(flight.arriveTime) +
      " " +
      escapeHtml(flight.toAirport) +
      "</li>" +
      "</ul></div>"
    );
  }

  function cardHtml(place) {
    var slug = STATUS_SLUG[place.status] || "want";
    var exampleBadge = place.example ? '<span class="badge badge-example">示例数据</span>' : "";
    var tags = place.tags
      .map(function (t) {
        return '<span class="tag">' + escapeHtml(t) + "</span>";
      })
      .join("");
    var options = STATUS_OPTIONS.map(function (s) {
      var sel = s === place.status ? " selected" : "";
      return "<option value=\"" + escapeHtml(s) + "\"" + sel + ">" + escapeHtml(s) + "</option>";
    }).join("");

    return (
      '<article class="card" tabindex="0" role="button" data-id="' +
      escapeHtml(place.id) +
      '" aria-pressed="false">' +
      '<div class="card-top">' +
      "<div>" +
      "<h2>" +
      escapeHtml(place.nameZh) +
      '<span class="en">' +
      escapeHtml(place.nameEn) +
      "</span></h2>" +
      '<p class="meta-place">' +
      escapeHtml(place.countryZh) +
      " · " +
      escapeHtml(place.countryEn) +
      " · " +
      escapeHtml(place.continent) +
      "</p>" +
      "</div>" +
      '<div class="badges">' +
      exampleBadge +
      '<span class="badge badge-status-' +
      slug +
      '">' +
      escapeHtml(place.status) +
      "</span>" +
      '<span class="badge badge-priority">优先 ' +
      place.priority +
      "</span>" +
      "</div></div>" +
      '<dl class="card-grid">' +
      "<div><dt>最佳季节</dt><dd>" +
      escapeHtml(formatMonths(place.bestMonths)) +
      "</dd></div>" +
      "<div><dt>预算</dt><dd>" +
      escapeHtml(BUDGET_LABEL[place.budget]) +
      " " +
      escapeHtml(BUDGET_TEXT[place.budget]) +
      "</dd></div>" +
      "<div><dt>建议行程</dt><dd>" +
      place.tripDays +
      " 天</dd></div>" +
      "<div><dt>大约航程</dt><dd>约 " +
      escapeHtml(formatHours(place.flightHoursFromLondon)) +
      "</dd></div>" +
      "</dl>" +
      '<div class="tags">' +
      tags +
      "</div>" +
      '<p class="note">' +
      escapeHtml(place.note) +
      "</p>" +
      flightBlockHtml(place) +
      '<div class="card-foot">' +
      "<label>状态 <select data-status-for=\"" +
      escapeHtml(place.id) +
      "\">" +
      options +
      "</select></label>" +
      "</div></article>"
    );
  }

  function renderCards(list) {
    var root = $("card-list");
    if (!list.length) {
      root.innerHTML =
        '<div class="empty-state"><strong>没有符合条件的地点</strong><p>试试清除筛选，或换一个月份、标签看看。</p></div>';
      $("result-count").textContent = "显示 0 / " + places.length + " 个地点";
      return;
    }
    root.innerHTML = list.map(cardHtml).join("");
    $("result-count").textContent = "显示 " + list.length + " / " + places.length + " 个地点";

    Array.prototype.forEach.call(root.querySelectorAll(".card"), function (el) {
      el.addEventListener("click", function () {
        selectPlace(el.getAttribute("data-id"), { fromCard: true });
      });
      el.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          selectPlace(el.getAttribute("data-id"), { fromCard: true });
        }
      });
    });

    Array.prototype.forEach.call(root.querySelectorAll("select[data-status-for]"), function (sel) {
      sel.addEventListener("click", function (ev) {
        ev.stopPropagation();
      });
      sel.addEventListener("change", function (ev) {
        ev.stopPropagation();
        var id = sel.getAttribute("data-status-for");
        var place = places.filter(function (p) {
          return p.id === id;
        })[0];
        if (!place) return;
        place.status = sel.value;
        saveStatusOverrides();
        refresh({ keepActive: true, skipFit: true });
      });
    });

    if (activeId) {
      var activeCard = root.querySelector('.card[data-id="' + activeId + '"]');
      if (activeCard) {
        activeCard.classList.add("is-active");
        activeCard.setAttribute("aria-pressed", "true");
      }
    }
  }

  /* ---------- 地图 ---------- */

  function pinIcon(place, isActive) {
    var slug = STATUS_SLUG[place.status] || "want";
    var cls = "pin-wrap" + (isActive ? " is-active" : "");
    var html =
      '<div class="' +
      cls +
      '"><div class="pin pin-' +
      slug +
      '"><span>' +
      escapeHtml(String(place.priority)) +
      "</span></div></div>";
    return L.divIcon({
      className: "custom-pin",
      html: html,
      iconSize: isActive ? [34, 34] : [28, 28],
      iconAnchor: isActive ? [17, 32] : [14, 26],
      popupAnchor: [0, -28]
    });
  }

  function popupHtml(place) {
    var flight = place.flightFromLondon ? formatFlightLocal(place.flightFromLondon) : "";
    return (
      "<strong>" +
      escapeHtml(place.nameZh) +
      "</strong>" +
      '<div class="popup-en">' +
      escapeHtml(place.nameEn) +
      " · " +
      escapeHtml(place.countryZh) +
      "</div>" +
      escapeHtml(place.status) +
      " · " +
      escapeHtml(BUDGET_LABEL[place.budget]) +
      " · 约 " +
      escapeHtml(formatHours(place.flightHoursFromLondon)) +
      (flight ? '<span class="flight-code">' + escapeHtml(flight) + "</span>" : "")
    );
  }

  function initMap() {
    map = L.map("map", {
      scrollWheelZoom: true,
      worldCopyJump: true
    }).setView([LONDON.lat, LONDON.lng], 2);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    londonMarker = L.circleMarker([LONDON.lat, LONDON.lng], {
      radius: 7,
      color: "#9a4a2a",
      weight: 2,
      fillColor: "#9a4a2a",
      fillOpacity: 0.9
    })
      .addTo(map)
      .bindPopup("<strong>伦敦</strong><div class=\"popup-en\">出发地</div>");

    markerLayer = L.layerGroup().addTo(map);
  }

  function renderMarkers(list) {
    markerLayer.clearLayers();
    markers = {};
    list.forEach(function (place) {
      var marker = L.marker([place.lat, place.lng], {
        icon: pinIcon(place, place.id === activeId),
        title: place.nameZh + " / " + place.nameEn
      });
      marker.bindPopup(popupHtml(place));
      marker.on("click", function () {
        selectPlace(place.id, { fromMap: true });
      });
      marker.addTo(markerLayer);
      markers[place.id] = marker;
    });
  }

  function fitToVisible(list) {
    if (suppressFit) return;
    var pts = list.map(function (p) {
      return [p.lat, p.lng];
    });
    pts.push([LONDON.lat, LONDON.lng]);
    if (!pts.length) return;
    var bounds = L.latLngBounds(pts);
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 5 });
  }

  /* ---------- 联动 ---------- */

  function selectPlace(id, opts) {
    opts = opts || {};
    var place = places.filter(function (p) {
      return p.id === id;
    })[0];
    if (!place) return;

    activeId = id;

    Array.prototype.forEach.call(document.querySelectorAll(".card"), function (el) {
      var on = el.getAttribute("data-id") === id;
      el.classList.toggle("is-active", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    });

    var card = document.querySelector('.card[data-id="' + id + '"]');
    if (card && opts.fromMap) {
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    Object.keys(markers).forEach(function (mid) {
      var p = places.filter(function (x) {
        return x.id === mid;
      })[0];
      if (p && markers[mid]) {
        markers[mid].setIcon(pinIcon(p, mid === id));
      }
    });

    var marker = markers[id];
    if (marker) {
      if (opts.fromCard) {
        map.setView([place.lat, place.lng], Math.max(map.getZoom(), 5), { animate: true });
      }
      marker.openPopup();
    }
  }

  function refresh(opts) {
    opts = opts || {};
    suppressFit = !!opts.skipFit;
    var list = visiblePlaces();
    if (opts.keepActive && activeId) {
      var still = list.some(function (p) {
        return p.id === activeId;
      });
      if (!still) activeId = null;
    }
    renderCards(list);
    renderMarkers(list);
    fitToVisible(list);
    if (activeId && markers[activeId] && opts.keepActive) {
      markers[activeId].setIcon(
        pinIcon(
          places.filter(function (p) {
            return p.id === activeId;
          })[0],
          true
        )
      );
    }
    suppressFit = false;
    setTimeout(function () {
      if (map) map.invalidateSize();
    }, 80);
  }

  /* ---------- 筛选控件 ---------- */

  function fillSelect(el, values, allLabel) {
    var current = el.value;
    el.innerHTML = "";
    var all = document.createElement("option");
    all.value = "";
    all.textContent = allLabel;
    el.appendChild(all);
    values.forEach(function (v) {
      var opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      el.appendChild(opt);
    });
    if (current) el.value = current;
  }

  function initFilters() {
    fillSelect($("filter-continent"), uniqueSorted(places.map(function (p) { return p.continent; })), "全部");
    fillSelect(
      $("filter-tag"),
      uniqueSorted(
        places.reduce(function (acc, p) {
          return acc.concat(p.tags);
        }, [])
      ),
      "全部"
    );
    fillSelect($("filter-status"), STATUS_OPTIONS, "全部");

    var monthSel = $("filter-month");
    MONTH_LABELS.forEach(function (label, i) {
      var opt = document.createElement("option");
      opt.value = String(i + 1);
      opt.textContent = label;
      monthSel.appendChild(opt);
    });

    ["filter-q", "filter-continent", "filter-tag", "filter-status", "filter-month", "filter-budget", "sort-by"].forEach(
      function (id) {
        var ev = id === "filter-q" ? "input" : "change";
        $(id).addEventListener(ev, function () {
          activeId = null;
          refresh();
        });
      }
    );

    $("reset-filters").addEventListener("click", function () {
      $("filter-q").value = "";
      $("filter-continent").value = "";
      $("filter-tag").value = "";
      $("filter-status").value = "";
      $("filter-month").value = "";
      $("filter-budget").value = "";
      $("sort-by").value = "priority";
      activeId = null;
      refresh();
    });
  }

  var examplesLoaded = false;
  var wishlistUiReady = false;

  function renderEmptyWishlist() {
    $("result-count").textContent = "心愿清单为空";
    $("card-list").innerHTML = '<div class="empty-state"><strong>还没有心愿地点</strong><p>这是次要视图。可在「行程」页点击「载入示例」载入演示数据。</p></div>';
    if (markerLayer) markerLayer.clearLayers();
  }

  function loadWishlistExamples() {
    if (typeof DESTINATIONS === "undefined" || !DESTINATIONS.length) {
      renderEmptyWishlist();
      return;
    }
    examplesLoaded = true;
    places = clonePlaces();
    if (!map) initMap();
    if (!wishlistUiReady) {
      initFilters();
      wishlistUiReady = true;
    }
    refresh();
    try { localStorage.setItem("wishlist-map-examples-loaded-v1", "1"); } catch (e) {}
  }

  /* ---------- 启动 ---------- */

  function init() {
    if (!$("map") || !$("card-list")) return;
    var flag = false;
    try { flag = localStorage.getItem("wishlist-map-examples-loaded-v1") === "1"; } catch (e) {}
    initMap();
    window.addEventListener("resize", function () {
      if (map) map.invalidateSize();
    });
    document.addEventListener("wishlist-view-shown", function () {
      setTimeout(function () {
        if (map) map.invalidateSize();
      }, 80);
    });
    if (flag) loadWishlistExamples();
    else renderEmptyWishlist();
  }

  window.WishlistApp = {
    loadExamples: loadWishlistExamples,
    exportState: function () {
      var statuses = {};
      places.forEach(function (p) { statuses[p.id] = p.status; });
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw) statuses = Object.assign(JSON.parse(raw) || {}, statuses);
      } catch (e) {}
      return { statuses: statuses, loaded: examplesLoaded };
    },
    importState: function (state, mode) {
      var incoming = (state && state.statuses) || {};
      if (mode === "replace") {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(incoming)); } catch (e) {}
      } else {
        var cur = {};
        try { cur = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {}; } catch (e) {}
        Object.keys(incoming).forEach(function (k) { cur[k] = incoming[k]; });
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cur)); } catch (e) {}
      }
      /* v6：页面上已没有心愿地图（#map），旧备份里 wishlistLoaded=true 时别去建地图，否则整个导入报错、地理缓存也没导进来 */
      if (state && state.loaded && $("map")) loadWishlistExamples();
      else if (places.length) refresh();
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
