/**
 * v6：交通类条目（机票 + 火车 / 船 / 大巴）的公共规则，只放常量和纯函数，别的文件都从这里取。
 * 火车 / 船 / 大巴照着机票的存法：
 *   { type: "train"|"boat"|"bus", number, fromNameZh, nameZh(到达站), fromLat?, fromLng?, lat?, lng?,
 *     departDate, departTime, arriveDate, arriveTime, note?, confirmationNo?, seat? }
 * 机票的班次号仍存在 flightNo（老数据不动）。车站搜不到坐标时只保留名字：地图上不画这一段，也不进「待补」。
 */
(function (root) {
  "use strict";

  var KINDS = {
    flight: { label: "机票", noun: "航班", icon: "flight", numberLabel: "航班号", fromFallback: "出发机场", toFallback: "到达机场" },
    train: { label: "火车", noun: "火车", icon: "train", numberLabel: "车次", fromFallback: "出发站", toFallback: "到达站" },
    boat: { label: "船", noun: "船", icon: "boat", numberLabel: "班次", fromFallback: "出发码头", toFallback: "到达码头" },
    bus: { label: "大巴", noun: "大巴", icon: "bus", numberLabel: "班次", fromFallback: "上车站", toFallback: "下车站" }
  };
  var GROUND = ["train", "boat", "bus"];

  /* 导入时认的类型写法（第一列）。顺序要紧：先长后短。 */
  var TYPE_WORDS = [
    [/^(火车票|车票|火车|高铁|动车|列车|城际|铁路|train|rail)$/i, "train"],
    [/^(船票|船|轮渡|渡轮|渡船|邮轮|游船|客船|ferry|boat|ship)$/i, "boat"],
    [/^(大巴票|汽车票|大巴|巴士|长途汽车|长途车|汽车|客车|机场大巴|bus|coach)$/i, "bus"]
  ];

  function typeOf(item) {
    return item && typeof item === "object" ? String(item.type || "") : String(item || "");
  }
  function isTransit(item) {
    return Object.prototype.hasOwnProperty.call(KINDS, typeOf(item));
  }
  function isGround(item) {
    return GROUND.indexOf(typeOf(item)) !== -1;
  }
  /** v6.0：有固定时间、不能长按拖动的（机票、火车、船、大巴） */
  var FIXED_TIME = ["flight", "train", "boat", "bus"];
  function isFixedTime(item) {
    return FIXED_TIME.indexOf(typeOf(item)) !== -1;
  }
  function kind(item) {
    return KINDS[typeOf(item)] || null;
  }
  function number(item) {
    if (!item) return "";
    return String((item.type === "flight" ? item.flightNo : item.number) || "").trim();
  }
  /** 卡片标题：班次号，没有就写「火车」「船」「大巴」 */
  function title(item) {
    var k = kind(item);
    return number(item) || (k ? k.noun : "");
  }
  /** 导入第一列（「/」前面那段）→ "train" / "boat" / "bus"；不认识返回 "" */
  function groundKindFromWord(word) {
    var w = String(word || "").trim();
    var i;
    for (i = 0; i < TYPE_WORDS.length; i++) {
      if (TYPE_WORDS[i][0].test(w)) return TYPE_WORDS[i][1];
    }
    return "";
  }
  /**
   * 地址列「出发站 - 到达站」→ { from, to }。分隔符：两边带空格的 - – —，或 → ->、～ ~（不拆名字里不带空格的连字符）。
   */
  function splitStations(text) {
    var s = String(text || "").replace(/\s+/g, " ").trim();
    if (!s) return null;
    var parts = s.split(/\s+[-–—]+\s+|\s*(?:→|->|⇒|～|~)\s*/);
    if (parts.length !== 2) return null;
    var from = parts[0].trim();
    var to = parts[1].trim();
    if (!from || !to) return null;
    return { from: from, to: to };
  }
  function routeText(item) {
    var k = kind(item) || KINDS.train;
    return (item.fromNameZh || k.fromFallback) + " → " + (item.nameZh || k.toFallback);
  }

  var api = {
    KINDS: KINDS,
    GROUND: GROUND,
    isTransit: isTransit,
    isGround: isGround,
    isFixedTime: isFixedTime,
    FIXED_TIME: FIXED_TIME,
    kind: kind,
    number: number,
    title: title,
    groundKindFromWord: groundKindFromWord,
    splitStations: splitStations,
    routeText: routeText
  };
  root.Transport = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
