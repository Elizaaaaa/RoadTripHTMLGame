# 世界观命名 canon（已确认，后续正式文案请遵循）

游戏名：**《公路旅行禁止偏航 - 白湖镇》**

| 中文 | English | 说明 |
|---|---|---|
| 小镇 | White Lake | 镇名 |
| 干湖 | White Lake Dry Bed | 镇西侧干涸的湖床 |
| 山谷 | White Lake Valley | 小镇所在的山谷 |
| 公司 | White Lake Alkali Company | （虚构）曾经运营小镇的制碱公司，公司镇性质、具体情节留给正式文案展开 |
| 简称 | the Lake | 居民口头对整片区域的简称 |

## 目前 content/ 示例数据里已经跟进的部分

- `assets/maps/hotspots.json`：热点 `lake` 的显示名从占位的"雾湖"改成了"干湖"
- `assets/maps/placeholder-town-map.svg`：地图标题改成"白湖镇"，6 号点位标签改成"干湖"，池子的颜色/纹理从水面改成了干涸盐碱地的样子（不再是水色渐变+波纹）
- `content/archive.json`：档案库键名 `fogLake` 改成了 `dryLake`，标题改"干湖"，正文里"浮着白雾/沉在湖底"这类跟"湖已干涸"矛盾的描述改成了"龟裂盐碱地/半埋在干裂湖床下"；`oldChurch` 词条里引用它的地方也同步改了
- `content/days.json`：事件 e1/e2 的正文和复盘 r1 的 prompt 里，"雾湖"关键词同步改成"干湖"，key 同步改成 `dryLake`
- **正式地图已上线**：占位 SVG 换成了手绘风格正式地图 `assets/maps/white-lake-map.png`（1536×1024），`assets/maps/hotspots.json` 按图上标注的 11 个建筑图标重新拾取坐标并整体改名——`square`（中心广场）/`library`（图书馆，原"旧书馆"）/`lake`（干湖）/`cemetery`（墓地）/`gasStation`（废弃加油站，basecamp）保留原 id 只挪坐标+改名，新增 `hotel`（旅店）/`restaurant`（餐馆）/`museum`（博物馆）/`highSchool`（高中）/`alkaliWorks`（制碱厂）/`theSink`（大坑）六个新点位；原占位版里画的 `clinic`（康宁诊所）/`inn`（白鹭旅店）/`market`（灯笼集市）/`chapel`（圣礼教堂）/`station`（火车站）/`lighthouse`（灯塔）六个点位在正式地图上没有对应建筑，已删除。其中 `chapel` 挂的支线事件 `e9`（`content/days.json`）和 `oldChurch` 词条的钟楼描述本来就写的是"半埋在干裂的湖床下"，物理上就在干湖范围内，所以把 `e9.loc` 和 day2 的 `unlockedLocations` 从 `chapel` 改成了 `lake`，文案不用动；`design-doc.md` / `游戏设计框架.md` 里 e9 的示例 `loc` 字段也同步改了。

## 还没跟进、留给你自己写的部分

- 新地图上的 `hotel`/`restaurant`/`museum`/`highSchool`/`alkaliWorks`/`theSink` 六个新点位目前只有 id、显示名和坐标，`content/days.json` 里还没有任何事件挂在这些 loc 上，也都不在任何一天的 `unlockedLocations` 里——正式关卡设计需要你自己安排哪天解锁哪个点、写对应的事件/线索
- **White Lake Alkali Company（制碱公司）** 和 **White Lake Valley（山谷）** 这两个设定目前在 `content/` 里还没有对应的档案库词条、事件——是公司镇怎么垮的、山谷里发生过什么，都还没有具体情节；不过地图上新加的 `alkaliWorks`（制碱厂）、`theSink`（大坑）两个点位天然适合承接这段设定，这部分需要你自己决定并写进 `content/archive.json` / `content/days.json`，引擎不会替你编
- `index.html` 的 `<title>` 已经改成正式游戏名，但页面内 `#status-bar` 目前没有单独展示游戏名/镇名的地方，如果想让标题在游戏内可见（不只是浏览器标签页），需要在 `index.html` / `engine/main.js` 里加一个展示位
