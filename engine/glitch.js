// glitch.js —— 监控信号异常演出：画面断掉、雪花、撕裂带、时间码乱跳，然后重新锁上。
// 只负责"信号断了一下"这件事本身，不判断什么时候该断——触发时机写在 main.js 的
// applyRestoredState() 里（时间线回退：结局窗口的两份清单、地图上的"时间线"按钮）。
//
// 为什么回退要配这么一段：这个游戏的画面语言从一开始就是"被记录下来的东西"——vlog
// 素材、剪辑台、手机数据页，scan.js 那套取景框更是直说了"有个东西在隔着地图量这个镇子"
// （见 content/worldbuilding.md canon 表）。玩家回到某个时间点，动作上等于把这卷带子倒
// 回去重录，所以转场就该是监控画面倒带时的样子：先断，再重新锁上一个新的时间码。
//
// 它同时还是个功能件，不只是好看：整段演出最不透明的那一段（见 ui.css 的 glitchEnvelope
// 关键帧 26%~55%）正好把"换状态"这一下遮住——地图重画、时钟跳表、弹窗关掉都发生在
// 雪花后面，玩家看到的是"信号回来的时候已经是另一个时刻了"，而不是界面当场闪一下变了样。
// 换状态的回调就是 play() 的 onCut，落点由 CUT_RATIO 定。
//
// 跟 quake.js 一样：零美术素材，整段只用 transform / opacity / background-position，
// 不碰 filter，也不给地图的祖先挂任何正在跑的滤镜（ui.css 理智闪烁那一节记着的教训）。
// 雪花的做法跟落灰同源——几层互质间距的渐变点阵各自按 steps() 跳位，叠在一起眼睛就
// 读成随机噪点了，不用逐帧重绘、也不用一张噪点图。

const DEFAULTS = {
  ms: 1500,     // 整段演出时长
  from: '',     // 断掉之前画面上的时刻（OSD 时间码的起点，如"7月5日 20:00"）；不传就直接从乱码开始
  to: '',       // 重新锁上之后的时刻——这一行才是玩家真正要看清的信息
  onCut: null   // 画面彻底断掉的那一刻的回调：调用方就在这里换状态、刷新界面
};

// onCut 落在整段的哪个位置。必须落在 ui.css 的 glitchEnvelope 里 opacity:1 那一段
// （26%~55%）中间——改那边的关键帧记得同步这个数，不然换状态会露在半透明的画面里。
const CUT_RATIO = 0.30;
const LOCK_RATIO = 0.72;  // 时间码停止乱跳、锁定成 to 的时刻
const SCRAMBLE_MS = 60;   // 时间码乱跳的重抽间隔

let timers = [];
let scrambleTimer = 0;
let pendingCut = null;    // 还没执行的 onCut；cancel() 时也要把它执行掉，见下
let finishCurrent = null; // 当前这次演出的 resolve，cancel() 时直接兑现，不让调用方的流程挂死

export function isPlaying() {
  return !!finishCurrent;
}

/** 时间码乱跳：只把数字换掉，月/日/冒号原样留着，看起来才像计数器在空转而不是一串乱码。 */
const scrambleDigits = s => String(s).replace(/\d/g, () => String(Math.floor(Math.random() * 10)));

/**
 * 播一次信号异常。
 * @param {object} [opts] 见上面的 DEFAULTS
 * @returns {Promise<void>} 信号完全恢复、这一层撤干净之后兑现
 */
export function play(opts = {}) {
  cancel(); // 同一时间只允许一次演出：新的一次直接接管，旧的那次立刻兑现

  const cfg = { ...DEFAULTS, ...opts };
  const overlay = document.getElementById('glitch-overlay');

  // 页面上没有这一层（预览工具里少放了、或者以后拆了这段演出）时不能把流程卡住：
  // 该换的状态立刻换掉，直接兑现。演出是锦上添花的，不该成为必经环节。
  if (!overlay) {
    if (cfg.onCut) cfg.onCut();
    return Promise.resolve();
  }

  const stamp = overlay.querySelector('.gl-osd-stamp');
  const note = overlay.querySelector('.gl-osd-note');
  const cutAt = Math.round(cfg.ms * CUT_RATIO);
  const lockAt = Math.round(cfg.ms * LOCK_RATIO);

  document.documentElement.style.setProperty('--gl-ms', `${cfg.ms}ms`);
  if (stamp) stamp.textContent = cfg.from || scrambleDigits(cfg.to || '00月00日 00:00');
  if (note) note.textContent = '信号中断';

  overlay.classList.remove('hidden');
  // 跟 quake.js 同一个理由：先解除 display:none 并强制一次回流，让动画从真正的起始帧开始播。
  // 这里不能用 requestAnimationFrame 代替——页面不可见时 rAF 可能一直不回调，演出就永远不开始。
  void overlay.offsetWidth;
  overlay.classList.add('gl-on');
  document.body.classList.add('glitching'); // 演出期间这一层接管点击，见 ui.css

  pendingCut = typeof cfg.onCut === 'function' ? cfg.onCut : null;

  return new Promise(resolve => {
    finishCurrent = resolve;

    // 画面彻底断掉：调用方在这一刻换状态，换完的界面藏在雪花后面
    timers.push(setTimeout(() => {
      fireCut();
      if (stamp) {
        scrambleTimer = setInterval(() => { stamp.textContent = scrambleDigits(cfg.to || cfg.from); }, SCRAMBLE_MS);
      }
    }, cutAt));

    // 重新锁上：时间码停在新的时刻，这是整段演出唯一要玩家读到的一行字
    timers.push(setTimeout(() => {
      clearInterval(scrambleTimer);
      scrambleTimer = 0;
      if (stamp && cfg.to) stamp.textContent = cfg.to;
      if (note) note.textContent = '已重新锁定';
      overlay.classList.add('gl-locked');
    }, lockAt));

    // 收尾：撤掉这一层，兑现
    timers.push(setTimeout(() => {
      finishCurrent = null;
      reset();
      resolve();
    }, cfg.ms));
  });
}

/**
 * 中断当前演出并立刻复位。**还没执行的 onCut 会在这里补执行**——它带着"换状态"这件
 * 正事，漏掉的话玩家会卡在一个既没回退、弹窗又已经关掉的局面里。
 */
export function cancel() {
  for (const t of timers) clearTimeout(t);
  timers = [];
  clearInterval(scrambleTimer);
  scrambleTimer = 0;
  fireCut();
  reset();
  if (finishCurrent) {
    const resolve = finishCurrent;
    finishCurrent = null;
    resolve();
  }
}

function fireCut() {
  const cut = pendingCut;
  pendingCut = null;
  if (cut) cut();
}

function reset() {
  document.body.classList.remove('glitching');
  const overlay = document.getElementById('glitch-overlay');
  if (!overlay) return;
  overlay.classList.remove('gl-on', 'gl-locked');
  overlay.classList.add('hidden');
}
