/**
 * 导出 / 导入全部本地数据备份（行程、条目、交通腿、心愿状态、地理编码缓存）。
 */
(function (root) {
  "use strict";

  var LEG_KEY = "wishlist-map-legs-v1";
  var STATUS_KEY = "wishlist-map-status-v1";
  var TRIP_KEY = "wishlist-map-trips-v1";
  var GEO_KEY = "wishlist-map-geocode-v1";
  var FLAG_KEY = "wishlist-map-examples-loaded-v1";

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
    return y + "-" + m + "-" + day;
  }

  function collect(opts) {
    opts = opts || {};
    var live = root.TripApp && typeof root.TripApp.exportState === "function" ? root.TripApp.exportState() : null;
    var wish = root.WishlistApp && typeof root.WishlistApp.exportState === "function" ? root.WishlistApp.exportState() : null;
    var payload = {
      app: "行程地图",
      version: 1,
      exportedAt: new Date().toISOString(),
      trips: live && live.trips ? live.trips : readJson(TRIP_KEY, []),
      activeTripId: live && live.activeTripId ? live.activeTripId : "",
      examplesLoaded: live && typeof live.examplesLoaded === "boolean" ? live.examplesLoaded : readJson(FLAG_KEY, false),
      legs: live && live.legs ? live.legs : readJson(LEG_KEY, {}),
      statuses: wish && wish.statuses ? wish.statuses : readJson(STATUS_KEY, {}),
      wishlistLoaded: wish && wish.loaded ? true : false
    };
    if (opts.includeGeocodeCache !== false) {
      payload.geocodeCache = root.Geocode && root.Geocode.getCache ? root.Geocode.getCache() : readJson(GEO_KEY, {});
    }
    return payload;
  }

  function downloadBackup() {
    var payload = collect({ includeGeocodeCache: true });
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    var a = document.createElement("a");
    var url = URL.createObjectURL(blob);
    a.href = url;
    a.download = "行程备份-" + todayStamp() + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
    return payload;
  }

  function applyBackup(payload, mode) {
    if (!payload || payload.app !== "行程地图" || !payload.version) {
      /* 也接受缺 app 字段但有 trips 数组的文件 */
      if (!payload || !Array.isArray(payload.trips)) {
        throw new Error("这不是一份有效的行程地图备份文件。");
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
          activeTripId: payload.activeTripId || "",
          examplesLoaded: !!payload.examplesLoaded,
          legs: incomingLegs
        },
        mode
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
    return { mode: mode, tripCount: incomingTrips.length };
  }

  function setupButtons() {
    var exp = document.getElementById("backup-export");
    var imp = document.getElementById("backup-import");
    var file = document.getElementById("backup-file");
    if (exp) {
      exp.addEventListener("click", function () {
        downloadBackup();
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
            alert("无法解析该文件，请确认是导出的 JSON 备份。");
            return;
          }
          var how = window.confirm(
            "要将备份合并到当前数据吗？\n\n确定 = 合并（保留现有行程，并加入备份里的内容）\n取消 = 再问一次是否整份替换"
          );
          var mode = "merge";
          if (!how) {
            var replace = window.confirm("确定要用这份备份整份替换当前数据吗？现有行程会被覆盖。");
            if (!replace) return;
            mode = "replace";
          }
          try {
            applyBackup(data, mode);
            alert(mode === "replace" ? "已用备份替换当前数据。" : "已将备份合并到当前数据。");
          } catch (err) {
            alert(err && err.message ? err.message : String(err));
          }
        };
        reader.readAsText(f, "utf-8");
      });
    }
  }

  var api = {
    TRIP_KEY: TRIP_KEY,
    LEG_KEY: LEG_KEY,
    STATUS_KEY: STATUS_KEY,
    FLAG_KEY: FLAG_KEY,
    collect: collect,
    downloadBackup: downloadBackup,
    applyBackup: applyBackup,
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
