/**
 * 检查用的假数据：一份 v5.3「完整备份」，字段照 v5.3 线上代码的真实存法（全是假的：假确认号、假座位、示例地点）。
 * 只给 check-migrate.js / check-import-v53-backup.js / 截图脚本用，不进预缓存，网页不加载。
 */
"use strict";

function trips() {
  return [
    {
      id: "my-trip",
      nameZh: "伦敦巴黎罗马",
      nameEn: "",
      imported: true,
      legs: [],
      items: [
        { id: "ba300", type: "flight", flightNo: "BA300", fromAirport: "LHR", toAirport: "CDG", fromNameZh: "希思罗机场", fromNameEn: "Heathrow", nameZh: "戴高乐机场", nameEn: "Charles de Gaulle",
          fromLat: 51.47002, fromLng: -0.454295, lat: 49.0097, lng: 2.5479, departDate: "2026-12-05", departTime: "10:00", arriveDate: "2026-12-05", arriveTime: "12:00",
          confirmationNo: "FAKE-BA-0001", seat: "14A", note: "提前 2 小时到机场\n行李 23kg", example: false },
        { id: "az332", type: "flight", flightNo: "AZ332", fromAirport: "CDG", toAirport: "FCO", fromNameZh: "戴高乐机场", nameZh: "菲乌米奇诺机场",
          fromLat: 49.0097, fromLng: 2.5479, lat: 41.800278, lng: 12.238889, departDate: "2026-12-05", departTime: "14:30", arriveDate: "2026-12-05", arriveTime: "16:30", example: false },
        { id: "savoy", type: "hotel", nameZh: "萨沃伊酒店", nameEn: "The Savoy", address: "Strand, London WC2R 0EZ", city: "London", checkIn: "2026-12-03", checkInTime: "15:00",
          checkOut: "2026-12-05", checkOutTime: "", confirmationNo: "FAKE-SAV-0002", note: "要护照登记\n早餐 7 点开始", lat: 51.51015, lng: -0.12047, icon: "hotel", example: false },
        { id: "dishoom", type: "place", subtype: "餐厅", nameZh: "Dishoom Covent Garden", address: "12 Upper St Martin's Ln, London WC2H 9FB", city: "London",
          date: "2026-12-04", time: "12:00", note: "印度早餐，建议早去排队", lat: 51.5116, lng: -0.1268, example: false },
        { id: "museum", type: "place", subtype: "景点", nameZh: "大英博物馆", address: "Great Russell St, London WC1B 3DG", date: "2026-12-04", time: "14:30",
          note: "免费，建议预约 https://www.openstreetmap.org/booking", lat: 51.5194, lng: -0.127, icon: "attraction", example: false },
        { id: "little-shop", type: "place", subtype: "", nameZh: "朋友推荐的小店", address: "", date: "2026-12-04", time: "17:00", note: "朋友说招牌是蛋挞", example: false },
        { id: "pending-date", type: "place", subtype: "景点", nameZh: "罗马斗兽场", address: "Piazza del Colosseo, Roma", date: "", time: "", pendingDate: true,
          dateRaw: "下周三上午", pendingReason: "看不懂", pendingKind: "", lat: 41.8902, lng: 12.4922, note: "", example: false },
        { id: "rome-hotel", type: "hotel", nameZh: "罗马示例酒店", address: "Via Example 1, Roma", checkIn: "", checkOut: "", pendingDate: true, pendingKind: "hotel-reversed",
          pendingFrom: "2026-12-08", pendingTo: "2026-12-05", dateRaw: "12/8 ~ 12/5", note: "", example: false },
        { id: "trevi", type: "place", subtype: "景点", nameZh: "特雷维喷泉", address: "Piazza di Trevi, Roma", city: "Roma", date: "2026-12-06", time: "09:00",
          lat: 41.9009, lng: 12.4833, note: "背对喷泉扔硬币", example: false },
        { id: "gelato", type: "place", subtype: "餐厅", nameZh: "示例冰淇淋店", address: "", date: "2026-12-07", time: "", note: "", example: false }
      ]
    },
    {
      id: "imported-2",
      nameZh: "上次导入的东京",
      items: [
        { id: "j-h1", type: "hotel", nameZh: "东京示例酒店", city: "东京", address: "Shinjuku, Tokyo", checkIn: "2026-11-10", checkInTime: "18:00", checkOut: "2026-11-14", lat: 35.6938, lng: 139.7034 },
        { id: "j-p1", type: "place", subtype: "景点", nameZh: "浅草寺", address: "浅草寺", date: "2026-11-11", time: "10:00", lat: 35.7148, lng: 139.7967 }
      ]
    }
  ];
}

function legs() {
  return {
    "dishoom>museum": { origin: "dishoom", destination: "museum", mode: "公共交通", note: "坐 24 路公交，座位 随便 确认号 FAKE-LEG" },
    "savoy>dishoom": { origin: "savoy", destination: "dishoom", mode: "步行", note: "走路 10 分钟" }
  };
}

/** v5.3 的「完整备份」文件（backup.js version 1） */
function fullBackup() {
  return {
    app: "行程地图",
    version: 1,
    exportedAt: "2026-11-16T17:00:00.000Z",
    trips: trips(),
    activeTripId: "my-trip",
    examplesLoaded: false,
    legs: legs(),
    statuses: { tokyo: "planned", paris: "visited" },
    wishlistLoaded: true,
    geocodeCache: { "dishoom covent garden": { savedAt: "2026-11-16T12:00:00.000Z", results: [{ lat: 51.5116, lng: -0.1268, displayName: "Dishoom" }] } },
    kind: "full"
  };
}

/** v5.3 在本机 localStorage 里的样子 */
function localStorageV53() {
  return {
    "wishlist-map-trips-v1": JSON.stringify({ trips: trips(), activeTripId: "my-trip", examplesLoaded: false }),
    "wishlist-map-legs-v1": JSON.stringify(legs()),
    "wishlist-map-last-seen-version-v1": "v5.3",
    "wishlist-map-help-hide-v1": "1",
    "wishlist-map-trip-renamed-v1": "1"
  };
}

module.exports = { trips, legs, fullBackup, localStorageV53 };
