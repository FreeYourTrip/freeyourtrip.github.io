/**
 * 判断当前环境该如何提示「添加到桌面」。纯函数，无副作用。
 * kind: standalone | inapp | ios-safari | other
 */
(function (root) {
  "use strict";

  var IN_APP_RE = /MicroMessenger|Weixin|WeiBo|Weibo|DingTalk|AliApp|AlipayClient|NewsArticle|aweme|BytedanceWebview|musical_ly|TikTok|FBAN|FBAV|Instagram|Line\/|Snapchat|Twitter|KAKAOTALK|\bQQ\/|QBWebViewSDK|Baidu|baiduboxapp|UCBrowser\/.*Mini|MiniProgramEnv|; wv\)/i;
  var IOS_RE = /iPhone|iPad|iPod/i;
  var IOS_OTHER_RE = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|Brave|Chrome|Android/i;

  function isIOS(ua, hints) {
    if (IOS_RE.test(ua)) return true;
    hints = hints || {};
    if (hints.platform === "MacIntel" && Number(hints.maxTouchPoints) > 1) return true;
    return false;
  }

  function isInAppBrowser(ua) {
    return IN_APP_RE.test(String(ua || ""));
  }

  function isIOSSafari(ua, hints) {
    if (!isIOS(ua, hints)) return false;
    if (isInAppBrowser(ua)) return false;
    if (IOS_OTHER_RE.test(ua) && !/Version\//.test(ua)) return false;
    if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return false;
    return /Safari/i.test(ua) || /AppleWebKit/i.test(ua);
  }

  function isStandalone(hints) {
    hints = hints || {};
    if (hints.standalone) return true;
    var mode = String(hints.displayMode || "");
    return mode === "standalone" || mode === "fullscreen";
  }

  /**
   * @param {string} ua
   * @param {{standalone?:boolean,displayMode?:string,platform?:string,maxTouchPoints?:number}} [hints]
   */
  function detectInstallEnv(ua, hints) {
    ua = String(ua == null ? "" : ua);
    hints = hints || {};
    var standalone = isStandalone(hints);
    var inApp = isInAppBrowser(ua);
    var ios = isIOS(ua, hints);
    var safari = isIOSSafari(ua, hints);
    var kind = "other";
    if (standalone) kind = "standalone";
    else if (inApp) kind = "inapp";
    else if (ios) kind = safari ? "ios-safari" : "inapp";
    return {
      kind: kind,
      standalone: standalone,
      inApp: inApp || (ios && !safari && !standalone),
      ios: ios,
      safari: safari,
      hideInstall: standalone
    };
  }

  function currentInstallEnv() {
    var ua = "";
    var hints = {};
    if (typeof navigator !== "undefined") {
      ua = navigator.userAgent || "";
      hints.standalone = !!navigator.standalone;
      hints.platform = navigator.platform;
      hints.maxTouchPoints = navigator.maxTouchPoints;
    }
    if (typeof window !== "undefined" && window.matchMedia) {
      try {
        if (window.matchMedia("(display-mode: standalone)").matches) {
          hints.standalone = true;
          hints.displayMode = "standalone";
        } else if (window.matchMedia("(display-mode: fullscreen)").matches) {
          hints.displayMode = "fullscreen";
        }
      } catch (err) {}
    }
    return detectInstallEnv(ua, hints);
  }

  var api = {
    detectInstallEnv: detectInstallEnv,
    currentInstallEnv: currentInstallEnv,
    isInAppBrowser: isInAppBrowser,
    isIOS: isIOS
  };
  root.InstallEnv = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
