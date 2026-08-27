// time.js —— 时间系统：与地图解耦，只负责"分钟数"的推进与格式化。
// 对应 design-doc.md 第 2 节：全程共 3 天，每天的时间窗口不再是同一个常量——
// 第 1 天只有晚上（20:00-24:00），第 2/3 天是全天（08:00-24:00）。
// 具体窗口由 content/days.json 每天数据里的 startMin/endMin 字段决定，
// 本文件只提供读取这两个字段（带兜底默认值）+ 分钟推进/格式化的工具函数。

export const DEFAULT_DAY_START_MIN = 480;   // 08:00，没在内容里配置 startMin 时的兜底值
export const DEFAULT_DAY_END_MIN = 1200;    // 20:00，没在内容里配置 endMin 时的兜底值

// 前往任意调查地点（含来回）固定消耗的时间。框架阶段先用一个常量占位，
// 真实内容如果想做"远近不同耗时不同"，可以把这个值换成按 hotspot 距离查表。
export const TRAVEL_TIME_MIN = 90;

/** 读取某一天的时间窗口（起止分钟数）。dayContent 缺失或没配置对应字段时落回默认值。 */
export function getDayRange(dayContent) {
  const start = dayContent && typeof dayContent.startMin === 'number' ? dayContent.startMin : DEFAULT_DAY_START_MIN;
  const end = dayContent && typeof dayContent.endMin === 'number' ? dayContent.endMin : DEFAULT_DAY_END_MIN;
  return { start, end };
}

export function formatMinutes(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 推进时间。返回推进后是否已经到/超过当天结束点（结束点取自 dayContent.endMin）。 */
export function addMinutes(state, delta, dayContent) {
  state.minutes += delta;
  return isDayOver(state, dayContent);
}

export function isDayOver(state, dayContent) {
  return state.minutes >= getDayRange(dayContent).end;
}

export function remainingMinutes(state, dayContent) {
  return Math.max(0, getDayRange(dayContent).end - state.minutes);
}

/** 把当天时间重置为出发时刻（dayContent.startMin），供 main.js 在推进到下一天时调用。 */
export function resetToday(state, dayContent) {
  state.minutes = getDayRange(dayContent).start;
}
