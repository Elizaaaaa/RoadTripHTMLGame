// dice.js —— 掷骰事件：固定 1d20，理智值只改变"取几次骰子、取哪一个"。
// 对应 design-doc.md 第 5.4 节。不引入角色卡/技能值。

import { TIER, getTier } from './sanity.js';

export function rollD20() {
  return Math.floor(Math.random() * 20) + 1;
}

/**
 * 按理智档位决定掷骰次数与取值规则。
 * 清醒：掷 1 次直接用。
 * 动摇：掷 2 次，取"离 10.5 更远"的一个（大成功/大失败概率同时上升）。
 * 濒崩：掷 3 次，取"离 10.5 最远"的一个；并额外允许"不掷骰、直接大成功"的隐藏选项
 *       （由调用方决定是否向玩家提供这个选项，见 canForceCritSuccess）。
 */
export function rollForSanity(sanity) {
  const tier = getTier(sanity);
  let rolls;
  if (tier === TIER.CLEAR) {
    rolls = [rollD20()];
  } else if (tier === TIER.SHAKEN) {
    rolls = [rollD20(), rollD20()];
  } else {
    rolls = [rollD20(), rollD20(), rollD20()];
  }
  const chosen = rolls.reduce((best, r) =>
    Math.abs(r - 10.5) > Math.abs(best - 10.5) ? r : best
  );
  return {
    tier,
    rolls,
    chosen,
    canForceCritSuccess: tier === TIER.BREAKING
  };
}

/** 1 必定大失败，20 必定大成功，其余按阈值分成功/失败。 */
export function classify(rollValue, threshold) {
  if (rollValue === 1) return 'critFail';
  if (rollValue === 20) return 'critSuccess';
  return rollValue >= threshold ? 'success' : 'fail';
}

/**
 * 解析一次掷骰事件。
 * @param {object} eventDef 内容里的 diceCheck 事件定义（含 diceThreshold / outcomes）
 * @param {number} sanity 当前理智值
 * @param {object} [opts] { forceCritSuccess: bool } —— 仅濒崩档位可用的隐藏选项，
 *        选择后必定拿 critSuccess 结果，但额外承担一笔理智代价（呼应黑暗结局路径）。
 */
export function resolveDiceCheck(eventDef, sanity, opts = {}) {
  if (opts.forceCritSuccess) {
    const outcome = eventDef.outcomes.critSuccess;
    return {
      outcomeKey: 'critSuccess',
      forced: true,
      rollInfo: null,
      outcome,
      extraSanityCost: 10 // "不计代价换取真相"的额外理智代价，见 5.4 节
    };
  }
  const rollInfo = rollForSanity(sanity);
  const outcomeKey = classify(rollInfo.chosen, eventDef.diceThreshold);
  return {
    outcomeKey,
    forced: false,
    rollInfo,
    outcome: eventDef.outcomes[outcomeKey],
    extraSanityCost: 0
  };
}
