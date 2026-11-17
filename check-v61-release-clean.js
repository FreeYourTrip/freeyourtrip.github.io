/* v6.1.1：不带开发截图；script-src 为已批准的 'self' 'unsafe-eval' webapi + restapi；connect-src 仍含 restapi */
const fs = require("fs");
const assert = require("assert");
const files = fs.readdirSync(__dirname);
assert.deepStrictEqual(files.filter((f) => /^screenshot.*\.png$/i.test(f)), [], "no dev screenshots in release");
const html = fs.readFileSync(__dirname + "/index.html", "utf8");
assert.ok(html.indexOf("https://restapi.amap.com") !== -1, "restapi.amap.com allowed in CSP");
const csp = (html.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || "";
const scriptSrc = ((csp.match(/script-src ([^;]+)/) || [])[1] || "").trim();
assert.strictEqual(scriptSrc, "'self' 'unsafe-eval' https://webapi.amap.com https://restapi.amap.com");
assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp), "script-src must not include unsafe-inline");
assert.ok(csp.indexOf("wasm-unsafe-eval") === -1, "do not add wasm-unsafe-eval");
assert.ok(!/script-src[^;]*\*\.amap\.com/.test(csp), "no wildcard *.amap.com in script-src");
console.log("all passed");
