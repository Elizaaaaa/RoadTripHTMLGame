// time.js —— 时间系统：与地图解耦，只负责"分钟数"的推进与格式化。
// 对应 design-doc.md 第 2 节：全程共 3 天，每天的时间窗口不再是同一个常量——
// 第 1 天只有晚上（20:00-24:00），第 2/3 天是全天（08:00-24:00）。
// 具体窗口由 content/days.json 每天数据里的 startMin/endMin 字段决定，
// 本文件只提供读取这两个字段（带兜底默认值）+ 分钟推进/格式化的工具函数。

export const DEFAULT_DAY_START_MIN = 480;   // 08:00，没在内容里配置 startMin 时的兜底值
export const DEFAULT_DAY_END_MIN = 1200;    // 20:00，没在内容里配置 endMin 时的兜底值

// 前往任意调查地点（含来回）固定消耗的时间。统一定成 1 小时——不管去哪个地点、
// 触发的是哪个事件，每次点击地图交互都固定推进这么多分钟，保证时间感受一致。
export const TRAVEL_TIME_MIN = 60;

/** 读取某一天的时间窗口（起止分钟数）。dayContent 缺失或没配置对应字段时落回默认值。 */
export function getDayRange(dayContent) {
  const start = dayContent && typeof dayContent.startMin === 'number' ? dayContent.startMin : DEFAULT_DAY_START_MIN;
  const end = dayContent && typeof dayContent.endMin === 'number' ? dayContent.endMin : DEFAULT_DAY_END_MIN;
  return { start, end };
}

/**
 * 某一天在故事里的日历日期（content/days.json 每天的 date 字段，如 "7月3日"）。
 * 没配就退回"第 N 天"——引擎不自己算日期，故事定在哪三天由内容说了算。
 * 结局窗口的"从某个时间点继续"要拿它拼出"几月几号几点"，见 main.js。
 */
export function formatDayDate(dayContent, day) {
  return (dayContent && dayContent.date) || `第 ${day} 天`;
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

/**
 * 这次时间推进跨过了当天哪些"定时全局事件"（dayContent.timedEvents，见 design-doc.md 1.6 节的两次地震）。
 * 区间是左开右闭 (fromMin, toMin]：同一个时刻只会被某一次推进算作"跨过"一次，来回推进也不会重复命中。
 * 只按时间挑，不管玩家在哪、也不管有没有触发过——"触发过就不再触发"由调用方拿 state 过滤（见 main.js findTimedEvents）。
 * @returns {object[]} 命中的事件，按 at 从早到晚排好序
 */
export function crossedTimedEvents(dayContent, fromMin, toMin) {
  return ((dayContent && dayContent.timedEvents) || [])
    .filter(e => typeof e.at === 'number' && e.at > fromMin && e.at <= toMin)
    .sort((a, b) => a.at - b.at);
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
