/* v6.1 上线前：不带开发截图；CSP 不放行没用到的 restapi.amap.com（v6.3 做搜索再加） */
const fs = require("fs");
const assert = require("assert");
const files = fs.readdirSync(__dirname);
assert.deepStrictEqual(files.filter((f) => /^screenshot.*\.png$/i.test(f)), [], "no dev screenshots in release");
const html = fs.readFileSync(__dirname + "/index.html", "utf8");
assert.ok(html.indexOf("restapi.amap.com") === -1, "restapi.amap.com not allowed in CSP");
console.log("all passed");
