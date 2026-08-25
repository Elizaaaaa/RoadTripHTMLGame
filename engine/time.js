// time.js —— 时间系统：与地图解耦，只负责"分钟数"的推进与格式化。
// 对应 design-doc.md 第 2 节：单日时间预算，耗尽时若未回加油站触发"更新失败"。

export const DAY_START_MIN = 480;   // 08:00，每天从加油站出发的时间
export const DAY_END_MIN = 1200;    // 20:00，时间预算耗尽点

// 前往任意调查地点（含来回）固定消耗的时间。框架阶段先用一个常量占位，
// 真实内容如果想做"远近不同耗时不同"，可以把这个值换成按 hotspot 距离查表。
export const TRAVEL_TIME_MIN = 90;

export function formatMinutes(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 推进时间。返回推进后是否已经到/超过当天结束点。 */
export function addMinutes(state, delta) {
  state.minutes += delta;
  return isDayOver(state);
}

export function isDayOver(state) {
  return state.minutes >= DAY_END_MIN;
}

export function remainingMinutes(state) {
  return Math.max(0, DAY_END_MIN - state.minutes);
}

/** 把当天时间重置为出发时刻，供 main.js 在推进到下一天时调用。 */
export function resetToday(state) {
  state.minutes = DAY_START_MIN;
}
