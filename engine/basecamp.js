// basecamp.js —— 加油站基地点：唯一信号点，承担"翻旧报纸"与"发布 vlog"两个入口。
// 对应 design-doc.md 第 3.3 节。播放量结算的计算逻辑在 publish.js，
// 本文件只负责"加油站专属"的准入规则（比如翻报纸限一天一次）。

export function canReadNewspaper(state) {
  return !state.usedNewspaperToday;
}

/**
 * 返回当天的旧报纸/论坛老帖文本列表；重复调用同一天返回 null。
 * 注意"限一次"限的只是"翻出新东西"这个动作：已经翻出来的那批内容，UI 侧（main.js
 * renderNewspaperTab）会在玩家再次打开这个 tab 时原样再显示一遍——报纸正文里的
 * 关键词链接是解锁词条/地点的入口，看一眼就收走会把当天卡死。
 */
export function readNewspaper(state, dayContent) {
  if (!canReadNewspaper(state)) return null;
  state.usedNewspaperToday = true;
  return dayContent.newspaper || [];
}
