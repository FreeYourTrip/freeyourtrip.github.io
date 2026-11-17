/**
 * 可选配置。国内店名和地址搜索使用高德 Web 端 JS API
 * （AMAP_JS_KEY / AMAP_SECURITY_CODE）。都留空时只使用 OpenStreetMap Nominatim，
 * 也不会加载高德脚本。AMAP_REST_KEY 本版不使用，保持为空。
 * 填写方法见 README.md「高德地理编码（可选）」。
 * 不要把真实 Key 写进仓库或要发给朋友的分享文件里。
 */
(function (root) {
  "use strict";
  var AMAP_JS_KEY = "dd3e691c86d06ce88956feb9194a6dbd";
  var AMAP_SECURITY_CODE = "a3a7de0a657df1c092f0e1f2430e9eef";
  var AMAP_REST_KEY = "";
  var api = {
    AMAP_JS_KEY: AMAP_JS_KEY,
    AMAP_SECURITY_CODE: AMAP_SECURITY_CODE,
    AMAP_REST_KEY: AMAP_REST_KEY
  };
  root.AppConfig = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
