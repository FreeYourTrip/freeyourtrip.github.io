/**
 * v5.2「放到手机桌面」引导：所有文案放在 COPY 一处（文案改这里就行），
 * 加上纯函数：该给哪种引导、什么时候自动弹、存哪几个键。没有副作用，不联网。
 * 只在本机存三个引导状态键（加好了 / 下次再说的时间 / 有行程时已弹过一次），不存别的。
 */
(function (root) {
  "use strict";

  /* 「桌面打开后看不到这里的行程」提示的开关。默认开；正式发布前要在真 iPhone 上确认桌面版确实看不到 Safari 里的行程。 */
  var SHOW_SEPARATE_STORAGE_NOTE = true;

  var COPY = {
    settingsLabel: "放到手机桌面",
    settingsSub: "像 App 一样，点图标就打开",
    bannerText: "放到手机桌面，像 App 一样打开",
    /* 微信 / 其他 App 内置浏览器：全屏遮罩，箭头指右上角 */
    wechatText: "微信里没法放到桌面。点右上角 ···，选『在 Safari 中打开』或『在默认浏览器中打开』",
    inAppText: "这个 App 里没法放到桌面。点右上角 ···，选『在 Safari 中打开』或『在默认浏览器中打开』",
    iosOtherText: "这个浏览器里没法放到桌面。点『复制网址』，再打开 Safari，粘贴到地址栏打开",
    copyUrl: "复制网址",
    copied: "网址已复制",
    copyFailed: "没复制成功，请长按地址栏手动复制",
    close: "关闭",
    /* iPhone / iPad Safari：底部面板，3 步 */
    iosTitle: "放到桌面，像 App 一样打开",
    /* v5.3（UI 省高度）：每步说明一行放得下（390 宽、15px 约 21 个字） */
    iosSteps: [
      "点底部分享按钮，没有就先点「···」",
      "往下滑，选「添加到主屏幕」",
      "点右上角「添加」"
    ],
    /* iPad 上分享按钮在右上角 */
    ipadStep1: "点右上角的分享按钮（方框加向上箭头）",
    /* v5.3（UI）：只在已有行程时显示，一行 13px 灰字 */
    hasItemsNote: "桌面看不到这些行程，先『完整备份』再到桌面『导入』",
    done: "我加好了",
    later: "下次再说",
    /* 设置里手动打开：安卓 / 电脑 */
    sheetTitle: "放到手机桌面",
    androidSteps: [
      "点浏览器右上角的菜单（三个点）",
      "选「添加到主屏幕」或「安装应用」",
      "按提示确认，桌面就有图标了"
    ],
    desktopNote: "这是给手机用的：用手机浏览器打开这个网址，再按提示放到桌面。电脑上可以直接把网址加进书签。",
    placeholder: "示意图（占位）"
  };

  var DONE_KEY = "wishlist-map-install-guide-done-v1";
  var SNOOZE_KEY = "wishlist-map-install-guide-snooze-v1";
  var ITEMS_SHOWN_KEY = "wishlist-map-install-guide-items-shown-v1";
  var STORAGE_KEYS = [DONE_KEY, SNOOZE_KEY, ITEMS_SHOWN_KEY];
  var SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

  function isWeChat(ua) {
    return /MicroMessenger/i.test(String(ua || ""));
  }

  function isAndroid(ua) {
    return /Android/i.test(String(ua || ""));
  }

  function isIPad(ua, hints) {
    ua = String(ua || "");
    hints = hints || {};
    if (/iPad/i.test(ua)) return true;
    return hints.platform === "MacIntel" && Number(hints.maxTouchPoints) > 1;
  }

  /**
   * 该给哪种引导。env 来自 InstallEnv.detectInstallEnv。
   * 返回 { kind, variant, ipad }：
   *   kind: none（桌面图标打开）| inapp（全屏遮罩）| ios-sheet | android-prompt | android-steps | desktop
   *   variant（inapp 时）: wechat | inapp | ios-other（iOS 上的 Chrome / Firefox / Edge 等，让用 Safari 打开）
   */
  function guideFor(env, ua, hints, opts) {
    env = env || {};
    ua = String(ua || "");
    opts = opts || {};
    if (env.standalone || env.kind === "standalone") return { kind: "none", variant: "", ipad: false };
    var ipad = isIPad(ua, hints);
    if (isWeChat(ua)) return { kind: "inapp", variant: "wechat", ipad: ipad };
    if (env.kind === "inapp") {
      var known = env.inApp && root.InstallEnv && typeof root.InstallEnv.isInAppBrowser === "function"
        ? root.InstallEnv.isInAppBrowser(ua)
        : /MicroMessenger|Weibo|QQ\/|DingTalk|AliApp|FBAN|FBAV|Instagram|Line\/|; wv\)/i.test(ua);
      return { kind: "inapp", variant: known ? "inapp" : "ios-other", ipad: ipad };
    }
    if (env.kind === "ios-safari") return { kind: "ios-sheet", variant: "", ipad: ipad };
    if (isAndroid(ua)) return { kind: opts.hasPrompt ? "android-prompt" : "android-steps", variant: "", ipad: false };
    return { kind: "desktop", variant: "", ipad: false };
  }

  function overlayText(variant) {
    if (variant === "wechat") return COPY.wechatText;
    if (variant === "ios-other") return COPY.iosOtherText;
    return COPY.inAppText;
  }

  /**
   * 是否自动弹。只在 iPhone / iPad Safari（底部面板）和 App 内置浏览器（遮罩）上自动弹。
   * state: { guide, done, snoozedAt, now, hasItems, itemsShown, popupThisOpen }
   *   - 从桌面图标打开：从不弹；点过「我加好了」：从不弹；
   *   - 这次打开已经弹了公告或使用说明：这次不弹，下次打开再说；
   *   - 7 天内弹过 / 点过「下次再说」：不弹；
   *   - 还没有行程：按上面规则弹；已有行程：只自动弹一次（带「完整备份 → 导入」提示）。
   */
  function shouldAutoShow(state) {
    state = state || {};
    var g = state.guide || {};
    if (g.kind !== "ios-sheet" && g.kind !== "inapp") return false;
    if (state.done) return false;
    if (state.popupThisOpen) return false;
    var at = Number(state.snoozedAt);
    var now = Number(state.now) || Date.now();
    if (at && isFinite(at) && now - at < SNOOZE_MS) return false;
    if (state.hasItems && state.itemsShown) return false;
    return true;
  }

  function showItemsNote(guide, hasItems) {
    return !!(SHOW_SEPARATE_STORAGE_NOTE && hasItems && guide && guide.kind === "ios-sheet");
  }

  /** 复制用的网址：只要站点地址，不带 ?demo= 之类的参数和 #。 */
  function shareableUrl(loc) {
    loc = loc || {};
    return String(loc.origin || "") + String(loc.pathname || "/");
  }

  var api = {
    SHOW_SEPARATE_STORAGE_NOTE: SHOW_SEPARATE_STORAGE_NOTE,
    COPY: COPY,
    DONE_KEY: DONE_KEY,
    SNOOZE_KEY: SNOOZE_KEY,
    ITEMS_SHOWN_KEY: ITEMS_SHOWN_KEY,
    STORAGE_KEYS: STORAGE_KEYS,
    SNOOZE_MS: SNOOZE_MS,
    isWeChat: isWeChat,
    isIPad: isIPad,
    guideFor: guideFor,
    overlayText: overlayText,
    shouldAutoShow: shouldAutoShow,
    showItemsNote: showItemsNote,
    shareableUrl: shareableUrl
  };
  root.InstallGuide = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
