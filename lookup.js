/**
 * 统一找位置（导入、待确认、收藏都走这里）。
 * 导入时绝不按店名搜——按店名搜会问来问去；确认页才允许按名字列候选。
 * 顺序：地点库 → 结构化地址（门牌+街道+城市+邮编，不含店名）→ 英国邮编
 * → 街道+城市（须在邮编或附带的点约 300 米内）→ 附带的点（须大概在同一座城市，约 30 公里）
 * → 「位置待确认」（只在每一层都找不到点时）。
 * 地址和附带的点差得远：默默用地址的结果，不打条。针脚样式都一样。
 * 高德搜索留一个 hook，v6.3 再接。
 */
(function (root) {
  "use strict";

  var POSTCODES_URL = "https://api.postcodes.io/postcodes/";
  var VERIFY_POSTCODE_M = 500;
  var STREET_NEAR_M = 300;
  var AI_NEAR_M = 1000;
  var SAME_CITY_KM = 30;

  var COPY = {
    pending: "位置待确认 ›",
    notFound: "地图上没找到这里",
    mapTap: "在地图上点一下",
    skip: "先跳过",
    progress: "第 {i} 个，共 {n} 个",
    confirmHere: "就放这里",
    confirmHead: "确认位置",
    confirmHint: "拖动地图或点一下，把点对准那个地方"
  };

  var providers = {
    /* v6.3：高德搜索。现在不用。 */
    amap: null,
    geocode: null,
    postcode: null
  };

  function setProvider(name, fn) {
    providers[name] = fn;
  }

  function trim(s) {
    return String(s == null ? "" : s).replace(/^\s+|\s+$/g, "");
  }

  function escapeRe(s) {
    return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /* 英国邮编（含 GIR 0AA）。只从文字里抽出邮编本身，发给 postcodes.io 时不再附带别的。 */
  var UK_PC_RE = /\b(GIR\s?0AA|(?:[A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2})\b/i;

  function extractUkPostcode(text) {
    var m = String(text || "").toUpperCase().match(UK_PC_RE);
    if (!m) return "";
    return normalizeUkPostcode(m[1]);
  }

  function normalizeUkPostcode(pc) {
    var s = String(pc || "").toUpperCase().replace(/\s+/g, "");
    if (!s) return "";
    if (s.length < 5) return "";
    return s.slice(0, s.length - 3) + " " + s.slice(s.length - 3);
  }

  function stripPlaceName(address, name) {
    var a = trim(address);
    var n = trim(name);
    if (!a) return "";
    if (!n) return a;
    var re = new RegExp("^" + escapeRe(n) + "\\s*[,，:：\\-–—]?\\s*", "i");
    var out = a.replace(re, "");
    return trim(out) || a;
  }

  /**
   * 从地址里拆出门牌+街道、城市、邮编。不含店名。
   * 英国 / 常见「街道, 城市 邮编」写法优先；拆不出就返回能拿到的部分。
   */
  function parseStructuredAddress(address, name) {
    var raw = stripPlaceName(address, name);
    var uk = extractUkPostcode(raw);
    var rest = raw;
    if (uk) rest = raw.replace(new RegExp(escapeRe(uk), "i"), "");
    /* 法国等：逗号前若有 5 位邮编 */
    var fr = rest.match(/\b(\d{5})\b/);
    var postal = uk || (fr ? fr[1] : "");
    if (fr && !uk) rest = rest.replace(fr[1], "");
    rest = rest.replace(/[,\s;；]+$/g, "").replace(/^[,\s;；]+/g, "");
    var parts = rest.split(/[,，]/).map(trim).filter(Boolean);
    var street = parts[0] || "";
    var city = "";
    var i;
    for (i = parts.length - 1; i >= 1; i--) {
      var p = parts[i].replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i, "").trim();
      if (p && !/^\d+$/.test(p)) {
        city = p.replace(/\b(UK|United Kingdom|France|England)\b/i, "").trim();
        if (city) break;
      }
    }
    var house = "";
    /* 门牌可以是「12」或「60-62」这种号段 */
    var hm = street.match(/^(\d+[A-Za-z]?(?:\s*[-–]\s*\d+[A-Za-z]?)?)\s+(.+)$/);
    if (hm) {
      house = hm[1].replace(/\s+/g, "");
    } else {
      var hm2 = street.match(/^(.+?)\s+(\d+[A-Za-z]?(?:\s*[-–]\s*\d+[A-Za-z]?)?)$/);
      if (hm2) house = hm2[2].replace(/\s+/g, "");
    }
    return {
      raw: raw,
      street: street,
      house: house,
      city: city,
      postalcode: postal,
      ukPostcode: uk
    };
  }

  function kmBetween(a, b) {
    if (!a || !b || !isFinite(a.lat) || !isFinite(b.lat) || !isFinite(a.lng) || !isFinite(b.lng)) return null;
    if (root.GeoUtil && root.GeoUtil.haversineKm) return root.GeoUtil.haversineKm(a, b);
    var R = 6371;
    var dLat = ((b.lat - a.lat) * Math.PI) / 180;
    var dLng = ((b.lng - a.lng) * Math.PI) / 180;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function metersBetween(a, b) {
    var km = kmBetween(a, b);
    return km == null ? null : km * 1000;
  }

  function inSameCity(point, refs) {
    var list = refs || [];
    var i;
    for (i = 0; i < list.length; i++) {
      var km = kmBetween(point, list[i]);
      if (km != null && km <= SAME_CITY_KM) return true;
    }
    return false;
  }

  function houseMatches(hit, house) {
    if (!house || !hit) return false;
    var want = String(house).toLowerCase().replace(/\s+/g, "");
    var got = String((hit.address && (hit.address.house_number || hit.address.housenumber)) || "").toLowerCase().replace(/\s+/g, "");
    if (got && (got === want || want.indexOf(got) !== -1 || got.indexOf(want) !== -1)) return true;
    var parts = want.split(/[-–]/);
    if (got && parts.length === 2 && (got === parts[0] || got === parts[1] || (got.indexOf(parts[0]) !== -1 && got.indexOf(parts[1]) !== -1))) return true;
    var blob = String(hit.displayName || hit.name || "").toLowerCase().replace(/\s+/g, "");
    return !!(want && blob.indexOf(want) !== -1);
  }

  /**
   * 纯函数：把各层已经拿到的结果合成一个结论。不访问网络。
   * 有点就用（针脚样式相同）；只有每一层都没有点时才 needsConfirm。
   * 地址和附带的点差得远：用地址，不打条。
   */
  function decide(input) {
    input = input || {};
    var lib = input.library;
    var house = input.houseHit;
    var postcode = input.postcode;
    var streetCity = input.streetCity;
    var ai = input.ai;
    var refs = [].concat(input.tripPoints || [], input.cityCenter ? [input.cityCenter] : []);

    function ok(src, pt) {
      return {
        status: "ok",
        source: src,
        lat: pt.lat,
        lng: pt.lng,
        verified: true,
        needsConfirm: false,
        navByAddress: true
      };
    }

    if (lib && isFinite(lib.lat) && isFinite(lib.lng)) return ok("library", lib);
    if (input.amap && isFinite(input.amap.lat) && isFinite(input.amap.lng)) return ok("amap", input.amap);
    if (house && isFinite(house.lat) && isFinite(house.lng)) return ok("geocode", house);

    if (streetCity && isFinite(streetCity.lat) && isFinite(streetCity.lng)) {
      var nearPc = postcode && metersBetween(streetCity, postcode) != null && metersBetween(streetCity, postcode) <= STREET_NEAR_M;
      var nearAi = ai && metersBetween(streetCity, ai) != null && metersBetween(streetCity, ai) <= STREET_NEAR_M;
      if (nearPc || nearAi) return ok("street", streetCity);
    }

    if (postcode && isFinite(postcode.lat) && isFinite(postcode.lng)) {
      return ok("postcode", postcode);
    }

    if (ai && isFinite(ai.lat) && isFinite(ai.lng) && (inSameCity(ai, refs) || !refs.length)) {
      return ok("ai", ai);
    }

    return {
      status: "needsConfirm",
      source: "",
      lat: null,
      lng: null,
      verified: false,
      needsConfirm: true,
      navByAddress: true
    };
  }

  function lookupPostcode(pc, fetchFn) {
    var code = normalizeUkPostcode(pc);
    if (!code) return Promise.resolve(null);
    if (providers.postcode) return Promise.resolve(providers.postcode(code));
    var f = fetchFn || (typeof fetch === "function" ? fetch : null);
    if (!f) return Promise.resolve(null);
    var url = POSTCODES_URL + encodeURIComponent(code);
    return f(url).then(function (res) {
      if (!res || !res.ok) return null;
      return typeof res.json === "function" ? res.json() : res;
    }).then(function (data) {
      if (!data || data.status !== 200 || !data.result) return null;
      var r = data.result;
      if (!isFinite(r.latitude) || !isFinite(r.longitude)) return null;
      return { lat: r.latitude, lng: r.longitude, postcode: r.postcode, source: "postcode" };
    }).catch(function () {
      return null;
    });
  }

  function firstHit(list) {
    if (!list || !list.length) return null;
    var x = list[0];
    if (!x || !isFinite(x.lat) || !isFinite(x.lng)) return null;
    return x;
  }

  function structuredSearch(parts, opts) {
    if (providers.geocode) return Promise.resolve(providers.geocode(parts, opts));
    var G = root.Geocode;
    if (G && typeof G.nominatimStructured === "function") return G.nominatimStructured(parts, opts);
    return Promise.resolve([]);
  }

  function libraryHit(item, places) {
    var P = root.Places;
    if (!P || !P.match || !item) return null;
    var cand = {
      type: item.type === "hotel" ? "hotel" : "food",
      nameZh: item.nameZh || item.name || "",
      nameEn: item.nameEn || "",
      address: item.address || "",
      city: item.city || "",
      lat: item.hintLat,
      lng: item.hintLng
    };
    if (typeof item.lat === "number") {
      cand.lat = item.lat;
      cand.lng = item.lng;
    }
    var m = P.match(cand, places || [], {});
    if (m && m.kind === "auto" && m.place && typeof m.place.lat === "number") {
      return { lat: m.place.lat, lng: m.place.lng, placeId: m.place.id, source: "library" };
    }
    return null;
  }

  /**
   * 主入口。ctx 可带：places, tripPoints, cityCenter, bias, fetch, skipLibrary。
   * 导入路径请不要设 searchByName。按名字搜只给确认页用 searchByName()。
   */
  function lookup(item, ctx) {
    ctx = ctx || {};
    var address = trim(item && (item.address || ""));
    var name = trim(item && (item.nameZh || item.nameEn || item.name || ""));
    var parts = parseStructuredAddress(address, name);
    var ai = null;
    if (item && isFinite(item.hintLat) && isFinite(item.hintLng)) {
      ai = { lat: Number(item.hintLat), lng: Number(item.hintLng) };
    }
    var lib = ctx.skipLibrary ? null : libraryHit(item, ctx.places);

    function finish(layers) {
      var out = decide({
        library: layers.library,
        amap: layers.amap,
        houseHit: layers.houseHit,
        postcode: layers.postcode,
        streetCity: layers.streetCity,
        ai: layers.ai,
        tripPoints: ctx.tripPoints,
        cityCenter: ctx.cityCenter
      });
      out.address = parts.raw || address;
      out.parts = parts;
      return out;
    }

    if (lib) return Promise.resolve(finish({ library: lib, ai: ai }));

    function looksMainlandQuery() {
      var G = root.Geocode;
      var blob = [address, name, item && item.city, ctx.city, ctx.country].join(" ");
      if (G && typeof G.looksMainland === "function") return G.looksMainland(blob);
      return /[\u3400-\u9fff]/.test(blob) && !/香港|澳门|澳門|台灣|台湾/.test(blob);
    }

    function tryAmap() {
      if (ctx.skipAmap) return Promise.resolve(null);
      var G = root.Geocode;
      if (!G) return Promise.resolve(null);
      if (typeof G.amapConfigured === "function" && !G.amapConfigured()) return Promise.resolve(null);
      if (!looksMainlandQuery()) return Promise.resolve(null);
      var city = (item && item.city) || ctx.city || "";
      var run = typeof G.amapLookupItem === "function"
        ? G.amapLookupItem(item, { city: city })
        : (typeof G.amapSearch === "function" ? G.amapSearch((item && (item.address || item.nameZh || item.name)) || "", { city: city }) : Promise.resolve(null));
      return Promise.resolve(run).then(function (res) {
        if (res && isFinite(res.lat) && isFinite(res.lng)) return res;
        if (res && res.length && res[0] && isFinite(res[0].lat)) return res[0];
        return null;
      }).catch(function () {
        return null;
      });
    }

    var houseQuery = parts.street ? structuredSearch({
      street: parts.street,
      city: parts.city,
      postalcode: parts.postalcode
    }, { bias: ctx.bias }) : Promise.resolve([]);

    function runExistingChain() {
    return houseQuery.then(function (list) {
      var houseHit = null;
      var i;
      for (i = 0; i < (list || []).length; i++) {
        if (parts.house && houseMatches(list[i], parts.house)) {
          houseHit = list[i];
          break;
        }
      }
      /* 有门牌却对不上号：当没找到门牌，改走邮编，绝不改按店名搜 */
      if (!parts.house && list && list.length) houseHit = firstHit(list);

      if (houseHit) return finish({ houseHit: houseHit, ai: ai });

      var pcP = parts.ukPostcode ? lookupPostcode(parts.ukPostcode, ctx.fetch) : Promise.resolve(null);
      return pcP.then(function (pc) {
        var streetOnly = (parts.street || parts.city) ? structuredSearch({
          street: parts.house ? String(parts.street).replace(new RegExp("^" + escapeRe(parts.house) + "\\s+"), "") : parts.street,
          city: parts.city
        }, { bias: ctx.bias }) : Promise.resolve([]);
        return streetOnly.then(function (streetList) {
          return finish({
            postcode: pc,
            streetCity: firstHit(streetList),
            ai: ai
          });
        });
      });
    }).catch(function () {
      if (!parts.ukPostcode) return finish({ ai: ai });
      return lookupPostcode(parts.ukPostcode, ctx.fetch).then(function (pc) {
        return finish({ postcode: pc, ai: ai });
      });
    });
    }

    return tryAmap().then(function (amap) {
      if (amap && isFinite(amap.lat) && isFinite(amap.lng)) {
        return finish({ amap: amap, ai: ai });
      }
      return runExistingChain();
    });
  }

  /** 确认页才允许：按名字列候选。导入不要调用。 */
  function searchByName(name, opts) {
    var q = trim(name);
    if (!q) return Promise.resolve([]);
    if (providers.amap) return Promise.resolve(providers.amap(q, opts || {}));
    var G = root.Geocode;
    if (G && G.searchAddress) return G.searchAddress(q, opts || {});
    return Promise.resolve([]);
  }

  /** 用户在地图上点了或点了「对的」：把这个点永久写入地点库。 */
  function saveUserPosition(places, item, lat, lng) {
    var P = root.Places;
    if (!P || !item || !isFinite(lat) || !isFinite(lng)) return places || [];
    var list = places || [];
    var place = item.placeId ? P.byId(list, item.placeId) : null;
    if (!place) {
      var made = P.placeFromItem ? P.placeFromItem(item) : null;
      if (made) {
        made.lat = Number(lat);
        made.lng = Number(lng);
        made.source = "user";
        list = list.concat([made]);
        item.placeId = made.id;
        return list;
      }
      return list;
    }
    place.lat = Number(lat);
    place.lng = Number(lng);
    place.source = "user";
    if (P.fillFromItem) P.fillFromItem(place, item);
    return list;
  }


  /** 只取门牌+街道，去掉邮编、城市、国家。展示用，不改存储。 */
  function streetLine(address) {
    var parts = parseStructuredAddress(address, "");
    if (parts.street) return parts.street;
    var raw = trim(address);
    if (!raw) return "";
    var uk = extractUkPostcode(raw);
    if (uk) raw = raw.replace(new RegExp(escapeRe(uk), "i"), "");
    raw = raw.replace(/\b(United Kingdom|UK|England|France|China|United States|USA|US)\b/ig, "");
    raw = raw.replace(/[,\s;；]+$/g, "").replace(/^[,\s;；]+/g, "");
    var bits = raw.split(/[,，]/).map(trim).filter(Boolean);
    return bits[0] || trim(address);
  }

  /**
   * 折叠卡片上的标题：不改存储。
   * 有店名就显示店名，若店名后面用逗号单独跟了城市（且地址里也有这个城市）则只在展示时去掉。
   * 没有店名、只有地址：只显示门牌+街道。
   */
  function displayTitle(name, address) {
    var n = trim(name);
    if (!n) return streetLine(address) || "";
    var bits = n.split(/[,，]/).map(trim).filter(Boolean);
    if (bits.length >= 2) {
      var last = bits[bits.length - 1];
      var addr = trim(address);
      var lastIsPc = !!extractUkPostcode(last);
      var lastInAddr = addr && new RegExp("(^|[,，\\s])" + escapeRe(last) + "\\b", "i").test(addr);
      if (lastIsPc || lastInAddr) return bits.slice(0, -1).join(", ");
    }
    return n;
  }

  function displayTitleForItem(item) {
    if (!item) return "";
    if (item.type === "flight") return item.flightNo || "航班";
    var T = root.Transport;
    if (T && T.isGround && T.isGround(item) && T.title) return T.title(item);
    return displayTitle(item.nameZh || item.nameEn || item.name || "", item.address || "") || "未命名";
  }

  var api = {
    COPY: COPY,
    POSTCODES_URL: POSTCODES_URL,
    VERIFY_POSTCODE_M: VERIFY_POSTCODE_M,
    STREET_NEAR_M: STREET_NEAR_M,
    AI_NEAR_M: AI_NEAR_M,
    SAME_CITY_KM: SAME_CITY_KM,
    extractUkPostcode: extractUkPostcode,
    normalizeUkPostcode: normalizeUkPostcode,
    stripPlaceName: stripPlaceName,
    parseStructuredAddress: parseStructuredAddress,
    kmBetween: kmBetween,
    metersBetween: metersBetween,
    inSameCity: inSameCity,
    houseMatches: houseMatches,
    decide: decide,
    lookupPostcode: lookupPostcode,
    lookup: lookup,
    searchByName: searchByName,
    saveUserPosition: saveUserPosition,
    setProvider: setProvider,
    libraryHit: libraryHit,
    streetLine: streetLine,
    displayTitle: displayTitle,
    displayTitleForItem: displayTitleForItem
  };

  root.Lookup = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
