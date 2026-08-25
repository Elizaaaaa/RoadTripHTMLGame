// map.js —— 图片地图：底图 + 百分比坐标热点，缩放/平移，点击交互与状态展示。
// 对应 design-doc.md 第 3.1 / 3.2 节。取代原型里的按钮网格实现。

const MIN_SCALE = 1;
const MAX_SCALE = 3;
const CLICK_DRAG_THRESHOLD = 6; // px，小于这个位移判定为点击，否则判定为拖拽平移

let viewportEl, contentEl, imageBoxEl, imgEl;
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
  const unlockedLocs = new Set(dayContent.unlockedLocations || []);
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
