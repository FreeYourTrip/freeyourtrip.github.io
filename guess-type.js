/**
 * 根据 OSM class/type（或同类字段）猜测地点类型。纯函数，无副作用。
 */
(function (root) {
  "use strict";

  var FOOD = { restaurant: 1, cafe: 1, fast_food: 1, fastfood: 1 };
  var HOTEL = { hotel: 1, hostel: 1, guest_house: 1, guesthouse: 1 };
  var SIGHT = { museum: 1, attraction: 1, viewpoint: 1, gallery: 1, zoo: 1, park: 1 };
  var STREET = { highway: 1, street: 1, road: 1 };

  function tokensFrom(cls, typ) {
    var raw = String(cls || "") + " " + String(typ || "");
    return raw
      .toLowerCase()
      .split(/[^a-z0-9_\u3400-\u9fff]+/)
      .filter(Boolean);
  }

  /**
   * @param {string|{class?:string,type?:string,category?:string,osmClass?:string,osmType?:string}} input
   * @param {string} [typ]
   * @returns {"餐厅"|"景点"|"街道"|"酒店"|"地点"}
   */
  function guessType(input, typ) {
    var cls = "";
    var type = typ == null ? "" : typ;
    if (input && typeof input === "object") {
      cls = input.class || input.osmClass || input.category || input.cls || "";
      type = input.type || input.osmType || type || "";
    } else if (input != null) {
      cls = input;
    }
    var tokens = tokensFrom(cls, type);
    var i;
    for (i = 0; i < tokens.length; i++) {
      if (FOOD[tokens[i]]) return "餐厅";
    }
    for (i = 0; i < tokens.length; i++) {
      if (HOTEL[tokens[i]]) return "酒店";
    }
    for (i = 0; i < tokens.length; i++) {
      if (SIGHT[tokens[i]]) return "景点";
    }
    for (i = 0; i < tokens.length; i++) {
      if (STREET[tokens[i]]) return "街道";
    }
    return "地点";
  }

  var api = { guessType: guessType };
  root.GuessType = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
