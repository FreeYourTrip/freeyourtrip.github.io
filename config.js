/**
 * 可选配置。高德 Web 端 JS API Key 与安全密钥都留空时，地址搜索只使用
 * OpenStreetMap Nominatim，也不会加载任何高德脚本。
 * 填写方法见 README.md「高德地理编码（可选）」。
 * 不要把真实 Key 写进要发给朋友的分享文件里。
 */
(function (root) {
  "use strict";
  var AMAP_JS_KEY = "";
  var AMAP_SECURITY_CODE = "";
  var api = { AMAP_JS_KEY: AMAP_JS_KEY, AMAP_SECURITY_CODE: AMAP_SECURITY_CODE };
  root.AppConfig = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
