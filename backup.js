/**
 * 导出 / 导入本地数据。
 * 「分享我的行程」会去掉确认号、座位及备注里的对应字样，且不含地理编码缓存。
 * 「完整备份」保留全部内容，仅供自己保存。
 *
 * 文件格式（v6 起 version: 2）：
 *   { app: "行程地图", version: 2, kind: "share"|"full", exportedAt, trips: [...], places: [...],
 *     activeTripId, examplesLoaded, legs, statuses, wishlistLoaded, geocodeCache?(只在完整备份) }
 *   分享：places 只带分享出去的行程用到的地点，去掉收藏和去过；条目和地点的备注都去掉确认号 / 座位字样。
 *   完整备份：整个地点库（含收藏、去过）。
 *   行程上的 theme 字段原样带上（第 4 批：行程颜色跟着分享走；背景图以后要勾了才带）。
 * 旧文件（version: 1，没有 places）照样能导入：条目导入后现连地点库。
 */
(function (root) {
  "use strict";

  var LEG_KEY = "wishlist-map-legs-v1";
  var STATUS_KEY = "wishlist-map-status-v1";
  var TRIP_KEY = "wishlist-map-trips-v1"; /* v5.3 及以前；v6 起只读，用来搬家 */
  var DATA_KEY = "wishlist-map-data-v2";
  var FORMAT_VERSION = 2;
  var GEO_KEY = "wishlist-map-geocode-v1";
  var FLAG_KEY = "wishlist-map-examples-loaded-v1";
  var APP_PREFIX = "wishlist-map";

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      return fallback;
    }
  }

  function todayStamp() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return "" + y + m + day;
  }

  /** 去掉备注中的「确认号 X」「座位 X」等字样。 */
  function stripSecretPatterns(text) {
    return String(text == null ? "" : text)
      .replace(/确认号\s*[:：]?\s*\S+/g, "")
      .replace(/座位\s*[:：]?\s*\S+/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function redactItem(item) {
    var copy = JSON.parse(JSON.stringify(item || {}));
    delete copy.confirmationNo;
    delete copy.confirmation;
    delete copy.seat;
    if (copy.note) copy.note = stripSecretPatterns(copy.note);
    if (copy.flightFromLondon) {
      delete copy.flightFromLondon.confirmationNo;
      delete copy.flightFromLondon.confirmation;
      delete copy.flightFromLondon.seat;
    }
    return copy;
  }

  function redactForShare(payload) {
    var out = JSON.parse(JSON.stringify(payload || {}));
    out.kind = "share";
    delete out.geocodeCache;
    var P = root.Places || (typeof require === "function" ? require("./places.js") : null);
    if (Array.isArray(out.places) && P) {
      out.places = P.forShare(out.places, out.trips || []).map(function (p) {
        if (p.note) p.note = stripSecretPatterns(p.note);
        return p;
      });
    }
    out.trips = (out.trips || []).map(function (trip) {
      var t = Object.assign({}, trip);
      t.items = (t.items || []).map(redactItem);
      if (Array.isArray(t.legs)) {
        t.legs = t.legs.map(function (leg) {
          var l = Object.assign({}, leg);
          if (l.note) l.note = stripSecretPatterns(l.note);
          return l;
        });
      }
      return t;
    });
    if (out.legs && typeof out.legs === "object" && !Array.isArray(out.legs)) {
      var legs = {};
      Object.keys(out.legs).forEach(function (k) {
        var leg = Object.assign({}, out.legs[k] || {});
        if (leg.note) leg.note = stripSecretPatterns(leg.note);
        legs[k] = leg;
      });
      out.legs = legs;
    }
    return out;
  }

  function collect(opts) {
    opts = opts || {};
    var live = root.TripApp && typeof root.TripApp.exportState === "function" ? root.TripApp.exportState() : null;
    var wish = root.WishlistApp && typeof root.WishlistApp.exportState === "function" ? root.WishlistApp.exportState() : null;
    var stored = live ? null : readJson(DATA_KEY, null) || readJson(TRIP_KEY, null);
    var payload = {
      app: "行程地图",
      version: FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      trips: live && live.trips ? live.trips : (function () {
        if (stored && Array.isArray(stored.trips)) return stored.trips;
        return Array.isArray(stored) ? stored : [];
      })(),
      places: live && live.places ? live.places : stored && Array.isArray(stored.places) ? stored.places : [],
      activeTripId: live && live.activeTripId ? live.activeTripId : "",
      examplesLoaded: live && typeof live.examplesLoaded === "boolean" ? live.examplesLoaded : readJson(FLAG_KEY, false),
      legs: live && live.legs ? live.legs : readJson(LEG_KEY, {}),
      statuses: wish && wish.statuses ? wish.statuses : readJson(STATUS_KEY, {}),
      wishlistLoaded: wish && wish.loaded ? true : false
    };
    if (opts.includeGeocodeCache) {
      payload.geocodeCache = root.Geocode && root.Geocode.getCache ? root.Geocode.getCache() : readJson(GEO_KEY, {});
    }
    return payload;
  }

  function triggerDownload(payload, filename) {
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    var a = document.createElement("a");
    var url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
    return payload;
  }

  /** 分享我的行程：隐藏订单号/座位，不含地理编码缓存。 */
  function downloadShare() {
    var payload = redactForShare(collect({ includeGeocodeCache: false }));
    return triggerDownload(payload, "freeyourtrip-share-" + todayStamp() + ".json");
  }

  /** 完整备份：含确认号、座位和地理编码缓存，仅自己保存。 */
  function downloadFullBackup() {
    var payload = collect({ includeGeocodeCache: true });
    payload.kind = "full";
    return triggerDownload(payload, "freeyourtrip-full-backup-" + todayStamp() + ".json");
  }

  function downloadBackup() {
    /* 兼容旧调用：默认走分享导出 */
    return downloadShare();
  }

  /**
   * opts.onConflict（v6）：{ 行程id: "overwrite" | "copy" }，合并时本机已有同一趟怎么办；没写 = 另存一份。
   */
  function applyBackup(payload, mode, opts) {
    if (!payload || payload.app !== "行程地图" || !payload.version) {
      if (!payload || !Array.isArray(payload.trips)) {
        throw new Error("这不是一份有效的 Free Your Trip 备份或分享文件。");
      }
    }
    mode = mode === "merge" ? "merge" : "replace";
    var incomingTrips = Array.isArray(payload.trips) ? payload.trips : [];
    var incomingLegs = payload.legs && typeof payload.legs === "object" ? payload.legs : {};
    var incomingStatuses = payload.statuses && typeof payload.statuses === "object" ? payload.statuses : {};

    if (root.TripApp && typeof root.TripApp.importState === "function") {
      root.TripApp.importState(
        {
          trips: incomingTrips,
          places: Array.isArray(payload.places) ? payload.places : [],
          activeTripId: payload.activeTripId || "",
          examplesLoaded: !!payload.examplesLoaded,
          legs: incomingLegs
        },
        mode,
        { onConflict: (opts && opts.onConflict) || {} }
      );
    }
    if (root.WishlistApp && typeof root.WishlistApp.importState === "function") {
      root.WishlistApp.importState({ statuses: incomingStatuses, loaded: !!payload.wishlistLoaded }, mode);
    } else if (mode === "replace") {
      localStorage.setItem(STATUS_KEY, JSON.stringify(incomingStatuses));
    } else {
      var cur = readJson(STATUS_KEY, {});
      Object.keys(incomingStatuses).forEach(function (k) {
        cur[k] = incomingStatuses[k];
      });
      localStorage.setItem(STATUS_KEY, JSON.stringify(cur));
    }
    if (payload.geocodeCache && typeof payload.geocodeCache === "object") {
      if (root.Geocode && root.Geocode.setCacheAll && root.Geocode.getCache) {
        if (mode === "replace") {
          root.Geocode.setCacheAll(payload.geocodeCache);
        } else {
          var cache = root.Geocode.getCache() || {};
          Object.keys(payload.geocodeCache).forEach(function (k) {
            cache[k] = payload.geocodeCache[k];
          });
          root.Geocode.setCacheAll(cache);
        }
      } else if (mode === "replace") {
        localStorage.setItem(GEO_KEY, JSON.stringify(payload.geocodeCache));
      }
    }
    return { mode: mode, tripCount: incomingTrips.length, kind: payload.kind || "" };
  }

  function clearAllLocalData() {
    var keys = [];
    var i;
    for (i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key && key.indexOf(APP_PREFIX) === 0) keys.push(key);
    }
    keys.forEach(function (k) {
      localStorage.removeItem(k);
    });
    return keys;
  }

  /* v6：清空本机数据的确认（文案定稿 19:43） */
  var CLEAR_LOCAL_COPY = { title: "手机上所有行程和地点都会删掉，删了找不回来", ok: "全部删掉", cancel: "取消" };

  function setupButtons() {
    var share = document.getElementById("backup-export-share") || document.getElementById("backup-export");
    var full = document.getElementById("backup-export-full");
    var imp = document.getElementById("backup-import");
    var file = document.getElementById("backup-file");
    var clearBtn = document.getElementById("backup-clear");
    if (share) {
      share.addEventListener("click", function () {
        downloadShare();
      });
    }
    if (full) {
      full.addEventListener("click", function () {
        var ok = window.confirm("完整备份包含机票/酒店确认号和座位，请仅自己保存，不要发给别人。确定导出吗？");
        if (!ok) return;
        downloadFullBackup();
      });
    }
    if (imp && file) {
      imp.addEventListener("click", function () {
        file.value = "";
        file.click();
      });
      file.addEventListener("change", function () {
        var f = file.files && file.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
          var data;
          try {
            data = JSON.parse(String(reader.result || ""));
          } catch (err) {
            alert("这个文件打不开，要用这里导出的备份或分享文件");
            return;
          }
          var how = window.confirm(
            "要将文件合并到当前数据吗？\n\n确定 = 合并（保留现有行程，并加入文件里的内容）\n取消 = 再问一次是否整份替换"
          );
          var mode = "merge";
          if (!how) {
            var replace = window.confirm("确定要用这份文件整份替换当前数据吗？现有行程会被覆盖。");
            if (!replace) return;
            mode = "replace";
          }
          var run = function (onConflict) {
            try {
              applyBackup(data, mode, { onConflict: onConflict || {} });
              alert(mode === "replace" ? "已用文件替换当前数据。" : "已将文件合并到当前数据。");
            } catch (err) {
              alert("这个文件打不开，要用这里导出的备份或分享文件");
            }
          };
          /* v6：合并时本机已有同一趟 → 先问 覆盖 / 另存一份 / 取消（取消 = 什么都不导入） */
          var app = root.TripApp;
          var clashes = mode === "merge" && app && app.tripConflicts && data && Array.isArray(data.trips) ? app.tripConflicts(data) : [];
          if (clashes.length && app.askTripConflicts) {
            app.askTripConflicts(clashes, function (answers) {
              if (answers) run(answers);
            });
            return;
          }
          run({});
        };
        reader.readAsText(f, "utf-8");
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        var wipe = function () {
          clearAllLocalData();
          window.location.reload();
        };
        if (window.TripApp && typeof window.TripApp.confirm === "function") {
          window.TripApp.confirm({
            title: CLEAR_LOCAL_COPY.title,
            okText: CLEAR_LOCAL_COPY.ok,
            cancelText: CLEAR_LOCAL_COPY.cancel,
            onOk: wipe
          });
          return;
        }
        var ok = window.confirm(CLEAR_LOCAL_COPY.title);
        if (!ok) return;
        wipe();
      });
    }
  }

  var api = {
    CLEAR_LOCAL_COPY: CLEAR_LOCAL_COPY,
    TRIP_KEY: TRIP_KEY,
    DATA_KEY: DATA_KEY,
    FORMAT_VERSION: FORMAT_VERSION,
    LEG_KEY: LEG_KEY,
    STATUS_KEY: STATUS_KEY,
    FLAG_KEY: FLAG_KEY,
    collect: collect,
    downloadBackup: downloadBackup,
    downloadShare: downloadShare,
    downloadFullBackup: downloadFullBackup,
    redactForShare: redactForShare,
    stripSecretPatterns: stripSecretPatterns,
    redactItem: redactItem,
    applyBackup: applyBackup,
    clearAllLocalData: clearAllLocalData,
    todayStamp: todayStamp,
    setupButtons: setupButtons,
    readJson: readJson
  };
  root.BackupUtil = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", setupButtons);
    } else {
      setupButtons();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
