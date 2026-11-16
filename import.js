/**
 * 行程导入：同一输入框自动识别 JSON 或管道分隔文本。
 * 推荐管道格式（5 列）：类型 | 名称 | 地址 | 日期时间 | 备注
 * 详见 导入格式说明.txt
 */
(function (root) {
  "use strict";

  var HEADER = ["类型", "名称", "地址", "日期时间", "备注"];
  /* v6：火车 / 船 / 大巴（写法见 transport.js 的 TYPE_WORDS） */
  var Transport = root.Transport || (typeof require === "function" ? require("./transport.js") : null);
  /* v6：图标别名（「甜品」→ 咖啡甜点酒吧）在 icons.js；用的时候再取，不依赖脚本先后 */
  function iconsRef() {
    if (root.Icons) return root.Icons;
    try { return typeof require === "function" ? require("./icons.js") : null; } catch (e) { return null; }
  }
  var TYPE_ALIASES = {
    机票: "flight",
    航班: "flight",
    flight: "flight",
    酒店: "hotel",
    hotel: "hotel",
    地点: "place",
    地方: "place",
    place: "place"
  };

  function trim(s) {
    return String(s == null ? "" : s).replace(/^\s+|\s+$/g, "");
  }

  function looksLikeJson(text) {
    var t = trim(normalizeImportText(text));
    return t.charAt(0) === "{" || t.charAt(0) === "[";
  }

  /** 去掉 Markdown 代码块围栏，便于粘贴 AI 回复。 */
  function normalizeImportText(text) {
    var t = String(text == null ? "" : text);
    t = t.replace(/```[\w-]*[ \t]*\n?([\s\S]*?)```/g, function (_, inner) {
      return "\n" + inner + "\n";
    });
    t = t.replace(/^[ \t]*```[\w-]*[ \t]*$/gm, "");
    return t;
  }

  function tidyPipeLine(raw) {
    var line = trim(raw);
    line = line.replace(/^[-*•●]\s+/, "");
    /* v5.2：AI 有时输出 Markdown 表格「| 类型 | 名称 | … |」：去掉首尾的竖线 */
    if (/^[|｜]/.test(line) && /[|｜]$/.test(line) && line.length > 1) {
      line = line.replace(/^[|｜]\s*/, "").replace(/\s*[|｜]$/, "");
    }
    return trim(line);
  }

  /** Markdown 表格的分隔行「---|---|…」 */
  function isTableRule(line) {
    return /^[\s|｜:：\-—]+$/.test(line) && /-/.test(line);
  }

  var ROW_TYPE_RE = /^(机票|航班|飞机|酒店|住宿|民宿|地点|餐厅|景点|街道|火车票|车票|火车|高铁|动车|列车|船票|船|轮渡|渡轮|邮轮|大巴票|汽车票|大巴|巴士|长途汽车|flight|hotel|place|train|ferry|boat|bus|coach)/i;

  function splitPipeLine(line) {
    return tidyPipeLine(line).replace(/\uFF5C/g, "|").split("|").map(trim);
  }

  function isHeaderRow(cols) {
    if (cols.length !== 5) return false;
    var i;
    for (i = 0; i < 5; i++) {
      if (cols[i] !== HEADER[i]) return false;
    }
    return true;
  }

  function parseType(raw) {
    var s = trim(raw).replace(/\uFF0F/g, "/");
    var base = s;
    var subtype = "";
    var slash = s.indexOf("/");
    if (slash !== -1) {
      base = trim(s.slice(0, slash));
      subtype = trim(s.slice(slash + 1));
    }
    var kind = TYPE_ALIASES[base.toLowerCase()] || TYPE_ALIASES[base] || (Transport ? Transport.groundKindFromWord(base) : "");
    if (!kind) return { error: "无法识别的类型「" + s + "」，应为 机票、火车、船、大巴、酒店 或 地点（地点可带「地点/餐厅」等子类）" };
    if (kind !== "place") subtype = subtype || "";
    return { kind: kind, subtype: subtype, raw: s };
  }

  function parseIataPair(addr) {
    var s = trim(addr).replace(/[–—−]/g, "-").replace(/\s+/g, " ");
    var m = s.match(/^([A-Za-z]{3})\s*-\s*([A-Za-z]{3})$/);
    if (!m) {
      return {
        error: "机票的地址应为「出发机场 - 到达机场」（IATA 三字码），例如 LHR - HND"
      };
    }
    return { fromAirport: m[1].toUpperCase(), toAirport: m[2].toUpperCase() };
  }

  function parseRangeDateTime(raw, opts) {
    var s = trim(raw).replace(/\uFF5E/g, "~");
    if (!s) {
      return { error: opts.requiredMessage };
    }
    var m = s.match(
      /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?\s*~\s*(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/
    );
    if (!m) {
      return { error: opts.badMessage };
    }
    if (!isValidIsoDate(m[1]) || !isValidIsoDate(m[3]) || !isValidTime(m[2]) || !isValidTime(m[4])) {
      return { error: opts.badMessage + "（日期无效）" };
    }
    if (opts.requireTimes && (!m[2] || !m[4])) {
      return { error: opts.badMessage };
    }
    return {
      startDate: m[1],
      startTime: m[2] || "",
      endDate: m[3],
      endTime: m[4] || ""
    };
  }

  function parsePlaceDateTime(raw) {
    var s = trim(raw);
    if (!s) return { date: "", time: "" };
    var m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/);
    if (!m || !isValidIsoDate(m[1]) || !isValidTime(m[2])) {
      return {
        error: "地点的日期时间应为「YYYY-MM-DD」或「YYYY-MM-DD HH:mm」，也可留空"
      };
    }
    return { date: m[1], time: m[2] || "" };
  }

  /* ---------- 日期 / 时间宽容写法 → 标准「YYYY-MM-DD HH:MM」 ---------- */
  var activeYearHint = "";
  var activeToday = "";
  var hintLocked = false;

  function toHalfWidth(s) {
    return String(s == null ? "" : s)
      .replace(/[\uFF10-\uFF19]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 48); })
      .replace(/\uFF1A/g, ":")
      .replace(/\uFF0F/g, "/")
      .replace(/\uFF0E/g, ".")
      .replace(/[\uFF0D\u2010-\u2013]/g, "-")
      .replace(/\u3000/g, " ");
  }

  /** 从整段文字里找一个能用的年份（第一个完整日期的年），给只写「12月11日」的行用。 */
  function findYearHint(text) {
    var m = /(?:^|[^\d])((?:19|20)\d{2})\s*(?:[-/.]|年)\s*\d{1,2}/.exec(toHalfWidth(text));
    return m ? m[1] : "";
  }

  function pad(n) {
    n = Number(n);
    return n < 10 ? "0" + n : String(n);
  }

  function fixTime(h, mi, ap) {
    h = Number(h);
    mi = mi == null || mi === "" ? 0 : Number(mi);
    ap = String(ap || "").toLowerCase().replace(/\./g, "");
    if (ap === "pm" || ap === "下午" || ap === "晚上") {
      if (h < 12) h += 12;
    } else if (ap === "am" || ap === "上午" || ap === "早上") {
      if (h === 12) h = 0;
    }
    if (h > 23 || mi > 59) return null;
    return pad(h) + ":" + pad(mi);
  }

  /**
   * 把日期时间单元格里的常见写法改成标准写法；认不出来的部分原样保留（后面照旧报错）。
   * 日期：2026/12/11、2026.12.11、2026年12月11日、2026-1-5；12月11日（只有 yearHint 时）。
   * 时间：9:00、9：00、9点、9点30、9点半、9:00 AM / PM、9am、下午3点；全角数字。
   */
  /*
   * v6：「4/12」「12/4/2026」这种月日不知道谁在前的写法。
   * 有一个数大于 12 → 只有一种读法，直接用；两个都 ≤ 12（且不相等）→ 不猜，记进 lastAmbiguous，
   * 由 itemFromFields 放进「待补」，问「是12月4日还是4月12日？」。order：首次 "md"（前面是月），第二种读法 "dm"。
   */
  var lastAmbiguous = null;

  /** 行程里第一条已定日期的年份；待补不算。 */
  function yearFromItems(items) {
    var dates = [];
    (items || []).forEach(function (it) {
      if (!it || it.pendingDate) return;
      ["date", "checkIn", "checkOut", "departDate", "arriveDate"].forEach(function (k) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(it[k] || "")) dates.push(it[k]);
      });
    });
    dates.sort();
    return dates.length ? dates[0].slice(0, 4) : "";
  }

  /** 没有年份时：取今天及之后最近一次出现的那一年来用。 */
  function nearestYear(month, day, today) {
    today = today || activeToday || localTodayIso();
    var y = Number(String(today).slice(0, 4));
    if (!y) return "";
    function iso(year) {
      var t = year + "-" + pad(month) + "-" + pad(day);
      return isValidIsoDate(t) ? t : "";
    }
    var a = iso(y);
    if (a && a >= today) return String(y);
    var b = iso(y + 1);
    if (b) return String(y + 1);
    return a ? String(y) : "";
  }

  function yearForMd(month, day, explicitYear, yearHint) {
    if (explicitYear) return String(explicitYear);
    if (yearHint) return String(yearHint);
    return nearestYear(month, day, activeToday);
  }

  function slashDates(s, yearHint, order) {
    return s.replace(/(^|[^\d/.\-:])(\d{1,2})\s*[\/.]\s*(\d{1,2})(?:\s*[\/.\-]\s*((?:19|20)\d{2}))?(?![\d\/.:])/g, function (all, pre, a, b, y) {
      var na = Number(a);
      var nb = Number(b);
      if (na < 1 || nb < 1) return all;
      var m;
      var d;
      if (na > 12 && nb > 12) return all;
      if (na > 12) { d = na; m = nb; }
      else if (nb > 12) { m = na; d = nb; }
      else if (na === nb) { m = na; d = nb; }
      else {
        if (!lastAmbiguous) lastAmbiguous = { a: na, b: nb };
        if (order === "dm") { d = na; m = nb; } else { m = na; d = nb; }
      }
      if (m < 1 || m > 12 || d < 1 || d > 31) return all;
      var year = yearForMd(m, d, y, yearHint);
      if (!year) return all;
      return pre + year + "-" + pad(m) + "-" + pad(d) + " ";
    });
  }

  function normalizeDateTime(raw, yearHint, order) {
    var s = toHalfWidth(raw);
    if (!s.trim()) return s;
    s = s.replace(/((?:19|20)\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/g, function (_, y, m, d) {
      return y + "-" + pad(m) + "-" + pad(d) + " ";
    });
    s = s.replace(/((?:19|20)\d{2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})(?!\d)/g, function (_, y, m, d) {
      return y + "-" + pad(m) + "-" + pad(d) + " ";
    });
    s = slashDates(s, yearHint, order);
    s = s.replace(/(^|[^\d-])(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/g, function (_, pre, m, d) {
      var year = yearForMd(Number(m), Number(d), "", yearHint);
      if (!year) return _;
      return pre + year + "-" + pad(m) + "-" + pad(d) + " ";
    });
    // 时间：带冒号的（可带 AM/PM 或 上午/下午）
    s = s.replace(/(上午|下午|早上|晚上)?\s*(\d{1,2}):(\d{2})(?!\d)\s*([AaPp]\.?[Mm]\.?)?/g, function (all, ap1, h, mi, ap2) {
      var t = fixTime(h, mi, ap2 || ap1);
      return t ? " " + t + " " : all;
    });
    // 9点 / 9点30 / 9点半 / 下午3点
    s = s.replace(/(上午|下午|早上|晚上)?\s*(\d{1,2})\s*[点點时時](?:\s*(半|\d{1,2})\s*分?)?/g, function (all, ap, h, mi) {
      var t = fixTime(h, mi === "半" ? 30 : mi, ap);
      return t ? " " + t + " " : all;
    });
    // 9am / 9 PM（前面要是空白或开头，避免吃掉日期里的数字）
    s = s.replace(/(^|\s)(\d{1,2})\s*([AaPp]\.?[Mm]\.?)(?![A-Za-z])/g, function (all, pre, h, ap) {
      var t = fixTime(h, 0, ap);
      return t ? pre + t + " " : all;
    });
    s = s.replace(/\s*~\s*/g, " ~ ").replace(/\s*\uFF5E\s*/g, " ~ ");
    s = s.replace(/(\d{4}-\d{2}-\d{2})\s*T\s*(\d{2}:\d{2})/g, "$1 $2");
    s = s.replace(/\s+/g, " ").trim();
    return s;
  }

  function isValidTime(t) {
    if (!t) return true;
    var m = /^(\d{2}):(\d{2})$/.exec(t);
    return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59;
  }

  function isValidIsoDate(iso) {
    var p = String(iso).split("-");
    if (p.length !== 3) return false;
    var y = Number(p[0]);
    var m = Number(p[1]);
    var d = Number(p[2]);
    if (!y || m < 1 || m > 12 || d < 1 || d > 31) return false;
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  function parseOneDateTime(raw) {
    var s = trim(raw);
    if (!s) return { date: "", time: "" };
    var m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/);
    if (!m || !isValidIsoDate(m[1])) return { error: true, raw: s };
    return { date: m[1], time: m[2] || "" };
  }

  function extractBalancedJson(text, start) {
    var open = text.charAt(start);
    var close = open === "[" ? "]" : "}";
    var depth = 0;
    var inStr = false;
    var esc = false;
    var i;
    for (i = start; i < text.length; i++) {
      var c = text.charAt(i);
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === open) depth += 1;
      else if (c === close) {
        depth -= 1;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  /**
   * 从备注里抽出座位和确认号。取值到空格或 ； ; ， , 、 | 为止（「票号 0000 1111 2222」整段留在备注里）。
   * 确认号还认：预订号、订单号、取票号、预订编号、booking ref、confirmation。
   */
  function parseSeatAndConfirm(remark) {
    var note = trim(remark);
    var seat = "";
    var confirmationNo = "";
    var val = "[^\\s；;，,、|]+";
    note = note.replace(new RegExp("座位\\s*[:：]?\\s*(" + val + ")", "g"), function (_, v) {
      seat = v;
      return " ";
    });
    note = note.replace(new RegExp("(?:预订编号|booking\\s*ref|confirmation(?:\\s*(?:no\\.?|number|code|#))?|确认号|预订号|订单号|取票号)\\s*[:：]?\\s*(" + val + ")", "gi"), function (_, v) {
      confirmationNo = v;
      return " ";
    });
    note = note.replace(/([；;，,、|])(?:\s*[；;，,、|])+/g, "$1");
    note = note.replace(/^[\s；;，,、|]+|[\s；;，,、|]+$/g, "");
    note = note.replace(/[ \t]+/g, " ");
    return { seat: seat, confirmationNo: confirmationNo, note: note };
  }

  /**
   * 从地址或地图链接里尽量取出 WGS-84 坐标；不做在线地理编码。
   */
  function parseCoordsFromAddress(addr) {
    var s = trim(addr);
    if (!s) return null;
    var m;
    m = s.match(/[?&#]ll=([-+\d.]+),([-+\d.]+)/i);
    if (m) return numPair(m[1], m[2]);
    m = s.match(/[?&#]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
    if (m) return numPair(m[1], m[2]);
    m = s.match(/[?&#]query=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
    if (m) return numPair(m[1], m[2]);
    m = s.match(/[?&#]destination=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
    if (m) return numPair(m[1], m[2]);
    m = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|\/|$|\s)/);
    if (m) return numPair(m[1], m[2]);
    m = s.match(/#map=\d+\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/);
    if (m) return numPair(m[1], m[2]);
    m = s.match(/geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
    if (m) return numPair(m[1], m[2]);
    /* 高德 uri：position=经度,纬度 */
    m = s.match(/[?&#]position=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
    if (m) return { lat: Number(m[2]), lng: Number(m[1]), from: "amap-link" };
    /* 纯坐标：纬度, 经度（纬度绝对值通常 <= 90） */
    m = s.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (m) return numPair(m[1], m[2]);
    return null;
  }

  function numPair(a, b) {
    var lat = Number(a);
    var lng = Number(b);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) {
      var t = lat;
      lat = lng;
      lng = t;
    }
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: lat, lng: lng };
  }

  function newId(prefix, used) {
    var n = 1;
    var id = prefix;
    while (used[id]) {
      n += 1;
      id = prefix + "-" + n;
    }
    used[id] = true;
    return id;
  }

  function slug(s, fallback) {
    var t = trim(s)
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-|-$/g, "");
    return t || fallback || "item";
  }

  function looksCjk(s) {
    return /[\u4e00-\u9fff]/.test(s);
  }

  function namesFrom(name) {
    var n = trim(name);
    if (looksCjk(n)) return { nameZh: n, nameEn: "" };
    return { nameZh: n, nameEn: n };
  }

  function cell(obj, keys) {
    var i;
    for (i = 0; i < keys.length; i++) {
      if (obj[keys[i]] != null && String(obj[keys[i]]) !== "") return obj[keys[i]];
    }
    /* 也试小写 / 去掉空格的键 */
    var map = {};
    Object.keys(obj).forEach(function (k) {
      map[trim(k).toLowerCase().replace(/\s+/g, "")] = obj[k];
    });
    for (i = 0; i < keys.length; i++) {
      var k = trim(keys[i]).toLowerCase().replace(/\s+/g, "");
      if (map[k] != null && String(map[k]) !== "") return map[k];
    }
    return "";
  }

  /** 日期时间认不出来时：不丢这一行，记下原文、标「待确认」，能认出的日期放进 dateGuess 供修改时预填。 */
  function localTodayIso() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function markPending(item, rawText, normalized, reason) {
    item.pendingDate = true;
    item.dateRaw = String(rawText == null ? "" : rawText).trim();
    var g = /(\d{4}-\d{2}-\d{2})/.exec(normalized || "");
    if (g && isValidIsoDate(g[1])) item.dateGuess = g[1];
    item.pendingReason = reason || "";
    return item;
  }

  /** 日期倒过来（退房早于入住 / 到达比出发早太多）：保留这一行，标待确认，记下两个日期给卡片显示，日期字段清空。 */
  function markReversed(item, rawText, kind, fromKey, toKey) {
    item.pendingDate = true;
    item.pendingKind = kind;
    item.dateRaw = String(rawText == null ? "" : rawText).trim();
    item.pendingFrom = item[fromKey];
    item.pendingTo = item[toKey];
    item.dateGuess = item[fromKey];
    item[fromKey] = "";
    item[toKey] = "";
    return item;
  }

  /** 火车 / 船 / 大巴：名称 = 班次号（可空），地址 = 「出发站 - 到达站」，日期时间 = 「出发 ~ 到达」（时间可只写日期） */
  function groundItemFromFields(kind, name, fields, extra, rawDateText, usedIds) {
    var label = Transport.KINDS[kind].label;
    var st = Transport.splitStations(fields.address);
    if (!st) {
      return { error: label + "的地址应为「出发站 - 到达站」，例如 " + (kind === "boat" ? "Dover - Calais" : kind === "bus" ? "Victoria Coach Station - Oxford" : "北京南 - 上海虹桥") };
    }
    /* 当天到的可以只写「2026-12-01 09:00 ~ 13:28」，也可以只写出发时间 */
    var dt = trim(fields.datetime).replace(/\uFF5E/g, "~");
    var sameDay = dt.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?\s*~\s*(\d{2}:\d{2})$/);
    if (sameDay) dt = sameDay[1] + (sameDay[2] ? " " + sameDay[2] : "") + " ~ " + sameDay[1] + " " + sameDay[3];
    else if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?$/.test(dt)) dt = dt + " ~ " + dt.slice(0, 10);
    var when = parseRangeDateTime(dt, {
      requireTimes: false,
      requiredMessage: label + "缺少日期时间",
      badMessage: label + "的日期时间应为「出发 ~ 到达」，例如 2026-12-01 09:00 ~ 2026-12-01 13:28"
    });
    var pending = !!when.error;
    if (pending) when = { startDate: "", startTime: "", endDate: "", endTime: "", reason: when.error };
    var item = {
      id: newId(slug(name || st.from, kind), usedIds),
      type: kind,
      number: name.toUpperCase(),
      fromNameZh: st.from,
      nameZh: st.to,
      departDate: when.startDate,
      departTime: when.startTime || "",
      arriveDate: when.endDate || when.startDate,
      arriveTime: when.endTime || "",
      confirmationNo: extra.confirmationNo || "",
      seat: extra.seat || "",
      note: extra.note || "",
      example: false
    };
    if (pending) markPending(item, rawDateText, fields.datetime, when.reason);
    else if (item.departDate && item.arriveDate && item.arriveDate < item.departDate) {
      /* v6：火车 / 船（大巴也一样）跟 v5.4 的机票一样，到达日期早于出发日期 → 进待补，问「日期对吗？」 */
      markReversed(item, rawDateText, "flight-reversed", "departDate", "arriveDate");
    }
    return { item: item };
  }

  function itemFromFields(fields, usedIds) {
    var rawDateText = fields ? fields.datetime : "";
    var ambiguous = null;
    if (fields && fields.datetime != null) {
      lastAmbiguous = null;
      var readA = normalizeDateTime(fields.datetime, activeYearHint, "md");
      if (lastAmbiguous) {
        ambiguous = { a: lastAmbiguous.a, b: lastAmbiguous.b, readA: readA, readB: normalizeDateTime(fields.datetime, activeYearHint, "dm") };
      }
      lastAmbiguous = null;
      fields = Object.assign({}, fields, { datetime: readA });
    }
    var made = itemFromFieldsInner(fields, usedIds, rawDateText);
    if (ambiguous && made.item) markAmbiguous(made.item, rawDateText, ambiguous);
    return made;
  }

  var DATE_KEYS = ["date", "time", "checkIn", "checkOut", "checkInTime", "checkOutTime", "departDate", "departTime", "arriveDate", "arriveTime"];
  /** 「是12月4日还是4月12日？」：两种读法都存下来（整格日期时间的标准写法），日期字段清空，进「待补」；从不替用户选 */
  function markAmbiguous(item, rawText, amb) {
    var PK = ["pendingDate", "pendingKind", "pendingFrom", "pendingTo", "pendingReason", "dateGuess", "dateRaw"];
    PK.forEach(function (k) { delete item[k]; });
    DATE_KEYS.forEach(function (k) { if (k in item) item[k] = ""; });
    item.pendingDate = true;
    item.pendingKind = "date-ambiguous";
    item.dateRaw = String(rawText == null ? "" : rawText).trim();
    item.pendingReason = ambiguousQuestion(amb.a, amb.b);
    item.pendingChoices = [
      { label: amb.a + "月" + amb.b + "日", datetime: amb.readA },
      { label: amb.b + "月" + amb.a + "日", datetime: amb.readB }
    ];
    return item;
  }
  function ambiguousQuestion(a, b) {
    return "是" + a + "月" + b + "日还是" + b + "月" + a + "日？";
  }

  /**
   * 用户点了一种读法：按这条的类型重新解析那一格，只改日期时间字段，别的（id、地点、备注…）不动；拿掉待补标记。
   * 返回新对象；读法不对（比如解析失败）就原样返回。
   */
  function applyDateChoice(item, index) {
    if (!item || item.pendingKind !== "date-ambiguous" || !item.pendingChoices || !item.pendingChoices[index]) return item;
    var dt = item.pendingChoices[index].datetime;
    var typeWord = item.type === "flight" ? "机票" : item.type === "hotel" ? "酒店" : (Transport && Transport.isGround(item)) ? Transport.KINDS[item.type].label : "地点";
    var addr = item.type === "flight" ? (item.fromAirport || "AAA") + " - " + (item.toAirport || "BBB") : (Transport && Transport.isGround(item)) ? "A - B" : "x";
    var fresh = itemFromFieldsInner({ type: typeWord, name: "x", address: addr, datetime: dt, note: "" }, {}, dt);
    if (!fresh.item || fresh.item.pendingDate && fresh.item.pendingKind !== "flight-reversed" && fresh.item.pendingKind !== "hotel-reversed") return item;
    var next = Object.assign({}, item);
    ["pendingDate", "pendingKind", "pendingFrom", "pendingTo", "pendingReason", "dateGuess", "dateRaw", "pendingChoices"].forEach(function (k) { delete next[k]; });
    DATE_KEYS.forEach(function (k) {
      if (k in fresh.item) next[k] = fresh.item[k];
    });
    if (fresh.item.pendingDate) {
      ["pendingDate", "pendingKind", "pendingFrom", "pendingTo", "dateGuess", "dateRaw"].forEach(function (k) {
        if (k in fresh.item) next[k] = fresh.item[k];
      });
    }
    if (next.type === "place" && !next.date) delete next.date;
    return next;
  }

  function itemFromFieldsInner(fields, usedIds, rawDateText) {
    var typeInfo = parseType(fields.type);
    if (typeInfo.error) return { error: typeInfo.error };
    var name = trim(fields.name);
    var ground = !!(Transport && Transport.isGround(typeInfo.kind));
    if (!name && !ground) return { error: "缺少名称" };
    var extra = parseSeatAndConfirm(fields.note);
    if (fields.confirmation) extra.confirmationNo = trim(fields.confirmation);
    if (fields.seat) extra.seat = trim(fields.seat);
    if (ground) return groundItemFromFields(typeInfo.kind, name, fields, extra, rawDateText, usedIds);
    var coords = parseCoordsFromAddress(fields.map_url || fields.address);
    var item;

    if (typeInfo.kind === "flight") {
      var air = parseIataPair(fields.address);
      if (air.error) return { error: air.error };
      var when = parseRangeDateTime(fields.datetime, {
        requireTimes: true,
        requiredMessage: "机票缺少日期时间",
        badMessage: "机票的日期时间应为「出发当地时间 ~ 到达当地时间」，例如 2026-12-01 09:30 ~ 2026-12-02 07:00"
      });
      var flightPending = !!when.error;
      if (flightPending) when = { startDate: "", startTime: "", endDate: "", endTime: "", reason: when.error };
      item = {
        id: newId(slug(name, "flight"), usedIds),
        type: "flight",
        nameZh: air.toAirport,
        nameEn: air.toAirport,
        fromNameZh: air.fromAirport,
        fromNameEn: air.fromAirport,
        flightNo: name.toUpperCase(),
        fromAirport: air.fromAirport,
        toAirport: air.toAirport,
        departDate: when.startDate,
        departTime: when.startTime,
        arriveDate: when.endDate,
        arriveTime: when.endTime,
        confirmationNo: extra.confirmationNo || "",
        seat: extra.seat || "",
        note: extra.note || "",
        example: false
      };
      if (flightPending) markPending(item, rawDateText, fields.datetime, when.reason);
      else if (item.departDate && item.arriveDate && item.arriveDate < item.departDate) {
        /* v5.4：落地日期早于起飞日期，不默默收下，标待确认让用户点「对的」或「改日期」 */
        markReversed(item, rawDateText, "flight-reversed", "departDate", "arriveDate");
      }
    } else if (typeInfo.kind === "hotel") {
      var stay = parseRangeDateTime(fields.datetime, {
        requireTimes: false,
        requiredMessage: "酒店缺少入住与退房日期",
        badMessage: "酒店的日期时间应为「入住日期 ~ 退房日期」，例如 2026-12-04 ~ 2026-12-07"
      });
      var stayPending = stay.error ? stay.error : "";
      if (stayPending) stay = { startDate: "", endDate: "", startTime: "", endTime: "" };
      var hn = namesFrom(name);
      item = {
        id: newId(slug(name, "hotel"), usedIds),
        type: "hotel",
        nameZh: hn.nameZh,
        nameEn: hn.nameEn,
        address: trim(fields.address),
        checkIn: stay.startDate,
        checkOut: stay.endDate,
        checkInTime: stay.startTime || "",
        checkOutTime: stay.endTime || "",
        confirmationNo: extra.confirmationNo || "",
        note: extra.note || "",
        example: false
      };
      if (stayPending) {
        /* v6：类型写「酒店」就存成酒店，导入时不弹日期框；缺日期 → 进「待补」，先按今天预填，批量导入不打断 */
        markPending(item, rawDateText, fields.datetime, stayPending);
        if (!item.dateGuess) item.dateGuess = localTodayIso();
      }
      else if (item.checkOut && item.checkIn && item.checkOut < item.checkIn) {
        markReversed(item, rawDateText, "hotel-reversed", "checkIn", "checkOut");
      }
    } else {
      var whenP = parsePlaceDateTime(fields.datetime);
      var placePending = whenP.error || "";
      if (placePending) whenP = { date: "", time: "" };
      var pn = namesFrom(name);
      item = {
        id: newId(slug(name, "place"), usedIds),
        type: "place",
        subtype: typeInfo.subtype || "",
        nameZh: pn.nameZh,
        nameEn: pn.nameEn,
        address: trim(fields.address),
        date: whenP.date,
        time: whenP.time,
        note: trim(fields.note),
        example: false
      };
      if (placePending) markPending(item, rawDateText, fields.datetime, placePending);
      /* v6：「地点/甜品」（旧名）、「地点/咖啡甜点酒吧」→ 咖啡甜点酒吧图标，子类统一写新名字 */
      var IconsRef = iconsRef();
      if (IconsRef && IconsRef.categoryFromWord && IconsRef.categoryFromWord(item.subtype) === "dessert") {
        item.subtype = IconsRef.CAFE_LABEL || "咖啡甜点酒吧";
        item.icon = "dessert";
      }
    }

    if (fields.map_url) item.map_url = trim(fields.map_url);
    if (coords) {
      item.lat = coords.lat;
      item.lng = coords.lng;
    }
    return { item: item };
  }

  function parsePipe(text) {
    if (!hintLocked) activeYearHint = findYearHint(text);
    var lines = normalizeImportText(text).split(/\r\n|\n|\r/);
    var usedIds = {};
    var items = [];
    var errors = [];
    var notes = [];
    /* v5.2：AI 常在行程前后加解释文字。只要认出了行，这些解释行就安静跳过，不再逐行提示。 */
    var skippedProse = [];
    var i;
    for (i = 0; i < lines.length; i++) {
      var lineNo = i + 1;
      var raw = tidyPipeLine(lines[i]);
      if (!raw) continue;
      if (/^#/.test(raw)) continue;
      if (isTableRule(raw)) continue;
      var cols = splitPipeLine(raw);
      if (isHeaderRow(cols)) continue;
      if (cols.length !== 5) {
        if (!/[|｜]/.test(raw) || !ROW_TYPE_RE.test(cols[0])) {
          skippedProse.push("第 " + lineNo + " 行不像行程条目，已跳过。");
        } else {
          errors.push("第 " + lineNo + " 行：列数不是 5 列（分割后得到 " + cols.length + " 列）。应为「类型 | 名称 | 地址 | 日期时间 | 备注」，空单元格也请保留竖线。");
        }
        continue;
      }
      var result = itemFromFields(
        { type: cols[0], name: cols[1], address: cols[2], datetime: cols[3], note: cols[4] },
        usedIds
      );
      if (result.error) {
        errors.push("第 " + lineNo + " 行：" + result.error);
      } else {
        items.push(stripImportedLegRole(result.item));
      }
    }
    if (!items.length) notes = skippedProse.concat(notes);
    else if (skippedProse.length) notes = ["AI 回复里的 " + skippedProse.length + " 行说明文字已跳过。"].concat(notes);
    return { items: items, errors: errors, notes: notes, format: "pipe" };
  }

  function extractJsonRecords(data) {
    if (Array.isArray(data)) return { records: data, tripName: "" };
    if (data && Array.isArray(data.items)) {
      return { records: data.items, tripName: data.nameZh || data.name || data.名称 || "" };
    }
    if (data && Array.isArray(data.行程)) {
      return { records: data.行程, tripName: data.nameZh || data.名称 || "" };
    }
    if (data && Array.isArray(data.entries)) {
      return { records: data.entries, tripName: data.nameZh || data.name || "" };
    }
    if (data && typeof data === "object" && (cell(data, ["类型", "type"]) || cell(data, ["名称", "name"]))) {
      return { records: [data], tripName: "" };
    }
    return { error: "JSON 应为对象数组，或带 items / 行程 数组的对象。" };
  }

  /* 粘贴导入不写入手动航段角色；完整备份走 backup.js，会原样保留。 */
  function stripImportedLegRole(item) {
    if (item) delete item.legRole;
    return item;
  }

  function recordToFields(rec, indexLabel) {

    if (!rec || typeof rec !== "object" || Array.isArray(rec)) {
      return { error: indexLabel + "：不是一个对象" };
    }
    /* 已规范化的内部条目 */
    if ((rec.type === "flight" || rec.type === "hotel" || rec.type === "place" || (Transport && Transport.isGround(rec.type) && rec.departDate)) && (rec.nameZh || rec.departDate || rec.checkIn)) {
      return { internal: rec };
    }
    var typ = cell(rec, ["类型", "type", "kind"]);
    var typInfo = typ ? typ : "";
    var typLower = String(typInfo).toLowerCase();

    /* 约定的英文 JSON：flight / hotel / place */
    if (typLower === "flight" || typ === "机票" || typ === "航班") {
      var dep = cell(rec, ["depart", "departure", "departAt"]);
      var arr = cell(rec, ["arrive", "arrival", "arriveAt"]);
      var datetime = dep && arr ? trim(dep) + " ~ " + trim(arr) : cell(rec, ["日期时间", "datetime", "dateTime"]);
      var frm = cell(rec, ["from"]);
      var to = cell(rec, ["to"]);
      var address = frm && to ? trim(frm) + " - " + trim(to) : cell(rec, ["地址", "address"]);
      return {
        fields: {
          type: typ || "flight",
          name: cell(rec, ["flight_no", "flightNo", "航班号", "名称", "name"]),
          address: address,
          datetime: datetime,
          note: cell(rec, ["备注", "note", "remark"]),
          confirmation: cell(rec, ["confirmation", "confirmationNo", "确认号"]),
          seat: cell(rec, ["seat", "座位"])
        }
      };
    }
    if (Transport && Transport.groundKindFromWord(typ)) {
      var gdep = cell(rec, ["depart", "departure", "departAt"]);
      var garr = cell(rec, ["arrive", "arrival", "arriveAt"]);
      var gfrom = cell(rec, ["from"]);
      var gto = cell(rec, ["to"]);
      return {
        fields: {
          type: typ,
          name: cell(rec, ["number", "train_no", "trainNo", "车次", "班次", "名称", "name"]),
          address: gfrom && gto ? trim(gfrom) + " - " + trim(gto) : cell(rec, ["地址", "address"]),
          datetime: gdep ? trim(gdep) + (garr ? " ~ " + trim(garr) : "") : cell(rec, ["日期时间", "datetime", "dateTime"]),
          note: cell(rec, ["备注", "note", "remark"]),
          confirmation: cell(rec, ["confirmation", "confirmationNo", "确认号"]),
          seat: cell(rec, ["seat", "座位"])
        }
      };
    }
    if (typLower === "hotel" || typ === "酒店") {
      var cin = cell(rec, ["check_in", "checkIn"]);
      var cout = cell(rec, ["check_out", "checkOut"]);
      var stay = cin && cout ? trim(cin) + " ~ " + trim(cout) : cell(rec, ["日期时间", "datetime", "dateTime"]);
      return {
        fields: {
          type: typ || "hotel",
          name: cell(rec, ["名称", "name", "title"]),
          address: cell(rec, ["地址", "address"]),
          datetime: stay,
          note: cell(rec, ["备注", "note", "remark"]),
          confirmation: cell(rec, ["confirmation", "confirmationNo", "确认号"]),
          map_url: cell(rec, ["map_url", "mapUrl"])
        }
      };
    }
    if (typLower === "place" || typ.indexOf("地点") === 0) {
      var subtype = rec.subtype || rec.亚类 || "";
      var typeLabel = typ;
      if (typLower === "place" && subtype) typeLabel = "地点/" + subtype;
      return {
        fields: {
          type: typeLabel || "place",
          name: cell(rec, ["名称", "name", "title"]),
          address: cell(rec, ["地址", "address"]),
          datetime: cell(rec, ["日期时间", "datetime", "dateTime", "date"]),
          note: cell(rec, ["备注", "note", "remark"]),
          map_url: cell(rec, ["map_url", "mapUrl"])
        }
      };
    }
    return {
      fields: {
        type: typ,
        name: cell(rec, ["名称", "name", "title", "flightNo", "flight_no", "航班号"]),
        address: cell(rec, ["地址", "address"]),
        datetime: cell(rec, ["日期时间", "datetime", "dateTime", "date"]),
        note: cell(rec, ["备注", "note", "remark"]),
        confirmation: cell(rec, ["confirmation", "confirmationNo", "确认号"]),
        seat: cell(rec, ["seat", "座位"]),
        map_url: cell(rec, ["map_url", "mapUrl"])
      }
    };
  }

  function parseJson(text) {
    if (!hintLocked) activeYearHint = findYearHint(text);
    var data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      return {
        items: [],
        errors: ["JSON 无法解析：" + (err && err.message ? err.message : String(err))],
        format: "json"
      };
    }
    var extracted = extractJsonRecords(data);
    if (extracted.error) {
      return { items: [], errors: [extracted.error], format: "json", tripName: "" };
    }
    var usedIds = {};
    var items = [];
    var errors = [];
    extracted.records.forEach(function (rec, idx) {
      var label = "第 " + (idx + 1) + " 条";
      var mapped = recordToFields(rec, label);
      if (mapped.error) {
        errors.push(mapped.error);
        return;
      }
      if (mapped.internal) {
        var copy = Object.assign({}, mapped.internal);
        copy.id = newId(copy.id || slug(copy.nameZh || copy.flightNo || "item", "item"), usedIds);
        items.push(stripImportedLegRole(copy));
        return;
      }
      var result = itemFromFields(mapped.fields, usedIds);
      if (result.error) errors.push(label + "：" + result.error);
      else items.push(stripImportedLegRole(result.item));
    });
    return { items: items, errors: errors, format: "json", tripName: extracted.tripName || "" };
  }

  function parseJsonData(data, usedIds) {
    var extracted = extractJsonRecords(data);
    if (extracted.error) return { items: [], errors: [extracted.error], tripName: "" };
    usedIds = usedIds || {};
    var items = [];
    var errors = [];
    extracted.records.forEach(function (rec, idx) {
      var label = "第 " + (idx + 1) + " 条";
      var mapped = recordToFields(rec, label);
      if (mapped.error) {
        errors.push(mapped.error);
        return;
      }
      if (mapped.internal) {
        var copy = Object.assign({}, mapped.internal);
        copy.id = newId(copy.id || slug(copy.nameZh || copy.flightNo || "item", "item"), usedIds);
        items.push(stripImportedLegRole(copy));
        return;
      }
      var result = itemFromFields(mapped.fields, usedIds);
      if (result.error) errors.push(label + "：" + result.error);
      else items.push(stripImportedLegRole(result.item));
    });
    return { items: items, errors: errors, tripName: extracted.tripName || "" };
  }

  function parseImport(text, opts) {
    opts = opts || {};
    var raw = normalizeImportText(String(text == null ? "" : text));
    activeToday = opts.today && /^\d{4}-\d{2}-\d{2}$/.test(opts.today) ? opts.today : localTodayIso();
    var fromText = findYearHint(raw);
    var fromTrip = opts.yearHint || yearFromItems(opts.items);
    activeYearHint = fromText || fromTrip || "";
    hintLocked = true;
    try {
      return parseImportInner(raw);
    } finally {
      hintLocked = false;
    }
  }

  function parseImportInner(raw) {
    if (!trim(raw)) {
      return { items: [], errors: ["没有可导入的内容。请粘贴管道格式或 JSON。"], notes: [], format: "" };
    }
    if (looksLikeJson(raw)) return parseJson(raw);

    /* 同一框里既有管道行又有 JSON 时：抽出可解析的 JSON 块，其余按管道处理 */
    var jsonBlocks = [];
    var mask = raw.split("");
    var i = 0;
    while (i < raw.length) {
      var ch = raw.charAt(i);
      if (ch === "[" || ch === "{") {
        var block = extractBalancedJson(raw, i);
        if (block) {
          try {
            jsonBlocks.push(JSON.parse(block));
            var k;
            for (k = 0; k < block.length; k++) mask[i + k] = " ";
            i += block.length;
            continue;
          } catch (err) {
            /* 不是完整 JSON，继续扫描 */
          }
        }
      }
      i += 1;
    }
    var rest = mask.join("");
    var usedIds = {};
    var items = [];
    var errors = [];
    var notes = [];
    var formats = [];
    var tripName = "";
    if (trim(rest)) {
      var pipe = parsePipe(rest);
      pipe.items.forEach(function (it) {
        it.id = newId(it.id || "item", usedIds);
        items.push(stripImportedLegRole(it));
      });
      errors = errors.concat(pipe.errors || []);
      notes = notes.concat(pipe.notes || []);
      if (pipe.items.length || (pipe.errors && pipe.errors.length) || (pipe.notes && pipe.notes.length)) formats.push("pipe");
    }
    jsonBlocks.forEach(function (data, idx) {
      var one = parseJsonData(data, usedIds);
      items = items.concat(one.items);
      errors = errors.concat(
        (one.errors || []).map(function (e) {
          return jsonBlocks.length > 1 ? "JSON " + (idx + 1) + " · " + e : e;
        })
      );
      if (one.tripName) tripName = one.tripName;
      formats.push("json");
    });
    var format = formats.indexOf("json") !== -1 && formats.indexOf("pipe") !== -1 ? "mixed" : formats[0] || "pipe";
    return { items: items, errors: errors, notes: notes, format: format, tripName: tripName };
  }

  function tripFromImport(result, fallbackName) {
    var name = result.tripName || fallbackName || "导入的行程";
    return {
      id: "imported-" + Date.now(),
      nameZh: name,
      nameEn: "",
      example: false,
      imported: true,
      items: result.items.slice(),
      legs: []
    };
  }

  var api = {
    HEADER: HEADER,
    looksLikeJson: looksLikeJson,
    normalizeImportText: normalizeImportText,
    normalizeDateTime: normalizeDateTime,
    applyDateChoice: applyDateChoice,
    ambiguousQuestion: ambiguousQuestion,
    findYearHint: findYearHint,
    yearFromItems: yearFromItems,
    nearestYear: nearestYear,
    splitPipeLine: splitPipeLine,
    parseCoordsFromAddress: parseCoordsFromAddress,
    parseSeatAndConfirm: parseSeatAndConfirm,
    parseImport: parseImport,
    parsePipe: parsePipe,
    parseJson: parseJson,
    tripFromImport: tripFromImport
  };

  root.ImportUtil = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
