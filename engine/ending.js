// ending.js —— 结局判定：五结局模型。
// 对应 design-doc.md 第 5.3 节 + content/drafts/outline.md 里确认的那五个结局。
//
// 判定轴只有三条，全部来自大纲，跟 San 值无关（San 值仍然影响掷骰/演出/文案，但
// 不再是任何一条结局分支的判定条件）：
//
//   1. 有没有在午夜之前剪辑发布并回旅馆    → 没有：结局① night_madness（被黑夜吞噬）
//   2. 三天之内有没有收齐全部关键线索        → 没收齐：结局② oblivious（一无所知）
//   3. 收齐之后的高潮抉择（两问，见下）      → 结局③/④/⑤
//
// 第 1 条不在本模块——它是"当天时间走完还没回加油站"的即时判定，写在 main.js 的
// handleDayOver() 里，直接把 state.ending 设成 night_madness 并结束游戏。
// 第 2、3 条都在本模块：高潮抉择的结果记在 state.finale 上，decide() 只负责读它，
// 没有抉择结果（= 没走到高潮、或关键线索没收齐）就一律落到"一无所知"。

import { computeProgress } from './archive.js';

/**
 * 关键线索达标线：探索进度（linkedMainCase 词条的解锁占比，见 archive.js
 * computeProgress）达到这个数，才算"全部关键线索都收齐了"，才有资格触发高潮抉择。
 * 大纲写的是"全部"，所以这里是 100；内容量跑起来之后觉得太苛刻就调这一个数，
 * 引擎其余部分不用动（main.js 的抉择事件门槛 requires.allMainClues 也读这条）。
 */
export const FINALE_PROGRESS_THRESHOLD = 100;

export const ENDING = {
  NIGHT_MADNESS: 'night_madness',        // ① 午夜没回旅馆，被黑夜吞噬
  OBLIVIOUS: 'oblivious',                // ② 关键线索没收齐，平安离开，一无所知
  GOD_ARRIVAL: 'god_arrival',            // ③ 摧毁子午线仪 → 神的降临
  PAST_STAYS_BURIED: 'past_stays_buried',// ④ 修复子午线仪、不救婴儿 → 旧日应当留在过去
  SALVATION_IN_RUIN: 'salvation_in_ruin' // ⑤ 修复子午线仪、救婴儿 → 于毁灭中拯救
};

/** state.finale 的初始形状，见 state.js createInitialState。 */
export function createFinale() {
  return {
    meridian: null, // 'destroy' 摧毁子午线仪 | 'repair' 修复子午线仪
    baby: null,     // true 救婴儿 | false 不救（只在 meridian === 'repair' 时有意义）
    ending: null    // 上面两问凑齐后锁定的结局 id，锁定即游戏结束
  };
}

/** 关键线索是否已经收齐——高潮抉择事件的准入门槛。 */
export function mainCluesComplete(state) {
  return computeProgress(state) >= FINALE_PROGRESS_THRESHOLD;
}

/**
 * 高潮抉择真值表 → 结局 id。返回 null 表示这套抉择还没做完，游戏继续。
 *
 * 大纲里的提问顺序是：镇民先提议"修复还是摧毁子午线仪" → 选了修复，它们才会接着
 * 劝"在加固封印之前先开一道小口，把婴儿放出来"。所以 baby 这一问只在 repair 这一
 * 支上存在；选了 destroy 就地结束，不会再被问第二次。
 */
export function resolveFinale(finale) {
  if (!finale) return null;
  if (finale.meridian === 'destroy') return ENDING.GOD_ARRIVAL;
  if (finale.meridian === 'repair') {
    if (finale.baby === true) return ENDING.SALVATION_IN_RUIN;
    if (finale.baby === false) return ENDING.PAST_STAYS_BURIED;
    return null; // 还差"救不救那个婴儿"那一问
  }
  return null;
}

/**
 * 记录一次高潮抉择（days.json 里 type:'choice' 事件的某个 option 被选中时调用），
 * 真值表凑齐就顺手把结局 id 锁进 state.finale.ending。
 *
 * @param {object} state
 * @param {object} choice 内容侧写在 option.finale 里的字段：
 *        { meridian?: 'destroy'|'repair', baby?: boolean, ending?: string }
 *        ending 是给"我就要直接指定结局"用的后门（比如以后加第六个结局），
 *        写了就绕开真值表；正常情况只写 meridian / baby，让引擎自己推。
 * @returns {string|null} 本次锁定的结局 id；还没凑齐返回 null
 */
export function applyFinaleChoice(state, choice = {}) {
  state.finale ||= createFinale();
  if (choice.meridian) state.finale.meridian = choice.meridian;
  if (typeof choice.baby === 'boolean') state.finale.baby = choice.baby;

  const id = choice.ending || resolveFinale(state.finale);
  if (id) state.finale.ending = id;
  return id;
}

/**
 * 全程走完（第 3 天结束）时的兜底判定，见 main.js advanceDay()。
 *
 * 高潮抉择一旦锁定结局，游戏在抉择当场就结束了（main.js pickChoice 直接进结局窗口），
 * 所以真走到这里的只有两种人：关键线索没收齐的，和收齐了却没去工厂按下那个抉择的——
 * 两种都是"平安开出小镇，什么都没发生"，一律给"一无所知"。两者的区别交给 variants
 * 里的伪 tag（见下面 getText 的 __cluesComplete / __finaleSkipped）去做文案差异。
 */
export function decide(state) {
  const progress = computeProgress(state);
  const sanity = state.sanity;
  const id = (state.finale && state.finale.ending) || ENDING.OBLIVIOUS;
  return { id, progress, sanity };
}

/**
 * 结局正文里可以用的伪 tag：跟 choiceLog 里的真 tag 混在同一个集合里参与 variants
 * 匹配，统一加 `__` 前缀跟内容作者自己写的 tag 区分开。内容侧照常写
 * `{ "when": "__cluesComplete", "text": "..." }` 就行。
 */
function computeStateTags(state) {
  const tags = [];
  const complete = mainCluesComplete(state);
  tags.push(complete ? '__cluesComplete' : '__cluesIncomplete');
  // 关键线索收齐了却没按下那个抉择：人到了真相跟前又开车走了，"一无所知"里最特别的一种
  if (complete && !(state.finale && state.finale.ending)) tags.push('__finaleSkipped');
  if (state.sanity < 35) tags.push('__sanityBreaking');
  else if (state.sanity >= 70) tags.push('__sanityClear');
  tags.push(`__day${state.day}`); // 结局发生在第几天（① 可能在第 1/2 天就结束）
  return tags;
}

/**
 * 取结局文案，按 choiceLog 里出现过的 tag（外加上面那批伪 tag）匹配 variants，
 * 命中的都会附加在结局正文结尾。endingsContent 来自 content/endings.json。
 *
 * epilogue（后日谈）是独立的一段，不跟正文拼在一起：结局窗口先把正文播完，玩家点
 * "继续"才揭晓后日谈（见 main.js showEnding）。design-doc.md 1.4 节要求结局⑤
 * （于毁灭中拯救）必须写成两段式——正文那一段是一场不留破绽的胜利，婴儿的真相只能
 * 放在后日谈里，所以引擎层面这两段必须分开存、分开播，不能指望作者把翻转塞进正文
 * 最后一行。
 *
 * quake 原样透传给 engine/quake.js：配了就在结局窗口出现之前先震一次（1.6 节：无论
 * 走到哪个结局，现实世界都一定会记录到那两次地震）。
 */
export function getText(endingId, state, endingsContent) {
  const entry = endingsContent[endingId];
  if (!entry) return null;

  const tagsHit = new Set([
    ...state.choiceLog.map(c => c.tag).filter(Boolean),
    ...computeStateTags(state)
  ]);
  const extra = (entry.variants || [])
    .filter(v => tagsHit.has(v.when))
    .map(v => v.text);

  return {
    title: entry.title,
    text: [entry.text, ...extra].join('\n\n'),
    epilogue: entry.epilogue || null,
    quake: entry.quake || null
  };
}
