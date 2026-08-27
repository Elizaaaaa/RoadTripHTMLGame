// state.js —— 全局游戏状态：结构定义 + 存档/读档
// 本文件只管"数据"，不含任何 UI 或规则判断逻辑（规则判断在各自的 engine 模块里）。

const SAVE_KEY = 'roadtrip1_save_v1';

/**
 * 新开一局的初始状态。
 * @param {object} [day1Content] content.days["1"] 的数据，用于读取第 1 天的出发时刻
 *        （startMin，见 time.js getDayRange）；不传时兜底为 480（08:00）。
 */
export function createInitialState(day1Content) {
  const startMin = day1Content && typeof day1Content.startMin === 'number' ? day1Content.startMin : 480;
  return {
    day: 1,
    minutes: startMin,     // 当天已过去的分钟数，第 1 天默认从 20:00（1200）开始，见 content/days.json 与 time.js
    location: 'gasStation', // 当前所在热点 id，永远从加油站出发
    sanity: 100,            // 理智值，全程累积不重置，见 sanity.js
    didFailReturn: false,   // 当天是否因超时未回加油站而"更新失败"

    visitedToday: [],       // 当天已去过的调查地点 id 列表（用于地图变暗/打勾）
    triggeredEvents: [],    // 已触发过的事件 id（全程累计，事件不重复触发）
    collectedClues: [],     // 全程收集到的线索 id
    todayClues: [],         // 当天新收集、尚待发布的线索 id

    archives: {
      unlocked: [],          // 已解锁的档案库词条 key
      newSinceLastView: []   // 解锁后还没被玩家翻开看过的 key（小红点用）
    },

    signalToday: [],         // 当天已弹出的信号闪现记录，回加油站时汇总展示
    usedNewspaperToday: false, // 翻旧报纸每天限一次

    completedReviews: [],    // 已完成的复盘事件 id
    choiceLog: [],           // 关键复盘选择记录：{ reviewId, day, tag }
    diceLog: [],             // 掷骰记录：{ eventId, day, rolls, chosen, outcome }
    publishLog: [],          // 每天的发布结算：{ day, playcount, clues } 或 { day, failed:true }

    ending: null,            // 游戏结束后写入结局 id，写入后视为游戏已结束

    dayCheckpoints: {}      // { 天数: 当天开始时的状态快照 }，供"重新度过今日"/"回到上一天"使用，见下方三个函数
  };
}

/**
 * 记录"当天开始时"的一份状态快照，存进 state.dayCheckpoints[state.day]。
 * 调用时机：新开一局记第 1 天、每次 advanceDay() 推进到新的一天时都要记一次。
 * 快照本身不包含 dayCheckpoints 字段（避免自我嵌套、存档体积滚雪球）。
 */
export function snapshotDay(state) {
  const { dayCheckpoints, ...rest } = state;
  const snapshot = JSON.parse(JSON.stringify(rest));
  state.dayCheckpoints = { ...(dayCheckpoints || {}), [state.day]: snapshot };
}

export function hasDayCheckpoint(state, day) {
  return !!(state.dayCheckpoints && state.dayCheckpoints[day]);
}

/**
 * 恢复到某天开始时的快照——"重新度过今日"传当前天数，"回到上一天"传 day-1。
 * 目标天之后的快照会被一并丢弃：一旦从某天重新出发，之后的进程就此改写，
 * 旧快照（哪怕玩家之前已经打到过第 3 天）不再代表这条时间线，留着只会误导回退操作。
 * @returns {object|null} 恢复后可直接替换 main.js 里 state 变量的新状态；
 *          没有对应快照时返回 null（调用方应保持现状、提示玩家没有可回退的存档点）。
 */
export function restoreDayCheckpoint(state, day) {
  const cp = state.dayCheckpoints && state.dayCheckpoints[day];
  if (!cp) return null;
  const restored = JSON.parse(JSON.stringify(cp));
  restored.dayCheckpoints = {};
  for (const [d, snap] of Object.entries(state.dayCheckpoints)) {
    if (Number(d) <= day) restored.dayCheckpoints[d] = snap;
  }
  return restored;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[state] 读档失败，将开始新一局', err);
    return null;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[state] 存档失败', err);
  }
}

export function clearSave() {
  localStorage.removeItem(SAVE_KEY);
}
