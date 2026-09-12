// quake.js —— 地震演出：抖动 + 落灰 + 一拍死寂。只负责"地在动"这件事本身，
// 不含任何剧情文案，也不判断什么时候该震——触发时机写在 content/days.json 的
// timedEvents 里，由 main.js 调用（见 playTimedEvents）。
//
// 对应 design-doc.md 1.6 节：2019-07-04 的 M6.4 前震和 07-05 的 M7.1 主震是跨结局
// 固定发生的现实锚点，是"封印正在衰减"的物理签名、而不是玩家行为的后果。所以演出
// 上要的是"没头没尾地晃了一下、然后一切安静下来"，不是爆炸式的高潮回报：抖动振幅
// 从头衰减到尾，抖完留一拍死寂才让文案出现（见 play() 的 silenceMs）。
//
// 为什么整段动画只碰 transform / opacity：ui.css 理智闪烁那一节记着一条教训——祖先
// 元素上挂着正在跑的 filter，会让整棵子树每帧重新栅格化，还会废掉 .map-content 的
// will-change:transform。这里只用合成器属性，而且是一次性动画，跑完马上把 class 摘掉，
// 不给地图留任何长期开销。
//
// 抖动分两层：#app（状态栏 + 地图，"世界在抖"）和 #modal-box（仿 macOS 的弹窗，
// "手里这台电脑在抖"）。弹窗容器是 body 的兄弟节点、不在 #app 里，所以本来就不会
// 被 #app 的 transform 带着走，正好各给一份振幅不同的动画。
// 另：#app 被平移时边缘会露出 body 底色，关键帧里统一带一个 scale(1.015) 顶出去。

// 按震级预设的几组参数。play({ magnitude: '7.1' }) 取这里，再被显式传入的字段覆盖。
const PRESETS = {
  '6.4': { amp: 5,  shakeMs: 1100, silenceMs: 600, dust: 0.55 }, // 前震：晃一下就过去了，灰也不大
  '7.1': { amp: 12, shakeMs: 1900, silenceMs: 900, dust: 1 }     // 主震：站不住，顶上落灰
};

const DEFAULTS = { amp: 7, shakeMs: 1300, silenceMs: 700, dust: 0.7 };

const DUST_FADE_OUT_MS = 1400; // 灰落定的时间，比 play() 的 promise 晚——文案出现时灰还在慢慢沉

let timers = [];
let finishCurrent = null; // 当前这次演出的 resolve，cancel() 时直接兑现，不让调用方的流程挂死

export function isPlaying() {
  return !!finishCurrent;
}

/**
 * 播一次地震。
 * @param {object} [opts]
 * @param {string|number} [opts.magnitude] 震级，命中 PRESETS 就用那组参数（'6.4' / '7.1'）
 * @param {number} [opts.amp] 抖动振幅（px，峰值）
 * @param {number} [opts.shakeMs] 抖多久
 * @param {number} [opts.silenceMs] 抖完到 promise 兑现之间的"死寂"时长
 * @param {number} [opts.dust] 落灰浓度 0-1
 * @returns {Promise<void>} 抖完 + 死寂之后兑现；调用方在 .then 里再弹文案窗口。
 */
export function play(opts = {}) {
  cancel(); // 同一时间只允许一次演出：新的一次直接接管，旧的那次立刻兑现

  const preset = PRESETS[String(opts.magnitude)] || {};
  const cfg = { ...DEFAULTS, ...preset, ...opts };

  const overlay = document.getElementById('quake-overlay');
  const root = document.documentElement;
  // 晕动症 / 系统"减少动态效果"：不抖，只留落灰和那一拍死寂，信息量不丢。
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const shakeMs = reduced ? 0 : cfg.shakeMs;

  root.style.setProperty('--quake-amp', `${cfg.amp}px`);
  root.style.setProperty('--quake-shake-ms', `${shakeMs}ms`);
  root.style.setProperty('--quake-dust', String(cfg.dust));

  if (overlay) {
    overlay.classList.remove('hidden');
    // 先解除 display:none 并强制一次回流，让"opacity:0 且已经在渲染树里"这个起始状态真正落地，
    // 再加 class，transition 才有得过渡。这里不能用 requestAnimationFrame 代替：页面不可见
    // （后台标签页、无头浏览器）时 rAF 可能一直不回调，落灰就永远不会淡入。
    void overlay.offsetWidth;
    overlay.classList.add('quake-dust-on');
  }
  if (!reduced) document.body.classList.add('quaking');
  // 演出期间（含那一拍死寂）把落灰层变成能吃点击的挡板：不然玩家能在抖动中间又点一次
  // 地图，两条流程叠在一起。见 ui.css 的 body.quake-blocking 规则。
  document.body.classList.add('quake-blocking');

  return new Promise(resolve => {
    finishCurrent = resolve;
    // 抖动结束：摘 class（动画 both 填充，摘了才会回到原位）
    timers.push(setTimeout(() => document.body.classList.remove('quaking'), shakeMs));
    // 死寂过半时开始收灰，剩下的一半时间里灰在慢慢沉
    timers.push(setTimeout(() => overlay && overlay.classList.remove('quake-dust-on'), shakeMs + cfg.silenceMs * 0.5));
    // 一拍死寂走完 → 兑现，调用方这时才弹文案
    timers.push(setTimeout(() => {
      finishCurrent = null;
      document.body.classList.remove('quake-blocking');
      timers.push(setTimeout(() => overlay && overlay.classList.add('hidden'), DUST_FADE_OUT_MS));
      resolve();
    }, shakeMs + cfg.silenceMs));
  });
}

/** 中断当前演出并立刻复位（切换存档、回退时间线等场合调）。等待中的 promise 会被立即兑现。 */
export function cancel() {
  for (const t of timers) clearTimeout(t);
  timers = [];
  document.body.classList.remove('quaking');
  document.body.classList.remove('quake-blocking');
  const overlay = document.getElementById('quake-overlay');
  if (overlay) {
    overlay.classList.remove('quake-dust-on');
    overlay.classList.add('hidden');
  }
  if (finishCurrent) {
    const resolve = finishCurrent;
    finishCurrent = null;
    resolve();
  }
}
