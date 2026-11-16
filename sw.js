/* 行程地图：缓存应用外壳。全部使用相对路径，可部署在 GitHub Pages 子目录（如 /repo-name/）。 */
var CACHE = "xingcheng-map-shell-v12";
var SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./data.js",
  "./airports.js",
  "./config.js",
  "./geo.js",
  "./legs.js",
  "./calendar.js",
  "./recommend.js",
  "./item-edit.js",
  "./update-banner.js",
  "./version.js",
  "./icons.js",
  "./geocode.js",
  "./import.js",
  "./guess-type.js",
  "./install-env.js",
  "./ai-prompt.js",
  "./backup.js",
  "./app.js",
  "./timeline.js",
  "./vendor/leaflet.css",
  "./vendor/leaflet.js",
  "./vendor/images/marker-icon.png",
  "./vendor/images/marker-icon-2x.png",
  "./vendor/images/marker-shadow.png",
  "./vendor/images/layers.png",
  "./vendor/images/layers-2x.png",
  "./manifest.webmanifest",
  "./icons/icon-16.png",
  "./icons/icon-32.png",
  "./icons/icon-120.png",
  "./icons/icon-152.png",
  "./icons/icon-167.png",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./导入格式说明.txt"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL);
    })
  );
  /* 不自动 skipWaiting：新版装好后等用户点「立即更新」，或所有页面关掉后下次打开再生效。 */
});

self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req).then(function (cached) {
      var fresh = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return cached || caches.match("./index.html");
      });
      return cached || fresh;
    })
  );
});
