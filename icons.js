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
    help:
      '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.8.4-1.4 1-1.4 1.9V14"/><path d="M12 17h.01"/>'
  };

  var TYPE_META = {
    flight: { icon: "flight", color: "#2F80ED", tint: "#E3F0FD", label: "机票" },
    hotel: { icon: "hotel", color: "#8E5CF7", tint: "#F1E9FE", label: "酒店" },
    restaurant: { icon: "restaurant", color: "#F2994A", tint: "#FDEDD9", label: "餐厅" },
    attraction: { icon: "attraction", color: "#27AE60", tint: "#E3F7EA", label: "景点" },
    street: { icon: "street", color: "#6B7A8F", tint: "#E8ECF0", label: "街道" },
    place: { icon: "attraction", color: "#27AE60", tint: "#E3F7EA", label: "地点" }
  };

  function normalizeSubtype(s) {
    return String(s || "").toLowerCase();
  }

  function typeKind(item) {
    if (!item) return "place";
    var t = String(item.type || "").toLowerCase();
    if (t === "flight" || t === "机票") return "flight";
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
    svg: function (name) {
      return PATHS[name] ? svg(PATHS[name]) : "";
    }
  };

  root.Icons = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
