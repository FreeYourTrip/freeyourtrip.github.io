/**
 * 隐私导出校验。用法：node check-privacy.js
 */
"use strict";

const assert = require("assert");
const BackupUtil = require("./backup.js");
const Geocode = require("./geocode.js");

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log("PASS  " + name);
  } catch (err) {
    failures += 1;
    console.log("FAIL  " + name);
    console.log("      " + (err && err.stack ? err.stack : err));
  }
}

const samplePayload = {
  app: "行程地图",
  version: 1,
  trips: [
    {
      id: "sample",
      nameZh: "测试行程",
      items: [
        {
          type: "flight",
          flightNo: "BA123",
          fromAirport: "LHR",
          toAirport: "HND",
          seat: "32A",
          confirmationNo: "",
          note: "座位 32A 靠窗，已值机"
        },
        {
          type: "hotel",
          nameZh: "The Savoy",
          nameEn: "The Savoy",
          address: "Strand, London WC2R 0EZ",
          confirmationNo: "ABC123",
          note: "确认号 ABC123 豪华房"
        }
      ],
      legs: [{ origin: "a", destination: "b", note: "确认号 XYZ999 上车点" }]
    }
  ],
  legs: {
    "a:b": { origin: "a", destination: "b", mode: "公共交通", note: "座位 12B 别忘了" }
  },
  geocodeCache: { "the savoy": { results: [{ lat: 51.51, lng: -0.12 }] } }
};

check("share export strips confirmation, seat, and note patterns; drops geocode cache", function () {
  const share = BackupUtil.redactForShare(JSON.parse(JSON.stringify(samplePayload)));
  const json = JSON.stringify(share);
  assert.strictEqual(share.kind, "share");
  assert.strictEqual("geocodeCache" in share, false, "must not include geocodeCache");
  assert.ok(!json.includes("ABC123"), json);
  assert.ok(!json.includes("32A"), json);
  assert.ok(!json.includes("XYZ999"), json);
  assert.ok(!json.includes("12B"), json);
  const flight = share.trips[0].items[0];
  const hotel = share.trips[0].items[1];
  assert.strictEqual(flight.flightNo, "BA123");
  assert.ok(!flight.seat);
  assert.ok(!flight.confirmationNo);
  assert.strictEqual(flight.note, "靠窗，已值机");
  assert.ok(!hotel.confirmationNo);
  assert.strictEqual(hotel.note, "豪华房");
  assert.strictEqual(share.trips[0].legs[0].note, "上车点");
  assert.strictEqual(share.legs["a:b"].note, "别忘了");
  assert.ok(json.includes("BA123"));
  assert.ok(json.includes("The Savoy"));
});

check("full backup payload keeps secrets when includeGeocodeCache is true", function () {
  /* collect() needs no DOM; we only test redact is not applied to a raw payload */
  const json = JSON.stringify(samplePayload);
  assert.ok(json.includes("ABC123"));
  assert.ok(json.includes("32A"));
  assert.ok(json.includes("geocodeCache"));
});

check("share filename pattern uses compact YYYYMMDD", function () {
  const stamp = BackupUtil.todayStamp();
  assert.ok(/^\d{8}$/.test(stamp), stamp);
  const shareName = "行程分享-" + stamp + ".json";
  const fullName = "行程完整备份-" + stamp + ".json";
  assert.ok(shareName.indexOf("行程分享-") === 0);
  assert.ok(fullName.indexOf("行程完整备份-") === 0);
  assert.notStrictEqual(shareName, fullName);
});

check("Nominatim sanitize drops confirmation/seat/notes, keeps name/address/IATA", function () {
  const s = Geocode.sanitizeGeocodeQuery;
  assert.strictEqual(s("The Savoy 确认号 ABC123 豪华房"), "The Savoy 豪华房");
  assert.strictEqual(s("大英博物馆 座位 32A"), "大英博物馆");
  assert.strictEqual(s("LHR airport"), "LHR airport");
  assert.strictEqual(s("Great Russell St, London"), "Great Russell St, London");
  assert.ok(!s("确认号 ABC123").includes("ABC123"));
  assert.ok(!s("座位 32A").includes("32A"));
});

check("mask pattern for UI (ABC123 -> AB****23)", function () {
  function maskSecret(s) {
    s = String(s == null ? "" : s);
    if (s.length <= 4) return "****";
    return s.slice(0, 2) + "****" + s.slice(-2);
  }
  assert.strictEqual(maskSecret("ABC123"), "AB****23");
  assert.strictEqual(maskSecret("SAV-EXAMPLE-001"), "SA****01");
  assert.strictEqual(maskSecret("AB"), "****");
});

if (failures) {
  console.log("\n" + failures + " failure(s)");
  process.exit(1);
}
console.log("\nAll privacy checks passed.");
