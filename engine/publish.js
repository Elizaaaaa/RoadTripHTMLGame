// publish.js —— 回加油站发布 vlog & 播放量结算，原型里叫"夜间播报"。
// 对应 design-doc.md 第 3 节表格 + 5.2 节理智档位对发布效果的影响。

import { getTier, TIER, adjust } from './sanity.js';

/**
 * 计算当天播放量。公式是占位实现，重点是把"理智档位影响发布结果"这条规则
 * 接进来，具体数值内容作者可以随便调：
 * - 清醒：正常计算
 * - 动摇：15% 概率"素材出错"，播放量打对折
 * - 濒崩：观众爱看猎奇素材，播放量反而上浮，但呼应黑暗结局路径
 */
export function computePlaycount(state, selectedClueIds) {
  const base = 100 + selectedClueIds.length * 50;
  const tier = getTier(state.sanity);

  if (tier === TIER.SHAKEN && Math.random() < 0.15) {
    return { playcount: Math.round(base * 0.5), glitched: true, tier };
  }
  if (tier === TIER.BREAKING) {
    return { playcount: Math.round(base * 1.5), glitched: false, tier };
  }
  return { playcount: base, glitched: false, tier };
}

/** 正常发布流程：选中当天线索 -> 结算播放量 -> 写入 publishLog。 */
export function publish(state, selectedClueIds) {
  const result = computePlaycount(state, selectedClueIds);
  state.publishLog.push({
    day: state.day,
    playcount: result.playcount,
    glitched: result.glitched,
    clues: selectedClueIds
  });
  state.didFailReturn = false;
  return result;
}

/**
 * 未能按时回到加油站的"更新失败"处理，见 design-doc.md 第 2 节最后一条：
 * 不生成播放量结算，sanityCost +5，直接进入下一天。
 */
export function failReturn(state) {
  adjust(state, -5); // sanityCost +5，即扣 5 点理智
  state.publishLog.push({ day: state.day, failed: true });
  state.didFailReturn = true;
}
