# Free Your Trip（原「我的行程」，仓库 Trip-Map）

> **当前版本 v5.1（2026-11-16，未推送；线上为 v5）**：v5.1 = 导入日期宽容与「日期待确认」黄卡、日期颠倒提醒、设置里分成「分享我的行程」和「推荐这个工具」（各带一行说明）、地图「定位到我」按钮（位置只在内存里，不保存不上传）、窄屏顶栏与日期条标签、iPhone 启动图。版本规则：大版本 v5、v6…，小更新只变小数点（v5.1、v5.2…），版本号只在 `version.js` 里改。
>
> **v5（2026-11-16，已上线）**：改名 Free Your Trip；单条修改/删除、清空全部（10 秒撤销）；「有新版本」横条和每次发版的更新公告；设置里显示版本号和更新记录（版本号只在 `version.js` 里改）。备份/分享文件名改为 `freeyourtrip-share-日期.json`、`freeyourtrip-full-backup-日期.json`，文件格式不变，旧文件照样能导入。
>
> **网址**：https://freeyourtrip.github.io/ （仓库 `FreeYourTrip/freeyourtrip.github.io`，部署在根路径；线上为 v5，提交 `b71917b`）。本项目全部用相对路径，`manifest` 的 `start_url` / `scope` 为 `./`，service worker 以 `./sw.js` 注册，放在根路径或子目录都能用。旧网址 chickenbb52-hub.github.io/Trip-Map 已停用（返回 404，不做跳转）；两个网址的浏览器数据互不相通。

一份可直接在浏览器里打开的小工具。打开后是手机友好的行程列表：顶栏显示行程名称（可点按改名）和日期，右边用地图图标切换地图、用齿轮打开设置。用底部「＋ 添加」粘贴旅行顾问的清单或输入一个地名。相邻卡片之间的「带我去」胶囊会直接打开公共交通导航（中国大陆两端用高德，否则用谷歌地图）。首次打开是空行程。心愿清单逻辑仍保留在代码里，但界面上不再入口。

**当前数据全部是示例**（`example: true`，页面顶部有「示例数据」横幅），用来跑通功能，不是你的真实心愿清单或已订行程。换成自己的数据时，编辑 `data.js` 即可。

## 顶部日期条（v5）

列表上方是一条可左右滑动的日期条：每格显示日期（如 12/1）、星期和有安排日子的类型圆点（机票蓝、酒店紫、地点绿/橙/灰，沿用卡片颜色）。

- 范围：行程最早一天到最晚一天（含酒店退房日），没安排的日子也显示；今天离行程 31 天以内会延伸到今天，更远就不延伸、「今天」按钮隐藏。
- 打开时选中：今天有安排就选今天；否则选今天之后第一个有安排的日子；整个行程都过去了就选最后一个有安排的日子。
- 早于今天的日子变灰。右端固定「今天」按钮跳回今天。
- 点某一天只看那天；看全部日子点最前面的「全部」格（选它而不是“再点一次取消”，因为一直看得见、不用猜）。选中没安排的日子会显示“这天没有安排”和「看全部日子」。
- 左上角月份（如 2026年11月）点开是整月日历：每天有圆点，‹ › 换月；只有日期条范围内的日子能点，点了就选中并关闭。
- 住宿段：只按酒店算，入住日到退房日（没写退房日就到下一家酒店入住日，再没有就只算入住当天）；段名用酒店的 `city` 字段，没有就取地址最后一个逗号后面的部分（去掉邮编数字），再没有就用酒店名；整段都早于今天时标「已去」。
- 演示：`index.html?demo=japan&today=2026-11-16`（假数据，`today` 只在演示模式下生效），`demo=japan-month` 直接打开月历。

## 折叠屏 / 双屏（v5.1，大概适配）

- 600–799px 宽（折叠屏内屏等）：列表和日期条最宽 640px 居中，「＋ 添加」也最宽 640px，地图铺满。
- 双屏（`horizontal-viewport-segments: 2`）：左屏列表，右屏地图，转轴上不放东西；其他浏览器不受影响。
- 只在无头 Chrome 里模拟测过（344 / 600 / 768 / 900 宽；双屏用注入 CSS 的方式模拟），没上真机。

## 如何打开

无需安装、无需构建。用浏览器直接打开 `index.html` 即可。地图库使用本地 `vendor/` 中的 Leaflet 1.9.4，界面用系统字体栈，不加载外部字体或第三方脚本，并且没有统计或追踪脚本。地图图块默认来自 OpenStreetMap（需能访问 OSM）。可选的高德 JS API 仅在 `config.js` 填写了 Key 和安全密钥之后，才会在大陆搜索时按需加载。

也可以用本地静态服务：

```bash
python3 -m http.server 8080 --directory .
```

然后访问 `http://localhost:8080`。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.html` | 页面结构（列表 / 地图、添加与设置面板） |
| `styles.css` | 移动优先样式（约 390px 宽、大按钮、系统字体） |
| `data.js` | 心愿目的地 `DESTINATIONS` 与示例行程 `EXAMPLE_TRIPS` |
| `config.js` | 可选高德 Web 端 JS API（`AMAP_JS_KEY` / `AMAP_SECURITY_CODE`，默认都为空） |
| `geo.js` | 中国大陆判断、WGS-84↔GCJ-02、谷歌/高德导航链接（无路线计算） |
| `legs.js` | 航班前后路段端点、「转机」、当天第一段「从我的位置出发」规则 |
| `icons.js` | 统一线性 SVG 图标（界面不使用系统 emoji） |
| `app.js` | 心愿清单逻辑（界面已隐藏，代码保留） |
| `timeline.js` | 行程列表、地图、添加与导航 |
| `airports.js` | 约 180 个主要机场的 WGS-84 坐标（机票解析用） |
| `geocode.js` | Nominatim 地理编码（1 次/秒，8 秒超时）；已配置高德时，大陆查询按需走 JS API |
| `import.js` | 行程导入（自动识别管道格式 / JSON，支持中英文字段） |
| `backup.js` | 分享导出、完整备份、导入与清空本机数据 |
| `ai-prompt.js` | 「复制给 AI 的话」的提示词正文 |
| `guess-type.js` | 按 OSM class/type 猜测地点类型 |
| `install-env.js` | 判断独立窗口 / iOS Safari / 微信等，决定「添加到桌面」提示 |
| `install-guide.js` | v5.2「放到手机桌面」引导：选哪种引导（微信遮罩 / iOS 底部说明 / 安卓 / 电脑）、何时自动弹、全部文案；`SHOW_SEPARATE_STORAGE_NOTE` 开关（有行程时的橙色提醒，待真机确认） |
| `trip-name.js` | v5.2 行程名胶囊与起名建议：默认名判断、日期范围、城市来源（去程到达机场 → 酒店地址 → 只用日期） |
| `item-edit.js` | 单条删除 / 撤销 / 清空全部 / 修改的纯函数 |
| `locate.js` | 地图「定位到我」按钮：只在点按钮时取一次位置，位置只放在内存里，不保存、不上传、不进分享 / 备份；高德（GCJ-02）底图下大陆坐标先转换 |
| `recommend.js` | 设置里的「推荐这个工具」：系统分享（`navigator.share`）或复制介绍文字和网址，不含任何行程数据 |
| `calendar.js` | 顶部日期条与月历的纯函数：日期范围、默认选中哪天、过去变灰、类型圆点、住宿段（规则写在文件开头） |
| `DESIGN.md` | 设计规范：从 `styles.css` 整理的颜色、字号、间距、圆角和组件规格，以及重复颜色清单 |
| `update-banner.js` | 注册 service worker；有新版本时显示「有新版本」横条（不强制更新） |
| `DEVLOG.md` | 开发决策与改动记录 |
| `vendor/` | 本地 Leaflet 1.9.4 脚本、样式与标记图 |
| `manifest.webmanifest` / `sw.js` / `icons/` | 可安装到手机主屏幕（相对路径，根路径或子目录都能用）。`icons/` 为 v5 新图标：16、32、120、152、167、180、192、512 和 `icon-maskable-512.png`，换图时保持文件名不变 |
| `cover-1200x630.png` / `splash-*.png` | 链接预览封面（og:image）和 iPhone 启动图（9 张：1290×2796、1179×2556、1170×2532、1284×2778、1125×2436、1242×2688、828×1792、1080×2340、750×1334，按 device-width / device-height / 像素比 / 竖屏匹配），都不进预缓存 |
| `导入格式说明.txt` | 导入格式说明（推荐管道格式） |
| `check.js` / `check-import.js` / `check-privacy.js` / `check-legs.js` / `check-guess-type.js` / `check-install-env.js` / `check-edit.js` / `check-update.js` / `check-version.js` / `check-calendar.js` / `check-patch.js` / `check-pending.js` / `check-locate.js` / `check-install-guide.js` / `check-name-suggest.js` / `check-import-tolerant.js` / `check-search-pick.js` / `check-v52-ui.js` / `check-fix-address.js` / `check-size.js` | 可选的离线校验（`check-size.js`：打印预缓存总量和比 `size-baseline.json` 的增减，超过 1.5 MB 或用了 png/jpg 图片只警告） |

## 心愿清单字段（`DESTINATIONS`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | 字符串 | 唯一标识，例如 `"kyoto"`。状态保存在 localStorage 时用它做键。 |
| `nameZh` / `nameEn` | 字符串 | 中文、英文名称 |
| `countryZh` / `countryEn` | 字符串 | 国家 |
| `continent` | 字符串 | 建议用：欧洲、亚洲、北美洲、南美洲、非洲、大洋洲 |
| `lat` / `lng` | 数字 | **WGS-84** 坐标（地图标记用） |
| `bestMonths` | 数字数组 | 适宜前往的月份，`1`–`12` |
| `budget` | `1` / `2` / `3` | 大致预算档：£ / ££ / £££ |
| `tripDays` | 数字 | 建议行程天数 |
| `tags` | 字符串数组 | 例如：海岛、城市、自然、美食、滑雪 |
| `priority` | `1` / `2` / `3` | 优先级，**1 最高** |
| `status` | 字符串 | `想去` / `计划中` / `去过`。可在卡片上更改，并写入本机 localStorage。 |
| `note` | 字符串 | 短备注 |
| `flightHoursFromLondon` | 数字 | 从伦敦出发的大约飞行小时数，仅用于排序和「大约航程」 |
| `flightFromLondon` | 对象 | 一条参考航班（见下方）。可省略。 |
| `example` | 布尔值 | 示例数据请设为 `true` |

## 航班时刻怎么写

航班时刻一律按**各自机场的当地墙钟时间**存放，不要换算成浏览器时区，也不要存成 UTC 的 `Date` / ISO 时间戳。

```js
flightFromLondon: {
  fromAirport: "LHR",
  toAirport: "HND",
  departDate: "2026-04-10",  // 出发机场当地日期（YYYY-MM-DD）
  departTime: "10:00",       // 出发机场当地时刻（HH:MM）
  arriveDate: "2026-04-11",  // 到达机场当地日期
  arriveTime: "06:30"        // 到达机场当地时刻
}
```

页面展示为：`10:00 LHR → 06:30+1 HND`。`+1` / `+2` / `-1` 是到达当地日期相对出发当地日期的日历日差，不是时区换算。

在行程时间线上：航班主体放在**出发地当地日期**；到达放在**目的地当地日期**（跨日则出现在后一天）。

行程里的航班还可以有：`flightNo`（航班号）、`confirmationNo`（确认号，可选）、`seat`（座位，可选），以及出发机场名称 `fromNameZh` / `fromNameEn`。

## 示例行程与交通连接

`EXAMPLE_TRIPS` 是行程数组。每条行程包含按顺序排列的 `items`（`flight` / `hotel` / `place`）。

酒店字段：`nameZh` / `nameEn`、`address`、`checkIn` / `checkOut`（当地日历日）、可选 `confirmationNo`，以及 WGS-84 的 `lat` / `lng`。

相邻卡片之间会出现品牌色的「带我去 → 下一项」胶囊（每天第一项之前是「从我的位置 带我去」；两段航班相邻则为不可点击的「转机」）。点一下即用公共交通打开导航应用：

- 谷歌地图：`https://www.google.com/maps/dir/?api=1&origin=LAT,LNG&destination=LAT,LNG&travelmode=transit|driving|walking`（打车使用 `driving`）
- 高德：`https://uri.amap.com/navigation?from=LNG,LAT,NAME&to=LNG,LAT,NAME&mode=bus|car|walk&callnative=1`（打车使用 `car`，因官方 URI 未单独列出 taxi）

手机上这两个链接是普通的 `<a href="..." target="_blank">`，可唤起已安装的导航应用；不要在异步回调里再用 `window.open`。

推荐应用：若**两端都在中国大陆**（简单包围盒，并排除港澳台），默认推荐高德；否则推荐谷歌地图。中国大陆点在生成高德链接前会把存储的 WGS-84 转成 GCJ-02（标准 `wgs2gcj` 算法）。高德在中国大陆使用 GCJ-02，这是已知限制。

交通腿只保存：起点、终点、选用的出行方式、一句备注（例如「机场快线 30 分钟」）。可选显示两点直线距离，**页面不请求、不计算导航路线**。

自带两条用于验收的真实地点示例：

1. 希思罗机场 → 萨沃伊酒店（The Savoy, Strand，伦敦）
2. 上海浦东国际机场 → 外滩



## 高德地理编码（可选）

地址搜索默认使用 OpenStreetMap Nominatim，**不必申请密钥**。若希望对中国大陆地址用高德：

1. 到[高德开放平台](https://console.amap.com/)申请「Web 端（JS API）」Key，并把使用该站点的域名加入白名单（域名为 `freeyourtrip.github.io`）。同时创建安全密钥（`securityJsCode`）。
2. 把 Key 填进 `config.js` 的 `AMAP_JS_KEY`，把安全密钥填进 `AMAP_SECURITY_CODE`。不要把这两项写进要发给朋友的分享文件里（该文件本就不含密钥）。
3. 仅当两项都非空、且查询词看起来像中国大陆地址（含汉字，且不含港澳台常见词）时，才会按需懒加载 `https://webapi.amap.com/maps?v=2.0&key=…&plugin=AMap.PlaceSearch,AMap.AutoComplete`，并先设置 `window._AMapSecurityConfig`。加载后用 PlaceSearch（空结果再试 AutoComplete）。
4. 高德返回的是 GCJ-02，入库前**只转换一次**成 WGS-84。导航里发给高德的大陆坐标会再从存储的 WGS-84 转回 GCJ-02。不要对已经入库存成 WGS-84 的点再转一次。
5. 两项都为空时不会加载任何高德脚本，行为与只用 Nominatim 相同。出错、超时或配额用尽时回退 Nominatim / OSM，页面不会因此中断。底图仍用 Leaflet + OpenStreetMap 图块。

查找失败或超过 8 秒时，条目仍会留下，并提示「暂时找不到位置，可以先直接添加，之后再补地址」。没有坐标的条目卡片上显示「待补地址」，点它可以搜索补上位置；有地址没坐标时导航用名称 + 地址文本。

本页没有 Content-Security-Policy 元标签。若自行加上 CSP，需要放行 `https://webapi.amap.com`（以及其回源与图块域名），否则可选的高德脚本会被挡住。

## 航班之间怎么走

- 航班**之前**的地面段，终点是**出发机场**。
- 航班**之后**的地面段，起点是**到达机场**。
- 两段航班相邻时，中间显示不可点击的「转机」（可附中转时长），不是「带我去」。
- 每天第一段「从我的位置出发」若指向航班，目标是出发机场。

图标全部使用同一套线性 SVG（相同描边粗细），不用系统 emoji。转机段使用连接箭头图标。

## 导入行程（推荐管道格式）

点底部「添加」，把文本粘贴进同一个输入框（也可以只输入一个地名）。工具会自动识别：

1. **管道格式（推荐）**：固定 5 列 `类型 | 名称 | 地址 | 日期时间 | 备注`（空单元格保留竖线；也可用全角 ｜）。类型为 机票 / 酒店 / 地点，地点可写成 `地点/餐厅`、`地点/景点`、`地点/街道`。
2. **JSON**：以 `[` 或 `{` 开头。约定英文字段：机票 `type, flight_no, from, to, depart, arrive, confirmation?, seat?`；酒店 `type, name, address, check_in, check_out, confirmation?`；地点 `type, subtype?, name, address?, map_url?, date?, note?`。中文键仍然可用。同一框可混合粘贴管道和 JSON。

格式有问题时，会用中文说明是第几行（JSON 则是第几条）以及错在哪里，并仍然导入正确的行。完整规则、可复制的三行示例和 Dishoom JSON 见 `导入格式说明.txt`。

航班的日期时间按**各自身机场的当地墙钟时间**书写，例如 `2026-12-01 09:30 ~ 2026-12-02 07:00`。文字地址和名称会通过 OpenStreetMap Nominatim 查找坐标（无需密钥，每秒 1 次，结果缓存在本机）。机票先查内置机场表。找不到或多个候选时，预览行会标成黄色，可挑选或重试；不会因此中断整批导入。页面不计算导航路线。

行程只存在你的手机里，没有账号，也没有服务器，我们看不到。数据保存在本机浏览器（`localStorage` 键 `wishlist-map-trips-v1` 等）。只有搜索、显示地图和导航时，地名或地址会发给地图服务（OpenStreetMap、高德或 Google 地图）。在「设置」里可以「分享我的行程」（去掉确认号、座位及备注里的对应字样，也不含地理编码缓存，文件名如 `行程分享-YYYYMMDD.json`）或做「完整备份」（保留全部内容，仅自己保存，文件名如 `行程完整备份-YYYYMMDD.json`）。两种文件都可以用「导入」合并或替换。换手机或清缓存前请先做完整备份；也可以「清空本机数据」。

把站点放到 GitHub Pages 时，所有本地资源都使用相对路径（`./styles.css`、`./sw.js`、`start_url: "./"`），可部署在子目录如 `/repo-name/`。可用浏览器「添加到主屏幕」安装。service worker 只在 http/https 下注册，用 file:// 直接打开时不会启用，但不影响基本功能。



## 本地保存

- 心愿状态：`localStorage` 键 `wishlist-map-status-v1`
- 交通方式与备注：`wishlist-map-legs-v1`

刷新后仍在。要恢复数据文件里的默认值，清除对应键即可。

## 换成自己的清单

1. 编辑 `data.js`，按上面的字段增删改对象。
2. 真实数据请把 `example` 改为 `false` 或删掉该字段。
3. 若不再需要示例提示，可去掉 `index.html` 里的「示例数据」横幅。
4. 改完后刷新浏览器即可，不用打包。

## 说明

- 参考航班时刻、确认号和行程日期都是虚构示例，不能当作可订机票或酒店订单。
- 地图图块来自 OpenStreetMap，请遵守其使用条款。
- 可用 `node check.js` 校验坐标转换与导航链接（不启动浏览器）。
