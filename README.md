# 旅行心愿地图（第一版）

一份可直接在浏览器里打开的小工具。默认进入**行程时间线**：导入或按名称添加机票、酒店和地点，按日期排列，并在相邻地点之间生成交通连接。心愿清单是次要页。首次打开是空行程，需要演示数据时再点「载入示例」。

**当前数据全部是示例**（`example: true`，页面顶部有「示例数据」横幅），用来跑通功能，不是你的真实心愿清单或已订行程。换成自己的数据时，编辑 `data.js` 即可。

## 如何打开

无需安装、无需构建。用浏览器直接打开 `index.html`（需要能访问 Leaflet / OpenStreetMap 与字体的 CDN）。

也可以用本地静态服务：

```bash
python3 -m http.server 8080 --directory .
```

然后访问 `http://localhost:8080`。示例行程视图：`http://localhost:8080/?view=timeline`（可再加 `&trip=london-example` 或 `&trip=shanghai-example`）。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.html` | 页面结构 |
| `styles.css` | 样式（桌面左右分栏，手机上地图在上、列表在下） |
| `data.js` | 心愿目的地 `DESTINATIONS` 与示例行程 `EXAMPLE_TRIPS` |
| `geo.js` | 中国大陆判断、WGS-84→GCJ-02、谷歌/高德导航链接（无路线计算） |
| `app.js` | 心愿地图、卡片、筛选、排序、状态保存 |
| `timeline.js` | 示例行程时间线与交通连接条 |
| `airports.js` | 约 180 个主要机场的 WGS-84 坐标（机票解析用） |
| `geocode.js` | Nominatim 地理编码（1 次/秒，localStorage 缓存） |
| `import.js` | 行程导入（自动识别管道格式 / JSON，支持中英文字段） |
| `backup.js` | 导出 / 导入全部数据备份 |
| `manifest.webmanifest` / `sw.js` / `icons/` | 可安装到手机主屏幕（相对路径，适合 GitHub Pages 子目录） |
| `导入格式说明.txt` | 导入格式说明（推荐管道格式） |
| `check.js` / `check-import.js` | 可选的离线校验（`node check.js`、`node check-import.js`） |

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

**交通连接条**会自动出现在每两个相邻、且都有坐标的条目之间，文案为「起点名 —— 终点名」。点击后可选择出行方式（公共交通 / 驾车 / 步行 / 打车），并用链接打开导航应用：

- 谷歌地图：`https://www.google.com/maps/dir/?api=1&origin=LAT,LNG&destination=LAT,LNG&travelmode=transit|driving|walking`（打车使用 `driving`）
- 高德：`https://uri.amap.com/navigation?from=LNG,LAT,NAME&to=LNG,LAT,NAME&mode=bus|car|walk&callnative=1`（打车使用 `car`，因官方 URI 未单独列出 taxi）

手机上这两个链接是普通的 `<a href="..." target="_blank">`，可唤起已安装的导航应用；不要在异步回调里再用 `window.open`。

推荐应用：若**两端都在中国大陆**（简单包围盒，并排除港澳台），默认推荐高德；否则推荐谷歌地图。中国大陆点在生成高德链接前会把存储的 WGS-84 转成 GCJ-02（标准 `wgs2gcj` 算法）。高德在中国大陆使用 GCJ-02，这是已知限制。

交通腿只保存：起点、终点、选用的出行方式、一句备注（例如「机场快线 30 分钟」）。可选显示两点直线距离，**页面不请求、不计算导航路线**。

自带两条用于验收的真实地点示例：

1. 希思罗机场 → 萨沃伊酒店（The Savoy, Strand，伦敦）
2. 上海浦东国际机场 → 外滩


## 导入行程（推荐管道格式）

在「示例行程」页点击「导入行程」，把文本粘贴进同一个输入框。工具会自动识别：

1. **管道格式（推荐）**：固定 5 列 `类型 | 名称 | 地址 | 日期时间 | 备注`（空单元格保留竖线；也可用全角 ｜）。类型为 机票 / 酒店 / 地点，地点可写成 `地点/餐厅`、`地点/景点`、`地点/街道`。
2. **JSON**：以 `[` 或 `{` 开头。约定英文字段：机票 `type, flight_no, from, to, depart, arrive, confirmation?, seat?`；酒店 `type, name, address, check_in, check_out, confirmation?`；地点 `type, subtype?, name, address?, map_url?, date?, note?`。中文键仍然可用。同一框可混合粘贴管道和 JSON。

格式有问题时，会用中文说明是第几行（JSON 则是第几条）以及错在哪里，并仍然导入正确的行。完整规则、可复制的三行示例和 Dishoom JSON 见 `导入格式说明.txt`。

航班的日期时间按**各自身机场的当地墙钟时间**书写，例如 `2026-12-01 09:30 ~ 2026-12-02 07:00`。文字地址和名称会通过 OpenStreetMap Nominatim 查找坐标（无需密钥，每秒 1 次，结果缓存在本机）。机票先查内置机场表。找不到或多个候选时，预览行会标成黄色，可挑选或重试；不会因此中断整批导入。页面不计算导航路线。

行程数据保存在本机 `localStorage`（`wishlist-map-trips-v1` 等）。请用页眉上醒目的「导出备份 / 导入备份」按钮下载带日期的 JSON；导入时可选择合并或整份替换。页脚有提示：数据只保存在本浏览器，换手机或清缓存前请先导出备份。

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
