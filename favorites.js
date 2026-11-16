/**
 * 收藏和足迹：收藏进地点库（不算行程，不进日程表）；足迹按类型、城市分组。
 */
(function (root) {
  "use strict";

  var LAYER_KEY = "wishlist-map-map-layers-v1";
  var TYPE_LABEL = { food: "饭店", hotel: "酒店", sight: "景点", street: "街道", place: "地点" };

  function todayIso() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function places() {
    var app = root.TripApp;
    if (app && app.getPlaces) return app.getPlaces() || [];
    return [];
  }

  function savePlaces() {
    if (root.TripApp && root.TripApp.savePlaces) root.TripApp.savePlaces();
  }

  function P() {
    return root.Places;
  }

  function wished(list) {
    return (list || places()).filter(function (p) { return p && p.wish; });
  }

  function visited(list) {
    return (list || places()).filter(function (p) { return P() && P().visitCount(p) > 0; });
  }

  function applyWishes(wishes, opts) {
    opts = opts || {};
    var list = places();
    var added = 0;
    var Pl = P();
    if (!Pl) return { added: 0 };
    (wishes || []).forEach(function (w) {
      if (!w || !(w.nameZh || w.name)) return;
      var item = {
        type: "place",
        nameZh: w.nameZh || w.name,
        nameEn: w.nameEn || "",
        address: w.address || "",
        subtype: w.subtype || "",
        note: w.note || "",
        city: w.city || "",
        lat: w.lat,
        lng: w.lng
      };
      var r = Pl.linkItem(item, list, { today: opts.today || todayIso(), onAsk: "new" });
      var place = r.place;
      if (!place) return;
      if (w.tags) Pl.setTags(place, w.tags);
      if (w.note && !place.note) place.note = w.note;
      Pl.setWish(place, opts.today || todayIso());
      added += 1;
    });
    if (added) savePlaces();
    return { added: added };
  }

  function toggleWish(placeId, on) {
    var Pl = P();
    var p = Pl && Pl.byId(places(), placeId);
    if (!p) return null;
    if (on === false || (on == null && p.wish)) Pl.clearWish(p);
    else Pl.setWish(p, todayIso());
    savePlaces();
    return p;
  }

  function readLayers() {
    try {
      var raw = JSON.parse(localStorage.getItem(LAYER_KEY) || "null");
      return {
        trip: raw && raw.trip === false ? false : true,
        wish: !!(raw && raw.wish),
        visited: !!(raw && raw.visited)
      };
    } catch (err) {
      return { trip: true, wish: false, visited: false };
    }
  }

  function writeLayers(l) {
    try { localStorage.setItem(LAYER_KEY, JSON.stringify(l)); } catch (err) {}
    return l;
  }

  function groupVisited(list) {
    var groups = {};
    visited(list).forEach(function (p) {
      var typ = TYPE_LABEL[p.type] || "地点";
      var city = p.city || "未标明城市";
      var key = typ + " · " + city;
      if (!groups[key]) groups[key] = { key: key, type: typ, city: city, items: [] };
      groups[key].items.push(p);
    });
    return Object.keys(groups).sort().map(function (k) { return groups[k]; });
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function firstLine(s) {
    return String(s || "").split(/\r?\n/)[0];
  }

  function renderFavList(host, filter) {
    filter = filter || { family: "", tag: "全部" };
    var list = wished().filter(function (p) {
      if (filter.family === "饭店" && p.type !== "food") return false;
      if (filter.family === "酒店" && p.type !== "hotel") return false;
      if (filter.tag && filter.tag !== "全部" && (p.tags || []).indexOf(filter.tag) === -1) return false;
      return true;
    });
    if (!list.length) {
      host.innerHTML = "<p class=\"fav-empty\">还没有收藏。在地点详情里点☆，就可以收在这里。</p>";
      return;
    }
    host.innerHTML = list.map(function (p) {
      var tag = (p.tags || [])[0] || (TYPE_LABEL[p.type] || "");
      var note = firstLine(p.note);
      return '<article class="fav-row" data-place="' + esc(p.id) + '">' +
        "<div><p class=\"fav-name\">" + esc(p.name || "") +
        (tag ? '<span class="fav-tag">' + esc(tag) + "</span>" : "") + "</p>" +
        (note ? '<p class="fav-note">' + esc(note) + "</p>" : "") +
        "</div></article>";
    }).join("");
  }

  function renderVisitedList(host) {
    var groups = groupVisited();
    if (!groups.length) {
      host.innerHTML = "<p class=\"fav-empty\">还没有足迹。行程里去过的酒店和地点会出现在这里。</p>";
      return;
    }
    host.innerHTML = groups.map(function (g) {
      var rows = g.items.map(function (p) {
        var n = P().visitCount(p);
        var dates = (p.visits || []).filter(function (v) { return !v.cancelled; }).map(function (v) { return v.date; }).filter(Boolean);
        return '<article class="fav-row" data-place="' + esc(p.id) + '"><div><p class="fav-name">' +
          esc(p.name || "") + "</p><p class=\"fav-note\">去过 " + n + " 次" +
          (dates.length ? " · " + esc(dates.join("、")) : "") + "</p></div></article>";
      }).join("");
      return '<section class="fav-group"><h3 class="fav-group-title">' + esc(g.key) + "</h3>" + rows + "</section>";
    }).join("");
  }

  function ensureSheet(id, title) {
    var el = document.getElementById(id);
    if (el) return el;
    el = document.createElement("div");
    el.id = id;
    el.className = "sheet";
    el.hidden = true;
    el.innerHTML =
      '<div class="sheet-backdrop" data-close="' + id + '"></div>' +
      '<div class="sheet-panel" role="dialog" aria-labelledby="' + id + '-title">' +
      '<div class="sheet-handle" aria-hidden="true"></div>' +
      '<div class="sheet-head"><h2 id="' + id + '-title">' + title + "</h2>" +
      '<button type="button" class="icon-btn sheet-close" data-close="' + id + '" aria-label="关闭"></button></div>' +
      '<div class="sheet-body" id="' + id + '-body"></div></div>';
    document.body.appendChild(el);
    return el;
  }

  function openSheet(id) {
    if (root.TripApp && root.TripApp.openSheet) root.TripApp.openSheet(id);
    else {
      var el = document.getElementById(id);
      if (el) el.hidden = false;
    }
  }

  function openFavorites() {
    var sheet = ensureSheet("fav-sheet", "收藏");
    var body = document.getElementById("fav-sheet-body");
    body.innerHTML =
      '<div class="fav-filters" id="fav-filters">' +
      '<button type="button" class="fav-chip is-on" data-fam="">全部</button>' +
      '<button type="button" class="fav-chip" data-fam="饭店">饭店</button>' +
      '<button type="button" class="fav-chip" data-fam="酒店">酒店</button>' +
      "</div>" +
      '<div class="fav-subtags" id="fav-subtags" hidden></div>' +
      '<div id="fav-list"></div>';
    var state = { family: "", tag: "全部" };
    var subFor = { "饭店": ["全部", "堂食", "外卖"], "酒店": ["全部", "酒店", "民宿"] };
    function paint() {
      renderFavList(document.getElementById("fav-list"), state);
    }
    body.querySelector("#fav-filters").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-fam]");
      if (!b) return;
      state.family = b.getAttribute("data-fam") || "";
      state.tag = "全部";
      Array.prototype.forEach.call(body.querySelectorAll("#fav-filters .fav-chip"), function (x) {
        x.classList.toggle("is-on", x === b);
      });
      var sub = document.getElementById("fav-subtags");
      var tags = subFor[state.family];
      if (!tags) { sub.hidden = true; sub.innerHTML = ""; }
      else {
        sub.hidden = false;
        sub.innerHTML = tags.map(function (t, i) {
          return '<button type="button" class="fav-chip' + (i === 0 ? " is-on" : "") + '" data-tag="' + t + '">' + t + "</button>";
        }).join("");
      }
      paint();
    });
    body.querySelector("#fav-subtags").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-tag]");
      if (!b) return;
      state.tag = b.getAttribute("data-tag") || "全部";
      Array.prototype.forEach.call(body.querySelectorAll("#fav-subtags .fav-chip"), function (x) {
        x.classList.toggle("is-on", x === b);
      });
      paint();
    });
    paint();
    openSheet("fav-sheet");
  }

  function openVisited() {
    var sheet = ensureSheet("visited-sheet", "足迹");
    renderVisitedList(document.getElementById("visited-sheet-body"));
    openSheet("visited-sheet");
  }

  function openCollect(placeOrItem, onDone) {
    var sheet = ensureSheet("collect-sheet", "收藏到这里");
    var body = document.getElementById("collect-sheet-body");
    var isHotel = !!(placeOrItem && (placeOrItem.type === "hotel" || placeOrItem.type === "酒店"));
    var tags = isHotel ? ["酒店", "民宿"] : ["堂食", "外卖"];
    var picked = (placeOrItem.tags || []).slice();
    var note = placeOrItem.note || "";
    body.innerHTML =
      '<div class="collect-panel">' +
      '<div class="collect-tags">' + tags.map(function (t) {
        return '<button type="button" class="collect-tag' + (picked.indexOf(t) !== -1 ? " is-on" : "") + '" data-tag="' + t + '">' + t + "</button>";
      }).join("") + "</div>" +
      '<textarea id="collect-note" rows="2" placeholder="写点什么，比如：招牌菜、要提前订">' + (note ? String(note).replace(/</g, "&lt;") : "") + "</textarea>" +
      '<button type="button" class="primary-btn" id="collect-go">收藏</button>' +
      "</div>";
    body.querySelector(".collect-tags").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-tag]");
      if (!b) return;
      var t = b.getAttribute("data-tag");
      var i = picked.indexOf(t);
      if (i === -1) picked.push(t);
      else picked.splice(i, 1);
      b.classList.toggle("is-on");
    });
    document.getElementById("collect-go").addEventListener("click", function () {
      var noteEl = document.getElementById("collect-note");
      if (onDone) onDone({ tags: picked, note: noteEl ? noteEl.value : "" });
      if (root.TripApp && root.TripApp.closeSheet) root.TripApp.closeSheet("collect-sheet");
      else sheet.hidden = true;
    });
    openSheet("collect-sheet");
  }

  function recordVisitsForTrip(trip) {
    var Pl = P();
    if (!Pl || !trip) return 0;
    var list = places();
    var n = 0;
    (trip.items || []).forEach(function (it) {
      if (!it || !it.placeId) return;
      var place = Pl.byId(list, it.placeId);
      var visit = Pl.visitFromItem(it, trip.id);
      if (place && visit && visit.date) {
        Pl.addVisit(place, visit);
        n += 1;
      }
    });
    if (n) savePlaces();
    return n;
  }

  /* 足迹页还没入口时保持 false，删行程/条目的「同时删掉足迹」勾选框不会出现。 */
  var PAGE_SHIPPED = false;

  var api = {
    LAYER_KEY: LAYER_KEY,
    pageShipped: PAGE_SHIPPED,
    wished: wished,
    visited: visited,
    applyWishes: applyWishes,
    toggleWish: toggleWish,
    readLayers: readLayers,
    writeLayers: writeLayers,
    groupVisited: groupVisited,
    openFavorites: openFavorites,
    openVisited: openVisited,
    openCollect: openCollect,
    recordVisitsForTrip: recordVisitsForTrip
  };
  root.Favorites = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
