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
 *
 * epilogue（后日谈）是独立的一段，不跟正文拼在一起：结局窗口先把正文播完，玩家点
 * "继续"才揭晓后日谈（见 main.js showEnding）。design-doc.md 1.4 节要求结局②必须写成
 * 两段式——正文那一段是一场不留破绽的胜利，翻转只能放在后日谈里，所以引擎层面这两段
 * 必须分开存、分开播，不能指望作者把翻转塞进正文最后一行。
 *
 * quake 原样透传给 engine/quake.js：配了就在结局窗口出现之前先震一次（1.6 节：无论
 * 走到哪个结局，现实世界都一定会记录到那两次地震）。
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
    text: [entry.text, ...extra].join('\n\n'),
    epilogue: entry.epilogue || null,
    quake: entry.quake || null
  };
}
