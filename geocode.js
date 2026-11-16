/**
 * OpenStreetMap Nominatim 地理编码（无需 API Key）。
 * 限制：每秒最多 1 次请求；结果缓存在 localStorage。
 * 机票优先查本地机场表，找不到再搜「<IATA> airport」。
 * 请求中只包含名称、地址或 IATA，不会发送确认号、座位或备注。
 */
(function (root) {
  "use strict";

  var CACHE_KEY = "wishlist-map-geocode-v1";
  var NOMINATIM = "https://nominatim.openstreetmap.org/search";
  var MIN_INTERVAL_MS = 1000;
  var lastRequestAt = 0;
  var chain = Promise.resolve();

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
        type: r.type || r.category || "",
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
      return fetch(url, { headers: { Accept: "application/json" } }).then(function (res) {
        if (!res.ok) {
          throw new Error("Nominatim 返回 HTTP " + res.status);
        }
        return res.json();
      }).then(function (data) {
        var results = mapResults(data);
        cacheSet(q, results);
        return results;
      });
    });
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
      return nominatimSearch(queries[i]).then(function (list) {
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
        out.message = "没有找到「" + query + "」的坐标";
      }
      return out;
    }).catch(function (err) {
      out.status = "error";
      out.message = "地理编码失败：" + (err && err.message ? err.message : String(err));
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
            status: "error",
            query: "",
            candidates: [],
            chosen: null,
            message: String(err && err.message ? err.message : err)
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
    sanitizeGeocodeQuery: sanitizeGeocodeQuery,
    lookupIata: lookupIata,
    resolveItem: resolveItem,
    resolveAll: resolveAll,
    applyChoice: applyChoice,
    cacheGet: cacheGet,
    getCache: getCache,
    setCacheAll: setCacheAll
  };

  root.Geocode = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
