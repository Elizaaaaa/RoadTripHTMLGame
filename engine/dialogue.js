// dialogue.js —— QQ/BB 事件后闲聊：跟具体事件 id 绑定，事件触发、玩家看完事件文本
// 准备点"继续"关掉弹窗之前，必定播放一段两人对这件事的讨论（左右气泡逐条弹出）。
// 跟 signal.js 的"信号闪现"是两套机制：信号闪现是随机命中的粉丝留言，这里是
// 确定触发的角色对话，不进 signalToday/当日摘要，也不占随机判定的名额。
//
// 事件正文（events[].text / diceCheck 的 outcome.text）里可以用换行符 \n 把一段长文本
// 拆成好几"页"（见 main.js 的 splitSegments/playEventPages）：玩家每点一次"继续"翻一页，
// 翻到最后一页才真正关窗、结束这次调查。
//
// content/days.json 里每天数据可选挂一个 dialogues 数组，形如：
//   "dialogues": [
//     {
//       "id": "dlg1",
//       "afterEvent": "e1",              // 对应 events[].id，那个事件触发完就会播这段
//       "afterSegment": 0,               // 可选：绑在第几页（0 开始）后面播，不写默认绑最后一页
//       "lines": [
//         { "speaker": "qq", "text": "……" },
//         { "speaker": "bb", "text": "……" }
//       ]
//     }
//   ]
// lines 里的 text 支持跟事件正文一样的 [[显示文字|key]] 关键词语法。

/**
 * 查找绑定在某个事件、某一页正文之后的对话（同一页最多绑一段，找到第一条就返回）。
 * @param {object} dayContent 当天内容数据（含 dialogues 数组）
 * @param {string} eventId 刚翻完的事件 id
 * @param {number} segmentIndex 刚翻完的是第几页（0 开始）
 * @param {number} totalSegments 这个事件正文一共拆成几页——没写 afterSegment 的对话默认绑最后一页
 * @returns {object|null} 找到则返回 { id, afterEvent, afterSegment, lines }，否则 null
 */
export function findForEvent(dayContent, eventId, segmentIndex, totalSegments) {
  const pool = (dayContent && dayContent.dialogues) || [];
  return pool.find(d => {
    if (d.afterEvent !== eventId) return false;
    const target = typeof d.afterSegment === 'number' ? d.afterSegment : totalSegments - 1;
    return target === segmentIndex;
  }) || null;
}
