// ending.js —— 结局判定：探索进度 × 最终理智值 2x2 矩阵。
// 对应 design-doc.md 第 5.3 节。choiceLog 不参与判定，只用于同结局内的文案差异。

import { computeProgress } from './archive.js';

const PROGRESS_THRESHOLD = 70;
const SANITY_THRESHOLD = 60;

export function decide(state) {
  const progress = computeProgress(state);
  const sanity = state.sanity;
  const highProgress = progress >= PROGRESS_THRESHOLD;
  const highSanity = sanity >= SANITY_THRESHOLD;

  let id;
  if (highProgress && highSanity) id = 'truth_escape';
  else if (highProgress && !highSanity) id = 'costly_escape';
  else if (!highProgress && highSanity) id = 'blind_escape';
  else id = 'trapped';

  return { id, progress, sanity };
}

/**
 * 取结局文案，按 choiceLog 里出现过的 tag 匹配 variants，命中的都会附加在结尾。
 * endingsContent 来自 content/endings.json。
 */
export function getText(endingId, state, endingsContent) {
  const entry = endingsContent[endingId];
  if (!entry) return null;

  const tagsHit = new Set(state.choiceLog.map(c => c.tag).filter(Boolean));
  const extra = (entry.variants || [])
    .filter(v => tagsHit.has(v.when))
    .map(v => v.text);

  return {
    title: entry.title,
    text: [entry.text, ...extra].join('\n\n')
  };
}
