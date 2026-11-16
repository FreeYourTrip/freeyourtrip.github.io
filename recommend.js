/**
 * 设置里的「分享给朋友」：只发网址，不带任何行程数据。
 * 有系统分享（navigator.share）就先弹分享面板（只传网址）；
 * 没有，或分享失败（不是用户取消）时，复制网址并提示「网址已复制，发给朋友就行」。
 * 用户取消分享（AbortError）不提示。
 * 浏览器里是 window.Recommend；node 里 require("./recommend.js")。
 */
(function (root) {
  "use strict";

  var URL = "https://freeyourtrip.github.io";
  var TITLE = "Free Your Trip";
  /* 系统分享时文字和网址分开传，文字到「打开就能用」为止（不带 👉）；复制时用整段，带 👉 和网址。 */
  var LEAD = "机票、酒店、想去的地方，一路串起来 ✈️ 不用下载不用注册，打开就能用";
  var FULL_TEXT = LEAD + " 👉 " + URL;
  var COPIED = "网址已复制，发给朋友就行";

  /** 给 navigator.share 的内容：只发网址，不带行程、也不带介绍文字。 */
  function sharePayload() {
    return { title: TITLE, url: URL };
  }

  function legacyCopy(doc, text) {
    try {
      var ta = doc.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      doc.body.appendChild(ta);
      ta.select();
      var ok = doc.execCommand && doc.execCommand("copy");
      doc.body.removeChild(ta);
      return !!ok;
    } catch (err) {
      return false;
    }
  }

  function copyText(nav, doc, text) {
    if (nav && nav.clipboard && nav.clipboard.writeText) {
      return nav.clipboard.writeText(text).then(
        function () { return true; },
        function () { return doc ? legacyCopy(doc, text) : false; }
      );
    }
    return Promise.resolve(doc ? legacyCopy(doc, text) : false);
  }

  /**
   * 「分享给朋友」。env: { navigator, document, toast(msg) }。
   * 返回 Promise<"shared" | "cancelled" | "copied" | "failed">。
   */
  function recommend(env) {
    env = env || {};
    var nav = env.navigator;
    var doc = env.document;
    var toast = env.toast || function () {};
    function fallback() {
      return copyText(nav, doc, URL).then(function (ok) {
        if (ok) {
          toast(COPIED);
          return "copied";
        }
        toast("没复制上，长按网址自己复制：" + URL);
        return "failed";
      });
    }
    if (nav && typeof nav.share === "function") {
      var payload = sharePayload();
      if (typeof nav.canShare === "function") {
        try {
          if (!nav.canShare(payload)) return fallback();
        } catch (err) {
          return fallback();
        }
      }
      return Promise.resolve()
        .then(function () { return nav.share(payload); })
        .then(
          function () { return "shared"; },
          function (err) {
            if (err && err.name === "AbortError") return "cancelled";
            return fallback();
          }
        );
    }
    return fallback();
  }

  var api = { URL: URL, TITLE: TITLE, LEAD: LEAD, FULL_TEXT: FULL_TEXT, COPIED: COPIED, sharePayload: sharePayload, recommend: recommend };
  root.Recommend = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  if (typeof document === "undefined") return;
  function bind() {
    var btn = document.getElementById("recommend-btn");
    if (!btn || btn.getAttribute("data-bound") === "1") return;
    btn.setAttribute("data-bound", "1");
    btn.addEventListener("click", function () {
      recommend({
        navigator: window.navigator,
        document: document,
        toast: function (msg) {
          if (window.TripApp && TripApp.toast) TripApp.toast(msg);
        }
      });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})(typeof window !== "undefined" ? window : globalThis);
