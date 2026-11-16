/**
 * 「有新版本」横条 + service worker 注册。
 * 规则：从不强制更新。新版下载好后只提示；点「立即更新」才切换并刷新一次；
 * 点「稍后」只在本次打开期间隐藏（sessionStorage），下次打开如果新版还在等待，会再提示。
 * 离线时照常用缓存的旧版打开（见 sw.js 的 fetch 处理）。
 */
(function (root) {
  "use strict";

  var LATER_KEY = "wishlist-map-update-later-v1";

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
   * 是否显示横条。
   * hasWaiting：有已下载、等待中的新版；hasController：当前页面已经由旧版 SW 控制（首次打开没有，不提示）。
   */
  function shouldShow(state, storage) {
    state = state || {};
    if (state.forceDemo) return true;
    if (!state.hasWaiting || !state.hasController) return false;
    return !laterThisSession(storage);
  }

  var api = { LATER_KEY: LATER_KEY, shouldShow: shouldShow, markLater: markLater, laterThisSession: laterThisSession };
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
    var el = banner();
    if (!el || el.getAttribute("data-painted") === "1") return;
    el.setAttribute("data-painted", "1");
    var icon = window.Icons && Icons.html ? Icons.html("refresh", "update-ico") : "";
    var lead = el.querySelector(".update-lead");
    if (lead) lead.innerHTML = icon + "<span>有新版本</span>";
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
    bindButtons();
    var demo = new URLSearchParams(window.location.search).get("demo");
    if (demo === "update") show({ forceDemo: true });
    register();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof window !== "undefined" ? window : globalThis);
