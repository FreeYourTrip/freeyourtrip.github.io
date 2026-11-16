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
  var APP_VERSION = "v6.0";
  var APP_DATE = "2026-11-16";
  var LAST_SEEN_KEY = "wishlist-map-last-seen-version-v1";

  var ANNOUNCEMENT = {
    /* v6.0 公告：广告文案宣传大师定稿 */
    title: APP_VERSION + " 大更新",
    bullets: [
      "能存好几个行程了：点顶部的行程名，切换、新建、改名、删除都在这里",
      "火车、船、大巴也能导入，跟机票一样按时间排好，时间旁边标着「当地时间」",
      "长按卡片能拖到别的日子；有酒店或票的行程，「全部」里一天一栏，没定日子的放在最下面「还没定哪天」",
      "同一个地方加进别的行程，上次写的备注会跟过来",
      "原来的行程已经自动放进「我的行程」，内容不变"
    ],
    tip: "更新不会删除你的行程。如果看到的还是旧版：把网页彻底关掉再打开。放在桌面的，就从后台划掉，再点图标打开。"
  };

  var CHANGELOG = [
    {
      /* v6.0 更新记录：广告文案宣传大师定稿 */
      version: "v6.0",
      date: "2026-11-16",
      lines: [
        "新增：可以存好几个行程，点顶部的行程名切换、新建、改名、删除；原来的行程自动放进「我的行程」",
        "新增：火车、船、大巴可以导入，有自己的图标，时间旁边标「当地时间」；火车、船、大巴跟机票一样不能拖",
        "新增：长按卡片可以拖到别的日子，也能拖进「还没定哪天」，5 秒内可以撤销；有酒店或机票、车票、船票的行程，「全部」按日期一天一栏",
        "新增：备注跟着地点走，同一个地方加进别的行程，上次写的备注还在",
        "新增：手动加机票可以选去程、返程、转机",
        "调整：『清空全部』改成『清空这趟』，只清当前这一趟；『清空本机数据』挪到使用说明最下面；导入已有的行程会先问覆盖还是另存一份；旧备份照样能导入",
        "调整：「甜品」改叫「咖啡甜点酒吧」；『给 AI 的话』『分享给朋友』『找不到？换个方式加』各合成一个入口；手动填写的图标少了「酒店」「交通」",
        "调整：导入时分不清月和日的日期会问一句；缺日期的酒店先放进「待补」",
        "调整：打开行程时，日期条直接停在第一天那一周；旅行中停在今天，整趟结束了停在最后一天",
        "修复：长按卡片不再选中文字；退房卡的文字不再被『带我去』挡住",
        "修复：往返中间没订酒店时，误显示成转机"
      ]
    },
    {
      /* v5.4 更新记录：广告文案宣传大师定稿 */
      version: "v5.4",
      date: "2026-11-16",
      lines: [
        "新增：长按卡片，在同一天里拖动换顺序，机票固定不动；拖完 5 秒内可以撤销",
        "新增：两站之间显示直线距离和『路线』，点一下从上一站导航到下一站；当天最后一站显示『回酒店』；缺位置的显示「补位置」",
        "新增：往返机票自动标「去程」「回程」；手动加机票可以点『再加一张返程』",
        "调整：加酒店要先选入住和退房日期，退房那天多一张「退房」卡；『带我去』挪到卡片右边，从你现在的位置出发",
        "调整：导入机票时，落地比起飞早的会先问一句；几处界面颜色和间距统一了"
      ]
    },
    {
      /* v5.3 更新记录：定稿 */
      version: "v5.3",
      date: "2026-11-16",
      lines: [
        "新增：待补地点自动列出候选，点一下确认；搜不到的在地图上长按选点；待补地点集中在一个面板里补",
        "调整：搜索框能直接粘贴地址；搜索先找附近，没有再搜全球；导入时搜到多个位置不再自动用第一个，放进待补让你确认",
        "调整：点『添加』先选加机票、酒店还是地点；AI 向导只写截图里看得到的地址；放到桌面的引导文字更短了"
      ]
    },
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
