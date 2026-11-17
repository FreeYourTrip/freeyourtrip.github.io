/* 行程地图：缓存应用外壳。全部使用相对路径，可部署在 GitHub Pages 子目录（如 /repo-name/）。 */
var CACHE = "xingcheng-map-shell-v22";
var SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./data.js",
  "./airports.js",
  "./config.js",
  "./geo.js",
  "./transport.js",
  "./places.js",
  "./trip-store.js",
  "./legs.js",
  "./calendar.js",
  "./recommend.js",
  "./locate.js",
  "./item-edit.js",
  "./update-banner.js",
  "./version.js",
  "./icons.js",
  "./geocode.js",
  "./lookup.js",
  "./tiles.js",
  "./import.js",
  "./guess-type.js",
  "./install-env.js",
  "./install-guide.js",
  "./guide/01-wechat.webp",
  "./guide/02-safari-classic-share-focus.webp",
  "./guide/03-safari-ios26-more-focus.webp",
  "./guide/04-share-sheet-add-focus.webp",
  "./guide/05-add-confirm-focus.webp",
  "./guide/ipad-share.webp",
  "./trip-name.js",
  "./fix-cand.js",
  "./ai-prompt.js",
  "./backup.js",
  "./share-link.js",
  "./app.js",
  "./timeline.js",
  "./vendor/leaflet.css",
  "./vendor/leaflet.js",
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
      /* 强制绕过 HTTP 缓存，避免 GitHub Pages max-age 把旧文件写进新缓存 */
      return Promise.all(SHELL.map(function (url) {
        return fetch(new Request(url, { cache: "reload" })).then(function (res) {
          if (!res || !res.ok) throw new Error("precache failed: " + url);
          return cache.put(url, res);
        });
      }));
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
      var fresh = fetch(new Request(req, { cache: "no-cache" })).then(function (res) {
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
