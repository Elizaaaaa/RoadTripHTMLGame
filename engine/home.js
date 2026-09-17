// home.js —— 手机主屏：玩家自己把手机掏出来之后看到的那一屏，以及从主屏点进去的几个 app。
//
// 跟 vlogstats.js / chat.js 那种"被流程弹出来"的 app 不一样，这台手机是**玩家主动叫出来**的：
// 从底下升到画面正中（pose center + enter rise），背后压一层暗幕，点暗幕或按 Esc 收起。
// **呼出不消耗游戏内时间**——它是个查阅界面，跟记事本同一类，不是一次资源决策。
//
// 主屏 → app → 退回主屏走 phone.setScreen()：只换屏幕里的内容，手机本身不重新进场，
// 观感上就是在同一台手机里翻页。
//
// ---- 信号规则（design-doc.md 第 20 行）----
// 全镇只有加油站能稳定联网，镇内一律"无服务"。这条规则在这里是**实打实的功能限制**，
// 不是状态栏上的一句装饰：
//   · 后台（vlog 数据页）—— 没信号时打得开，但显示的是上次同步下来的缓存，顶上挂一条
//     离线提示，评论区转圈加载不出来；
//   · 信息（QQ/BB 聊天记录）—— 照常能看，它本来就存在手机本地；
//   · 相册 —— 同上，本地的东西不受影响。
// 所以镇里掏出手机不会是一片空白，只是通往外面的那几个入口全死了。

import * as phone from './phone.js';
import * as vlogStats from './vlogstats.js';

let ctx = null; // { state, content, hasSignal, clock, dayLabel }

// ---------- 图标（内联 SVG + CSS 渐变，零美术素材） ----------

const GLYPH = {
  messages: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.4c5 0 9 3.3 9 7.4 0 4.1-4 7.4-9 7.4a11 11 0 0 1-2.5-.3l-4.3 2.1a.4.4 0 0 1-.6-.4l.5-3.4C3.2 15 3 13 3 10.8c0-4.1 4-7.4 9-7.4z"/></svg>',
  stats: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="13" width="4" height="8" rx="1.4"/><rect x="10" y="8" width="4" height="13" rx="1.4"/><rect x="17" y="3" width="4" height="18" rx="1.4"/></svg>',
  photos: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v10A1.5 1.5 0 0 1 20 18.5H4A1.5 1.5 0 0 1 2.5 17V7A1.5 1.5 0 0 1 4 5.5z" opacity="0.35"/><circle cx="8.2" cy="10" r="1.9"/><path d="M2.9 16.6 8 11.9l3.4 3.1 3.9-4.2 5 5.8v.4a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.1-.5z"/></svg>'
};

const APPS = [
  { id: 'messages', name: '信息', glyph: GLYPH.messages, tint: 'app-green' },
  { id: 'stats',    name: '后台', glyph: GLYPH.stats,    tint: 'app-blue' },
  { id: 'photos',   name: '相册', glyph: GLYPH.photos,   tint: 'app-warm' }
];

function escapeHTML(str) {
  return String(str).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

// ---------- 主屏 ----------

function homeHTML() {
  return `
    <div class="home-screen">
      <div class="home-grid">
        ${APPS.map(a => `
          <button class="home-app" data-app="${a.id}" type="button">
            <span class="home-icon ${a.tint}">${a.glyph}</span>
            <span class="home-label">${a.name}</span>
          </button>`).join('')}
      </div>
      <div class="home-dots"><i class="on"></i><i></i></div>
    </div>`;
}

function goHome() {
  // 从"后台"退回来时把濒崩的色差关掉——那是数据页自己的状态，不该留在主屏上
  const overlay = document.getElementById('phone-overlay');
  if (overlay) overlay.classList.remove('phone-glitch');

  phone.setScreen(homeHTML(), () => {
    document.querySelectorAll('#phone-content .home-app').forEach(btn => {
      btn.addEventListener('click', () => openApp(btn.dataset.app));
    });
  });
}

function openApp(id) {
  if (id === 'messages') openMessages();
  else if (id === 'stats') openStats();
  else if (id === 'photos') openPhotos();
}

/** 各个 app 顶上那条导航栏，左边是能点的返回箭头（退回主屏）。 */
function navbarHTML(title, sub) {
  return `
    <div class="chat-navbar">
      <button class="chat-back" id="phone-nav-back" type="button" title="返回主屏">
        <svg viewBox="0 0 12 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2 2 10l8 8"/></svg>
      </button>
      <span class="chat-peer">
        <span class="chat-peer-name app-title">${escapeHTML(title)}</span>
        ${sub ? `<span class="app-subtitle">${escapeHTML(sub)}</span>` : ''}
      </span>
    </div>`;
}

function wireBack() {
  const btn = document.getElementById('phone-nav-back');
  if (btn) btn.addEventListener('click', goHome);
}

// ---------- app：信息（QQ/BB 聊天记录） ----------
//
// chat.js 演的是"正在发生"的那一段，播完事件窗一关手机就收了；这里是**存档里留下来的
// 全部记录**（state.chatLog），按天分组、跟 iOS「信息」往上翻聊天记录一样。
// 本地数据，没信号照样能看。

function messagesHTML() {
  const log = ctx.state.chatLog || [];
  if (log.length === 0) {
    return navbarHTML('QQ') + `
      <div class="chat-thread app-empty-thread">
        <div class="app-empty">
          <div class="app-empty-title">还没有聊天记录</div>
          <div class="app-empty-sub">你们俩今天还没为什么事情吵起来。</div>
        </div>
      </div>`;
  }

  let lastDay = null;
  let lastSpeaker = null;
  const rows = [];
  log.forEach((e, i) => {
    if (e.day !== lastDay) {
      rows.push(`<div class="chat-daymark">${escapeHTML(ctx.dayLabel(e.day))}</div>`);
      lastDay = e.day;
      lastSpeaker = null;
    }
    const isQQ = e.speaker === 'qq';
    const side = isQQ ? 'chat-row-qq' : 'chat-row-bb';
    const cont = e.speaker === lastSpeaker ? ' chat-row-cont' : '';
    // 一串连发里只有最后一条挂尖角：下一条不是同一个人（或没有下一条）才算最后一条
    const next = log[i + 1];
    const said = next && next.day === e.day && next.speaker === e.speaker ? ' chat-row-said' : '';
    rows.push(`<div class="chat-row ${side}${cont}${said}"><div class="chat-bubble">${escapeHTML(e.text)}</div></div>`);
    lastSpeaker = e.speaker;
  });

  return navbarHTML('QQ') + `<div class="chat-thread">${rows.join('')}</div>`;
}

function openMessages() {
  phone.setScreen(messagesHTML(), scroller => {
    wireBack();
    if (scroller) scroller.scrollTop = scroller.scrollHeight; // 聊天记录默认停在最新一条
  });
}

// ---------- app：后台（vlog 数据页） ----------

/** 最近一期有发布记录的是第几天；一期都没有就返回 null。 */
function latestPublishedDay() {
  const log = (ctx.state.publishLog || []).filter(p => !p.failed);
  return log.length ? Math.max(...log.map(p => p.day)) : null;
}

function openStats() {
  const day = latestPublishedDay();
  if (day == null) {
    phone.setScreen(navbarHTML('后台') + `
      <div class="chat-thread app-empty-thread">
        <div class="app-empty">
          <div class="app-empty-title">还没有发布过</div>
          <div class="app-empty-sub">发出去第一期之后，这里才会有数据。</div>
        </div>
      </div>`, wireBack);
    return;
  }

  const screen = vlogStats.buildScreen({
    state: ctx.state,
    day,
    dayContent: ctx.content.days[String(day)],
    channel: ctx.content.days.meta && ctx.content.days.meta.channel,
    cover: ctx.content.map && ctx.content.map.mapImage,
    // 没信号时数据拉不下来，页面显示的是上次同步的那一份
    offline: !ctx.hasSignal,
    onBack: goHome
  });
  if (screen) phone.setScreen(screen.html, screen.onMount);
}

// ---------- app：相册 ----------
//
// 目前是个空壳：assets/ 下还没有任何照片素材，素材怎么来还没定（见 TODO.md 第 5 步）。
// 先摆在这里是因为它是**本地 app**——镇里没信号也打得开，正好证明"掏出手机不是一片空白"。

function openPhotos() {
  phone.setScreen(navbarHTML('相册') + `
    <div class="chat-thread app-empty-thread">
      <div class="app-empty">
        <div class="app-empty-title">这台手机里还没有照片</div>
        <div class="app-empty-sub">拍下来的东西都在另一台机器的存储卡上。</div>
      </div>
    </div>`, wireBack);
}

// ---------- 对外 ----------

/**
 * 玩家主动把手机掏出来：从底下升到画面正中，停在主屏。
 * @param {object} opts
 *   state     —— 全局状态
 *   content   —— 全部内容数据（读 days / map，转交给 vlog 数据页）
 *   hasSignal —— 当前有没有信号（只有在加油站才是 true）
 *   clock     —— 状态栏时间（分钟数）
 *   dayLabel  —— (day) => '7月3日'，聊天记录按天分组时的那行小字
 *   onClose   —— 收起手机之后走的下一步，一般不用传
 */
export function open(opts) {
  ctx = {
    state: opts.state,
    content: opts.content || {},
    hasSignal: !!opts.hasSignal,
    clock: opts.clock,
    dayLabel: opts.dayLabel || (d => `第 ${d} 天`)
  };

  return phone.mount({
    id: 'home',
    pose: 'center',
    enter: 'rise',          // 从兜里掏出来：从底下升上来，不是从天上掉下来
    dismissable: true,      // 点外面那片暗幕 / 按 Esc 收起
    signal: ctx.hasSignal,
    clock: opts.clock,
    html: homeHTML(),
    onMount: () => {
      document.querySelectorAll('#phone-content .home-app').forEach(btn => {
        btn.addEventListener('click', () => openApp(btn.dataset.app));
      });
    },
    onClose: opts.onClose || null
  });
}

export function close() {
  phone.unmount();
}

export function isOpen() {
  return phone.isOpen() && phone.getApp() === 'home';
}
