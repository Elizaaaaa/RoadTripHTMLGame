// paper.js —— 折叠纸条演出：一张对折过的纸条在屏幕中央翻开，摊平之后字迹才逐句淡入，
// 玩家读完点一下，纸和字一起淡出。只负责"翻开—写字—收起"这件事本身，不含任何剧情文案，
// 也不判断什么时候该出纸条——哪一页正文做成纸条写在 content/days.json 的
// events[].paperSegments 里，由 main.js 调用（见 playEventPages）。
//
// 跟地震演出（quake.js）同一层：DOM 和定时器都在这边，main.js 只管"什么时候放、放哪段
// 文字"。play() 返回的 promise 在玩家点掉纸条之后才兑现，调用方在 .then 里接着往下走。
//
// 对折的几何：#paper-overlay 里的 .paper-sheet 是摊平之后的整张纸，高度由纸上的文字撑开；
// 两块 .paper-fold 各占它的一半，绝对定位铺满整张。上半块不动，下半块绕中间那道折痕
// （transform-origin 落在它自己的上边）从 180° 转回 0°——180° 时正好翻上去盖住上半块，
// 转回来的路上自由边从屏幕这一侧（+z）扫过去，看着才像"把纸掀开"而不是"从背面翻出来"。
// 折着的时候画面里就是一张半高的小纸包。
//
// 纸包中心不等于摊平后的中心（纸包只占上半截），所以 .paper-sheet 起手先往下坐四分之一
// 张纸让纸包落在屏幕正中，再在翻开的同时抬回 0：纸包不跑位，摊平之后整张纸正好居中。
// 这段位移跟"落下淡入"分在 .paper-sheet / .paper-stage 两层元素上——同一个元素上两个
// 动画都动 transform 只会后者盖掉前者，合成不了。
//
// 字为什么等摊平了才出现：纸面在 0°~180° 之间是斜的，字跟着一起斜就糊成一团；而且"先摊开、
// 再显字"本身就是玩家读一张纸条的顺序。文字用 reveal.js 那套逐句淡入，起始延迟（--rv-base）
// 由这里按摊开时长算出来写进 .paper-body，所以改摊开时长不用再去对文字的延迟。
//
// 动画只动 transform / opacity 两个合成器属性，理由跟 ui.css 地震演出那一节一样：祖先上
// 挂 filter 会让整棵子树每帧重新栅格化。翻页转到侧面时的明暗变化因此不用 brightness()，
// 改成盖一层黑色渐变、跟着转角淡出（见 ui.css 的 .paper-fold::after）。

import * as revealSys from './reveal.js';

const DEFAULTS = {
  introMs: 320,    // 纸包淡入 + 轻微落下，落定之后才开始翻
  unfoldMs: 760,   // 翻开那一下的时长（整段演出只有这一折，给得足一点才有分量）
  settleMs: 160,   // 摊平之后停一拍，再开始写字
  textStepMs: 300, // 字迹逐句淡入的间隔
  outMs: 460       // 点掉之后纸和字一起淡出的时长
};

let timers = [];
let finishCurrent = null; // 当前这次演出的 resolve，cancel() 时直接兑现，不让调用方的流程挂死
let detachClick = null;   // 已经武装好的"点一下收起"，cancel() 用它拆掉监听

export function isPlaying() {
  return !!finishCurrent;
}

/**
 * 翻开一张纸条。
 * @param {object} opts
 * @param {string} opts.text 纸上的文字，原始正文（可带 [[显示文字|key]] 关键词语法）
 * @param {(s:string)=>string} [opts.parse] 把一句原始文本转成 HTML，通常传 keyword-parser 的 parseKeywords
 * @param {(bodyEl:HTMLElement)=>void} [opts.onReady] 文字塞进纸面之后回调，调用方拿它绑关键词点击
 * @param {number} [opts.introMs] [opts.unfoldMs] [opts.settleMs] [opts.textStepMs] [opts.outMs] 覆盖上面的节奏默认值
 * @returns {Promise<void>} 玩家点掉纸条、淡出走完之后兑现
 */
export function play(opts = {}) {
  cancel(); // 同一时间只允许一张纸条：新的一次直接接管，旧的那次立刻兑现

  const cfg = { ...DEFAULTS, ...opts };
  const overlay = document.getElementById('paper-overlay');
  if (!overlay) return Promise.resolve(); // 没有这层容器（比如某些预览页）就当没这回事，别把调用方卡死
  const body = overlay.querySelector('.paper-body');
  const hint = overlay.querySelector('.paper-hint');

  // 晕动症 / 系统"减少动态效果"：不翻了，纸直接是平的，只留淡入——信息一点不少。
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const introMs = reduced ? 160 : cfg.introMs;
  const unfoldMs = reduced ? 0 : cfg.unfoldMs;
  // 字迹开始淡入的时刻：翻开走完、再停一拍。玩家能点掉纸条的时刻也是这个——
  // 在纸还没摊平的时候手一抖点一下就把整张纸跳过去，那就白演了。
  const textDelayMs = introMs + unfoldMs + (reduced ? 0 : cfg.settleMs);

  overlay.style.setProperty('--paper-intro-ms', `${introMs}ms`);
  overlay.style.setProperty('--paper-unfold-ms', `${unfoldMs}ms`);
  overlay.style.setProperty('--paper-out-ms', `${cfg.outMs}ms`);

  body.innerHTML = revealSys.clauses(cfg.text || '', cfg.parse);
  body.style.setProperty('--rv-base', `${textDelayMs}ms`);
  body.style.setProperty('--rv-step', `${cfg.textStepMs}ms`);
  if (hint) hint.classList.remove('paper-hint-on');

  overlay.classList.remove('paper-closing');
  overlay.classList.remove('hidden');
  // 先解除 display:none 再强制一次回流，让"还折着"的起始状态真正落进渲染树，
  // 加 class 之后动画才有得播。跟 quake.js 一样不能用 rAF 代替：页面不可见时
  // （后台标签页、无头浏览器）rAF 可能一直不回调，纸条就永远停在折着的样子。
  void overlay.offsetWidth;
  overlay.classList.add('paper-open');
  if (cfg.onReady) cfg.onReady(body);

  return new Promise(resolve => {
    finishCurrent = resolve;

    const close = () => {
      if (!finishCurrent) return;
      detach();
      overlay.classList.add('paper-closing');
      timers.push(setTimeout(() => {
        overlay.classList.remove('paper-open', 'paper-closing');
        overlay.classList.add('hidden');
        const done = finishCurrent;
        finishCurrent = null;
        if (done) done();
      }, cfg.outMs));
    };

    const onClick = e => {
      // 纸上的关键词是拿来点开记事本词条的，点它不算"读完了"
      if (e.target.closest && e.target.closest('[data-kw]')) return;
      close();
    };
    const detach = () => {
      overlay.removeEventListener('click', onClick);
      overlay.classList.remove('paper-armed');
      detachClick = null;
    };

    // 字开始往纸上淡的那一刻才接受点击，同时给出"点一下收起"的提示
    timers.push(setTimeout(() => {
      overlay.addEventListener('click', onClick);
      overlay.classList.add('paper-armed');
      if (hint) hint.classList.add('paper-hint-on');
      detachClick = detach;
    }, textDelayMs));
  });
}

/** 中断当前演出并立刻复位（关窗、切换存档、回退时间线等场合调）。等待中的 promise 会被立即兑现。 */
export function cancel() {
  for (const t of timers) clearTimeout(t);
  timers = [];
  if (detachClick) detachClick();
  const overlay = document.getElementById('paper-overlay');
  if (overlay) {
    overlay.classList.remove('paper-open', 'paper-closing', 'paper-armed');
    overlay.classList.add('hidden');
  }
  if (finishCurrent) {
    const resolve = finishCurrent;
    finishCurrent = null;
    resolve();
  }
}
