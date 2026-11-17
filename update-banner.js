/**
 * 「有新版本」居中弹窗 + service worker 注册。
 * 规则：从不强制更新。新版下载好后只提示；点「立即更新」才切换并刷新一次；
 * 点「稍后」只在本次打开期间隐藏（sessionStorage），下次打开如果新版还在等待，会再提示。
 * 若检测到页面里新旧文件混在一起，自动刷新一次（sessionStorage 防循环）。
 * 离线时照常用缓存的旧版打开（见 sw.js 的 fetch 处理）。
 */
(function (root) {
  "use strict";

  var LATER_KEY = "wishlist-map-update-later-v1";
  var MIX_KEY = "wishlist-map-mix-reload-v1";
  var SHELL_CACHE = "xingcheng-map-shell-v21";

  function laterThisSession(storage) {
    try {
      return !!storage && storage.getItem(LATER_KEY) === "1";
    } catch (err) {
      return false;
    }
  }

  function markLater(storage) {
    try {
      if (storage) storage.setItem(LATER_KEY, "1");
    } catch (err) {}
  }

  /**
   * 是否显示更新弹窗。
   * hasWaiting：有已下载、等待中的新版；hasController：当前页面已经由旧版 SW 控制（首次打开没有，不提示）。
   */
  function shouldShow(state, storage) {
    state = state || {};
    if (state.forceDemo) return true;
    if (!state.hasWaiting || !state.hasController) return false;
    return !laterThisSession(storage);
  }

  /** 三个壳层标记里只要有两个且不一致，就是新旧文件混用。 */
  function isMixed(htmlId, jsId, swId) {
    var ids = [htmlId, jsId, swId].filter(function (x) { return !!x; });
    if (ids.length < 2) return false;
    var first = ids[0];
    return ids.some(function (x) { return x !== first; });
  }

  function shouldReloadMixed(mixed, storage) {
    if (!mixed) return false;
    try {
      if (storage && storage.getItem(MIX_KEY) === "1") return false;
    } catch (err) {}
    return true;
  }

  function markMixedReload(storage) {
    try {
      if (storage) storage.setItem(MIX_KEY, "1");
    } catch (err) {}
  }

  var api = {
    LATER_KEY: LATER_KEY,
    MIX_KEY: MIX_KEY,
    SHELL_CACHE: SHELL_CACHE,
    shouldShow: shouldShow,
    markLater: markLater,
    laterThisSession: laterThisSession,
    isMixed: isMixed,
    shouldReloadMixed: shouldReloadMixed,
    markMixedReload: markMixedReload
  };
  root.UpdateBanner = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  if (typeof document === "undefined") return;

  var waitingWorker = null;
  var reloading = false;

  function session() {
    try {
      return window.sessionStorage;
    } catch (err) {
      return null;
    }
  }

  function banner() {
    return document.getElementById("update-banner");
  }

  function paint() {
    var title = document.getElementById("update-title");
    var body = document.getElementById("update-body");
    if (title) title.textContent = "有新版本";
    if (body) body.textContent = "刷新一次就能用上，行程不会丢";
  }

  function show(state) {
    var el = banner();
    if (!el) return;
    if (!shouldShow(state, session())) return;
    paint();
    el.hidden = false;
  }

  function hide() {
    var el = banner();
    if (el) el.hidden = true;
  }

  function trackInstalling(reg, worker) {
    if (!worker) return;
    worker.addEventListener("statechange", function () {
      if (worker.state === "installed" && reg.waiting) {
        waitingWorker = reg.waiting;
        show({ hasWaiting: true, hasController: !!navigator.serviceWorker.controller });
      }
    });
  }

  function bindButtons() {
    var later = document.getElementById("update-later");
    var now = document.getElementById("update-now");
    if (later) {
      later.addEventListener("click", function () {
        markLater(session());
        hide();
      });
    }
    if (now) {
      now.addEventListener("click", function () {
        hide();
        if (waitingWorker) {
          waitingWorker.postMessage({ type: "SKIP_WAITING" });
        } else {
          window.location.reload();
        }
      });
    }
  }

  function readHtmlShell() {
    var m = document.querySelector('meta[name="shell-cache"]');
    return (m && m.getAttribute("content")) || "";
  }

  function reloadIfMixed() {
    var htmlId = readHtmlShell();
    var jsId = (root.AppVersion && AppVersion.SHELL_CACHE) || "";
    var mixed = isMixed(htmlId, jsId, SHELL_CACHE);
    var store = session();
    if (!shouldReloadMixed(mixed, store)) return false;
    markMixedReload(store);
    if (reloading) return true;
    reloading = true;
    window.location.reload();
    return true;
  }

  function register() {
    if (!("serviceWorker" in navigator)) return;
    if (!(location.protocol === "http:" || location.protocol === "https:")) return;
    /* v5.2：第一次打开时 sw.js 的 clients.claim() 也会触发 controllerchange。
       那次不用刷新（页面本来就是最新的），否则新用户一打开就被刷一次，说明会弹两遍。只在「换版本」时刷新。 */
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (!hadController) return;
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
    navigator.serviceWorker
      .register("./sw.js")
      .then(function (reg) {
        if (reg.waiting) {
          waitingWorker = reg.waiting;
          show({ hasWaiting: true, hasController: !!navigator.serviceWorker.controller });
        }
        if (reg.installing) trackInstalling(reg, reg.installing);
        reg.addEventListener("updatefound", function () {
          trackInstalling(reg, reg.installing);
        });
        document.addEventListener("visibilitychange", function () {
          if (document.visibilityState === "visible" && navigator.onLine !== false) {
            reg.update().catch(function () {});
          }
        });
      })
      .catch(function () {});
  }

  function init() {
    if (reloadIfMixed()) return;
    bindButtons();
    var demo = new URLSearchParams(window.location.search).get("demo");
    if (demo === "update") show({ forceDemo: true });
    register();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof window !== "undefined" ? window : globalThis);
