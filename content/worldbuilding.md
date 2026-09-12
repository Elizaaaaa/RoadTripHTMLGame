# 世界观命名 canon（已确认，后续正式文案请遵循）

游戏名：**《公路旅行禁止偏航 - 白湖镇》**

| 中文 | English | 说明 |
|---|---|---|
| 小镇 | White Lake | 镇名 |
| 干湖 | White Lake Dry Bed | 镇西侧干涸的湖床 |
| 山谷 | White Lake Valley | 小镇所在的山谷 |
| 公司 | White Lake Alkali Company | （虚构）曾经运营小镇的制碱公司，公司镇性质、具体情节留给正式文案展开 |
| 简称 | the Lake | 居民口头对整片区域的简称 |
| 格拉基 | Ghatanothoa | 幕后的邪神本体，全程不直接出场 |
| 时间裂隙 | —（英文待定） | 1982 年被子午线仪剪出去的那一层，真实的白湖镇和全部镇民都在里面 |
| 现实投影 | —（英文待定） | 现实世界这一侧留下的空镇，玩家走的整张地图都是它；两层靠实体物品耦合 |
| 湖心刺核 | —（英文待定） | 一万年前落在白湖的格拉基胚种，1982 年调查员给它起的名字 |
| 子午线仪 | The Meridian Engine | 1982 年调查员用矿场异常晶体 + 铁路信号设备 + 工厂压力仪表改造出的封印装置，现封存在废弃工厂地下 |
| 盐刺行尸 | —（英文待定） | 被湖心刺核污染的镇民（眷属）的正式称呼，外观特征见 `design-doc.md` 1.4 节 |

> 下面四行（格拉基 / 湖心刺核 / 子午线仪 / 盐刺行尸）来自 2026-09-11 的真相设定大纲，完整背景见 `design-doc.md` 第 1 节 1.1-1.5。写正式文案时中文名按上表固定，英文名待定的两条先不要在正文里出现英文。

## 现实原型（写具体细节时可以借用，但请按实际资料核对）

白湖镇的底子是真实存在的加州 **Trona**（圣贝纳迪诺郡，位于干涸的 **Searles Lake** 湖床边），一座围着碱/硼矿加工厂长起来的公司镇——这正是 White Lake Alkali Company 和"干湖 + 制碱厂 + 公司镇"这套设定的来源。2019 年 7 月 4 日的 M6.4 和 7 月 5 日的 M7.1 地震（Ridgecrest 地震序列）中受创最重的也是这一带，游戏把这两次地震作为跨结局的固定事件写进了剧情，见 `design-doc.md` 1.6 节。

借用现实细节（厂区样貌、盐碱地景观、镇子规模、地震当天的实际情形）能让文案很扎实，但白湖镇本身是虚构的，不要把真实居民、真实企业的具体人事写进剧情。

## 目前 content/ 示例数据里已经跟进的部分

- `assets/maps/hotspots.json`：热点 `lake` 的显示名从占位的"雾湖"改成了"干湖"
- `assets/maps/placeholder-town-map.svg`：地图标题改成"白湖镇"，6 号点位标签改成"干湖"，池子的颜色/纹理从水面改成了干涸盐碱地的样子（不再是水色渐变+波纹）
- `content/archive.json`：档案库键名 `fogLake` 改成了 `dryLake`，标题改"干湖"，正文里"浮着白雾/沉在湖底"这类跟"湖已干涸"矛盾的描述改成了"龟裂盐碱地/半埋在干裂湖床下"；`oldChurch` 词条里引用它的地方也同步改了
- `content/days.json`：事件 e1/e2 的正文和复盘 r1 的 prompt 里，"雾湖"关键词同步改成"干湖"，key 同步改成 `dryLake`
- **正式地图已上线**：占位 SVG 换成了手绘风格正式地图 `assets/maps/white-lake-map.png`（1536×1024），`assets/maps/hotspots.json` 按图上标注的 11 个建筑图标重新拾取坐标并整体改名——`square`（中心广场）/`library`（图书馆，原"旧书馆"）/`lake`（干湖）/`cemetery`（墓地）/`gasStation`（废弃加油站，basecamp）保留原 id 只挪坐标+改名，新增 `hotel`（旅店）/`restaurant`（餐馆）/`museum`（博物馆）/`highSchool`（高中）/`alkaliWorks`（制碱厂）/`theSink`（大坑）六个新点位；原占位版里画的 `clinic`（康宁诊所）/`inn`（白鹭旅店）/`market`（灯笼集市）/`chapel`（圣礼教堂）/`station`（火车站）/`lighthouse`（灯塔）六个点位在正式地图上没有对应建筑，已删除。其中 `chapel` 挂的支线事件 `e9`（`content/days.json`）和 `oldChurch` 词条的钟楼描述本来就写的是"半埋在干裂的湖床下"，物理上就在干湖范围内，所以把 `e9.loc` 和 day2 的 `unlockedLocations` 从 `chapel` 改成了 `lake`，文案不用动；`design-doc.md` / `游戏设计框架.md` 里 e9 的示例 `loc` 字段也同步改了。
- **坐标用 `tools/coord-picker.html` 重新精确取点**（你自己动手拾取的，比上面那版手动估算准）：顺带把几个点位改了名——`alkaliWorks` 显示名"制碱厂"→"废弃工厂"、`hotel` "旅店"→"沙狐旅馆"、`highSchool` "高中"→"旧高中"、`gasStation` 显示名简化成"加油站"；原 `restaurant`（餐馆）点位换成了新点位 `tavern`"老约翰酒馆"（位置也不一样，不是简单改名）。`square`/`library`/`museum`/`cemetery`/`theSink` 坐标同步更新，显示名不变。`lake` 坐标后来也用取点工具重新定位过，显示名从"干湖"改成了"白湖"。
- **地图改成「墨迹揭图」**：一开局看到的底图换成了白湖镇现在的卫星照片 `assets/maps/white-lake-map-now.png`（`hotspots.json` 的 `mapImage`），手绘旧地图 `white-lake-map.png` 降级成 `detailImage`——只有已解锁的地点，才会在它周围像墨水在纸上洇开一样渲染出旧地图的那一块（`engine/map.js` 的「墨迹揭图」一节：canvas 画不规则墨渍 + `globalCompositeOperation='source-in'` 裁出手绘图，墨渍形状按热点 id 取种子随机、每次刷新一致，边缘再描一圈吸墨的深色）。两张图同尺寸同取景（1536×1024），所以坐标表不用动；挨得近的点洇开后会连成一片，占地大的地点（`lake`/`alkaliWorks`）用新增的可选字段 `inkRadius` 单独放大了范围。叙事上这正好把「现在的白湖镇」和「他们查出来的白湖镇」叠在了同一张图上：查到哪儿，旧地图就长到哪儿。揭开过的区域不随换天收回（跟记事本词条一个逻辑）。所有地点都揭开过之后还有个收尾：墨从镇中心漫过整张纸，卫星底图整个让位给完整的手绘地图（含图廓、罗盘、比例尺这些只在整图上才有的东西），当成「把整个镇子摸清了」的视觉奖励。
- **修了一个地图引擎的显示 bug**（不是坐标数据的问题）：`engine/ui.css` 里 `.map-image` 用 `object-fit:contain` 保持底图 3:2 的原始比例，但热点的 `x`/`y` 百分比之前是直接套在整个视口盒子上算的——只要浏览器窗口宽高比跟底图不完全一致（几乎总是这样），`object-fit:contain` 留出的黑边就会把所有热点一起挤偏，窗口越宽/越窄偏得越厉害。改法是给 `.map-image` 包了一层 `.map-image-box`，`engine/map.js` 新增 `layoutImageBox()` 在图片加载完成和窗口 resize 时精确计算这个盒子的位置/大小（对齐 object-fit:contain 实际渲染出来的那个矩形），`<img>` 和所有 `.hotspot` 都挂在这个盒子下面，百分比才会真的对应图片本身而不是视口。用 Playwright 在好几种视口宽高比（含用户截图那种很宽的窗口）下量过热点中心点相对图片的百分比，跟 `hotspots.json` 里的数值误差都在 0.01% 以内；resize 窗口、缩放、点击热点弹事件也都重新测过，没问题。之前坐标看起来"选得准却在游戏里显示歪"，根源就是这个，不是取点或数据的问题。

## 还没跟进、留给你自己写的部分

- 新地图上的 `hotel`/`tavern`/`museum`/`highSchool`/`alkaliWorks`/`theSink` 六个新点位目前只有 id、显示名和坐标，`content/days.json` 里还没有任何事件挂在这些 loc 上，也都不在任何一天的 `unlockedLocations` 里——正式关卡设计需要你自己安排哪天解锁哪个点、写对应的事件/线索
- **White Lake Alkali Company（制碱公司）** 和 **White Lake Valley（山谷）** 这两个设定目前在 `content/` 里还没有对应的档案库词条、事件——是公司镇怎么垮的、山谷里发生过什么，都还没有具体情节；不过地图上新加的 `alkaliWorks`（废弃工厂）、`theSink`（神秘大坑）两个点位天然适合承接这段设定，这部分需要你自己决定并写进 `content/archive.json` / `content/days.json`，引擎不会替你编
- `index.html` 的 `<title>` 已经改成正式游戏名，但页面内 `#status-bar` 目前没有单独展示游戏名/镇名的地方，如果想让标题在游戏内可见（不只是浏览器标签页），需要在 `index.html` / `engine/main.js` 里加一个展示位
