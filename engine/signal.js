// signal.js —— 信号闪现：被动随机触发的粉丝留言，替代原"呼叫阿福"付费查询。
// 对应 design-doc.md 第 3.3 节。全镇默认无信号，只有加油站稳定联网；
// 玩家在调查地点点击时有低概率（默认 18%）弹出 1-2 条留言，不打断探索节奏。

const DEFAULT_CHANCE = 0.18;

/**
 * 尝试触发一次信号闪现。
 * @param {object} dayContent 当天内容数据（含 signalPool 数组）
 * @param {string[]} alreadyShownIds 当天已经弹出过的留言 id，避免重复
 * @returns {object|null} 命中则返回留言对象，否则 null
 */
export function tryTrigger(dayContent, alreadyShownIds = [], chance = DEFAULT_CHANCE) {
  const pool = (dayContent && dayContent.signalPool) || [];
  const candidates = pool.filter(s => !alreadyShownIds.includes(s.id));
  if (candidates.length === 0) return null;
  if (Math.random() >= chance) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function record(state, flare) {
  state.signalToday.push(flare);
}

/** 回加油站发布时汇总展示当天全部信号闪现，见 3.3 节"当日评论区"小结。 */
export function getDailyDigest(state) {
  return state.signalToday;
}

export function resetDaily(state) {
  state.signalToday = [];
}
