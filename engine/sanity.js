// sanity.js —— 理智值：数值、三档阈值判定、UI 反馈钩子。
// 对应 design-doc.md 第 5.1 / 5.2 节。理智值全程累积，不按天重置。

export const TIER = {
  CLEAR: 'clear',     // 清醒 70-100
  SHAKEN: 'shaken',   // 动摇 35-69
  BREAKING: 'breaking' // 濒崩 0-34
};

const TIER_LABEL = {
  [TIER.CLEAR]: '清醒',
  [TIER.SHAKEN]: '动摇',
  [TIER.BREAKING]: '濒崩'
};

export function getTier(sanity) {
  if (sanity >= 70) return TIER.CLEAR;
  if (sanity >= 35) return TIER.SHAKEN;
  return TIER.BREAKING;
}

export function getTierLabel(sanity) {
  return TIER_LABEL[getTier(sanity)];
}

/** 增减理智值（delta 可正可负），自动夹在 [0,100]，返回增减后的档位。 */
export function adjust(state, delta) {
  state.sanity = Math.max(0, Math.min(100, state.sanity + delta));
  return getTier(state.sanity);
}

/**
 * 把当前理智档位映射为 UI 效果。不直接操作 DOM class 列表以外的东西，
 * 具体噪点/抖动视觉效果由 engine/ui.css 里的对应 class 实现。
 */
export function applyUIEffects(sanity) {
  const tier = getTier(sanity);
  const body = document.body;
  body.classList.toggle('sanity-shaken', tier === TIER.SHAKEN);
  body.classList.toggle('sanity-breaking', tier === TIER.BREAKING);
  return tier;
}
