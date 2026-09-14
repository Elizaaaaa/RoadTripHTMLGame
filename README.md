# 《公路旅行禁止偏航 - 白湖镇》· 引擎 README

**测试链接：** https://elizaaaaa.github.io/RoadTripHTMLGame/

本目录是 `design-doc.md` 第 7 节清单对应的落地结果：一套可复用的 **engine/**，配一份非正式的 **content/** 示例数据，验证"加油站出发 → 探索 → 复盘 → 发布 → 下一天 → 结局"这条主循环能跑通。**没有正式故事文案**——`content/` 里的文字全部标了"占位"或在 `_comment` 字段里写明是示例，你写真实故事时替换这些 JSON 即可，原则上不用改 `engine/` 里的代码。

全流程固定 **3 天**，每天时间窗口不同（配置在 `content/days.json` 每天数据的 `startMin`/`endMin` 字段，见 `engine/time.js`）：第 1 天只有晚上（20:00-24:00），第 2、3 天是全天（08:00-24:00）。

## 怎么运行

`index.html` 用 `fetch()` 加载 `content/*.json` 和 `assets/maps/hotspots.json`，浏览器出于安全策略会拦截 `file://` 协议下的本地 JSON 请求，所以**不能直接双击 `index.html` 打开**，需要起一个本地静态服务器，例如任选一种：

```bash
# Python（自带，最省事）
python -m http.server 8080

# Node
npx serve .
```

然后访问它给出的地址（如 `http://localhost:8080`）。如果忘了起服务器直接打开文件，页面会自己弹出提示，不会是空白页或看不懂的报错。

## 目录结构

```
design-doc.md          设计基准文档（唯一真源，改设计先改这里）
TODO.md                欠账清单：还缺哪些美术素材 / 界面 / 内容，做完就勾掉
index.html             页面骨架 + 状态栏/地图容器/弹窗容器，不含具体文案
engine/                 引擎代码，通用规则，不写死任何故事内容
  state.js              全局状态结构定义 + 存档/读档（localStorage）+ 每天存档点快照/回退（"重新度过今日"/"回到上一天"）
  time.js               时间系统：分钟计时钟、每天时间窗口（按天配置起止分钟）、超时判定
  map.js                 图片地图：百分比坐标热点渲染、缩放/平移、点击交互
  signal.js              信号闪现：被动随机弹留言，池子来自当天 content
  quake.js               地震演出：抖动 + 落灰 + 一拍死寂，按震级预设参数，零美术素材（用在 timedEvents 和结局上）
  reveal.js              逐字/逐句浮现：把文本包成带序号的 span，动画交给 ui.css 的 .rv-*（只用在结局和地震这类要有分量的地方）
  paper.js               折叠纸条演出：一张对折的纸条在屏幕中央翻开、摊平之后字迹才逐句淡入，点一下收起（事件正文里配了 paperSegments 的那一页走这条路）
  basecamp.js            加油站专属准入规则（翻旧报纸每日一次）
  sanity.js               理智值：数值、三档阈值、UI 反馈 class
  dice.js                 1d20 掷骰：按理智档位决定取骰次数/取值规则
  keyword-parser.js       解析 [[显示文字|key]] 语法为可点击 span
  archive.js              档案库：解锁、分类、跨天主案进度计算
  review.js               复盘：前置条件判定、选项提交、choiceLog 记录
  publish.js              发布 vlog：播放量结算（超时未归判"被黑暗吞噬"坏结局，见 main.js handleDayOver()，不走这个模块）
  vlogstats.js            发布之后弹出的"手机数据页"：把播放量派生成点赞/评论/关注/完播率等互动数据并渲染
  ending.js               结局判定：进度 × 理智值 2x2 矩阵 + 文案变体 + 后日谈(epilogue)分段
  main.js                 启动与流程编排，把上面这些模块接起来
  ui.css                  引擎侧通用界面样式（含理智值氛围反馈动效）
  phone.css               "手机数据页"专用样式（竖屏手机外壳 + 暖色玻璃拟态，跟 ui.css 的 macOS 灰调分开）
content/                 示例数据，非正式剧本，改这里不用碰 engine/
  worldbuilding.md         已确认的世界观命名 canon（镇名/地名/公司名），写正式文案前先看这个
  days.json               3 天示例：地点开放表、事件、掷骰事件、定时全局事件(两次地震)、信号池、复盘、旧报纸、每天时间窗口
  archive.json             示例档案库词条（含嵌套 [[]] 互跳、unlockedBy、linkedMainCase）
  endings.json             4 个结局的占位文案 + 后日谈 + choiceLog 文案变体示例
assets/maps/
  white-lake-map-now.png   底图：白湖镇「现在」的卫星照片（1536x1024），一开局看到的就是它
  white-lake-map.png      手绘旧地图（同尺寸同取景），地点解锁后在该点周围墨迹洇开露出来
  placeholder-town-map.svg 已弃用的占位地图底图，留作对照，没有代码在引用它了
  hotspots.json            热点坐标表（1 个 basecamp + 10 个 investigation）
tools/
  coord-picker.html        独立的地图坐标拾取小工具，见下方说明
  phone-preview.html       "手机数据页"预览工具：不用真玩到发布就能看样式，见下方说明
  quake-preview.html       地震演出 / 结局浮现预览工具：不用真玩到第 2 天上午就能调参，见下方说明
_legacy-reference/        重构前参照的旧原型（另一个故事，仅供工程参考，不是本项目内容）
```

## 换地图 / 加点位：坐标拾取小工具

`tools/coord-picker.html` 是纯前端单文件小工具，不属于游戏本体，双击直接用浏览器打开就行（不用起本地服务器）：拖一张地图图片进去（或用按钮选 / Ctrl+V 粘贴）→ 在图上点击想放标记的位置 → 右侧列表里改 `id`/`name`/`type` → 点「复制 JSON」或「下载 hotspots.json」，把结果贴进 [assets/maps/hotspots.json](assets/maps/hotspots.json)。支持滚轮缩放、拖动平移、拖动已有标记微调位置，坐标定义和 `hotspots.json` 里的 `x`/`y` 完全一致（像素位置 ÷ 图片原始宽高 × 100，跟图片在页面里显示多大无关）。

## 发布之后的"手机数据页"

每天在剪辑台点「确认发布」之后（当天配了复盘的话，是看完对错反馈点「完成」之后），会弹出一个竖屏手机界面：封面用地图底图压成暖色调当视频封面，下面是本期播放/点赞/评论三宫格、最热片段、完播率、新增关注和评论区，收起手机才接旅馆的「进入下一天」。播放量仍然由 `engine/publish.js` 结算，其余指标由 `engine/vlogstats.js` 按"播放量 + 当期素材重要度 + 理智档位"派生——用以（天数 + 播放量 + 素材 id）为种子的伪随机数，所以同一期数据反复打开都是同一组数字，算完还会缓存进 `state.publishLog` 那条记录的 `stats` 字段。理智濒崩时点赞/评论上浮、完播率下降，素材出错（`glitched`）时整体打折，都会在面板上给一句提示。发布过之后想再看一眼，可以从加油站「发布 vlog」tab 或顶部「开始剪辑」里的「查看本期数据」进去。

手机屏幕内容一屏放不下：滚轮之外还能**按住鼠标上下拖**（触屏走原生滑动，不接管；拖动超过 4px 才算拖拽，松手那一下的 click 会被吞掉，不会误触按钮）。手机左边空地上有一列「向下滑动查看更多」的提示，点它往下翻一屏，玩家自己滚过之后就淡出不再出现。

改这套界面的样式时用 `tools/phone-preview.html`（要起本地静态服务器，访问 `/tools/phone-preview.html`）：左上角能直接切第几天、理智档位、素材是否出错，不用真的从第 1 天玩到发布。

## 调地震演出 / 结局浮现：预览工具

`tools/quake-preview.html`（同样要起本地静态服务器，访问 `/tools/quake-preview.html`）：不用真的玩到第 2 天上午 10 点半，点一下按钮就能看地震演出——可以切震级预设、直接改振幅和时长，也能单独预览"地震 + 事件窗口"和结局窗口的逐字/逐句浮现节奏。改 `engine/quake.js`、`engine/reveal.js` 或 `ui.css` 里「地震演出」「逐字 / 逐句浮现」两节时用它对着调。

演出本身零美术素材：抖动是 CSS 关键帧（`#app` 和弹窗两层振幅不同、相位错开、一路衰减到停），落灰是几层互质间距的 radial-gradient 点阵以不同速度下落叠出来的视差，全程只动 transform/opacity，不碰 filter（原因见 `ui.css` 理智闪烁那一节的注释）。系统开了"减少动态效果"时自动只保留落灰和那一拍死寂，不抖。

## 调折叠纸条演出：预览工具

`tools/paper-preview.html`（同样要起本地静态服务器，访问 `/tools/paper-preview.html`）：不用玩到第 2 天早上，点一下按钮就能看纸条翻开——能改落下、翻开、字迹逐句淡入这三段的时长，也能直接改纸上的文字（支持 `[[显示文字|key]]`）。"事件窗口 + 纸条"那颗按钮连带演出前后的层次一起看：游戏里纸条就是摊在事件窗口之上的。改 `engine/paper.js` 或 `ui.css` 里「折叠纸条演出」那一节时用它对着调。

同样零美术素材：整张纸是两块 CSS 渐变拼的（各取同一块渐变的一半，拼起来才是连续的一张纸），下半块绕中间那道折痕做 `rotateX` 180°→0° 的翻转，翻到侧面的明暗是盖一层黑色渐变跟着淡出、不用 filter；纸上的字是系统自带的楷体。对折的纸包只占整张纸的上半截，所以翻开的同时整张纸会往上抬四分之一做补偿——纸包不跑位，摊平之后正好居中。系统开了"减少动态效果"时纸直接是平的，只留淡入。


## 内容结构速览（改故事只用改这几份 JSON）

- **`assets/maps/hotspots.json`**：`x`/`y` 是百分比坐标（0-100），`type` 只能是 `"basecamp"`（唯一，加油站）或 `"investigation"`。想换地图就把 `mapImage`（卫星底图）和 `detailImage`（手绘旧地图）指到你自己的图，热点用 `tools/coord-picker.html`（见上一节）重新量一遍。
  - **墨迹揭图**：`mapImage` 是一开局就看得见的底图，`detailImage` 只在已解锁地点周围像墨水洇开一样显示出来（`engine/map.js` 的「墨迹揭图」一节）。两张图必须同尺寸同取景，同一套 `x`/`y` 才对得上。可选字段 `inkRadius` 单独指定某个点洇开范围的半径（占图宽的百分比，不写默认 8.5），占地大的地点（白湖、废弃工厂）调大一点更自然。揭开过的区域不会随换天收回去。**所有热点都揭开过之后**，墨会从镇中心漫过整张纸，直接显示完整的 `detailImage`（连图廓、罗盘、比例尺一起），不再是一块块的。
- **`content/days.json`**：按天数字符串做 key（`"1"`、`"2"`、`"3"`），`meta.totalDays` 决定跑几天后进入结局判定（当前固定 3 天）。每天包含：
  - `startMin`/`endMin`：当天的时间窗口（分钟数，0:00=0），决定 `clock-display` 起始值和"超时未归"的判定点；不写则各自兜底 480(08:00)/1200(20:00)，见 `engine/time.js`
  - `unlockedLocations`：当天地图上哪些 investigation 热点是解锁的（加油站永远解锁，不用列）。可以是空数组——第 1 天就是空的，中心广场要玩家在加油站「翻旧报纸」里点开 `[[中心广场|square]]` 这个词条才会出现（词条侧的 `unlocksLocation`，见下）；`state.extraUnlockedLocations` 里动态解锁的地点全程累计，会叠加在当天这份名单之上
  - `events`：普通文本事件（`type:"text"`）或掷骰事件（`type:"diceCheck"`，需要 `diceThreshold` + `outcomes.{critFail,fail,success,critSuccess}`），`loc` 对应热点 id，`mainline` 标记是否主线，`clue`/`sanityCost`/`unlocksArchive` 都是可选字段
    - `paperSegments`：可选，形如 `[2]`——`text` 按换行分页之后，这里列出的那几页不进事件窗口，改成一张折叠纸条在屏幕中央摊开，摊平之后字迹才逐句淡入，玩家点一下收起（`engine/paper.js`）。文字仍写在同一段 `text` 里，所以调查回顾照样收录全文、关键词照样能点开词条。**纸条页不能是第 0 页**：窗口里得先有一页把纸条摆进场景（"桌上压着一张纸条"），纸条才有地方摊、那颗"继续"才有着落；真配成第 0 页会退化成普通正文并在控制台报一句。绑在这一页上的 `dialogues`（`afterSegment` 填纸条那一页）会在玩家收起纸条之后才播——先读纸，再听两个人聊
  - `timedEvents`：**定时全局事件**，到点就发生、跟玩家当时在哪无关（对应 design-doc.md 1.6 节的两次地震）。字段 `at` 是当天第几分钟（10:33 = 633），其余字段跟普通 `text` 事件一样（`text` 支持换行分页、`clue`/`sanityCost`/`unlocksArchive` 照常），另可配 `quake: { "magnitude": "6.4" | "7.1" }` 在弹文案之前先播一次地震演出（`engine/quake.js`）。判定是"这次交互推进的这一小时有没有跨过 `at`"，引擎每次交互固定推进 60 分钟，所以文案要容得下误差（写"大约十点半"而不是"10:33 整"）；也因为时间只在"去调查地点"时推进，`at` 配得晚就要求当天有足够多的点位，否则走不到那个时刻。`dialogues` 一样能绑在它上面（`afterEvent` 填 timedEvent 的 id）
  - `newspaper`：加油站"翻旧报纸"能看到的内容，每天只出一批新的；已经翻出来的那批，玩家再打开这个 tab 会原样再显示一遍（正文里的关键词链接是解锁词条/地点的入口，看一眼就收走会把当天卡死）
  - `signalPool`：信号闪现的候选池，被动小概率触发
  - `reviews`：复盘，`req` 是需要先采集到的 `clue` id 数组，`options[].tag` 会写进 `choiceLog`，供结局文案变体匹配
  - `vlogTitle`：这期 vlog 的标题，发布后的手机数据页显示在频道名下面；不写兜底"第 N 天的素材"
  - `vlogComments`：手机数据页评论区里的评论，`{ user, text, likes?, alien? }`，`alien:true` 显示成灰色斜体的"未知来源"评论（呼应"置顶那条不是我们发的"）；当天真的弹出过的信号闪现会自动接在后面，不用重复写
  - 频道名写在 `meta.channel`（`{ name, handle }`），不写兜底 `QQ & BB`
- **`content/archive.json`**：`category` 随便定义（地点/人物/事件/物品……），`linkedMainCase:true` 的词条才计入探索进度（5.3 节 progress），`unlockedBy` 目前只是给你自己看的注释，引擎侧任何途径调用 `archive.unlock()` 都算数，不校验来源。可选的 `unlocksLocation`（热点 id 数组）让"收集到这个词条"顺带把对应的调查地点开进地图——"先在报纸/告示上读到有这么个地方，才去得了"，只在玩家点击 `[[..|key]]` 链接时触发（`engine/main.js` 的 `unlockLocationsFromArchive`），第 1 天的 `square` 就是这么开的。
- **`content/endings.json`**：当前代码里还是旧模型的 4 个结局 key（`truth_escape`/`costly_escape`/`blind_escape`/`trapped`，对应旧的"探索进度×San值 2x2 矩阵"）；`variants[].when` 对应 `choiceLog` 里的 `tag`，命中就把 `text` 追加在结局正文后面。可选的 `epilogue`（后日谈）是**单独一页**，玩家在结局正文里点过"继续"之后才揭晓——design-doc.md 1.4 节要求结局②的翻转必须放在这里、正文那一段不许留破绽，所以两段在数据上就是分开的；`epilogue` 自身也能用换行继续分页。可选的 `quake` 会在结局窗口弹出之前先播一次地震演出。结局窗口的演出是标题逐字上浮 + 正文逐句淡入（`engine/reveal.js`）。**待更新**：设计已确认改成 3 个结局的新模型（San 值熔断/进度不够 → 结局①，进度达标后由高潮关键抉择二选一给出结局②/③），见 design-doc.md 5.3 节；`engine/ending.js` 和这份 JSON 都还没跟着改，等正式故事大纲到位后一起重构。

## 跑过的验证

- 手动过了一遍 DOM id 对照（`index.html` 静态 id vs `main.js` 动态生成 id），没有对不上的。
- 用 Node 直接跑了一遍 `engine/` 的纯逻辑模块（跳过 `map.js`/`main.js` 里依赖浏览器 DOM 的部分），拿真实的 `content/*.json` 数据模拟了两天完整流程：文本事件、掷骰事件三档取骰规则、信号闪现命中率、关键词解锁（含嵌套跳转）、复盘前置条件、加油站翻报纸/发布、超时惩罚、结局矩阵四个象限——68 项断言全部通过。
- 用本地静态服务器起了一遍，确认 `index.html`/`engine/*.js`/`content/*.json`/`assets/maps/*` 全部能被正常请求到（200）。
- **3 天时间窗口改版**（第 1 天 20:00-24:00、第 2/3 天 08:00-24:00）：所有 `content/*.json` 过了一遍 `JSON.parse` 校验；单独跑了 `time.js`/`state.js` 的边界断言——第 1 天初始时钟 20:00、走 2 次(180 分钟)未到 24:00、走第 3 次即判定超时，第 2/3 天重置到 08:00 且能连续走 10 次才到超时点——全部通过。新增的第 3 天示例内容（`theSink`/`cemetery` 两个地点、1 个掷骰事件、2 个文本事件、1 个复盘）尚未跑完整的浏览器端手动通关，改动故事文案或调整这部分时建议自己再点一遍。

- **定时全局事件 + 地震演出 + 结局后日谈**（本轮新增）：用 Node 直接跑了 `engine/time.js`、`engine/reveal.js`、`engine/ending.js` 加真实 `content/*.json` 的 117 项断言——第 2 天按 60 分钟步长走完全天，M6.4 恰好在第 3 次交互（600→660）弹一次且只弹一次，第 3 天 M7.1 落在第 13 次交互（1200→1260）；左开右闭区间验过不会在相邻两次推进里重复命中；逐句切分不会把 `[[显示文字|key]]` 切开；每个结局都有后日谈且都写了 M6.4/M7.1 两条记录；所有 `unlocksArchive` 的 key 在正文里都有对应的 `[[..|key]]` 链接、所有线索 id 在 `materials.json` 里都有登记、所有对话绑定的事件都存在且 `afterSegment` 不越界。
- **浏览器端实测**（Edge headless）：`quake.play({magnitude:'7.1'})` 的 promise 在 2800ms 兑现（1900 抖 + 900 死寂），演出期间 `body` 上是 `quaking quake-blocking`、落灰层 z-index 250 且接管点击、`#app`/`#modal-box` 各自挂上对应关键帧，结束后 class 全部摘干净、`#app` 的 animation 回到 `none`；截图对比确认地图确实位移、顶部确实压上了一层灰。结局窗口的 `.rv-char`/`.rv-clause` 计算样式也核过（逐字 0.05s、逐句 0.18s 递增）。

框架阶段没有覆盖到、故意先放着的点：
- 复盘只做了"选一个选项"这一种形式，原型参考里的"判断对错/排序"题型没有照搬——design-doc.md 对复盘的要求本身就是"记录关键选择供结局文案分支"，没有要求特定题型，所以先按最简单的够用实现来，你要更复杂的题型可以在 `review.js` 上加。
