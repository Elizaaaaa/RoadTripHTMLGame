// state.js —— 全局游戏状态：结构定义 + 存档/读档
// 本文件只管"数据"，不含任何 UI 或规则判断逻辑（规则判断在各自的 engine 模块里）。

const SAVE_KEY = 'roadtrip1_save_v1';

/** 新开一局的初始状态。DAY_START_MIN 由 time.js 定义，这里用字面量避免循环依赖。 */
export function createInitialState() {
  return {
    day: 1,
    minutes: 480,          // 当天已过去的分钟数（8:00 = 480），见 time.js
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

    ending: null             // 游戏结束后写入结局 id，写入后视为游戏已结束
  };
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
