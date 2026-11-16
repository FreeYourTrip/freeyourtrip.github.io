/**
 * 校验 guessType()：按 OSM class/type 映射到中文类型。
 * 用法：node check-guess-type.js
 */
"use strict";

const assert = require("assert");
const { guessType } = require("./guess-type.js");

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log("PASS  " + name);
  } catch (err) {
    failures += 1;
    console.log("FAIL  " + name);
    console.log("      " + err.message);
  }
}

check("restaurant / cafe / fast_food → 餐厅", function () {
  assert.strictEqual(guessType("amenity", "restaurant"), "餐厅");
  assert.strictEqual(guessType({ class: "amenity", type: "cafe" }), "餐厅");
  assert.strictEqual(guessType({ class: "amenity", type: "fast_food" }), "餐厅");
  assert.strictEqual(guessType({ type: "fast_food" }), "餐厅");
});

check("museum / attraction / viewpoint / gallery / zoo / park → 景点", function () {
  assert.strictEqual(guessType("tourism", "museum"), "景点");
  assert.strictEqual(guessType({ class: "tourism", type: "attraction" }), "景点");
  assert.strictEqual(guessType({ class: "tourism", type: "viewpoint" }), "景点");
  assert.strictEqual(guessType({ class: "tourism", type: "gallery" }), "景点");
  assert.strictEqual(guessType({ class: "tourism", type: "zoo" }), "景点");
  assert.strictEqual(guessType({ class: "leisure", type: "park" }), "景点");
  assert.strictEqual(guessType({ type: "park" }), "景点");
});

check("highway / street → 街道", function () {
  assert.strictEqual(guessType("highway", "residential"), "街道");
  assert.strictEqual(guessType({ class: "highway", type: "pedestrian" }), "街道");
  assert.strictEqual(guessType({ class: "place", type: "street" }), "街道");
  assert.strictEqual(guessType({ type: "street" }), "街道");
});

check("hotel / hostel / guest_house → 酒店", function () {
  assert.strictEqual(guessType("tourism", "hotel"), "酒店");
  assert.strictEqual(guessType({ class: "tourism", type: "hostel" }), "酒店");
  assert.strictEqual(guessType({ class: "tourism", type: "guest_house" }), "酒店");
});

check("everything else → 地点", function () {
  assert.strictEqual(guessType("shop", "supermarket"), "地点");
  assert.strictEqual(guessType({ class: "amenity", type: "bank" }), "地点");
  assert.strictEqual(guessType({}), "地点");
  assert.strictEqual(guessType(""), "地点");
  assert.strictEqual(guessType(null), "地点");
  assert.strictEqual(guessType({ class: "amenity", type: "parking" }), "地点");
});

check("food wins over a looser class; parking is not park", function () {
  assert.strictEqual(guessType({ class: "tourism", type: "restaurant" }), "餐厅");
  assert.strictEqual(guessType({ type: "parking" }), "地点");
  assert.strictEqual(guessType({ type: "car_park" }), "地点");
});

if (failures) {
  console.log("\n" + failures + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll guessType checks passed.");
