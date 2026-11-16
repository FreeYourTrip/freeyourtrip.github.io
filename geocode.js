/**
 * 地理编码：默认使用 OpenStreetMap Nominatim（无需 API Key）。
 * 若 config.js 同时填写了 AMAP_JS_KEY 与 AMAP_SECURITY_CODE，且查询词像中国大陆
 * 地址，则按需懒加载高德 Web 端 JS API（PlaceSearch / AutoComplete），把返回的
 * GCJ-02 只转换一次成 WGS-84 再入库。两个配置都为空时不会加载任何高德脚本。
 * 限制：Nominatim 每秒最多 1 次；超时 8 秒；结果缓存在 localStorage。
 * 机票优先查本地机场表，找不到再搜「<IATA> airport」。
 * 请求中只包含名称、地址或 IATA，不会发送确认号、座位或备注。
 * 浏览器页面里的 fetch 不能自定义 User-Agent；Nominatim 请求带 Accept 与
 * Accept-Language，Referer / User-Agent 由浏览器自动附带。
 */
(function (root) {
  "use strict";

  var CACHE_KEY = "wishlist-map-geocode-v1";
  var NOMINATIM = "https://nominatim.openstreetmap.org/search";
  var AMAP_JS = "https://webapi.amap.com/maps";
  var MIN_INTERVAL_MS = 1000;
  var REQUEST_TIMEOUT_MS = 8000;
  var FRIENDLY_NOT_FOUND = "暂时找不到位置，不影响「带我去」导航";
  var lastRequestAt = 0;
  var chain = Promise.resolve();
  var amapLoader = null;

  function amapJsKey() {
    var cfg = root.AppConfig || {};
    return String(cfg.AMAP_JS_KEY || "").trim();
  }

  function amapSecurityCode() {
    var cfg = root.AppConfig || {};
    return String(cfg.AMAP_SECURITY_CODE || "").trim();
  }

  function amapConfigured() {
    return !!(amapJsKey() && amapSecurityCode());
  }

  function looksMainland(text) {
    if (root.GeoUtil && typeof root.GeoUtil.looksChineseMainlandQuery === "function") {
      return root.GeoUtil.looksChineseMainlandQuery(text);
    }
    return /[\u3400-\u9fff]/.test(String(text || ""));
  }

  function fetchWithTimeout(url, options) {
    var ms = REQUEST_TIMEOUT_MS;
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var opts = {};
    var key;
    options = options || {};
    for (key in options) {
      if (Object.prototype.hasOwnProperty.call(options, key)) opts[key] = options[key];
    }
    if (ctrl) opts.signal = ctrl.signal;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        if (ctrl) ctrl.abort();
        reject(new Error("timeout"));
      }, ms);
      fetch(url, opts).then(
        function (res) {
          clearTimeout(timer);
          resolve(res);
        },
        function (err) {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  function now() {
    return Date.now();
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function loadCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function saveCache(cache) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (err) {
      /* 配额满时忽略 */
    }
  }

  function getCache() {
    return loadCache();
  }

  function setCacheAll(obj) {
    saveCache(obj && typeof obj === "object" ? obj : {});
  }

  function normalizeQuery(q) {
    return String(q || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function cacheGet(query) {
    var key = normalizeQuery(query);
    if (!key) return null;
    var cache = loadCache();
    return cache[key] || null;
  }

  function cacheSet(query, results) {
    var key = normalizeQuery(query);
    if (!key) return;
    var cache = loadCache();
    cache[key] = {
      savedAt: new Date().toISOString(),
      results: results
    };
    saveCache(cache);
  }

  function mapResults(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (r) {
      return {
        lat: Number(r.lat),
        lng: Number(r.lon),
        displayName: r.display_name || "",
        name: r.name || "",
        class: r.class || r.category || "",
        type: r.type || "",
        importance: typeof r.importance === "number" ? r.importance : 0
      };
    }).filter(function (r) {
      return isFinite(r.lat) && isFinite(r.lng);
    });
  }

  function enqueue(task) {
    var run = chain.then(function () {
      var wait = Math.max(0, MIN_INTERVAL_MS - (now() - lastRequestAt));
      return delay(wait).then(function () {
        lastRequestAt = now();
        return task();
      });
    });
    chain = run.then(
      function () {},
      function () {}
    );
    return run;
  }

  /**
   * 只把地名/地址/IATA 发给 Nominatim，去掉可能夹带的确认号、座位、备注字样。
   */
  function sanitizeGeocodeQuery(query) {
    return String(query == null ? "" : query)
      .replace(/确认号\s*[:：]?\s*\S+/g, " ")
      .replace(/座位\s*[:：]?\s*\S+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function nominatimSearch(query) {
    var q = sanitizeGeocodeQuery(query);
    if (!q) return Promise.resolve([]);
    var hit = cacheGet(q);
    if (hit && Array.isArray(hit.results)) {
      return Promise.resolve(hit.results);
    }

    return enqueue(function () {
      var url =
        NOMINATIM +
        "?format=jsonv2&limit=5&accept-language=" +
        encodeURIComponent("zh,en") +
        "&q=" +
        encodeURIComponent(q);
      return fetchWithTimeout(url, {
          headers: { Accept: "application/json", "Accept-Language": "zh,en" }
        }).then(function (res) {
        if (!res.ok) {
          throw new Error("timeout-or-http");
        }
        return res.json();
      }).then(function (data) {
        var results = mapResults(data);
        cacheSet(q, results);
        return results;
      });
    });
  }

  /**
   * 高德 JS API 返回的是 GCJ-02。入库只做这一次转换，得到 WGS-84。
   * 不要对已经转过的结果再调用一次。
   */
  function gcjResultToWgs(lat, lng) {
    lat = Number(lat);
    lng = Number(lng);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (root.GeoUtil && typeof root.GeoUtil.gcj02ToWgs84 === "function") {
      return root.GeoUtil.gcj02ToWgs84(lat, lng);
    }
    return { lat: lat, lng: lng };
  }

  function readAmapLngLat(loc) {
    if (!loc) return null;
    var lng = typeof loc.getLng === "function" ? loc.getLng() : loc.lng;
    var lat = typeof loc.getLat === "function" ? loc.getLat() : loc.lat;
    if (lng == null && Array.isArray(loc) && loc.length >= 2) {
      lng = loc[0];
      lat = loc[1];
    }
    return gcjResultToWgs(lat, lng);
  }

  function mapAmapJsPois(pois, q) {
    var list = [];
    (pois || []).forEach(function (poi) {
      if (!poi) return;
      var pt = readAmapLngLat(poi.location);
      if (!pt) return;
      var name = String(poi.name || "").trim();
      var addr = String(poi.address || poi.district || "").trim();
      list.push({
        lat: pt.lat,
        lng: pt.lng,
        displayName: (name && addr ? name + ", " + addr : name || addr || q || "").trim(),
        name: name,
        class: "",
        type: poi.type || poi.typecode || "",
        source: "amap",
        coordSystem: "wgs84"
      });
    });
    return list;
  }

  function mapAmapJsTips(tips, q) {
    var list = [];
    (tips || []).forEach(function (tip) {
      if (!tip) return;
      var pt = readAmapLngLat(tip.location);
      if (!pt) return;
      var name = String(tip.name || "").trim();
      var addr = String(tip.address || tip.district || "").trim();
      list.push({
        lat: pt.lat,
        lng: pt.lng,
        displayName: (name && addr ? name + ", " + addr : name || addr || q || "").trim(),
        name: name,
        class: "",
        type: tip.type || tip.typecode || "",
        source: "amap",
        coordSystem: "wgs84"
      });
    });
    return list;
  }

  function ensureAmapJs() {
    if (!amapConfigured()) return Promise.reject(new Error("amap-not-configured"));
    if (typeof document === "undefined") return Promise.reject(new Error("amap-no-document"));
    if (root.AMap && (root.AMap.PlaceSearch || root.AMap.plugin)) {
      return Promise.resolve(root.AMap);
    }
    if (amapLoader) return amapLoader;
    try {
      root._AMapSecurityConfig = { securityJsCode: amapSecurityCode() };
    } catch (err) {}
    amapLoader = new Promise(function (resolve, reject) {
      var done = false;
      function finish(err, value) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (err) {
          amapLoader = null;
          reject(err);
        } else {
          resolve(value);
        }
      }
      var timer = setTimeout(function () {
        finish(new Error("timeout"));
      }, REQUEST_TIMEOUT_MS);
      root.__onAmapReady = function () {
        if (root.AMap) finish(null, root.AMap);
        else finish(new Error("amap-missing"));
      };
      var script = document.createElement("script");
      script.src =
        AMAP_JS +
        "?v=2.0&key=" +
        encodeURIComponent(amapJsKey()) +
        "&plugin=AMap.PlaceSearch,AMap.AutoComplete&callback=__onAmapReady";
      script.async = true;
      script.onerror = function () {
        finish(new Error("amap-load"));
      };
      try {
        document.head.appendChild(script);
      } catch (err) {
        finish(err || new Error("amap-load"));
      }
    });
    return amapLoader;
  }

  function amapPluginSearch(AMapCtor, pluginName, runner) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error("timeout"));
      }, REQUEST_TIMEOUT_MS);
      function go() {
        try {
          runner(function (doneErr, list) {
            clearTimeout(timer);
            if (doneErr) reject(doneErr);
            else resolve(list || []);
          });
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      }
      if (AMapCtor[pluginName]) {
        go();
        return;
      }
      if (typeof AMapCtor.plugin === "function") {
        AMapCtor.plugin(pluginName, function () {
          go();
        });
        return;
      }
      clearTimeout(timer);
      reject(new Error("amap-plugin"));
    });
  }

  function amapPlaceSearch(AMapCtor, q) {
    return amapPluginSearch(AMapCtor, "AMap.PlaceSearch", function (done) {
      var searcher = new AMapCtor.PlaceSearch({ pageSize: 5, pageIndex: 1, extensions: "base" });
      searcher.search(q, function (status, result) {
        if (status === "complete" && result && result.poiList) {
          done(null, mapAmapJsPois(result.poiList.pois || [], q));
          return;
        }
        if (status === "no_data") {
          done(null, []);
          return;
        }
        done(new Error(status || "amap-search"));
      });
    });
  }

  function amapAutoComplete(AMapCtor, q) {
    return amapPluginSearch(AMapCtor, "AMap.AutoComplete", function (done) {
      var auto = new AMapCtor.AutoComplete({});
      auto.search(q, function (status, result) {
        if (status === "complete" && result && result.tips) {
          done(null, mapAmapJsTips(result.tips, q));
          return;
        }
        if (status === "no_data") {
          done(null, []);
          return;
        }
        done(new Error(status || "amap-auto"));
      });
    });
  }

  /**
   * 大陆查询在已配置 JS Key 时走高德 PlaceSearch，空结果再试 AutoComplete。
   * 失败、超时或配额错误由调用方回退 Nominatim。
   */
  function amapSearch(query) {
    var q = sanitizeGeocodeQuery(query);
    if (!amapConfigured() || !q) return Promise.resolve([]);
    var cacheQ = "amap:" + q;
    var hit = cacheGet(cacheQ);
    if (hit && Array.isArray(hit.results)) return Promise.resolve(hit.results);
    return ensureAmapJs()
      .then(function (AMapCtor) {
        return amapPlaceSearch(AMapCtor, q).then(function (list) {
          if (list && list.length) return list;
          return amapAutoComplete(AMapCtor, q);
        });
      })
      .then(function (list) {
        var out = list || [];
        if (out.length) cacheSet(cacheQ, out);
        return out;
      });
  }

  /**
   * 统一搜索：已配置高德且查询像大陆地址时先走 JS API，失败或无结果再退回 Nominatim。
   * 两个配置都为空时只使用 Nominatim，不会加载 webapi.amap.com。
   */
  function searchAddress(query) {
    var q = sanitizeGeocodeQuery(query);
    if (!q) return Promise.resolve([]);
    if (amapConfigured() && looksMainland(q)) {
      return amapSearch(q)
        .then(function (list) {
          if (list && list.length) return list;
          return nominatimSearch(q);
        })
        .catch(function () {
          return nominatimSearch(q);
        });
    }
    return nominatimSearch(q);
  }

  function lookupIata(code) {
    if (root.AirportDB && typeof root.AirportDB.lookupAirport === "function") {
      return root.AirportDB.lookupAirport(code);
    }
    return null;
  }

  /**
   * 解析一条行程的坐标。
   * 返回 Promise<{
   *   item, status: 'ok'|'ambiguous'|'none'|'error',
   *   query, candidates: [...],
   *   chosen: {lat,lng,displayName,source}|null,
   *   fromChosen?: same (机票出发机场),
   *   message?: string
   * }>
   */
  function resolveItem(item) {
    var out = {
      item: item,
      status: "ok",
      query: "",
      candidates: [],
      chosen: null,
      fromChosen: null,
      message: ""
    };

    function already(lat, lng, label, source) {
      if (typeof lat === "number" && typeof lng === "number") {
        return { lat: lat, lng: lng, displayName: label || "", source: source || "stored" };
      }
      return null;
    }

    if (item.type === "flight") {
      var fromHit = lookupIata(item.fromAirport);
      var toHit = lookupIata(item.toAirport);
      if (fromHit) {
        out.fromChosen = {
          lat: fromHit.lat,
          lng: fromHit.lng,
          displayName: fromHit.nameZh || fromHit.name,
          source: "iata"
        };
      }
      if (fromHit) {
        item.fromNameZh = fromHit.nameZh || item.fromNameZh;
        item.fromNameEn = fromHit.name || item.fromNameEn;
        item.fromLat = fromHit.lat;
        item.fromLng = fromHit.lng;
      }
      if (toHit) {
        item.nameZh = toHit.nameZh || item.nameZh;
        item.nameEn = toHit.name || item.nameEn;
        out.chosen = {
          lat: toHit.lat,
          lng: toHit.lng,
          displayName: toHit.nameZh || toHit.name,
          source: "iata"
        };
        out.status = "ok";
        out.query = item.toAirport;
        if (fromHit) return Promise.resolve(out);
      }

      var pending = [];
      if (!fromHit && item.fromAirport) {
        pending.push(
          nominatimSearch(item.fromAirport + " airport").then(function (list) {
            return { end: "from", list: list, code: item.fromAirport };
          })
        );
      }
      if (!toHit && item.toAirport) {
        pending.push(
          nominatimSearch(item.toAirport + " airport").then(function (list) {
            return { end: "to", list: list, code: item.toAirport };
          })
        );
      }
      if (!pending.length) return Promise.resolve(out);

      return Promise.all(
        pending.map(function (p) {
          return p.catch(function (err) {
            return { error: err, end: "to" };
          });
        })
      ).then(function (parts) {
        parts.forEach(function (part) {
          if (!part || part.error) {
            if (!out.message && part && part.error) out.message = String(part.error.message || part.error);
            return;
          }
          var list = part.list || [];
          if (part.end === "from") {
            out.fromCandidates = list;
            if (list.length === 1 || list.length > 1) {
              var f = list[0];
              if (f) {
                out.fromChosen = {
                  lat: f.lat,
                  lng: f.lng,
                  displayName: f.displayName,
                  source: "nominatim"
                };
              }
            }
            if (list.length !== 1 && !fromHit) {
              /* 出发机场不确定不影响本条作为到达点的导入 */
            }
          } else {
            out.candidates = list;
            out.query = part.code + " airport";
            if (list.length === 1) {
              out.chosen = {
                lat: list[0].lat,
                lng: list[0].lng,
                displayName: list[0].displayName,
                source: "nominatim"
              };
              out.status = "ok";
            } else if (list.length > 1) {
              out.chosen = {
                lat: list[0].lat,
                lng: list[0].lng,
                displayName: list[0].displayName,
                source: "nominatim"
              };
              out.status = "ambiguous";
              out.message = "找到 " + list.length + " 个候选，请确认到达机场";
            } else if (!out.chosen) {
              out.status = "none";
              out.message = "未找到机场「" + part.code + "」的坐标";
            }
          }
        });
        return out;
      });
    }

    /* 酒店 / 地点：已有坐标则直接用；否则按地址或名称搜索 */
    if (typeof item.lat === "number" && typeof item.lng === "number") {
      out.chosen = already(item.lat, item.lng, item.address || item.nameZh || "", "stored");
      return Promise.resolve(out);
    }

    function pushQuery(arr, q) {
      q = String(q || "").replace(/\s+/g, " ").trim();
      if (q && arr.indexOf(q) === -1) arr.push(q);
    }
    function stripPostcode(addr) {
      return String(addr || "")
        .replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi, "")
        .replace(/,\s*,/g, ",")
        .replace(/[\s,]+$/g, "")
        .trim();
    }
    var name = (item.nameZh || item.nameEn || "").trim();
    var addr = (item.address && String(item.address).trim()) || "";
    var queries = [];
    if (name && addr) pushQuery(queries, name + ", " + addr);
    function stripArticle(n) {
      return String(n || "").replace(/^(the|le|la|el|les|los|an|a)\s+/i, "").trim();
    }
    if (item.type === "hotel" && name && !/hotel|饭店|酒店|旅館|旅馆/i.test(name)) {
      var bare = stripArticle(name) || name;
      [name, bare].forEach(function (n) {
        if (!n) return;
        pushQuery(queries, n + " Hotel, " + addr);
        pushQuery(queries, n + " Hotel, " + stripPostcode(addr));
        pushQuery(queries, n + " Hotel " + stripPostcode(addr));
      });
    }
    if (addr) pushQuery(queries, addr);
    if (addr && stripPostcode(addr) !== addr) {
      pushQuery(queries, stripPostcode(addr));
      if (name) pushQuery(queries, name + ", " + stripPostcode(addr));
    }
    if (name) pushQuery(queries, name);
    if (item.type === "hotel" && name && !/hotel|饭店|酒店/i.test(name)) {
      pushQuery(queries, name + " Hotel");
      var bare2 = name.replace(/^(the|le|la|el|les|los|an|a)\s+/i, "").trim();
      if (bare2 && bare2 !== name) pushQuery(queries, bare2 + " Hotel");
    }
    out.query = queries[0] || "";
    if (!queries.length) {
      out.status = "none";
      out.message = "没有可供搜索的地址或名称";
      return Promise.resolve(out);
    }

    function searchNext(i) {
      if (i >= queries.length) {
        return Promise.resolve([]);
      }
      out.query = queries[i];
      return searchAddress(queries[i]).then(function (list) {
        if (list && list.length) return list;
        return searchNext(i + 1);
      });
    }

    return searchNext(0).then(function (list) {
      out.candidates = list;
      if (list.length === 1) {
        out.chosen = {
          lat: list[0].lat,
          lng: list[0].lng,
          displayName: list[0].displayName,
          source: "nominatim"
        };
        out.status = "ok";
      } else if (list.length > 1) {
        out.chosen = {
          lat: list[0].lat,
          lng: list[0].lng,
          displayName: list[0].displayName,
          source: "nominatim"
        };
        out.status = "ambiguous";
        out.message = "找到 " + list.length + " 个候选，请确认地点";
      } else {
        out.status = "none";
        out.message = FRIENDLY_NOT_FOUND;
      }
      return out;
    }).catch(function () {
      out.status = "none";
      out.message = FRIENDLY_NOT_FOUND;
      return out;
    });
  }

  function applyChoice(item, chosen, fromChosen) {
    if (chosen && typeof chosen.lat === "number") {
      item.lat = chosen.lat;
      item.lng = chosen.lng;
    }
    if (item.type === "flight" && fromChosen && typeof fromChosen.lat === "number") {
      item.fromLat = fromChosen.lat;
      item.fromLng = fromChosen.lng;
    }
    return item;
  }

  function resolveAll(items, onEach) {
    var list = items || [];
    var results = [];
    var i = 0;
    function next() {
      if (i >= list.length) return Promise.resolve(results);
      var item = list[i];
      i += 1;
      return resolveItem(item)
        .then(function (res) {
          if (res.chosen) applyChoice(item, res.chosen, res.fromChosen);
          results.push(res);
          if (typeof onEach === "function") onEach(res, results.length - 1, list.length);
          return next();
        })
        .catch(function (err) {
          var fail = {
            item: item,
            status: "none",
            query: "",
            candidates: [],
            chosen: null,
            message: FRIENDLY_NOT_FOUND
          };
          results.push(fail);
          if (typeof onEach === "function") onEach(fail, results.length - 1, list.length);
          return next();
        });
    }
    return next();
  }

  var api = {
    CACHE_KEY: CACHE_KEY,
    nominatimSearch: nominatimSearch,
    searchAddress: searchAddress,
    amapSearch: amapSearch,
    amapConfigured: amapConfigured,
    gcjResultToWgs: gcjResultToWgs,
    mapAmapJsPois: mapAmapJsPois,
    FRIENDLY_NOT_FOUND: FRIENDLY_NOT_FOUND,
    sanitizeGeocodeQuery: sanitizeGeocodeQuery,
    lookupIata: lookupIata,
    resolveItem: resolveItem,
    resolveAll: resolveAll,
    applyChoice: applyChoice,
    guessType: function (input, typ) {
      return root.GuessType && GuessType.guessType ? GuessType.guessType(input, typ) : "地点";
    },
    cacheGet: cacheGet,
    getCache: getCache,
    setCacheAll: setCacheAll
  };

  root.Geocode = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
