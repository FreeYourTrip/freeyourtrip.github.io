/**
 * 统一线性图标（outline/stroke SVG）。
 * 全部 24×24、stroke-width 2、round 端点和拐角；界面里不用系统 emoji。
 */
(function (root) {
  "use strict";

  var ATTR =
    'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';

  function svg(inner) {
    return "<svg " + ATTR + ">" + inner + "</svg>";
  }

  var PATHS = {
    flight:
      '<path d="M3 16.5l7.2-2.1L13 6.2l2.2.7-1.2 6.3L21 15v2.1l-7.4.3L10.2 22H8.2l2-5.2L3 18.4z"/>',
    /* v6：船（火车、大巴用下面原有的 train / bus） */
    boat:
      '<path d="M3 15l2.2 4.2a2 2 0 0 0 1.8 1.1h10a2 2 0 0 0 1.8-1.1L21 15z"/><path d="M5 15V10h14v5"/><path d="M12 10V4"/><path d="M12 5l4 2.5-4 1"/>',
    hotel:
      '<path d="M3 19V10a2 2 0 0 1 2-2h5a3 3 0 0 1 6 0h3a2 2 0 0 1 2 2v9"/><path d="M3 19h18"/><path d="M3 15h18"/><path d="M3 19v2M21 19v2"/>',
    restaurant:
      '<path d="M7 3v8a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3"/><path d="M9 13v8"/><path d="M5 3v5"/><path d="M13 3v5"/><path d="M17 3c2.8 3.2 2.8 7.5 0 11v7"/><path d="M17 14h0"/>',
    attraction:
      '<path d="M4 21h16"/><path d="M6 21V10l6-5 6 5v11"/><path d="M10 21v-5h4v5"/><path d="M12 5v2.5"/>',
    street:
      '<path d="M12 3v18"/><path d="M12 5h8l-2 2.5L20 10H12"/><path d="M12 12H5l2 2.5L5 17h7"/>',
    place:
      '<path d="M4 21h16"/><path d="M6 21V10l6-5 6 5v11"/><path d="M10 21v-5h4v5"/>',
    transfer:
      '<circle cx="5" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/><path d="M8 12h5.2"/><path d="M11.5 9l3.5 3-3.5 3"/>',
    locate:
      '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
    plus:
      '<path d="M12 5v14M5 12h14"/>',
    list:
      '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
    map:
      '<path d="M9 4L4 6.2v13.6L9 18l6 2 5-2.2V4.2L15 6.2z"/><path d="M9 4v14M15 6.2V20"/>',
    gear:
      '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.3.6.9 1 1.51 1H21a2 2 0 1 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15z"/>',
    bus:
      '<rect x="4" y="4" width="16" height="12" rx="2"/><path d="M4 12h16"/><path d="M7 16v2.5M17 16v2.5"/><path d="M8 8h.01M12 8h.01"/>',
    chevron:
      '<path d="M6 9l6 6 6-6"/>',
    close:
      '<path d="M6 6l12 12M18 6L6 18"/>',
    share:
      '<circle cx="18" cy="5.5" r="2.2"/><circle cx="6" cy="12" r="2.2"/><circle cx="18" cy="18.5" r="2.2"/><path d="M8.2 13.1l7.5 3.9M15.6 6.9l-7.4 3.8"/>',
    import:
      '<path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19h14"/>',
    backup:
      '<rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 4.2V6h6V4.2"/><path d="M9 11h6M9 15h4"/>',
    trash:
      '<path d="M5 8h14"/><path d="M9 8V6h6v2"/><path d="M7 8l.8 12h8.4L17 8"/>',
    copy:
      '<rect x="8" y="8" width="12" height="14" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2"/>',
    pencil:
      '<path d="M4 20h4L20 8l-4-4L4 16v4z"/><path d="M13 7l4 4"/>',
    calendar:
      '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    device:
      '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 18h.01"/>',
    lock:
      '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    refresh:
      '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20.5V16h-4.5"/>',
    heart:
      '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    help:
      '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.8.4-1.4 1-1.4 1.9V14"/><path d="M12 17h.01"/>',
    /* v5.2 自选图标：同一颜色组里的图标形状各不相同 */
    nature:
      '<path d="M3 20l6-10 4 6 2-3 6 7z"/><circle cx="17" cy="6" r="2"/>',
    /* v6：「咖啡甜点酒吧」（内部 id 仍叫 dessert，老地点自动跟着变）：冒热气的杯子，替换原来的冰淇淋 */
    dessert:
      '<path d="M5 11h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 12h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5c-.8 1 .8 2 0 3M11 3.5c-.8 1 .8 2 0 3M14 3.5c-.8 1 .8 2 0 3"/>',
    shop:
      '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    train:
      '<rect x="6" y="3" width="12" height="14" rx="3"/><path d="M6 11h12"/><path d="M9 14h.01M15 14h.01"/><path d="M8 21l2-4M16 21l-2-4"/>',
    pin:
      '<path d="M12 21s6-5.6 6-10.3A6 6 0 0 0 6 10.7C6 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.2"/>'
  };

  /* v5.2 颜色只在这里配一次（IT老板 定稿，按组锁定）：
     景点、自然 绿；餐厅、咖啡甜点酒吧 橙；购物 粉；酒店 紫；交通 石板灰；其他 炭黑图标 + 沙色底 */
  var PALETTE = {
    green: { color: "#27AE60", tint: "#E3F7EA" },
    orange: { color: "#F2994A", tint: "#FDEDD9" },
    pink: { color: "#E26D9B", tint: "#FBE6EE" },
    purple: { color: "#8E5CF7", tint: "#F1E9FE" },
    slate: { color: "#6B7A8F", tint: "#E8ECF0" },
    charcoal: { color: "#2B2B2B", tint: "#EEE7DA" }
  };

  /* v6：这一类的名字只在这里写一次（暂定「咖啡甜点酒吧」，可能换成「咖啡酒吧」「歇脚」「喝一杯」，改这一行即可） */
  var CAFE_LABEL = "咖啡甜点酒吧";

  /* 图标选择器：4×2，顺序即显示顺序；标签都是两个字 */
  var CATEGORIES = [
    { key: "sight", label: "景点", icon: "attraction", group: "green" },
    { key: "nature", label: "自然", icon: "nature", group: "green" },
    { key: "food", label: "餐厅", icon: "restaurant", group: "orange" },
    { key: "dessert", label: CAFE_LABEL, icon: "dessert", group: "orange" },
    { key: "shop", label: "购物", icon: "shop", group: "pink" },
    { key: "hotel", label: "酒店", icon: "hotel", group: "purple" },
    { key: "transport", label: "交通", icon: "train", group: "slate" },
    { key: "other", label: "其他", icon: "pin", group: "charcoal" }
  ];

  /* v6：「手动填写」里的图标（可不选）不再放「酒店」「交通」（类型里已经能选），3×2。
     老地点用着酒店 / 交通图标照样显示（categoryMeta 仍认识它们）。 */
  var MANUAL_PICKER_KEYS = ["sight", "nature", "food", "dessert", "shop", "other"];

  /** v6：导入「地点/甜品」（旧名）或「地点/咖啡甜点酒吧」都归到这一类 */
  var CATEGORY_ALIASES = { "甜品": "dessert", "咖啡甜点酒吧": "dessert" };
  CATEGORY_ALIASES[CAFE_LABEL] = "dessert";
  function categoryFromWord(word) {
    var w = String(word || "").trim();
    return Object.prototype.hasOwnProperty.call(CATEGORY_ALIASES, w) ? CATEGORY_ALIASES[w] : "";
  }

  function categoryMeta(key) {
    for (var i = 0; i < CATEGORIES.length; i++) {
      var c = CATEGORIES[i];
      if (c.key === key) {
        var p = PALETTE[c.group];
        return { icon: c.icon, color: p.color, tint: p.tint, label: c.label, category: c.key };
      }
    }
    return null;
  }

  function fromPalette(icon, group, label) {
    return { icon: icon, color: PALETTE[group].color, tint: PALETTE[group].tint, label: label };
  }

  /* 没自选图标时，按类型给默认图标；颜色同样取自 PALETTE */
  var TYPE_META = {
    flight: fromPalette("flight", "slate", "机票"),
    train: fromPalette("train", "slate", "火车"),
    boat: fromPalette("boat", "slate", "船"),
    bus: fromPalette("bus", "slate", "大巴"),
    hotel: fromPalette("hotel", "purple", "酒店"),
    restaurant: fromPalette("restaurant", "orange", "餐厅"),
    attraction: fromPalette("attraction", "green", "景点"),
    street: fromPalette("street", "slate", "街道"),
    place: fromPalette("attraction", "green", "地点")
  };

  function normalizeSubtype(s) {
    return String(s || "").toLowerCase();
  }

  function typeKind(item) {
    if (!item) return "place";
    var t = String(item.type || "").toLowerCase();
    if (t === "flight" || t === "机票") return "flight";
    if (t === "train" || t === "火车") return "train";
    if (t === "boat" || t === "船") return "boat";
    if (t === "bus" || t === "大巴") return "bus";
    if (t === "hotel" || t === "酒店") return "hotel";
    if (t === "restaurant" || t === "餐厅") return "restaurant";
    if (t === "attraction" || t === "景点") return "attraction";
    if (t === "street" || t === "街道") return "street";
    var s = normalizeSubtype(item.subtype || item.subType || item.kind || "");
    if (/餐厅|餐馆|饭店|美食|restaurant|food|cafe|咖啡|dining/.test(s)) return "restaurant";
    if (/街道|马路|street|road|大街|步行街/.test(s)) return "street";
    if (/景点|博物馆|公园|attraction|museum|landmark|scenic|gallery/.test(s)) return "attraction";
    return "place";
  }

  function typeMeta(itemOrKind) {
    if (itemOrKind && typeof itemOrKind === "object" && itemOrKind.icon && ["flight", "train", "boat", "bus"].indexOf(itemOrKind.type) === -1) {
      var picked = categoryMeta(itemOrKind.icon);
      if (picked) return picked;
    }
    var kind = typeof itemOrKind === "string" ? itemOrKind : typeKind(itemOrKind);
    return TYPE_META[kind] || TYPE_META.place;
  }

  function typeIcon(itemOrKind) {
    return typeMeta(itemOrKind).icon;
  }

  function html(name, cls) {
    var inner = PATHS[name];
    if (!inner) return "";
    var extra = cls ? " " + cls : "";
    return (
      '<span class="ico ico-' +
      name +
      extra +
      '" aria-hidden="true">' +
      svg(inner) +
      "</span>"
    );
  }

  var api = {
    html: html,
    typeIcon: typeIcon,
    typeKind: typeKind,
    typeMeta: typeMeta,
    TYPE_META: TYPE_META,
    PALETTE: PALETTE,
    CATEGORIES: CATEGORIES,
    MANUAL_PICKER_KEYS: MANUAL_PICKER_KEYS,
    categoryFromWord: categoryFromWord,
    CAFE_LABEL: CAFE_LABEL,
    categoryMeta: categoryMeta,
    svg: function (name) {
      return PATHS[name] ? svg(PATHS[name]) : "";
    }
  };

  root.Icons = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
