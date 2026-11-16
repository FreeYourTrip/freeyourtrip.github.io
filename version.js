/**
 * 版本号、更新记录、每次发版的「新版本」公告。版本号只在这里改一处。
 * 规则（decideOnOpen）：
 *   - 第一次用（没有 lastSeenVersion、没有行程、也没勾过「不再自动弹出」）→ 只弹使用说明，并悄悄记下当前版本；
 *   - 老用户（记过旧版本，或虽然没记过但已有行程 / 勾过说明不再弹出，例如从 v4 升上来）→ 版本变了就弹一次公告，点「知道了」才记下；
 *   - 版本没变 → 按原来的规则决定是否弹使用说明。
 *   公告和使用说明不会同时弹。
 */
(function (root) {
  "use strict";

  /* 版本规则（用户定）：大版本 v5、v6…；小更新只变小数点 v5.1、v5.2… 公告按这个号判断是否弹出。 */
  var APP_VERSION = "v5.2";
  var APP_DATE = "2026-11-16";
  var LAST_SEEN_KEY = "wishlist-map-last-seen-version-v1";

  var ANNOUNCEMENT = {
    /* v5.2 公告：广告文案宣传大师定稿 */
    /* 界面不用 emoji（UI 终审）：标题和 4 条前面的 emoji 去掉，文字不变 */
    title: APP_VERSION + " 更新",
    bullets: [
      "放到桌面更简单，跟着提示做就能像 App 一样点开",
      "截图交给 AI，3 步排好行程",
      "导航更准，大阪、东京这类地方不会再误开高德",
      "搜不到的地点也能直接加，图标可以自己选"
    ],
    tip: "更新不会删除你的行程。如果看到的还是旧版：把网页彻底关掉再打开。放在桌面的，就从后台划掉，再点图标打开。"
  };

  var CHANGELOG = [
    {
      version: "v5.2",
      date: "2026-11-16",
      lines: [
        "新增：放到桌面的引导、分级说明书、截图交给 AI 的 3 步向导、行程起名提示、自选图标、搜不到的地点也能先加上，之后点『待补地址』补上位置",
        "修复：导航时店名和地址一起传；没坐标的地点按你当前所在位置选高德或 Google；搜索结果会显示地址，搜错了一眼就能看出来",
        "调整：『带我去』和『看位置』挪进卡片里，点开卡片就能看到；删除单条后，撤销提示缩短到 5 秒"
      ]
    },
    {
      version: "v5.1",
      date: "2026-11-16",
      lines: [
        "日期写法不标准也能自动认，认不出的标黄让你确认",
        "地图新增定位按钮；设置里分成「分享我的行程」和「推荐这个工具」",
        "窄屏排版和日期条标签优化，补齐各款 iPhone 的启动画面"
      ]
    },
    {
      version: "v5",
      date: "2026-11-16",
      lines: [
        "每一项都能单独修改、删除；「清空全部」一次删光，10 秒内能撤销",
        "新的顶部日期条：左右滑选日子、「今天」一键回来、点月份看整月，住宿段和「已去」一目了然",
        "有新版本时顶部提示，点一下就更新；改名为 Free Your Trip，设置里能看版本和更新记录"
      ]
    },
    {
      version: "v4",
      date: "2026-11-16",
      lines: [
        "输入地名，从结果里点一下就加好",
        "「复制给 AI 的话」：截图交给 AI 整理，再粘贴回来",
        "打开时自动弹出使用说明；可以「添加到桌面」像 App 一样打开"
      ]
    },
    {
      version: "v3",
      date: "2026-11-16",
      lines: [
        "界面简化：按天排好的卡片，底部只留「＋ 添加」",
        "两站之间的「带我去」，国内开高德、国外开 Google 地图",
        "机票、酒店、餐厅、景点用不同颜色和图标（和 v4 一起上线）"
      ]
    },
    {
      version: "v2",
      date: "2026-11-16",
      lines: [
        "隐私更新：分享给朋友时自动隐藏订单号和座位",
        "新增「清空本机数据」；不再加载外部字体和脚本"
      ]
    },
    {
      version: "v1",
      date: "2026-11-16",
      lines: [
        "第一版上线：行程列表和地图",
        "两站之间的连接条，点了跳到地图导航；可以粘贴整理好的行程"
      ]
    }
  ];

  function versionNumber(v) {
    var m = /^v?(\d+)(?:\.(\d+))?/.exec(String(v == null ? "" : v).trim());
    if (!m) return -1;
    return Number(m[1]) + (m[2] ? Number(m[2]) / 1000 : 0);
  }

  /** 'v4' < 'v5' → -1；相等 → 0；大于 → 1。认不出来的当作最旧。 */
  function compareVersion(a, b) {
    var x = versionNumber(a);
    var y = versionNumber(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }

  /**
   * state: { lastSeen: string|null, hasTrips: bool, helpHidden: bool, current?: string }
   * 返回 { show: "announce" | "help" | "none", markSeenNow: bool }
   * markSeenNow=true 表示立刻悄悄记下当前版本（第一次用、或版本没变）；公告则等点「知道了」再记。
   */
  function decideOnOpen(state) {
    state = state || {};
    var current = state.current || APP_VERSION;
    var lastSeen = state.lastSeen || null;
    if (!lastSeen) {
      var returning = !!state.hasTrips || !!state.helpHidden;
      if (!returning) return { show: "help", markSeenNow: true };
      return { show: "announce", markSeenNow: false };
    }
    if (compareVersion(lastSeen, current) < 0) return { show: "announce", markSeenNow: false };
    return { show: state.helpHidden ? "none" : "help", markSeenNow: false };
  }

  function versionLabel() {
    return "当前版本 " + APP_VERSION + " · " + APP_DATE;
  }

  var api = {
    APP_VERSION: APP_VERSION,
    APP_DATE: APP_DATE,
    LAST_SEEN_KEY: LAST_SEEN_KEY,
    ANNOUNCEMENT: ANNOUNCEMENT,
    CHANGELOG: CHANGELOG,
    compareVersion: compareVersion,
    decideOnOpen: decideOnOpen,
    versionLabel: versionLabel
  };
  root.AppVersion = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
