/**
 * 旅行心愿地图 — 目的地数据
 * 在本文件中编辑 DESTINATIONS 数组即可增删改地点，无需构建步骤。
 * 字段说明见 README.md。
 *
 * 当前条目均为示例数据（example: true），仅用于演示功能。
 *
 * 航班时刻约定：
 *   departDate / departTime 是出发机场的当地墙钟时间；
 *   arriveDate / arriveTime 是到达机场的当地墙钟时间。
 *   不要用浏览器时区去换算，也不要存成 Date/ISO UTC。
 *   展示格式示例：10:00 LHR → 06:30+1 HND（+1 表示到达当地日期比出发当地日期晚一天）。
 */
const DESTINATIONS = [
  {
    id: "santorini",
    nameZh: "圣托里尼",
    nameEn: "Santorini",
    countryZh: "希腊",
    countryEn: "Greece",
    continent: "欧洲",
    lat: 36.3932,
    lng: 25.4615,
    bestMonths: [5, 6, 7, 8, 9],
    budget: 3,
    tripDays: 5,
    tags: ["海岛", "美食", "城市"],
    priority: 2,
    status: "想去",
    note: "傍晚去伊亚看日落，错开邮轮高峰时段会更舒服。",
    flightHoursFromLondon: 4,
    flightFromLondon: {
      fromAirport: "LHR",
      toAirport: "JTR",
      departDate: "2026-06-12",
      departTime: "10:15",
      arriveDate: "2026-06-12",
      arriveTime: "16:15"
    },
    example: true
  },
  {
    id: "kyoto",
    nameZh: "京都",
    nameEn: "Kyoto",
    countryZh: "日本",
    countryEn: "Japan",
    continent: "亚洲",
    lat: 35.0116,
    lng: 135.7681,
    bestMonths: [3, 4, 10, 11],
    budget: 2,
    tripDays: 7,
    tags: ["城市", "美食", "自然"],
    priority: 1,
    status: "计划中",
    note: "春樱与秋叶最盛，寺院请提早预约，避开黄金周。",
    flightHoursFromLondon: 12,
    flightFromLondon: {
      fromAirport: "LHR",
      toAirport: "HND",
      departDate: "2026-04-10",
      departTime: "10:00",
      arriveDate: "2026-04-11",
      arriveTime: "06:30"
    },
    example: true
  },
  {
    id: "iceland",
    nameZh: "冰岛",
    nameEn: "Iceland",
    countryZh: "冰岛",
    countryEn: "Iceland",
    continent: "欧洲",
    lat: 64.1466,
    lng: -21.9426,
    bestMonths: [2, 3, 6, 7, 8, 9],
    budget: 3,
    tripDays: 8,
    tags: ["自然"],
    priority: 1,
    status: "想去",
    note: "夏日适合环岛看瀑布与冰川；冬春可碰极光，但天气更难预料。",
    flightHoursFromLondon: 3.5,
    flightFromLondon: {
      fromAirport: "LHR",
      toAirport: "KEF",
      departDate: "2026-07-08",
      departTime: "08:40",
      arriveDate: "2026-07-08",
      arriveTime: "10:55"
    },
    example: true
  },
  {
    id: "maldives",
    nameZh: "马尔代夫",
    nameEn: "Maldives",
    countryZh: "马尔代夫",
    countryEn: "Maldives",
    continent: "亚洲",
    lat: 3.2028,
    lng: 73.2207,
    bestMonths: [12, 1, 2, 3, 4],
    budget: 3,
    tripDays: 6,
    tags: ["海岛"],
    priority: 3,
    status: "想去",
    note: "旱季海水更清。选岛比选航班更关键，留意水屋与沙屋的差别。",
    flightHoursFromLondon: 11,
    flightFromLondon: {
      fromAirport: "LHR",
      toAirport: "MLE",
      departDate: "2026-01-15",
      departTime: "19:00",
      arriveDate: "2026-01-16",
      arriveTime: "11:00"
    },
    example: true
  },
  {
    id: "banff",
    nameZh: "班夫",
    nameEn: "Banff",
    countryZh: "加拿大",
    countryEn: "Canada",
    continent: "北美洲",
    lat: 51.1784,
    lng: -115.5708,
    bestMonths: [1, 2, 3, 6, 7, 8, 12],
    budget: 2,
    tripDays: 7,
    tags: ["自然", "滑雪"],
    priority: 2,
    status: "想去",
    note: "冬日滑雪、夏日徒步路易斯湖。从卡尔加里入境，租车最方便。",
    flightHoursFromLondon: 9.5,
    flightFromLondon: {
      fromAirport: "LHR",
      toAirport: "YYC",
      departDate: "2026-07-10",
      departTime: "16:20",
      arriveDate: "2026-07-10",
      arriveTime: "18:50"
    },
    example: true
  },
  {
    id: "queenstown",
    nameZh: "皇后镇",
    nameEn: "Queenstown",
    countryZh: "新西兰",
    countryEn: "New Zealand",
    continent: "大洋洲",
    lat: -45.0312,
    lng: 168.6626,
    bestMonths: [1, 2, 6, 7, 8, 12],
    budget: 3,
    tripDays: 10,
    tags: ["自然", "滑雪", "美食"],
    priority: 2,
    status: "计划中",
    note: "南半球季节相反：当地冬季可滑雪，夏季适合徒步米尔福德峡湾。",
    flightHoursFromLondon: 24,
    flightFromLondon: {
      fromAirport: "LHR",
      toAirport: "ZQN",
      departDate: "2026-01-20",
      departTime: "21:00",
      arriveDate: "2026-01-22",
      arriveTime: "10:00"
    },
    example: true
  },
  {
    id: "capetown",
    nameZh: "开普敦",
    nameEn: "Cape Town",
    countryZh: "南非",
    countryEn: "South Africa",
    continent: "非洲",
    lat: -33.9249,
    lng: 18.4241,
    bestMonths: [11, 12, 1, 2, 3],
    budget: 2,
    tripDays: 8,
    tags: ["城市", "自然", "美食"],
    priority: 1,
    status: "想去",
    note: "桌山、好望角与葡萄酒产区可搭配。南半球夏日更宜人。",
    flightHoursFromLondon: 11.5,
    flightFromLondon: {
      fromAirport: "LHR",
      toAirport: "CPT",
      departDate: "2026-02-05",
      departTime: "18:00",
      arriveDate: "2026-02-06",
      arriveTime: "08:30"
    },
    example: true
  },
  {
    id: "marrakech",
    nameZh: "马拉喀什",
    nameEn: "Marrakech",
    countryZh: "摩洛哥",
    countryEn: "Morocco",
    continent: "非洲",
    lat: 31.6295,
    lng: -7.9811,
    bestMonths: [3, 4, 5, 9, 10, 11],
    budget: 1,
    tripDays: 4,
    tags: ["城市", "美食"],
    priority: 3,
    status: "去过",
    note: "麦地那巷弄很适合漫走，盛夏很热，春秋更合适。此条为示例「去过」状态。",
    flightHoursFromLondon: 3.5,
    flightFromLondon: {
      fromAirport: "LHR",
      toAirport: "RAK",
      departDate: "2026-04-18",
      departTime: "09:15",
      arriveDate: "2026-04-18",
      arriveTime: "13:45"
    },
    example: true
  }
];

/**
 * 示例行程时间线（与上面的心愿清单相互独立，同样都是示例数据）。
 *
 * items 按行程顺序排列。相邻且都有坐标的条目之间会自动生成交通连接条。
 * 航班时刻为各自身机场的当地墙钟时间：出发放在出发当地日期，到达放在到达当地日期。
 *
 * 交通腿（leg）只保存：起点、终点、选用的出行方式、备注。
 * 不在页面内请求或计算路线。
 */
const EXAMPLE_TRIPS = [
  {
    id: "london-example",
    nameZh: "伦敦中转（示例）",
    nameEn: "London stopover",
    example: true,
    items: [
      {
        id: "lhr-arrival",
        type: "flight",
        nameZh: "希思罗机场",
        nameEn: "Heathrow Airport",
        fromNameZh: "菲乌米奇诺机场",
        fromNameEn: "Fiumicino Airport",
        flightNo: "BA0698",
        fromAirport: "FCO",
        toAirport: "LHR",
        departDate: "2026-06-12",
        departTime: "09:00",
        arriveDate: "2026-06-12",
        arriveTime: "10:35",
        confirmationNo: "EXG1BA",
        seat: "14A",
        fromLat: 41.800278,
        fromLng: 12.238889,
        lat: 51.47002,
        lng: -0.454295
      },
      {
        id: "savoy",
        type: "hotel",
        nameZh: "萨沃伊酒店",
        nameEn: "The Savoy",
        address: "Strand, London WC2R 0EU",
        checkIn: "2026-06-12",
        checkOut: "2026-06-14",
        confirmationNo: "SAV-EXAMPLE-001",
        lat: 51.51015,
        lng: -0.12047
      }
    ],
    legs: [
      {
        origin: "lhr-arrival",
        destination: "savoy",
        mode: "公共交通",
        note: "机场快线或出租车，约 45–60 分钟（示例备注）"
      }
    ]
  },
  {
    id: "shanghai-example",
    nameZh: "上海周末（示例）",
    nameEn: "Shanghai weekend",
    example: true,
    items: [
      {
        id: "pvg-arrival",
        type: "flight",
        nameZh: "上海浦东国际机场",
        nameEn: "Shanghai Pudong International Airport",
        fromNameZh: "希思罗机场",
        fromNameEn: "Heathrow Airport",
        flightNo: "MU552",
        fromAirport: "LHR",
        toAirport: "PVG",
        departDate: "2026-09-18",
        departTime: "11:20",
        arriveDate: "2026-09-19",
        arriveTime: "06:10",
        confirmationNo: "MUEX88",
        seat: "32K",
        fromLat: 51.47002,
        fromLng: -0.454295,
        lat: 31.143378,
        lng: 121.805214
      },
      {
        id: "the-bund",
        type: "place",
        nameZh: "外滩",
        nameEn: "The Bund",
        date: "2026-09-19",
        time: "10:00",
        note: "沿中山东一路散步看外滩建筑群（示例）。",
        lat: 31.240105,
        lng: 121.490432
      }
    ],
    legs: [
      {
        origin: "pvg-arrival",
        destination: "the-bund",
        mode: "公共交通",
        note: "磁浮 + 地铁 2 号线，约 1 小时（示例备注）"
      }
    ]
  }
];
