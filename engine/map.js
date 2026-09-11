// map.js —— 图片地图：底图 + 百分比坐标热点，缩放/平移，点击交互与状态展示。
// 对应 design-doc.md 第 3.1 / 3.2 节。取代原型里的按钮网格实现。

const MIN_SCALE = 1;
const MAX_SCALE = 3;
const CLICK_DRAG_THRESHOLD = 6; // px，小于这个位移判定为点击，否则判定为拖拽平移

// 墨迹揭图（见下方「墨迹揭图」一节）
const INK_RADIUS = 8.5;     // 墨团基准半径，占底图宽度的百分比；可被热点的 inkRadius 覆盖
const INK_GROW_MS = 1500;   // 一团墨洇开的时长
const INK_STAGGER_MS = 130; // 一次揭开多个点（读档进来）时的错峰间隔
const INK_EDGE_BLUR = 16;   // 稳定后的边缘羽化半径（按底图 1536 宽的画布像素算）
const INK_EDGE_STAIN = 'rgba(74, 52, 30, 0.55)'; // 边缘吸墨加深的颜色（旧纸上的墨色）
const INK_FULL_MS = 2200;   // 所有地点都揭开后，整张手绘地图漫开接管的时长

let viewportEl, contentEl, imageBoxEl, imgEl;
let inkCanvasEl, inkCtx, detailImg;
const inkBlots = new Map(); // id -> { shape, startAt }：已经洇开/正在洇开的墨团
let inkRaf = 0;
let fullRevealAt = null;    // 所有地点都揭开过之后，整张手绘地图开始漫开的时刻
let fullFloodShape = null;
let hotspotsById = {};      // id -> hotspot 定义（来自 hotspots.json）
let hotspotEls = new Map(); // id -> DOM 元素
let onHotspotClick = () => {};

let scale = 1, tx = 0, ty = 0;
let isPanning = false, dragDistance = 0;
let panStartX = 0, panStartY = 0, startTx = 0, startTy = 0;
let downTargetId = null;
let pinchStartDist = 0, pinchStartScale = 1;

function applyTransform() {
  contentEl.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
}

function clampPan() {
  const vw = viewportEl.clientWidth;
  const vh = viewportEl.clientHeight;
  const minX = vw - vw * scale;
  const minY = vh - vh * scale;
  tx = Math.min(0, Math.max(minX, tx));
  ty = Math.min(0, Math.max(minY, ty));
}

function zoomAt(newScale, cx, cy) {
  newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
  const contentX = (cx - tx) / scale;
  const contentY = (cy - ty) / scale;
  scale = newScale;
  tx = cx - contentX * scale;
  ty = cy - contentY * scale;
  clampPan();
  applyTransform();
}

function setupPanZoom() {
  viewportEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = viewportEl.getBoundingClientRect();
    const delta = e.deltaY < 0 ? 0.2 : -0.2;
    zoomAt(scale + delta, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  viewportEl.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && e.isPrimary === false) return; // 多指交给 touch 事件处理
    isPanning = true;
    dragDistance = 0;
    panStartX = e.clientX; panStartY = e.clientY;
    startTx = tx; startTy = ty;
    const hotspotEl = e.target.closest('.hotspot');
    downTargetId = hotspotEl && !hotspotEl.classList.contains('locked') ? hotspotEl.dataset.id : null;
    viewportEl.setPointerCapture(e.pointerId);
  });

  viewportEl.addEventListener('pointermove', (e) => {
    if (!isPanning) return;
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    dragDistance = Math.hypot(dx, dy);
    tx = startTx + dx;
    ty = startTy + dy;
    clampPan();
    applyTransform();
  });

  viewportEl.addEventListener('pointerup', () => {
    isPanning = false;
    if (dragDistance < CLICK_DRAG_THRESHOLD && downTargetId) {
      onHotspotClick(downTargetId);
    }
    downTargetId = null;
  });

  // 双指捏合缩放（移动端）
  viewportEl.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      isPanning = false;
      pinchStartDist = touchDist(e.touches);
      pinchStartScale = scale;
    }
  }, { passive: true });

  viewportEl.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const rect = viewportEl.getBoundingClientRect();
      const dist = touchDist(e.touches);
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      zoomAt(pinchStartScale * (dist / pinchStartDist), midX, midY);
    }
  }, { passive: false });
}

function touchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

/**
 * .map-image 用 object-fit:contain 保持底图原始比例，视口比例跟底图不一致时
 * 会在某一轴上留出黑边（信封效果）。热点坐标是相对"图片实际显示的那个矩形"算的
 * 百分比，不能直接拿 %，套在整个视口盒子上——否则视口比例和图片比例（这张地图
 * 是 1536x1024，3:2）不一致时，黑边会把所有热点一起挤偏。
 * 这里用 JS 把 .map-image-box 精确摆到 object-fit:contain 实际渲染的那个矩形位置，
 * <img> 和所有热点都挂在这个盒子下面，百分比就总是相对"图片本身"而不是视口。
 */
function layoutImageBox() {
  if (!imageBoxEl || !imgEl) return;
  const vw = viewportEl.clientWidth;
  const vh = viewportEl.clientHeight;
  const nw = imgEl.naturalWidth;
  const nh = imgEl.naturalHeight;
  if (!vw || !vh || !nw || !nh) return; // 视口还没有尺寸，或图片还没加载完，先不摆

  let boxW, boxH;
  if (vw / vh > nw / nh) {
    // 视口比图片更"宽"：以视口高度为准，图片左右留黑边
    boxH = vh;
    boxW = vh * (nw / nh);
  } else {
    // 视口比图片更"高"：以视口宽度为准，图片上下留黑边
    boxW = vw;
    boxH = vw * (nh / nw);
  }
  imageBoxEl.style.left = `${(vw - boxW) / 2}px`;
  imageBoxEl.style.top = `${(vh - boxH) / 2}px`;
  imageBoxEl.style.width = `${boxW}px`;
  imageBoxEl.style.height = `${boxH}px`;
}

// ---------- 墨迹揭图 ----------
// 底图是「现在」的卫星照片（white-lake-map-now.png）。一个地点被解锁后，它周围会像
// 墨水在纸上洇开一样，渲染出手绘地图（white-lake-map.png）对应位置的那一块——两张图
// 同尺寸同取景，所以直接按同一套百分比坐标叠就是对齐的。
//
// 做法是底图上盖一张 canvas：先把每个已解锁点画成一团白色的不规则墨渍（实心 + 模糊
// 边缘），再用 globalCompositeOperation='source-in' 把手绘地图整张画进去——手绘地图
// 就只在墨渍盖住的地方留下来，其余是透明的，露出下面的卫星底图。墨渍的形状按热点 id
// 取种子随机生成，所以同一个地点每次刷新长得都一样；挨得近的几个点洇开后会连成片。

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** mulberry32：小而稳的种子随机数，保证同一个 id 每次生成的墨渍形状一致。 */
function seededRandom(seed) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 生成一团墨渍的形状：极坐标下把半径按几个正弦谐波扰动成不规则轮廓，
 * 外加几颗溅出去的小墨点（洇到后半程才陆续出现）。
 */
function makeBlotShape(id) {
  const rand = seededRandom(hashSeed(id));
  const harmonics = [2, 3, 5, 7].map((f, i) => ({
    f,
    a: (0.2 - i * 0.042) * (0.6 + rand() * 0.8),
    phase: rand() * Math.PI * 2
  }));

  const STEPS = 72;
  const pts = [];
  for (let i = 0; i < STEPS; i++) {
    const th = (i / STEPS) * Math.PI * 2;
    let k = 1;
    for (const h of harmonics) k += h.a * Math.sin(h.f * th + h.phase);
    pts.push({ cos: Math.cos(th), sin: Math.sin(th), k: Math.max(0.55, k) });
  }

  const splatters = [];
  const count = 4 + Math.floor(rand() * 4);
  for (let i = 0; i < count; i++) {
    splatters.push({
      th: rand() * Math.PI * 2,
      dist: 0.85 + rand() * 0.4,
      r: 0.06 + rand() * 0.12,
      delay: 0.25 + rand() * 0.45
    });
  }
  return { pts, splatters };
}

/** 把墨渍轮廓描成路径（相邻采样点之间用二次贝塞尔过中点，边缘才不会是折线）。 */
function traceBlot(ctx, cx, cy, r, shape) {
  const pts = shape.pts;
  const n = pts.length;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const x1 = cx + cur.cos * cur.k * r;
    const y1 = cy + cur.sin * cur.k * r;
    const x2 = cx + next.cos * next.k * r;
    const y2 = cy + next.sin * next.k * r;
    if (i === 0) ctx.moveTo((x1 + x2) / 2, (y1 + y2) / 2);
    else ctx.quadraticCurveTo(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2);
  }
  ctx.closePath();
}

const supportsCanvasFilter = (() => {
  try {
    return typeof document.createElement('canvas').getContext('2d').filter === 'string';
  } catch (err) {
    return false;
  }
})();

/**
 * 画一团带羽化边缘的墨渍。优先用 canvas 的 filter:blur；老浏览器没有这个属性时，
 * 退化成几层由外到内逐层加深的同心轮廓，也能糊出接近的软边。
 */
function featherFill(ctx, cx, cy, r, shape, alpha, blur) {
  if (supportsCanvasFilter) {
    ctx.filter = `blur(${blur}px)`;
    ctx.globalAlpha = alpha;
    traceBlot(ctx, cx, cy, r, shape);
    ctx.fill();
    ctx.filter = 'none';
    return;
  }
  const LAYERS = 6;
  const spread = blur / Math.max(r, 1);
  for (let i = LAYERS; i >= 1; i--) {
    const f = i / LAYERS;
    ctx.globalAlpha = alpha * (1 - f * 0.85);
    traceBlot(ctx, cx, cy, r * (1 + spread * f), shape);
    ctx.fill();
  }
  ctx.globalAlpha = alpha;
  traceBlot(ctx, cx, cy, r, shape);
  ctx.fill();
}

/** t: 0→1 的洇开进度。半径 easeOutCubic（先快后慢，像墨被纸吃进去），边缘由糊到收。 */
function drawBlot(ctx, cx, cy, R, shape, t) {
  const r = R * (1 - Math.pow(1 - t, 3));
  const alpha = Math.min(1, t * 2.4);

  ctx.save();
  // 还在洇的时候，外面再糊一圈很淡的「湿边」，看着像墨还在往外走
  if (t < 1) {
    featherFill(ctx, cx, cy, r * 1.14, shape, alpha * 0.4, INK_EDGE_BLUR * (1 + (1 - t) * 4));
  }
  featherFill(ctx, cx, cy, r, shape, alpha, INK_EDGE_BLUR * (1 + (1 - t) * 1.8));

  for (const sp of shape.splatters) {
    if (t <= sp.delay) continue;
    const st = Math.min(1, (t - sp.delay) / (1 - sp.delay));
    const sx = cx + Math.cos(sp.th) * r * sp.dist;
    const sy = cy + Math.sin(sp.th) * r * sp.dist;
    if (supportsCanvasFilter) ctx.filter = `blur(${INK_EDGE_BLUR * 0.6}px)`;
    ctx.globalAlpha = alpha * st;
    ctx.beginPath();
    ctx.arc(sx, sy, R * sp.r * st, 0, Math.PI * 2);
    ctx.fill();
    if (supportsCanvasFilter) ctx.filter = 'none';
  }
  ctx.restore();
}

/**
 * 所有地点都揭开过之后的收尾：一团从镇中心漫开的大墨把整张纸吃掉，
 * 露出完整的手绘地图（连同图廓、罗盘、比例尺那些只在整图上才有的东西）。
 * p 到后半程再叠一层整幅实心，保证四个角也盖满——大墨团的轮廓是不规则的，
 * 光靠它扫不到角。
 */
function drawFullFlood(w, h, p) {
  const ctx = inkCtx;
  if (!fullFloodShape) fullFloodShape = makeBlotShape('__full_reveal__');
  ctx.save();
  const R = w * 0.95 * (1 - Math.pow(1 - p, 2.2));
  featherFill(ctx, w / 2, h / 2, R, fullFloodShape, 1, INK_EDGE_BLUR * (1 + (1 - p) * 3));
  if (p > 0.55) {
    ctx.filter = 'none';
    ctx.globalAlpha = Math.min(1, (p - 0.55) / 0.45);
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

/** 重画整张揭图 canvas。返回是否还有墨团在动（有的话下一帧接着画）。 */
function renderInk(now) {
  if (!inkCtx || !detailImg || !detailImg.complete || !detailImg.naturalWidth) return false;
  const w = inkCanvasEl.width;
  const h = inkCanvasEl.height;
  inkCtx.setTransform(1, 0, 0, 1, 0, 0);
  inkCtx.globalCompositeOperation = 'source-over';
  inkCtx.filter = 'none';
  inkCtx.globalAlpha = 1;
  inkCtx.clearRect(0, 0, w, h);
  inkCtx.fillStyle = '#fff';

  let animating = false;
  for (const [id, blot] of inkBlots.entries()) {
    const hotspot = hotspotsById[id];
    if (!hotspot) continue;
    const t = (now - blot.startAt) / INK_GROW_MS;
    if (t < 1) animating = true;
    if (t <= 0) continue; // 错峰还没轮到它
    const R = ((hotspot.inkRadius ?? INK_RADIUS) / 100) * w;
    drawBlot(inkCtx, (hotspot.x / 100) * w, (hotspot.y / 100) * h, R, blot.shape, Math.min(1, t));
  }

  // 所有地点都揭开过了：墨漫过整张纸，从"一块块揭开"过渡成完整的手绘地图
  let fullP = 0;
  if (fullRevealAt != null) {
    fullP = (now - fullRevealAt) / INK_FULL_MS;
    if (fullP < 1) animating = true;
    fullP = Math.min(1, fullP);
    if (fullP > 0) drawFullFlood(w, h, fullP);
  }

  // 关键一步：手绘地图只留在墨渍盖住的地方，其余透明，露出下面的卫星底图
  inkCtx.filter = 'none';
  inkCtx.globalAlpha = 1;
  inkCtx.globalCompositeOperation = 'source-in';
  inkCtx.drawImage(detailImg, 0, 0, w, h);

  // 再沿每团墨的轮廓描一圈糊开的墨色。source-atop 让它只落在已经揭开的区域里，
  // 于是只有内侧边缘被染深——纸吸饱墨之后边界比中间深，就是这个效果。
  // 整张图漫开之后就不该还有"边"了，所以随 fullP 一起淡掉（fullP=1 时这一圈是全透明的）。
  inkCtx.globalCompositeOperation = 'source-atop';
  inkCtx.strokeStyle = INK_EDGE_STAIN;
  for (const [id, blot] of inkBlots.entries()) {
    const hotspot = hotspotsById[id];
    if (!hotspot) continue;
    const t = Math.min(1, (now - blot.startAt) / INK_GROW_MS);
    if (t <= 0) continue;
    const R = ((hotspot.inkRadius ?? INK_RADIUS) / 100) * w;
    const r = R * (1 - Math.pow(1 - t, 3));
    if (supportsCanvasFilter) inkCtx.filter = `blur(${INK_EDGE_BLUR * 1.1}px)`;
    inkCtx.globalAlpha = (t < 1 ? 0.55 + (1 - t) * 0.45 : 0.55) * (1 - fullP); // 还湿着的时候边更重
    inkCtx.lineWidth = R * 0.11;
    traceBlot(inkCtx, (hotspot.x / 100) * w, (hotspot.y / 100) * h, r, blot.shape);
    inkCtx.stroke();
  }

  inkCtx.filter = 'none';
  inkCtx.globalAlpha = 1;
  inkCtx.globalCompositeOperation = 'source-over';
  return animating;
}

function inkTick() {
  inkRaf = 0;
  if (renderInk(performance.now())) inkRaf = requestAnimationFrame(inkTick);
}

function scheduleInkRender() {
  if (!inkRaf) inkRaf = requestAnimationFrame(inkTick);
}

/** 比对已解锁地点，给新解锁的点补一团墨；一次来好几个（读档）就错峰洇开。 */
function syncInkReveals(unlockedIds) {
  const now = performance.now();
  let queued = 0;
  for (const id of unlockedIds) {
    if (!hotspotsById[id] || inkBlots.has(id)) continue;
    inkBlots.set(id, { shape: makeBlotShape(id), startAt: now + queued * INK_STAGGER_MS });
    queued++;
  }
  // 集齐所有地点：等最后一团墨洇得差不多了，接着让整张手绘地图漫开
  if (queued && fullRevealAt == null && inkBlots.size === Object.keys(hotspotsById).length) {
    let lastStart = 0;
    for (const blot of inkBlots.values()) lastStart = Math.max(lastStart, blot.startAt);
    fullRevealAt = lastStart + INK_GROW_MS * 0.7;
  }
  if (queued) scheduleInkRender();
}

export function zoomIn() {
  const rect = viewportEl.getBoundingClientRect();
  zoomAt(scale + 0.3, rect.width / 2, rect.height / 2);
}

export function zoomOut() {
  const rect = viewportEl.getBoundingClientRect();
  zoomAt(scale - 0.3, rect.width / 2, rect.height / 2);
}

/**
 * 初始化地图，只调用一次。
 * @param {HTMLElement} el 视口容器（overflow:hidden 的固定区域）
 * @param {object} mapData { mapImage, hotspots }
 * @param {(id:string)=>void} onClick 点击热点（非拖拽）时回调
 */
export function init(el, mapData, onClick) {
  viewportEl = el;
  onHotspotClick = onClick;
  viewportEl.innerHTML = '';
  viewportEl.classList.add('map-viewport');

  contentEl = document.createElement('div');
  contentEl.className = 'map-content';
  contentEl.style.transformOrigin = '0 0';
  viewportEl.appendChild(contentEl);

  imageBoxEl = document.createElement('div');
  imageBoxEl.className = 'map-image-box';
  contentEl.appendChild(imageBoxEl);

  imgEl = document.createElement('img');
  imgEl.className = 'map-image';
  imgEl.draggable = false;
  imgEl.onload = layoutImageBox; // 图片是异步加载的，naturalWidth/Height 加载完才有值
  imgEl.src = mapData.mapImage;
  imageBoxEl.appendChild(imgEl);

  // 墨迹揭图层：盖在底图之上、热点之下，跟 .map-image-box 一样大，所以缩放/平移时
  // 跟底图一起动。画布本身按手绘地图的原始像素开，放大到 3 倍也不会比底图更糊。
  inkCanvasEl = document.createElement('canvas');
  inkCanvasEl.className = 'map-ink';
  inkCtx = inkCanvasEl.getContext('2d');
  imageBoxEl.appendChild(inkCanvasEl);

  if (mapData.detailImage) {
    detailImg = new Image();
    detailImg.onload = () => {
      inkCanvasEl.width = detailImg.naturalWidth;
      inkCanvasEl.height = detailImg.naturalHeight;
      scheduleInkRender(); // 手绘地图加载完之前就解锁的点，这时候才补画出来
    };
    detailImg.src = mapData.detailImage;
  }

  hotspotsById = {};
  hotspotEls = new Map();
  for (const hotspot of mapData.hotspots) {
    hotspotsById[hotspot.id] = hotspot;
    const marker = document.createElement('div');
    marker.className = `hotspot hotspot-${hotspot.type}`;
    marker.dataset.id = hotspot.id;
    marker.style.left = `${hotspot.x}%`;
    marker.style.top = `${hotspot.y}%`;
    marker.innerHTML = `<span class="hotspot-dot"></span><span class="hotspot-label">${hotspot.name}</span>`;
    imageBoxEl.appendChild(marker);
    hotspotEls.set(hotspot.id, marker);
  }

  window.addEventListener('resize', layoutImageBox);

  setupPanZoom();
  applyTransform();
  layoutImageBox(); // 万一图片是缓存的、onload 在这之前就已经触发过，这里兜底摆一次
}

/**
 * 按当前 state / 当天内容更新热点视觉状态：
 * locked（当天未解锁）/ visited（今日已去过）/ has-event（有未触发事件）/
 * mainline（含主线事件）/ current（玩家当前位置）。
 */
export function updateHotspotStates(state, dayContent) {
  const unlockedLocs = new Set([
    ...(dayContent.unlockedLocations || []),
    ...(state.extraUnlockedLocations || []) // 事件 unlocksLocation 效果动态解锁的地点，叠加在当天配置之上
  ]);
  // 揭开的地图是「已经看见过」的，不随换天回收：basecamp 一开局就揭，其余解锁一个揭一个
  syncInkReveals([...hotspotEls.keys()].filter(
    id => hotspotsById[id].type === 'basecamp' || unlockedLocs.has(id)
  ));

  for (const [id, el] of hotspotEls.entries()) {
    const hotspot = hotspotsById[id];
    const unlocked = hotspot.type === 'basecamp' || unlockedLocs.has(id);
    const eventsHere = (dayContent.events || []).filter(e => e.loc === id);
    const hasUntriggered = eventsHere.some(e => !state.triggeredEvents.includes(e.id));
    const isMainline = eventsHere.some(e => e.mainline);

    el.classList.toggle('locked', !unlocked);
    el.classList.toggle('visited', state.visitedToday.includes(id));
    el.classList.toggle('has-event', unlocked && hasUntriggered);
    el.classList.toggle('mainline', isMainline);
    el.classList.toggle('current', state.location === id);
  }
}

export function getHotspot(id) {
  return hotspotsById[id];
}
