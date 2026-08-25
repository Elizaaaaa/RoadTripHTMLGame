# 《公路旅行禁止偏航 - 白湖镇》· 引擎 README

本目录是 `design-doc.md` 第 7 节清单对应的落地结果：一套可复用的 **engine/**，配一份非正式的 **content/** 示例数据，验证"加油站出发 → 探索 → 复盘 → 发布 → 下一天 → 结局"这条主循环能跑通。**没有正式故事文案**——`content/` 里的文字全部标了"占位"或在 `_comment` 字段里写明是示例，你写真实故事时替换这些 JSON 即可，原则上不用改 `engine/` 里的代码。

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
index.html             页面骨架 + 状态栏/地图容器/弹窗容器，不含具体文案
engine/                 引擎代码，通用规则，不写死任何故事内容
  state.js              全局状态结构定义 + 存档/读档（localStorage）
  time.js               时间系统：分钟计时钟、单日预算、超时判定
  map.js                 图片地图：百分比坐标热点渲染、缩放/平移、点击交互
  signal.js              信号闪现：被动随机弹留言，池子来自当天 content
  basecamp.js            加油站专属准入规则（翻旧报纸每日一次）
  sanity.js               理智值：数值、三档阈值、UI 反馈 class
  dice.js                 1d20 掷骰：按理智档位决定取骰次数/取值规则
  keyword-parser.js       解析 [[显示文字|key]] 语法为可点击 span
  archive.js              档案库：解锁、分类、跨天主案进度计算
  review.js               复盘：前置条件判定、选项提交、choiceLog 记录
  publish.js              发布 vlog：播放量结算、超时"更新失败"惩罚
  ending.js               结局判定：进度 × 理智值 2x2 矩阵 + 文案变体
  main.js                 启动与流程编排，把上面这些模块接起来
  ui.css                  引擎侧通用界面样式（含理智值氛围反馈动效）
content/                 示例数据，非正式剧本，改这里不用碰 engine/
  worldbuilding.md         已确认的世界观命名 canon（镇名/地名/公司名），写正式文案前先看这个
  days.json               2 天示例：地点开放表、事件、掷骰事件、信号池、复盘、旧报纸
  archive.json             示例档案库词条（含嵌套 [[]] 互跳、unlockedBy、linkedMainCase）
  endings.json             4 个结局的占位文案 + choiceLog 文案变体示例
assets/maps/
  white-lake-map.png      正式地图底图（白湖镇手绘图，1536x1024）
  placeholder-town-map.svg 已弃用的占位地图底图，留作对照，没有代码在引用它了
  hotspots.json            热点坐标表（1 个 basecamp + 10 个 investigation）
tools/
  coord-picker.html        独立的地图坐标拾取小工具，见下方说明
_legacy-reference/        重构前参照的旧原型（另一个故事，仅供工程参考，不是本项目内容）
```

## 换地图 / 加点位：坐标拾取小工具

`tools/coord-picker.html` 是纯前端单文件小工具，不属于游戏本体，双击直接用浏览器打开就行（不用起本地服务器）：拖一张地图图片进去（或用按钮选 / Ctrl+V 粘贴）→ 在图上点击想放标记的位置 → 右侧列表里改 `id`/`name`/`type` → 点「复制 JSON」或「下载 hotspots.json」，把结果贴进 [assets/maps/hotspots.json](assets/maps/hotspots.json)。支持滚轮缩放、拖动平移、拖动已有标记微调位置，坐标定义和 `hotspots.json` 里的 `x`/`y` 完全一致（像素位置 ÷ 图片原始宽高 × 100，跟图片在页面里显示多大无关）。

## 内容结构速览（改故事只用改这几份 JSON）

- **`assets/maps/hotspots.json`**：`x`/`y` 是百分比坐标（0-100），`type` 只能是 `"basecamp"`（唯一，加油站）或 `"investigation"`。想换地图就把 `mapImage` 指到你自己的图，热点用 `tools/coord-picker.html`（见上一节）重新量一遍。
- **`content/days.json`**：按天数字符串做 key（`"1"`、`"2"`……），`meta.totalDays` 决定跑几天后进入结局判定。每天包含：
  - `unlockedLocations`：当天地图上哪些 investigation 热点是解锁的（加油站永远解锁，不用列）
  - `events`：普通文本事件（`type:"text"`）或掷骰事件（`type:"diceCheck"`，需要 `diceThreshold` + `outcomes.{critFail,fail,success,critSuccess}`），`loc` 对应热点 id，`mainline` 标记是否主线，`clue`/`sanityCost`/`unlocksArchive` 都是可选字段
  - `newspaper`：加油站"翻旧报纸"能看到的内容，每天一次
  - `signalPool`：信号闪现的候选池，被动小概率触发
  - `reviews`：复盘，`req` 是需要先采集到的 `clue` id 数组，`options[].tag` 会写进 `choiceLog`，供结局文案变体匹配
- **`content/archive.json`**：`category` 随便定义（地点/人物/事件/物品……），`linkedMainCase:true` 的词条才计入探索进度（5.3 节 progress），`unlockedBy` 目前只是给你自己看的注释，引擎侧任何途径调用 `archive.unlock()` 都算数，不校验来源。
- **`content/endings.json`**：4 个结局 key 固定为 `truth_escape`/`costly_escape`/`blind_escape`/`trapped`，对应 design-doc.md 5.3 节矩阵；`variants[].when` 对应 `choiceLog` 里的 `tag`，命中就把 `text` 追加在结局正文后面。

## 跑过的验证

- 手动过了一遍 DOM id 对照（`index.html` 静态 id vs `main.js` 动态生成 id），没有对不上的。
- 用 Node 直接跑了一遍 `engine/` 的纯逻辑模块（跳过 `map.js`/`main.js` 里依赖浏览器 DOM 的部分），拿真实的 `content/*.json` 数据模拟了两天完整流程：文本事件、掷骰事件三档取骰规则、信号闪现命中率、关键词解锁（含嵌套跳转）、复盘前置条件、加油站翻报纸/发布、超时惩罚、结局矩阵四个象限——68 项断言全部通过。
- 用本地静态服务器起了一遍，确认 `index.html`/`engine/*.js`/`content/*.json`/`assets/maps/*` 全部能被正常请求到（200）。

框架阶段没有覆盖到、故意先放着的点：
- 复盘只做了"选一个选项"这一种形式，原型参考里的"判断对错/排序"题型没有照搬——design-doc.md 对复盘的要求本身就是"记录关键选择供结局文案分支"，没有要求特定题型，所以先按最简单的够用实现来，你要更复杂的题型可以在 `review.js` 上加。
