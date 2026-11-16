/**
 * 行程导入：同一输入框自动识别 JSON 或管道分隔文本。
 * 推荐管道格式（5 列）：类型 | 名称 | 地址 | 日期时间 | 备注
 * 详见 导入格式说明.txt
 */
(function (root) {
  "use strict";

  var HEADER = ["类型", "名称", "地址", "日期时间", "备注"];
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
    return trim(line);
  }

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
    var kind = TYPE_ALIASES[base.toLowerCase()] || TYPE_ALIASES[base];
    if (!kind) return { error: "无法识别的类型「" + s + "」，应为 机票、酒店 或 地点（地点可带「地点/餐厅」等子类）" };
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
  function normalizeDateTime(raw, yearHint) {
    var s = toHalfWidth(raw);
    if (!s.trim()) return s;
    s = s.replace(/((?:19|20)\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/g, function (_, y, m, d) {
      return y + "-" + pad(m) + "-" + pad(d) + " ";
    });
    s = s.replace(/((?:19|20)\d{2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})(?!\d)/g, function (_, y, m, d) {
      return y + "-" + pad(m) + "-" + pad(d) + " ";
    });
    if (yearHint) {
      s = s.replace(/(^|[^\d-])(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/g, function (_, pre, m, d) {
        return pre + yearHint + "-" + pad(m) + "-" + pad(d) + " ";
      });
    }
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

  function parseSeatAndConfirm(remark) {
    var note = trim(remark);
    var seat = "";
    var confirmationNo = "";
    note = note.replace(/座位\s*[:：]?\s*(\S+)/g, function (_, v) {
      seat = v;
      return " ";
    });
    note = note.replace(/确认号\s*[:：]?\s*(\S+)/g, function (_, v) {
      confirmationNo = v;
      return " ";
    });
    note = note.replace(/\s+/g, " ");
    note = trim(note);
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
  function markPending(item, rawText, normalized, reason) {
    item.pendingDate = true;
    item.dateRaw = String(rawText == null ? "" : rawText).trim();
    var g = /(\d{4}-\d{2}-\d{2})/.exec(normalized || "");
    if (g && isValidIsoDate(g[1])) item.dateGuess = g[1];
    item.pendingReason = reason || "";
    return item;
  }

  function itemFromFields(fields, usedIds) {
    var rawDateText = fields ? fields.datetime : "";
    if (fields && fields.datetime != null) {
      fields = Object.assign({}, fields, { datetime: normalizeDateTime(fields.datetime, activeYearHint) });
    }
    var typeInfo = parseType(fields.type);
    if (typeInfo.error) return { error: typeInfo.error };
    var name = trim(fields.name);
    if (!name) return { error: "缺少名称" };
    var extra = parseSeatAndConfirm(fields.note);
    if (fields.confirmation) extra.confirmationNo = trim(fields.confirmation);
    if (fields.seat) extra.seat = trim(fields.seat);
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
      if (stayPending) markPending(item, rawDateText, fields.datetime, stayPending);
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
    var i;
    for (i = 0; i < lines.length; i++) {
      var lineNo = i + 1;
      var raw = tidyPipeLine(lines[i]);
      if (!raw) continue;
      if (/^#/.test(raw)) continue;
      var cols = splitPipeLine(raw);
      if (isHeaderRow(cols)) continue;
      if (cols.length !== 5) {
        if (!/[|｜]/.test(raw)) {
          notes.push("第 " + lineNo + " 行不像行程条目，已跳过。");
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
        items.push(result.item);
      }
    }
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

  function recordToFields(rec, indexLabel) {
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) {
      return { error: indexLabel + "：不是一个对象" };
    }
    /* 已规范化的内部条目 */
    if ((rec.type === "flight" || rec.type === "hotel" || rec.type === "place") && (rec.nameZh || rec.departDate || rec.checkIn)) {
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
        items.push(copy);
        return;
      }
      var result = itemFromFields(mapped.fields, usedIds);
      if (result.error) errors.push(label + "：" + result.error);
      else items.push(result.item);
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
        items.push(copy);
        return;
      }
      var result = itemFromFields(mapped.fields, usedIds);
      if (result.error) errors.push(label + "：" + result.error);
      else items.push(result.item);
    });
    return { items: items, errors: errors, tripName: extracted.tripName || "" };
  }

  function parseImport(text) {
    var raw = normalizeImportText(String(text == null ? "" : text));
    activeYearHint = findYearHint(raw);
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
        items.push(it);
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
    findYearHint: findYearHint,
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
