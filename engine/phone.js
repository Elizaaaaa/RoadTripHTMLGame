// phone.js —— 手机外壳模块：一台 2019 年的 iPhone XS（375×812 刘海机，iOS 12），橙红色中框。
//
// 外壳跟里面装什么无关：它只管"这台手机长什么样、摆在屏幕哪个位置、怎么进场出场"，
// 屏幕里的内容由各个 app 模块提供（第一个 app 是 engine/vlogstats.js 的 vlog 数据页）。
// 样式全在 engine/phone.css，零美术素材——中框、刘海、侧键、状态栏图标都是 CSS/内联 SVG，
// 跟 quake.js / glitch.js 那两套演出保持一致，缩放到任何倍率都不会糊。
//
// 为什么是 iPhone XS：故事发生在 2019-07-03～05，当时市面上最新的是 2018 年 9 月发布的
// iPhone XS / XS Max / XR，iPhone 11 要到 2019-09-20 才上市。灵动岛是 iPhone 14 Pro（2022）
// 的东西，2019 年只有刘海。系统是 iOS 12——系统级深色模式要 iOS 13（2019-09-19）才有，
// 所以那年夏天的 iPhone 只有日间配色：这里用浅色不是风格选择，是史实。
//
// 姿态（pose）：同一个 DOM 常驻不重建，只切 data-pose 属性，靠 CSS transition 挪位置，
// 所以聊天播到一半被别的 app 顶掉也不会丢掉已经弹出来的气泡。
//   center —— 画面正中，背后压一层暗幕（vlog 结算这种要玩家专心看的）
//   corner —— 右下角，不挡点击（QQ/BB 聊天这种"边看正文边冒消息"的）
//   away   —— 滑出屏幕底部（收起）
// 入场方向由 mount 的 enter 决定：'drop' 先把手机摆到画面上方再落下来，'rise' 从底下升上来。
//
// 信号规则见 design-doc.md 第 20 行：全镇只有加油站能稳定联网，镇内一律"无服务"。
// 状态栏右耳的红字就是这条规则的显示端，由 setSignal(true/false) 切换。

import { formatMinutes } from './time.js';

// 屏幕逻辑尺寸 + 中框厚度。整机尺寸 = 屏幕 + 两边中框，CSS 那边靠 --dev-w/--dev-h 算姿态位移。
export const DEVICE = { screenW: 375, screenH: 812, bezel: 13 };

const NOTCH_W = 209;   // iPhone X/XS 刘海宽度（pt），屏幕 375 减掉之后左右各剩 83 的"耳朵"
const NOTCH_H = 30;

let overlay = null;    // #phone-overlay
let current = null;    // 当前挂着的 app 描述对象，见 mount()
let teardown = [];     // 挂在 window 上的监听，unmount() 时统一摘掉
let closing = false;   // 出场动画播放中，挡住重复调用
let closeTimer = null; // 出场动画结束后才真正拆 DOM 的那个定时器，见 unmount()

// ---------- 状态栏图标（内联 SVG，跟 vlogstats 一样不引外部图片） ----------

const SB_ICONS = {
  // 信号格：四根从矮到高的圆角柱，只有在加油站（有信号）才画出来
  bars: `<svg class="sb-ico sb-bars" viewBox="0 0 18 12" aria-hidden="true">
    <rect x="0"  y="8"   width="3" height="4"   rx="1" fill="currentColor"/>
    <rect x="5"  y="5.5" width="3" height="6.5" rx="1" fill="currentColor"/>
    <rect x="10" y="3"   width="3" height="9"   rx="1" fill="currentColor"/>
    <rect x="15" y="0"   width="3" height="12"  rx="1" fill="currentColor"/>
  </svg>`,
  wifi: `<svg class="sb-ico sb-wifi" viewBox="0 0 16 12" aria-hidden="true">
    <path d="M8 10.8 5.9 8.5a3 3 0 0 1 4.2 0z" fill="currentColor"/>
    <path d="M3.9 6.4a5.9 5.9 0 0 1 8.2 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M1.6 4a9.2 9.2 0 0 1 12.8 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`,
  // 电池：外框 + 里面的电量块 + 右边那个小正极头。刘海机在 iOS 12 下不显示电量百分比，
  // 只有这个图标——屏幕顶上被刘海占了，塞不下数字。
  battery: `<svg class="sb-ico sb-battery" viewBox="0 0 27 13" aria-hidden="true">
    <rect x="0.6" y="0.6" width="21.8" height="11.8" rx="3.6" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.1"/>
    <rect x="2.2" y="2.2" width="16" height="8.6" rx="2.2" fill="currentColor"/>
    <path d="M24.2 4.5c1.05.4 1.05 3.6 0 4z" fill="currentColor" fill-opacity="0.4"/>
  </svg>`
};

// ---------- 外壳骨架 ----------

/**
 * 整台手机的 DOM。层次从外到内：
 *   .phone-device  中框（橙红色实体，侧键挂在它身上，超出边缘一点点）
 *     .phone-body    机身内屏区域，切掉圆角
 *       .phone-scroll  真正滚动的那一层，app 的内容填进 #phone-content
 *       .phone-statusbar / .phone-notch / .phone-home  三个浮在内容之上的硬件层
 */
function deviceHTML() {
  return `
    <div class="phone-backdrop"></div>
    <div class="phone-device" id="phone-device">
      <span class="phone-key phone-key-silent"></span>
      <span class="phone-key phone-key-volup"></span>
      <span class="phone-key phone-key-voldown"></span>
      <span class="phone-key phone-key-power"></span>

      <div class="phone-body">
        <div class="phone-scroll" id="phone-screen">
          <div class="phone-content" id="phone-content"></div>
        </div>

        <div class="phone-statusbar" id="phone-statusbar">
          <span class="sb-ear sb-ear-left"><span class="sb-clock" id="phone-clock">20:00</span></span>
          <span class="sb-ear sb-ear-right" id="phone-signal"></span>
        </div>

        <div class="phone-notch">
          <span class="notch-speaker"></span>
          <span class="notch-cam"></span>
        </div>
        <span class="notch-shoulder notch-shoulder-left"></span>
        <span class="notch-shoulder notch-shoulder-right"></span>

        <div class="phone-home"></div>
      </div>
    </div>

    <button class="phone-scroll-hint hidden" id="phone-scroll-hint" type="button">
      <span class="phone-scroll-hint-text">向下滑动查看更多</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
    </button>`;
}

/** 状态栏右耳：有信号时画信号格 + Wi-Fi，没信号时只剩一行红字"无服务"。 */
function signalHTML(hasService) {
  return hasService
    ? `${SB_ICONS.bars}${SB_ICONS.wifi}${SB_ICONS.battery}`
    : `<span class="sb-noservice">无服务</span>${SB_ICONS.battery}`;
}

// ---------- 尺寸 ----------

/**
 * 手机是固定尺寸的竖屏物件，游戏本体是横屏，所以按当前窗口算一个缩放塞进去。
 * 关键是**所有姿态共用同一个缩放**——手机在不同场景变大变小就不像同一台设备了，
 * 角落放不下就让它盖住一点画面，不缩小。
 */
function fitToViewport() {
  if (!overlay) return;
  const devW = DEVICE.screenW + DEVICE.bezel * 2;
  const devH = DEVICE.screenH + DEVICE.bezel * 2;
  const scale = Math.max(0.42, Math.min(0.92, (window.innerHeight - 36) / devH, (window.innerWidth - 36) / devW));
  overlay.style.setProperty('--phone-scale', scale.toFixed(3));
}

/** 当前缩放比。拖拽滚动要拿它把"鼠标走过的屏幕距离"换算回手机内部的距离。 */
export function getScale() {
  if (!overlay) return 1;
  return Number(getComputedStyle(overlay).getPropertyValue('--phone-scale')) || 1;
}

// ---------- 姿态 ----------

const POSES = ['center', 'corner', 'away', 'above'];

/**
 * 换姿态：只改属性，位移由 CSS 的 transition 接管，DOM 一点没动。
 * data-dock 记的是"停靠在哪"（中间 / 右下角），决定横向落点；data-pose 记的是
 * 当前的纵向状态（含画面外的 above/away）。分成两个属性是为了让入场出场
 * 不丢掉停靠位——不然从画面上方落下来的时候会先落到正中再横着挪过去。
 */
export function setPose(pose) {
  if (!overlay || !POSES.includes(pose)) return;
  if (pose === 'center' || pose === 'corner') overlay.dataset.dock = pose;
  overlay.dataset.pose = pose;
}

export function getPose() {
  return overlay ? overlay.dataset.pose : null;
}

// ---------- 状态栏 ----------

/** 切换"有没有信号"。true 只应该在加油站给——镇内一律 false，见文件头的说明。 */
export function setSignal(hasService) {
  if (!overlay) return;
  overlay.classList.toggle('phone-no-service', !hasService);
  const ear = document.getElementById('phone-signal');
  if (ear) ear.innerHTML = signalHTML(hasService);
}

/** 状态栏时间。传分钟数就按游戏内时间格式化，传字符串就原样显示。 */
export function setClock(value) {
  const el = document.getElementById('phone-clock');
  if (!el) return;
  el.textContent = typeof value === 'number' ? formatMinutes(value) : String(value);
}

// ---------- 挂载 / 卸载 ----------

/**
 * 把一个 app 装进手机并让手机进场。
 * @param {object} app
 *   id          —— app 标识，调试用
 *   html        —— 屏幕里的内容（不含外壳），填进 #phone-content
 *   pose        —— 目标姿态，默认 'center'
 *   enter       —— 入场方向：'drop' 从上落下（默认）/ 'rise' 从下升起 / 'none' 直接就位
 *   signal      —— 状态栏有没有信号，默认 false（镇内无服务）
 *   clock       —— 状态栏时间：分钟数或 'HH:MM' 字符串
 *   scrollHint  —— 是否显示手机左边那列"向下滑动查看更多"，默认 false
 *   dismissable —— 点手机外面的暗幕 / 按 Esc 能不能收起来，默认 false（玩家主动呼出时传 true）
 *   onMount     —— 内容填好、动画起步之后回调 (scroller, api)
 *   onUnmount   —— 卸载时回调，用来清 app 自己的定时器
 *   onClose     —— 手机收起来之后走的下一步
 */
export function mount(app) {
  // 上一台手机还在播出场动画时又要装新的：先把那个"动画播完再拆 DOM"的定时器掐掉，
  // 否则它会在 480ms 之后把刚装好的内容一起擦干净（关掉又马上重开时必踩）。
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; closing = false; }
  if (current) unmount({ silent: true });

  overlay = document.getElementById('phone-overlay');
  if (!overlay) return false;

  current = { pose: 'center', enter: 'drop', signal: false, scrollHint: false, ...app };
  closing = false;

  overlay.innerHTML = deviceHTML();
  overlay.dataset.app = current.id || '';
  overlay.classList.remove('hidden');

  document.getElementById('phone-content').innerHTML = current.html || '';
  setSignal(!!current.signal);
  if (current.clock != null) setClock(current.clock);

  fitToViewport();
  window.addEventListener('resize', fitToViewport);
  teardown.push(() => window.removeEventListener('resize', fitToViewport));

  // 入场：先把手机摆在画面外，下一帧再切到目标姿态，CSS transition 就把这段路演出来。
  // 'drop' 起点在画面上方（vlog 结算那种"手机落下来"），'rise' 起点在下方（玩家主动掏手机）。
  const startPose = current.enter === 'drop' ? 'above' : current.enter === 'rise' ? 'away' : current.pose;
  overlay.dataset.dock = current.pose === 'corner' ? 'corner' : 'center';
  overlay.dataset.pose = startPose;
  if (startPose !== current.pose) {
    requestAnimationFrame(() => requestAnimationFrame(() => setPose(current.pose)));
  }

  const scroller = document.getElementById('phone-screen');
  wireDragScroll(scroller);
  if (current.scrollHint) wireScrollHint(scroller);
  if (current.dismissable) wireDismiss();

  if (current.onMount) current.onMount(scroller, { setPose, setSignal, setClock, close });
  return true;
}

/**
 * 机内换屏：只把屏幕里的内容换掉，手机本身不动（不重新进场、不换姿态）。
 * 主屏点进某个 app、再从 app 退回主屏，走的都是这条——观感上就是在同一台手机里翻页，
 * 而不是"关掉一台手机再掏出另一台"。滚动位置一并归零。
 * @param {string} html 新的屏幕内容
 * @param {Function} [onMount] 填好之后的回调，用来挂这一屏自己的事件
 */
export function setScreen(html, onMount) {
  if (!current) return false;
  const holder = document.getElementById('phone-content');
  if (!holder) return false;
  holder.innerHTML = html;
  const scroller = getScroller();
  if (scroller) scroller.scrollTop = 0;
  if (onMount) onMount(scroller);
  return true;
}

/** 屏幕里真正滚动的那一层，app 想自己滚到某处时用。 */
export function getScroller() {
  return document.getElementById('phone-screen');
}

export function isOpen() {
  return !!current;
}

/** 当前装的是哪个 app（没装返回 null）。app 想知道"手机里现在是不是我"时用。 */
export function getApp() {
  return current ? (current.id || null) : null;
}

/**
 * 收起手机：先播一段滑出屏幕的出场动画，动画完再真正拆 DOM 并走 onClose。
 * @param {object} [opts] silent: true 跳过动画立刻拆掉（换 app 时内部用）
 */
export function unmount(opts = {}) {
  if (!current || closing) return;
  const app = current;

  const finish = () => {
    closeTimer = null;
    teardown.forEach(fn => fn());
    teardown = [];
    if (app.onUnmount) app.onUnmount();
    if (overlay) {
      overlay.classList.add('hidden');
      overlay.classList.remove('phone-no-service', 'phone-glitch');
      overlay.removeAttribute('data-pose');
      overlay.removeAttribute('data-dock');
      overlay.removeAttribute('data-app');
      overlay.innerHTML = '';
    }
    overlay = null;
    current = null;
    closing = false;
    if (!opts.silent && app.onClose) app.onClose();
  };

  if (opts.silent) { finish(); return; }

  closing = true;
  setPose('away');
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  closeTimer = setTimeout(finish, reduce ? 0 : 480); // 跟 phone.css 里 .phone-device 的 transition 时长对齐
}

/** unmount 的别名：app 内部的"关闭"按钮直接调这个，读起来更像那么回事。 */
export function close() {
  unmount();
}

// ---------- 屏幕交互（外壳层的通用行为，各个 app 都吃得到） ----------

/**
 * 鼠标按住往上拖也能翻页——原本只能滚轮。触屏不接管（原生滚动本来就能划），
 * 所以只认 pointerType === 'mouse'。
 */
function wireDragScroll(screen) {
  if (!screen) return;
  let dragging = false;
  let moved = false;   // 真的拖动过（超过 4px）才算拖拽，不然当普通点击放过去
  let startY = 0;
  let startTop = 0;

  const onDown = e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    dragging = true;
    moved = false;
    startY = e.clientY;
    startTop = screen.scrollTop;
  };

  const onMove = e => {
    if (!dragging) return;
    // 手机整体被 --phone-scale 缩放过，鼠标走过的屏幕距离要除以缩放比才对得上内容里的距离
    const dy = (e.clientY - startY) / getScale();
    if (!moved && Math.abs(dy) > 4) {
      moved = true;
      screen.classList.add('dragging');
    }
    if (moved) screen.scrollTop = startTop - dy;
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    screen.classList.remove('dragging');
    if (!moved) return;
    // 拖完松手浏览器还会补发一次 click，别让它落在按钮上（比如拖到一半正好停在"换一条"上）
    const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', swallow, true);
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
  };

  screen.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  teardown.push(() => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  });
}

/**
 * 玩家自己掏出来的手机得有个收起来的办法：点手机外面那片暗幕，或者按 Esc。
 * 只给 mount 时传了 dismissable 的那些场合挂（发布之后那台手机不挂——它有自己的
 * "收起手机，回房休息"按钮，而且那一步是流程的一环，不该能随手点掉）。
 */
function wireDismiss() {
  const backdrop = document.querySelector('#phone-overlay .phone-backdrop');
  if (backdrop) backdrop.addEventListener('click', () => unmount());

  const onKey = e => { if (e.key === 'Escape') unmount(); };
  window.addEventListener('keydown', onKey);
  teardown.push(() => window.removeEventListener('keydown', onKey));
}

/** 手机左边那列"向下滑动查看更多"：点一下往下翻一屏，玩家自己滚了就淡出，不再出现。 */
function wireScrollHint(screen) {
  const hint = document.getElementById('phone-scroll-hint');
  if (!hint || !screen) return;
  hint.classList.remove('hidden');
  // 内容没超出一屏就不提示。首帧布局还没算完，等一帧再量。
  requestAnimationFrame(() => {
    if (screen.scrollHeight <= screen.clientHeight + 20) {
      hint.classList.add('is-gone');
      return;
    }
    const onScroll = () => {
      if (screen.scrollTop <= 20) return;
      hint.classList.add('is-gone');
      screen.removeEventListener('scroll', onScroll);
    };
    screen.addEventListener('scroll', onScroll, { passive: true });
    hint.addEventListener('click', () => screen.scrollBy({ top: 380, behavior: 'smooth' }));
  });
}
