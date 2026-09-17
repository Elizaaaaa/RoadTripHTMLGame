// chat.js —— QQ/BB 事件后闲聊：手机里的第二个 app（第一个是 vlogstats.js 的 vlog 数据页）。
//
// 跟具体事件 id 绑定，事件触发、玩家看完事件文本准备点"继续"关掉弹窗之前，手机从屏幕
// 右下角升上来，两人对这件事的讨论一条条弹进聊天串里，播完手机不收、"继续"按钮解锁；
// 真正收起手机是在事件弹窗关掉的时候（main.js 的 closeModal → clear()）。
// 哪些事件绑了哪段对话由 engine/dialogue.js 查，本模块只负责演。
//
// 姿态是 corner：手机停在右下角、不压住中间的事件正文，overlay 本身不吃点击，
// 所以玩家能一边看正文一边看他俩聊。窗口窄到 1200 以下时手机会开始压住弹窗边角——
// 这是定好的取舍（手机固定尺寸、宁可遮一点也不缩小，见 phone.js 文件头）。
//
// 界面按 iOS 12 的「信息」来：**1:1 会话里没有头像也没有名字**，只有靠左的灰气泡和
// 靠右的蓝气泡。蓝色（右边）是手机主人，也就是 BB；对方是 QQ，名字挂在顶部导航栏上。
// 状态栏照常显示红字「无服务」——聊天气泡只是一种演出，不必去圆"没信号怎么发消息"。
//
// 关键词链接：气泡正文里的 [[显示文字|key]] 由调用方（main.js）传进来的 renderText /
// bindLinks 两个回调处理，本模块不碰 archives——解锁只能发生在点击那一下，
// 这条规则由 main.js 的 onKeywordClick 独占。

import * as phone from './phone.js';

const APP_ID = 'chat';

export const STEP_MS = 1500;   // 每条消息之间的间隔（从"正在输入"冒头算起）
export const TYPING_MS = 700;  // "正在输入"的三个点闪多久，才变成这条消息的正文
export const HOLD_MS = 900;    // 最后一条消息出现后，停留多久才判定"讨论完了"

const DEFAULT_PEER = { name: 'QQ', initial: 'Q' };

let timers = [];
let currentEventId = null; // 当前这串气泡属于哪个事件——同一事件翻页续聊、换事件才清屏

/** 手机里现在装着的是不是这个 app。 */
function isMounted() {
  return phone.isOpen() && phone.getApp() === APP_ID;
}

export function isShowing() {
  return isMounted();
}

// ---------- 界面 ----------

function escapeHTML(str) {
  return String(str).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

/**
 * 屏幕里的内容：顶部一条导航栏（挂着对方的名字）+ 下面的聊天串。
 * 导航栏 sticky 在顶上，背景往上延伸到状态栏底下——iOS 的导航栏就是这么盖住状态栏的。
 */
function screenHTML(peer) {
  return `
    <div class="chat-navbar">
      <span class="chat-back" aria-hidden="true">
        <svg viewBox="0 0 12 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2 2 10l8 8"/></svg>
      </span>
      <span class="chat-peer">
        <span class="chat-peer-avatar">${escapeHTML(peer.initial)}</span>
        <span class="chat-peer-name">${escapeHTML(peer.name)}</span>
      </span>
    </div>
    <div class="chat-thread" id="chat-thread"></div>`;
}

/**
 * 在聊天串底部先冒出一条"正在输入"的气泡，返回这一行，等正文到点了再填进去。
 * 同一个人连着说的第二句起：间距收紧（chat-row-cont），上一行的尖角去掉
 * （chat-row-said）——iMessage 里一串连发的消息只有最后一条挂尖角。
 */
function appendRow(speaker) {
  const thread = document.getElementById('chat-thread');
  if (!thread) return null;
  const isQQ = speaker === 'qq';
  const sideClass = isQQ ? 'chat-row-qq' : 'chat-row-bb';
  const prev = thread.lastElementChild;
  const row = document.createElement('div');
  row.className = `chat-row ${sideClass}`;
  if (prev && prev.classList.contains(sideClass)) {
    row.classList.add('chat-row-cont');
    prev.classList.add('chat-row-said');
  }
  row.innerHTML = '<div class="chat-bubble chat-typing"><i></i><i></i><i></i></div>';
  thread.appendChild(row);
  scrollToBottom();
  return row;
}

/** "正在输入"的三个点变成这条消息的正文。 */
function fillRow(row, line, opts) {
  if (!row) return;
  const bubble = row.querySelector('.chat-bubble');
  if (!bubble) return;
  bubble.classList.remove('chat-typing');
  bubble.classList.add('chat-bubble-in');
  bubble.innerHTML = opts.renderText ? opts.renderText(line.text) : escapeHTML(line.text);
  if (opts.bindLinks) opts.bindLinks(bubble);
  scrollToBottom();
}

/** 新消息进来时把聊天串滚到底——聊天串本身贴着屏幕底部长，长过一屏才会真的滚。 */
function scrollToBottom() {
  const sc = phone.getScroller();
  if (sc) sc.scrollTop = sc.scrollHeight;
}

// ---------- 播放 ----------

function clearTimers() {
  timers.forEach(clearTimeout);
  timers = [];
}

/**
 * 播一段对话。
 * @param {object} dialogue engine/dialogue.js 查出来的 { id, lines: [{ speaker, text }] }
 * @param {string} eventId 这段对话属于哪个事件——同一事件翻页续聊，换事件才清屏
 * @param {object} opts
 *   renderText —— (text) => html，把 [[显示文字|key]] 解析成可点的 span；不传就纯文本
 *   bindLinks  —— (bubbleEl) => void，给气泡里的关键词挂点击
 *   clock      —— 状态栏时间（分钟数或 'HH:MM'）
 *   peer       —— { name, initial }，导航栏上那个人，默认 QQ
 *   onDone     —— 播完回调（main.js 用它解锁"继续"按钮）
 */
export function play(dialogue, eventId, opts = {}) {
  const lines = (dialogue && dialogue.lines) || [];

  if (!isMounted()) {
    phone.mount({
      id: APP_ID,
      pose: 'corner',
      enter: 'rise',
      signal: false, // 镇内一律无服务；聊天只是演出，不受这条限制
      clock: opts.clock,
      html: screenHTML({ ...DEFAULT_PEER, ...(opts.peer || {}) })
    });
  } else if (eventId !== currentEventId) {
    // 换了别的事件：手机不收，只把上一段聊天清掉，接着往下聊
    const thread = document.getElementById('chat-thread');
    if (thread) thread.innerHTML = '';
  }
  currentEventId = eventId;

  clearTimers();
  lines.forEach((line, i) => {
    // 每条消息分两步：先冒"正在输入"的三个点，过 TYPING_MS 再换成正文
    timers.push(setTimeout(() => {
      const row = appendRow(line.speaker);
      timers.push(setTimeout(() => fillRow(row, line, opts), TYPING_MS));
    }, i * STEP_MS));
  });

  const totalMs = Math.max(0, lines.length - 1) * STEP_MS + TYPING_MS + HOLD_MS;
  if (opts.onDone) timers.push(setTimeout(opts.onDone, totalMs));
}

/** 收起手机、清掉还没播完的定时器。事件弹窗关掉时调（main.js 的 closeModal）。 */
export function clear() {
  clearTimers();
  currentEventId = null;
  if (isMounted()) phone.unmount();
}
