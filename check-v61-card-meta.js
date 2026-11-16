/**
 * v6.1 UI review: no leftover empty 「补位置」 capsules;
 * time row never wraps or shrinks; trailing sub-labels hide as a whole if they don't fit.
 * Usage: node check-v61-card-meta.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const L = require("./legs.js");
const Lookup = require("./lookup.js");

const tl = fs.readFileSync(path.join(__dirname, "timeline.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const imp = fs.readFileSync(path.join(__dirname, "import.js"), "utf8");

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log("  ok  " + name);
  } catch (err) {
    failed += 1;
    console.error("  FAIL  " + name);
    console.error("    " + (err && err.message));
  }
}

check("legPillHtml renders nothing when the label is empty; 补位置 hook is gone", function () {
  assert.ok(/function legPillHtml\(spec\) \{[\s\S]*?if \(!spec \|\| !spec.show \|\| !String\(spec\.label \|\| ""\)\.trim\(\)\) return "";/.test(tl));
  assert.ok(tl.indexOf('spec.label || "补位置 ›"') === -1);
  assert.ok(tl.indexOf("回酒店 · 补位置") === -1);
  assert.ok(!/if \(spec\.kind === "fix"\)/.test(tl));
});

check("trailingHotelPill: no capsule when the last stop has no coords (cannot measure distance)", function () {
  const hotel = {
    id: "h1",
    type: "hotel",
    nameZh: "示例酒店",
    address: "1 Example Road, London",
    checkIn: "2026-11-18",
    checkOut: "2026-11-20",
    lat: 51.52,
    lng: -0.14
  };
  const unlocated = {
    id: "p3",
    type: "place",
    nameZh: "还没定位置的店",
    address: "Somewhere Lane, London",
    date: "2026-11-19"
  };
  const trail = L.trailingHotelPill([unlocated], [unlocated, hotel], "2026-11-19");
  assert.ok(!trail.show, "unlocated last stop must not leave an empty 回酒店 / 补位置 capsule");
  assert.ok(!trail.label);

  const located = {
    id: "p1",
    type: "place",
    nameZh: "示例博物馆",
    address: "Great Russell St, London",
    date: "2026-11-19",
    lat: 51.5194,
    lng: -0.1269
  };
  const ok = L.trailingHotelPill([located], [located, hotel], "2026-11-19");
  assert.strictEqual(ok.show, true);
  assert.ok(ok.label && /回酒店/.test(ok.label), ok.label);
});

check("time is nowrap + flex-shrink:0; sub-labels (当地时间, · 共 N 晚) hide as a whole when clipped", function () {
  assert.ok(/white-space: nowrap;/.test(css));
  assert.ok(/\.card-meta-main \.card-time,[\s\S]*?flex-shrink: 0;[\s\S]*?white-space: nowrap;/.test(css));
  assert.ok(/class="card-sub tz-note"/.test(tl));
  assert.ok(/class="card-sub co-sub"/.test(tl));
  assert.ok(/function fitCardMetaSubs\(/.test(tl));
  assert.ok(/el\.scrollWidth > el\.clientWidth \+ 1/.test(tl));
  assert.ok(/\.card-sub\.is-clipped \{ display: none; \}/.test(css));
  assert.ok(/window\.addEventListener\("resize", function \(\) \{ fitCardMetaSubs\(\); \}\)/.test(tl));
});

check("copy: settings privacy matches the usage guide; import and empty-field errors are friendly", function () {
  const privacy = "行程只存在你手机里，没有账号，我们看不到。看地图、找位置和导航时，看的区域、地址和邮编会发给地图和邮编查询服务";
  assert.ok(html.indexOf('class="settings-note">' + privacy + "</p>") !== -1);
  assert.ok(html.indexOf("也没有服务器") === -1);
  assert.ok(imp.indexOf("JSON 无法解析") === -1);
  assert.ok(imp.indexOf("err.message") === -1 || !/errors: \["JSON/.test(imp));
  assert.ok(imp.indexOf('var IMPORT_UNRECOGNIZED = "没认出来，把 AI 的回复整段复制过来再试一次"') !== -1);
  assert.ok(tl.indexOf("请先输入地名，或粘贴一份清单") === -1);
  assert.ok(tl.indexOf('showAddStatus(\'<p class="err">先输入店名，或粘贴地址</p>\')') !== -1);
  assert.ok(tl.indexOf("已放进『还没定哪天』") === -1);
  assert.ok(tl.indexOf('undated: "已放进「还没定哪天」"') !== -1);
});

check("location confirm is a Leaflet map with a centre pin; drag pans under the pin, tap recentres", function () {
  assert.strictEqual(Lookup.COPY.confirmHint, "拖动地图或点一下，把点对准那个地方");
  assert.ok(tl.indexOf("拖动地图或点一下，把点对准那个地方") !== -1);
  assert.ok(tl.indexOf('id="loc-pending-map"') === -1, "『在地图上点一下』 link is gone");
  const paint = tl.slice(tl.indexOf("function paintLocConfirm"), tl.indexOf("function initChrome"));
  assert.ok(paint.indexOf("在地图上点一下") === -1, "confirm screen no longer uses 在地图上点一下");
  assert.ok(paint.indexOf("staticMapUrl") === -1, "confirm map is not a static image");
  assert.ok(/function bindLocConfirmMap\(el, start\)/.test(tl));
  assert.ok(/locConfirmMap = L\.map\(el,/.test(tl));
  assert.ok(/MapTiles\.attach\(locConfirmMap, el\)/.test(tl));
  assert.ok(/locConfirmMap\.on\("click", function \(e\) \{/.test(tl) && /locConfirmMap\.panTo\(e\.latlng\)/.test(tl), "tap recentres the point");
  assert.ok(/locConfirmMap\.getCenter\(\)/.test(tl) && /FC\(\)\.applyMapPick\(old, \{ lat: c\.lat, lng: c\.lng \}/.test(tl), "就放这里 saves the centre point");
  assert.ok(/id="loc-pending-here"/.test(paint) && /id="loc-pending-skip"/.test(paint));
  assert.ok(/import-confirm-pin-anchor/.test(paint) && /import-confirm-map-wrap/.test(paint));
  assert.ok(/function syncLocConfirmMapSize\(/.test(tl) && /invalidateSize\(\{ animate: false \}\)/.test(tl));
  assert.ok(/requestAnimationFrame\(function \(\) \{/.test(tl) && /bindLocConfirmResize\(/.test(tl));
  assert.ok(/visualViewport\.addEventListener\("resize", syncLocConfirmMapSize\)/.test(tl));
  assert.ok(/locConfirmMap\.remove\(\)/.test(tl) && /sheet\.innerHTML = ""/.test(tl), "map.remove and clear sheet on close");
  assert.ok(/\.import-confirm-map,\s*\.import-confirm-map\.leaflet-container \{[\s\S]*?height: 280px;/.test(css), "explicit height so Leaflet can measure");
  assert.ok(/top: 44%/.test(css) === false || css.indexOf(".import-confirm-pin {\n  position: absolute;\n  left: 50%;\n  top: 44%") === -1);
  assert.ok(/import-confirm-pin-anchor \{[\s\S]*?left: 50%;[\s\S]*?top: 50%;[\s\S]*?width: 0;[\s\S]*?height: 0;/.test(css), "pin tip anchor at wrap centre");
  assert.ok(/translateY\(-19\.79898987322px\)/.test(css), "teardrop tip offset is 14√2");
  assert.ok(/\.import-confirm-hint \{[\s\S]*?font-size: 13px;[\s\S]*?color: #6B7A8F;/.test(css));
  assert.ok(/pointer-events: none;/.test(css), "centre pin does not capture drag or tap");
  assert.ok(/#import-confirm-sheet \.leaflet-bottom(?:\.leaflet-right)? \{[\s\S]*?margin-bottom: 0;/.test(css), "confirm map attribution is not lifted by the main-map 122px offset");
  assert.ok(!/\.import-confirm-map img \{[\s\S]*?object-fit: cover/.test(css), "static-map img stretch is gone so Leaflet tiles are not distorted");
});


if (failed) {
  console.error("\n" + failed + " failed");
  process.exit(1);
}
console.log("\nall passed");
