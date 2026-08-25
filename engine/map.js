// map.js —— 图片地图：底图 + 百分比坐标热点，缩放/平移，点击交互与状态展示。
// 对应 design-doc.md 第 3.1 / 3.2 节。取代原型里的按钮网格实现。

const MIN_SCALE = 1;
const MAX_SCALE = 3;
const CLICK_DRAG_THRESHOLD = 6; // px，小于这个位移判定为点击，否则判定为拖拽平移

let viewportEl, contentEl;
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

  const img = document.createElement('img');
  img.className = 'map-image';
  img.src = mapData.mapImage;
  img.draggable = false;
  contentEl.appendChild(img);

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
    contentEl.appendChild(marker);
    hotspotEls.set(hotspot.id, marker);
  }

  setupPanZoom();
  applyTransform();
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
