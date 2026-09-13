// scan.js —— 「扫描」演出：理智跌到低位时，地图上随机亮起几个取景框，框住的那块底图被
// 打成马赛克，框边浮着一串读不通的读数，框与框之间拉出细线。演完自己消失，不留 DOM。
//
// 叙事上这是「子午线仪」的读数漏进了主角的感知（见 content/worldbuilding.md canon 表）：
// 不是主角在看地图，是有个东西在隔着地图量这个镇子。所以框的语气是「锁定」——先大一圈
// 再收进去咬住目标，而不是平淡地淡入；而被框住的地方反倒更看不清了（马赛克），因为
// 正在被量的不是主角能读懂的那一层。
//
// 跟 quake.js 一样，这个模块不判断「什么时候该扫」——阈值/冷却/概率写在 main.js 的
// maybeScan() 里，这里只管怎么演。但有两点跟地震不同：
//   1. 扫描不挡交互（整层 pointer-events:none）。它是环境效果不是打断，演出期间玩家
//      该点哪个热点还点哪个，不需要 quake 那样的 quake-blocking 挡板。
//   2. 因此 play() 返回的 promise 只是「演完了」的通知，没有「兑现后调用方才弹窗」的
//      时序契约——没人 await 它也不会卡住任何流程。
//
// 性能：整个演出挂在 .map-image-box 里（跟热点同一层），缩放/平移由 .map-content 的
// transform 一起带走，演出期间不用跟着 pan/zoom 重算任何东西。马赛克的做法是「把底图
// 那一块画进一张 N×M 的小 canvas，再让 CSS 把这张小图撑满框」：降采样那一步由 drawImage
// 完成（自带区块平均色），放大那一步交给 image-rendering:pixelated（不插值，硬边方块），
// 全程没有滤镜、没有 backdrop-filter、也没有逐帧重绘。ui.css 理智闪烁那一节记下的教训
// 在这里同样成立——绝对不能给地图的祖先挂一个正在跑的 filter。
//
// 另：drawImage 只是「画」不是「读像素」，不会因为图片跨源而抛 SecurityError，所以哪怕
// 有人用 file:// 打开也只是图加载不出来，不会在这里炸。

const NS = 'http://www.w3.org/2000/svg';

const DEFAULTS = {
  points: [],        // 候选点位 [{ x, y, w?, h?, text? }]，x/y 是框心，单位是占底图宽/高的百分比
  count: 10,         // 一次亮几个框（多于候选点数时自动取候选点数）
  boxMin: 4.5,       // 框宽下限（占底图宽度的百分比）
  boxMax: 10,        // 框宽上限
  gridMin: 6,        // 马赛克横向格数下限——格数越少块越大越糊
  gridMax: 12,
  staggerMs: 110,    // 框与框之间的错峰间隔
  growMs: 280,       // 单个框「收进去咬住」的时长
  holdMs: 2800,      // 全部亮齐之后停留多久
  fadeMs: 800,       // 整层淡出时长
  scrambleMs: 150,   // 读数重抽间隔（0 = 不抖）
  linkChance: 0.72,  // 相邻两个框之间拉引线的概率
  bleedWords: [],    // 长串乱码：命中时这个框不出短读数，改出这里的一条（样式变暖红，见 .scan-bleed）
  bleedChance: 0.4   // 注意是「每个框各掷一次」，不是「整场演出一次」——10 个框时平均亮 4 条
};

// 乱码字符集：半角片假名 + 块元素 + 制表符 + 十六进制数字。挑这些是因为它们等宽能对齐、
// 字形又不属于任何一种玩家读得懂的语言——要的是「仪器读数坏了」，不是「外星文」。
const GLYPHS = '0123456789ABCDEF▚▞▙▟▜▛░▒▓┤├┼╳ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾅﾆﾇﾈﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓ';

let layerEl = null;
let timers = [];
let scrambleTimer = 0;
let finishCurrent = null; // 当前这次演出的 resolve；cancel() 时直接兑现，不让等待方挂死

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pickOne = seq => seq[Math.floor(Math.random() * seq.length)];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function isPlaying() {
  return !!finishCurrent;
}

/**
 * 生成一条读数。大头是「n/7 的小数」：位数固定、又永远除不尽，看起来最像仪器真的量出来
 * 的值——纯随机数字反而会露馅（人眼认得出随机串的「毛糙」）。剩下的少数是纯乱码字形，
 * 用来打破整齐感。
 */
function makeReadout() {
  const r = Math.random();
  if (r < 0.55) return (randInt(1, 21) / 7).toFixed(4);
  if (r < 0.78) return `${randInt(0, 9)}.${String(randInt(0, 9999)).padStart(4, '0')}`;
  return Array.from({ length: randInt(3, 6) }, () => pickOne(GLYPHS)).join('');
}

/** 从候选点位里不重复地抽 count 个（部分洗牌，不动传进来的数组）。 */
function choosePoints(points, count) {
  const pool = points.slice();
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const j = randInt(i, pool.length - 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

/** 框的四个角，单位同 rect（占底图宽/高的百分比）。 */
function cornersOf(r) {
  return [
    [r.left, r.top], [r.left + r.w, r.top],
    [r.left, r.top + r.h], [r.left + r.w, r.top + r.h]
  ];
}

/**
 * 两个框之间选一对「看起来最近」的角来连线。x 是宽度百分比、y 是高度百分比，两者对应的
 * 屏幕像素不等长，所以比距离前得先把 y 按图片宽高比折算回同一把尺子，否则在 3:2 的底图上
 * 总会偏向选上下那对角。
 */
function nearestCorners(a, b, aspect) {
  let best = null;
  for (const [ax, ay] of cornersOf(a)) {
    for (const [bx, by] of cornersOf(b)) {
      const d = Math.hypot(bx - ax, (by - ay) / aspect);
      if (!best || d < best.d) best = { d, x1: ax, y1: ay, x2: bx, y2: by };
    }
  }
  return best;
}

/**
 * 把底图上 rect 那一块降采样进一张小 canvas。返回 null 表示底图还没加载完——这时只画框
 * 不画马赛克，比整个演出不出来要好。
 */
function makeMosaic(img, rect, cfg) {
  if (!img.complete || !img.naturalWidth) return null;
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;

  // 框可能被 clamp 到贴边，源矩形统一夹回图片范围内，免得 drawImage 取到图外的空白
  const sx = clamp(rect.left / 100 * nw, 0, nw);
  const sy = clamp(rect.top / 100 * nh, 0, nh);
  const sw = clamp(rect.w / 100 * nw, 1, nw - sx);
  const sh = clamp(rect.h / 100 * nh, 1, nh - sy);

  const cols = randInt(cfg.gridMin, cfg.gridMax);
  const rows = Math.max(2, Math.round(cols * sh / sw)); // 让方块在屏幕上接近正方形

  const canvas = document.createElement('canvas');
  canvas.className = 'scan-pix';
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true; // 缩小时插值 = 每个格子取区块平均色；放大那一步才要硬边
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cols, rows);
  return canvas;
}

/**
 * 播一次扫描。
 * @param {object} [opts] 覆盖 DEFAULTS 里的任意字段；points 为空时直接空跑
 * @returns {Promise<void>} 整层淡出之后兑现
 */
export function play(opts = {}) {
  cancel(); // 同一时间只演一次：新的直接接管，旧的立刻兑现

  // 逐个字段覆盖而不是 { ...DEFAULTS, ...opts }：对象展开会把值为 undefined 的键也铺上去，
  // 调用方从 JSON 里读一个没写的可选字段（mapData.bleedChance 之类）传进来，
  // 默认值就会被 undefined 顶掉，后面拿它做比较/算术会静默出错。
  const cfg = { ...DEFAULTS };
  for (const [k, v] of Object.entries(opts)) {
    if (v !== undefined) cfg[k] = v;
  }

  // 跟 map.js 的 DOM 约定：.map-image-box 是「精确对齐 object-fit:contain 实际渲染矩形」
  // 的那个盒子，热点的百分比坐标就是相对它算的，扫描框挂进来才能跟热点共用同一套坐标。
  // 地图还没建好（启动早期、结局画面）时静默跳过，不报错也不留状态。
  const mount = document.querySelector('.map-image-box');
  const img = document.querySelector('.map-image');
  if (!mount || !img) return Promise.resolve();

  const chosen = choosePoints(cfg.points || [], cfg.count);
  if (!chosen.length) return Promise.resolve();

  const aspect = (img.naturalWidth || 1536) / (img.naturalHeight || 1024);
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  layerEl = document.createElement('div');
  layerEl.className = reduced ? 'scan-layer scan-reduced' : 'scan-layer';
  layerEl.setAttribute('aria-hidden', 'true');
  // 淡出时长交给 CSS 的 transition，但节奏是这里算的——必须把 fadeMs 传过去，
  // 否则调用方改了 fadeMs，收尾的 timer 和 CSS 过渡会对不上（层还没淡完就被 remove）
  layerEl.style.setProperty('--scan-fade', `${cfg.fadeMs}ms`);

  // 引线层放在框下面：线从框角出发、被框自己压住一截，看起来才像「连到框上」而不是「穿过框」。
  // viewBox 用 0-100 的百分比坐标 + preserveAspectRatio=none，就能跟框共用同一套 x/y；
  // 代价是坐标系被非等比拉伸，所以线宽必须交给 vector-effect 而不是 stroke-width。
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'scan-links');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  layerEl.appendChild(svg);

  const rects = [];
  const labels = []; // 可以被重抽的读数元素（写死了 text 的那些不进来）

  chosen.forEach((p, i) => {
    const w = p.w || rand(cfg.boxMin, cfg.boxMax);
    // p.h 没写就按「屏幕上接近正方形」反推：高度百分比要乘以图片宽高比，再给一点随机扁窄
    const h = p.h || clamp(w * aspect * rand(0.75, 1.25), 3, 26);
    const rect = {
      left: clamp(p.x - w / 2, 0, 100 - w),
      top: clamp(p.y - h / 2, 0, 100 - h),
      w, h
    };
    rects.push(rect);

    const el = document.createElement('div');
    el.className = 'scan-box';
    el.style.left = `${rect.left}%`;
    el.style.top = `${rect.top}%`;
    el.style.width = `${rect.w}%`;
    el.style.height = `${rect.h}%`;
    // 错峰：一排框整齐划一地弹出来会像 UI，不像「在扫」
    el.style.setProperty('--scan-delay', `${reduced ? 0 : i * cfg.staggerMs}ms`);
    el.style.setProperty('--scan-grow', `${reduced ? 0 : cfg.growMs}ms`);

    const mosaic = makeMosaic(img, rect, cfg);
    if (mosaic) el.appendChild(mosaic);

    const label = document.createElement('span');
    label.className = 'scan-label';
    // 写死 text 的点位（或抽中「渗出来的词」）出真话，其余出乱码读数
    const bleed = !p.text && cfg.bleedWords.length && Math.random() < cfg.bleedChance;
    if (p.text || bleed) {
      label.textContent = p.text || pickOne(cfg.bleedWords);
      label.classList.add('scan-bleed');
    } else {
      label.textContent = makeReadout();
      labels.push(label);
    }
    el.appendChild(label);

    layerEl.appendChild(el);
  });

  // 引线：只连相邻的两个框，连成一条断断续续的链。全连成网会太「科幻 UI」，
  // 断链才像仪器随手把几个读数点标在一起。
  for (let i = 1; i < rects.length; i++) {
    if (Math.random() > cfg.linkChance) continue;
    const seg = nearestCorners(rects[i - 1], rects[i], aspect);
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', seg.x1);
    line.setAttribute('y1', seg.y1);
    line.setAttribute('x2', seg.x2);
    line.setAttribute('y2', seg.y2);
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    line.style.setProperty('--scan-delay', `${reduced ? 0 : i * cfg.staggerMs}ms`);
    svg.appendChild(line);
  }

  mount.appendChild(layerEl);

  const lastIn = (chosen.length - 1) * cfg.staggerMs + cfg.growMs;

  return new Promise(resolve => {
    finishCurrent = resolve;

    // 读数重抽：只挑一两个框改 textContent，不是整批刷新——「个别读数在跳」比「全体在跳」
    // 更像真的在测量。改的是绝对定位元素里的文字，重排范围就它自己，波及不到地图。
    if (!reduced && cfg.scrambleMs > 0 && labels.length) {
      scrambleTimer = setInterval(() => {
        for (let k = 0, n = Math.min(2, labels.length); k < n; k++) {
          pickOne(labels).textContent = makeReadout();
        }
      }, cfg.scrambleMs);
    }

    timers.push(setTimeout(() => {
      if (scrambleTimer) { clearInterval(scrambleTimer); scrambleTimer = 0; }
      if (layerEl) layerEl.classList.add('scan-out'); // 整层一起淡出，只动 opacity
    }, lastIn + cfg.holdMs));

    timers.push(setTimeout(() => {
      finishCurrent = null;
      if (layerEl) { layerEl.remove(); layerEl = null; }
      resolve();
    }, lastIn + cfg.holdMs + cfg.fadeMs));
  });
}

/** 中断并立刻清干净（重开、读档、地图重建时调）。等待中的 promise 会被立即兑现。 */
export function cancel() {
  for (const t of timers) clearTimeout(t);
  timers = [];
  if (scrambleTimer) { clearInterval(scrambleTimer); scrambleTimer = 0; }
  if (layerEl) { layerEl.remove(); layerEl = null; }
  if (finishCurrent) {
    const resolve = finishCurrent;
    finishCurrent = null;
    resolve();
  }
}
