// state.js —— 全局游戏状态：结构定义 + 存档/读档
// 本文件只管"数据"，不含任何 UI 或规则判断逻辑（规则判断在各自的 engine 模块里）。

import { createFinale } from './ending.js';

// 版本号在每次改动后递增：旧存档会挂在旧 key 下面，读不到就自动当新档处理，
// 不需要玩家手动清 localStorage 就能获得一次"从头开始"的测试。
const SAVE_KEY = 'roadtrip1_save_v38';

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
    extraUnlockedLocations: [], // 事件里 unlocksLocation 效果动态解锁的调查地点 id（全程累计，叠加在 dayContent.unlockedLocations 之上）
    triggeredEvents: [],    // 已触发过的事件 id（全程累计，事件不重复触发；day intro 也借用这个数组存 'intro_d<N>' 伪 id）
    collectedClues: [],     // 全程收集到的线索 id
    todayClues: [],         // 当天新收集、尚待发布的线索 id
    todayEventLog: [],      // 当天按调查顺序排列的事件记录：{ eventId, loc, locName, minutes, text, note }，供"调查回顾"用

    archives: {
      unlocked: [],          // 已解锁的档案库词条 key——现在唯一的解锁入口是玩家点击正文里的
                              // [[显示文字|key]] 链接（见 main.js onKeywordClick），所以这个数组
                              // 本身就等于"点过的链接"，链接蓝/灰直接读它，不需要再单独一份 clicked 记录
      newSinceLastView: []   // 解锁后还没被玩家翻开看过的 key（小红点用）
    },

    signalToday: [],         // 当天已弹出的信号闪现记录，回加油站时汇总展示
    usedNewspaperToday: false, // 翻旧报纸每天限一次

    completedReviews: [],    // 已完成的复盘事件 id
    choiceLog: [],           // 关键选择记录：剪辑复盘写 { reviewId, day, tag }，
                             // 抉择事件（type:'choice'）写 { choiceId, day, tag }；
                             // 两者都只用 tag，供结局文案变体匹配（见 ending.js getText）
    diceLog: [],             // 掷骰记录：{ eventId, day, rolls, chosen, outcome }
    publishLog: [],          // 每天的发布结算：{ day, playcount, clues } 或 { day, failed:true }

    finale: createFinale(),  // 高潮抉择的落子：{ meridian, baby, ending }，见 ending.js
                             // 的五结局真值表。ending 一旦写上，游戏当场结束
    ending: null,            // 游戏结束后写入结局 id，写入后视为游戏已结束

    checkpoints: []         // 时间线存档点，按记录先后排成一条链，见下方 snapshot* / restore* 一组函数
  };
}

// ---------- 存档点（时间线回退） ----------
//
// 一条按时间顺序排列的链，每个元素是一份"那一刻的完整状态快照"。三种来源：
//
//   kind:'day'    每天出发那一刻（advanceDay / 新开一局），供"重新度过今日"/"回到上一天"
//   kind:'time'   每次去调查地点、时间往前走之前的那个整点，供结局窗口的"从某个时间点继续"
//   kind:'choice' 重大抉择的选项摆出来之前，供结局窗口的"回到某个重大抉择"
//
// 'day' 和 'time' 用同一个 id（`天@分钟`）：每天出发那一刻本来就是那天第一个整点，
// 两者指的是同一个瞬间，同 id 只留先记下的那一个（也就是 'day' 那条），不重复存。

/** 一局里最多留多少个存档点。三天满打满算也就 50 个上下（每天每整点一个 + 每天开头 +
 *  两个抉择），这个上限只是内容量变大之后防止存档撑爆 localStorage 的保险丝：满了先丢
 *  最早的整点存档点，'day' 和 'choice' 那两类一个都不丢。 */
const MAX_CHECKPOINTS = 80;

const timeCheckpointId = state => `${state.day}@${state.minutes}`;

/**
 * 记一份"此刻"的快照。快照本身不含 checkpoints 字段（避免自我嵌套、存档体积滚雪球）。
 * 已经走到结局的局不再往里记——那种快照一还原就又是结局，没有意义。
 */
function recordCheckpoint(state, rec) {
  if (state.ending) return;
  state.checkpoints ||= [];
  if (state.checkpoints.some(c => c.id === rec.id)) return;
  const { checkpoints, ...rest } = state;
  state.checkpoints.push({ ...rec, snapshot: JSON.parse(JSON.stringify(rest)) });
  if (state.checkpoints.length > MAX_CHECKPOINTS) {
    const i = state.checkpoints.findIndex(c => c.kind === 'time');
    if (i >= 0) state.checkpoints.splice(i, 1);
  }
}

/** 当天出发那一刻的存档点。调用时机：新开一局记第 1 天、每次 advanceDay() 推进到新的一天。 */
export function snapshotDay(state) {
  recordCheckpoint(state, { id: timeCheckpointId(state), kind: 'day', day: state.day, minutes: state.minutes });
}

/** 整点存档点。调用时机：每次去调查地点、时间往前推进之前（见 main.js visitInvestigationSpot）。 */
export function snapshotTime(state) {
  recordCheckpoint(state, { id: timeCheckpointId(state), kind: 'time', day: state.day, minutes: state.minutes });
}

/**
 * 重大抉择存档点。调用时机：抉择事件正文开播之前（见 main.js showChoiceEvent）。
 * eventId 记下来是为了还原之后能把那条抉择事件重新播一遍——光把状态倒回去，
 * 玩家会站在原地，选项不会自己再摆出来。
 */
export function snapshotChoice(state, { eventId, label }) {
  recordCheckpoint(state, {
    id: `choice:${eventId}`, kind: 'choice', day: state.day, minutes: state.minutes, eventId, label
  });
}

/** 按种类取存档点列表（含 snapshot，UI 要读里面的理智/线索数做小字说明）。 */
export function listCheckpoints(state, kinds) {
  return (state.checkpoints || []).filter(c => kinds.includes(c.kind));
}

export function hasDayCheckpoint(state, day) {
  return (state.checkpoints || []).some(c => c.kind === 'day' && c.day === day);
}

/**
 * 还原到链上第 idx 个存档点。
 * 它之后的存档点会被一并丢弃：一旦从某一刻重新出发，之后的进程就此改写，旧快照
 * （哪怕玩家之前已经打到过第 3 天）不再代表这条时间线，留着只会误导回退操作。
 * 被还原的那一条自己留着，所以同一个点可以反复回。
 */
function restoreAt(state, idx) {
  const list = state.checkpoints || [];
  const restored = JSON.parse(JSON.stringify(list[idx].snapshot));
  restored.checkpoints = JSON.parse(JSON.stringify(list.slice(0, idx + 1)));
  restored.ending = null; // 保险：存档点都是结局之前记的，这里只是明确"回退之后这一局没有结局"
  return restored;
}

/**
 * 恢复到某天开始时的快照——"重新度过今日"传当前天数，"回到上一天"传 day-1。
 * @returns {object|null} 恢复后可直接替换 main.js 里 state 变量的新状态；
 *          没有对应快照时返回 null（调用方应保持现状、提示玩家没有可回退的存档点）。
 */
export function restoreDayCheckpoint(state, day) {
  const idx = (state.checkpoints || []).findIndex(c => c.kind === 'day' && c.day === day);
  return idx < 0 ? null : restoreAt(state, idx);
}

/** 按 id 恢复到任意一个存档点，供结局窗口的两个回退入口使用。 */
export function restoreCheckpoint(state, id) {
  const idx = (state.checkpoints || []).findIndex(c => c.id === id);
  return idx < 0 ? null : restoreAt(state, idx);
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
