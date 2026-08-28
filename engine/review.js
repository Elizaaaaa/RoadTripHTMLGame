// review.js —— 剪辑顺序判定：玩家在剪辑编辑器（顶部"开始剪辑"菜单按钮、加油站
// "剪辑" tab 两个入口共用同一个编辑器，见 engine/main.js 的 renderPublishEditor）
// 里把素材库中的素材拖到时间轴上、按认为正确的顺序排好，确认发布时顺带判定一次。
// 对应 design-doc.md 第 3 节 + 5.3 节最后一条：结果不决定结局分支，也不影响播放量
// （播放量结算见 engine/publish.js），只记录进 choiceLog，用于同一结局内的文案差异化。
//
// 数据结构（content/days.json 里 reviews 数组的一项）：
//   { id, day, req: [clueId], title, prompt,
//     timeline: [clueId, ...],       // 正确答案：需要出现在时间轴上的素材及顺序
//     successText, failText,         // 成功/失败时展示的反馈文案
//     successTag, failTag,           // 可选，写入 choiceLog.tag，供 ending.js 匹配文案分支
//     successEffect, failEffect }    // 可选，{ clue, sanityCost, unlocksArchive }，同 outcome 字段

let materialsData = {}; // { clueId: { label, importance } }，来自 content/materials.json

export function init(data) {
  materialsData = data || {};
}

/**
 * 某条素材在剪辑台里显示用的信息。没在 content/materials.json 里登记过的线索 id
 * 兜底显示 id 本身、按 mid 重要度处理，避免漏登记直接报错。
 */
export function getMaterial(clueId) {
  return materialsData[clueId] || { label: clueId, importance: 'mid' };
}

export function checkRequirements(state, reqList) {
  if (!reqList || reqList.length === 0) return true;
  return reqList.every(clueId => state.collectedClues.includes(clueId));
}

/** 当天可做、尚未完成、且已达成前置条件的复盘列表。 */
export function getAvailable(state, reviewsForDay) {
  return (reviewsForDay || []).filter(rev =>
    !state.completedReviews.includes(rev.id) && checkRequirements(state, rev.req)
  );
}

/**
 * 提交一次剪辑。timelineIds 是玩家最终摆在时间轴上的线索 id，按摆放顺序排列
 * （只包含玩家主动拖上去的素材，素材库里没拖走的不算数）。
 * 必须和 review.timeline 完全一致（数量、顺序都对上）才算复盘成功。
 * 失败不消耗机会——不会写进 completedReviews，玩家可以留在剪辑台里继续调整重试。
 * @returns {{ success: boolean, text: string, effect?: object }}
 */
export function submit(state, review, timelineIds) {
  const expected = review.timeline || [];
  const success = expected.length === timelineIds.length
    && expected.every((clueId, i) => clueId === timelineIds[i]);

  if (success) state.completedReviews.push(review.id);

  // 同一条复盘只保留"最近一次提交"的 tag，避免反复重试后 choiceLog 里堆一堆互相矛盾的记录。
  state.choiceLog = state.choiceLog.filter(c => c.reviewId !== review.id);
  const tag = (success ? review.successTag : review.failTag) ?? null;
  state.choiceLog.push({ reviewId: review.id, day: state.day, tag });

  return {
    success,
    text: success
      ? (review.successText || '剪完了，顺序对上了。')
      : (review.failText || '剪出来的顺序好像不太对，再想想看。'),
    effect: success ? review.successEffect : review.failEffect
  };
}
