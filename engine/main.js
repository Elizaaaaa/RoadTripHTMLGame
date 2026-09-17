// main.js —— 启动与流程编排：把各 engine 模块接起来，驱动
// "加油站出发 → 探索(消耗时间+信号闪现) → 事件/掷骰 → 复盘 → 走回加油站发布 → 结算 → 下一天"
// 这条示例主循环。所有具体文案/线索/地点内容都来自 content/*.json，
// 本文件不写死任何故事内容。

import * as timeSys from './time.js';
import * as mapSys from './map.js';
import * as sanitySys from './sanity.js';
import * as diceSys from './dice.js';
import * as kw from './keyword-parser.js';
import * as archiveSys from './archive.js';
import * as reviewSys from './review.js';
import * as publishSys from './publish.js';
import * as vlogStats from './vlogstats.js';
import * as signalSys from './signal.js';
import * as dialogueSys from './dialogue.js';
import * as chatSys from './chat.js';
import * as basecampSys from './basecamp.js';
import * as endingSys from './ending.js';
import * as quakeSys from './quake.js';
import * as revealSys from './reveal.js';
import * as paperSys from './paper.js';
import * as scanSys from './scan.js';
import * as glitchSys from './glitch.js';
import {
  createInitialState, loadState, saveState, clearSave,
  snapshotDay, snapshotTime, snapshotChoice,
  hasDayCheckpoint, restoreDayCheckpoint, restoreCheckpoint, listCheckpoints
} from './state.js';

let state;
let content = {};      // { days, archive, endings, materials, map }
let modalBox;
let currentModal = null;   // 'event' | 'basecamp' | 'publishEdit' | 'notebook' | 'tracker' | 'ending'
let notebookTab = null;    // 记事本当前选中的分类 tab（跨重渲染保持选中）
let pendingDayOver = false;

// ---------- 启动 ----------

async function boot() {
  modalBox = document.getElementById('modal-box');

  let mapData;
  try {
    [mapData, content.days, content.archive, content.endings, content.materials] = await Promise.all([
      fetchJSON('assets/maps/hotspots.json'),
      fetchJSON('content/days.json'),
      fetchJSON('content/archive.json'),
      fetchJSON('content/endings.json'),
      fetchJSON('content/materials.json')
    ]);
  } catch (err) {
    renderBootError(err);
    return;
  }

  content.map = mapData; // 手机数据页要拿底图当视频封面，见 openVlogPhone()
  archiveSys.init(content.archive);
  reviewSys.init(content.materials);
  const loaded = loadState();
  state = loaded || createInitialState(content.days['1']);
  // 新开一局要记第 1 天的存档点；读到的是旧格式存档（还没有 checkpoints）时，
  // 退而求其次地把"读档这一刻"记成当天的存档点，好过完全不能用"重新度过今日"。
  if (!hasDayCheckpoint(state, state.day)) snapshotDay(state);

  mapSys.init(document.getElementById('map-viewport'), mapData, onHotspotClick);
  wireStatusButtons();
  wireMapControls();
  wireDebugButtons();

  if (state.ending) {
    showEnding(state.ending, { intro: false }); // 读档进来的已完结存档：不重放地震演出，直接显示结局
  } else if (!maybeShowDayIntro()) {
    refreshAll();
  }
}

/**
 * 每天开场的旁白（可选）：dayContent.intro 存在且今天还没看过时，开局/换天先弹一个
 * 纯文本窗口，关掉才能操作地图。用 triggeredEvents 存一个 'intro_d<N>' 伪 id 记录
 * "看过了"，不为此单独加状态字段。
 * @returns {boolean} 这次是否弹出了旁白——调用方据此决定要不要自己 refreshAll()，
 *          弹出的话由旁白的"开始"按钮负责关闭后再 refreshAll()。
 */
function maybeShowDayIntro() {
  const dayContent = getDayContent();
  const introId = `intro_d${state.day}`;
  if (!dayContent || !dayContent.intro || state.triggeredEvents.includes(introId)) return false;

  state.triggeredEvents.push(introId);
  const introHTML = kw.parseKeywords(dayContent.intro, k => archiveSys.isUnlocked(state, k)).replace(/\n/g, '<br>');
  const body = renderWindow(`第 ${state.day} 天`, `
    <div class="event-text">${introHTML}</div>
    <button class="btn" id="btn-intro-continue">开始</button>
  `);
  bindKeywordClicks(body);
  openModal('event');
  document.getElementById('btn-intro-continue').addEventListener('click', () => {
    closeModal();
    refreshAll();
  });
  return true;
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载 ${url} 失败：HTTP ${res.status}`);
  return res.json();
}

function renderBootError(err) {
  document.getElementById('map-viewport').innerHTML = `
    <div style="padding:24px;max-width:520px;line-height:1.6;">
      <p>内容加载失败：${err.message}</p>
      <p class="hint">大概率是因为直接双击打开了 index.html —— 浏览器会拦截 file:// 协议下的
      JSON 请求。请用本地静态服务器打开这个目录，例如在项目根目录执行
      <code>npx serve .</code> 或 <code>python -m http.server</code>，再访问它给出的地址。</p>
    </div>
  `;
}

// ---------- 状态刷新 ----------

function getDayContent() {
  return content.days[String(state.day)];
}

function refreshAll() {
  document.getElementById('day-display').textContent = `第 ${state.day} 天`;
  document.getElementById('clock-display').textContent = timeSys.formatMinutes(state.minutes);
  document.getElementById('sanity-display').textContent = `理智：${sanitySys.getTierLabel(state.sanity)}`;
  sanitySys.applyUIEffects(state.sanity);

  const dayContent = getDayContent();
  if (dayContent) mapSys.updateHotspotStates(state, dayContent);
  updateNotebookDot();
  syncScanLoop(); // 理智跌破/回到阈值时，在这里开关低理智的扫描演出循环

  saveState(state);
}

/** 状态栏"记事本"按钮右上角的未读小红点，任何时候状态变了都刷一次（见 refreshAll）。 */
function updateNotebookDot() {
  const dot = document.getElementById('notebook-dot');
  if (dot) dot.classList.toggle('hidden', !archiveSys.hasUnread(state));
}

// ---------- 弹窗基础设施 ----------

function openModal(mode) {
  currentModal = mode;
  // 剪辑编辑器（publishEdit）素材库 + 时间轴两块内容并排放，默认弹窗宽度放不下，单独放宽。
  modalBox.classList.toggle('modal-wide', mode === 'publishEdit');
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  modalBox.innerHTML = '';
  modalBox.classList.remove('modal-wide');
  currentModal = null;
  closeClipInfo(); // 保险起见：主窗口关掉时，叠在它上面的素材简介小窗也一并收掉
  chatSys.clear();        // 同上：QQ/BB 聊天那台手机（以及还没播完的定时器）也一并收掉
  paperSys.cancel();      // 同上：还摊在屏幕中央的纸条（以及它的定时器）也一并收掉
}

/** 剪辑台里左键点开某段素材，弹出一个小窗显示它的内容简介，叠在剪辑台窗口之上。 */
function showClipInfo(clueId) {
  const m = reviewSys.getMaterial(clueId);
  const box = document.getElementById('clip-info-box');
  box.innerHTML = `
    <div class="mac-titlebar">
      <div class="mac-traffic">
        <button class="mac-dot mac-dot-red" id="clip-info-close" title="关闭"></button>
        <span class="mac-dot mac-dot-yellow"></span>
        <span class="mac-dot mac-dot-green"></span>
      </div>
      <div class="mac-title">${m.label}</div>
    </div>
    <div class="mac-body">
      <span class="clip-tag tag-${m.importance}">${importanceLabel(m.importance)}</span>
      <p class="clip-info-desc">${m.desc || '（这段素材还没写简介）'}</p>
    </div>
  `;
  document.getElementById('clip-info-overlay').classList.remove('hidden');
  document.getElementById('clip-info-close').addEventListener('click', closeClipInfo);
}

function closeClipInfo() {
  document.getElementById('clip-info-overlay').classList.add('hidden');
  document.getElementById('clip-info-box').innerHTML = '';
}

/**
 * 把弹窗内容包进一层仿 macOS 窗口外壳（标题栏 + 红黄绿交通灯 + 内容区），
 * 营造"玩家正在自己电脑上查看结果"的观感。红色圆点绑定关闭，黄/绿仅装饰。
 * 所有 modalBox.innerHTML 的设置都应该走这里，而不是直接赋值。
 * @param {object} [opts]
 * @param {boolean} [opts.noClose] 红灯渲染成不可点的装饰点，这个窗口关不掉。只用在
 *        "关掉就再也回不来"的窗口上——目前是高潮抉择（见 showChoiceEvent）：那个事件
 *        一旦被跳过，玩家就只剩"一无所知"一条路，不该让一次误点造成这种后果。
 * @returns {HTMLElement} 内容区 .mac-body，后续查询/绑定事件仍可用 document.getElementById
 *          或这个返回值，两者等价（.mac-body 就在 modalBox 内部）。
 */
function renderWindow(title, bodyHTML, opts = {}) {
  modalBox.innerHTML = `
    <div class="mac-titlebar">
      <div class="mac-traffic">
        ${opts.noClose
          ? '<span class="mac-dot mac-dot-red mac-dot-off"></span>'
          : '<button class="mac-dot mac-dot-red" id="mac-close" title="关闭"></button>'}
        <span class="mac-dot mac-dot-yellow"></span>
        <span class="mac-dot mac-dot-green"></span>
      </div>
      <div class="mac-title">${title}</div>
    </div>
    <div class="mac-body">${bodyHTML}</div>
  `;
  const closeBtn = document.getElementById('mac-close');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  return modalBox.querySelector('.mac-body');
}

function bindKeywordClicks(container) {
  kw.attachKeywordHandlers(container, onKeywordClick);
}

function onKeywordClick(key, spanEl) {
  const isNew = archiveSys.unlock(state, key, 'keyword_click');
  if (isNew) {
    notifyArchiveUnlock(key);
    unlockLocationsFromArchive(key);
  }
  // 立刻把点过的这个 span 从蓝（未收集）切成灰（已收集），不用等窗口关了重开才看到变化
  if (spanEl) {
    spanEl.classList.remove('kw-locked');
    spanEl.classList.add('kw-unlocked');
  }
  if (currentModal === 'notebook') openNotebook(notebookTab); // 就地刷新，显示新解锁的词条
}

function notifyArchiveUnlock(key) {
  const entry = archiveSys.getEntry(key);
  // "物品"分类是实打实拿到手的东西（钥匙、胸针……），提示用"获得物品"更贴切；
  // 其余分类（地点/人物/事件）说的是信息类词条，沿用"记事本已更新"。
  showToast(entry && entry.category === '物品'
    ? `🔑 获得物品：${entry.title}`
    : `📎 记事本已更新：${entry ? entry.title : key}`);
}

function notifyLocationUnlock(id) {
  const hotspot = mapSys.getHotspot(id);
  showToast(`🗺️ 地图已更新：${hotspot ? hotspot.name : id}`);
}

// 收集词条顺带解锁地点时，"地图已更新"那条晚一拍再弹：所有 toast 共用同一个元素，
// 同一帧连着弹两条的话前一条会被直接顶掉，玩家只看得见后面那条。
const LOC_TOAST_DELAY_MS = 1800;

/**
 * 词条里写了 unlocksLocation（见 content/archive.json 的 square）时，玩家点开这个词条
 * 的同时把对应的调查地点开进地图——"先在报纸/告示上读到有这么个地方，才去得了"。
 * 只从 onKeywordClick 调用：地点解锁和词条解锁一样，都以玩家真的点过那个链接为准，
 * 不走事件效果自动发放（那条路是事件自己的 unlocksLocation，见 applyOutcomeEffects）。
 */
function unlockLocationsFromArchive(key) {
  const entry = archiveSys.getEntry(key);
  if (!entry || !entry.unlocksLocation) return;
  state.extraUnlockedLocations ||= [];
  let queued = 0;
  for (const id of entry.unlocksLocation) {
    if (state.extraUnlockedLocations.includes(id)) continue;
    state.extraUnlockedLocations.push(id);
    setTimeout(() => notifyLocationUnlock(id), LOC_TOAST_DELAY_MS * (queued + 1));
    queued++;
  }
  if (queued) refreshAll(); // 热点状态和墨迹揭图就地更新，不用等玩家把加油站窗口关掉
}

function notifyClueGained(clueId) {
  showToast(`🎞️ 拍到新素材：${reviewSys.getMaterial(clueId).label}`);
}

let toastTimer = null;
function showToast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

function showSignalToast(text) {
  showToast(`📶 信号闪现：${text}`);
}

// ---------- 地图点击入口 ----------

function onHotspotClick(id) {
  const hotspot = mapSys.getHotspot(id);
  if (!hotspot) return;
  if (quakeSys.isPlaying() || paperSys.isPlaying() || glitchSys.isPlaying()) return; // 演出期间（落灰层/纸条层/信号层已经挡住点击）不再接受新的交互，双保险
  // "被黑暗吞噬"结局（每天都适用）：不在跨过十二点的那次交互里立刻判定——那次
  // 交互本身的内容（事件文本/掷骰）还是正常走完，pendingDayOver 先留着；等玩家
  // 在十二点之后真的再点一次地图（不管点哪，去哪都一样），才在这次交互一开始
  // 拦下来触发结局。
  if (pendingDayOver) {
    pendingDayOver = false;
    handleDayOver();
    return;
  }
  if (hotspot.type === 'basecamp') {
    openBasecamp();
  } else {
    visitInvestigationSpot(id);
  }
}

function visitInvestigationSpot(id) {
  const dayContent = getDayContent();
  if (!dayContent) return;
  const unlocked = (dayContent.unlockedLocations || []).includes(id) || (state.extraUnlockedLocations || []).includes(id);
  if (!unlocked) return; // 双重保险，地图上本应已经不显示这个热点了

  // 整点存档点：记在"这一小时花出去之前、这个地点的事件发生之前"，所以它代表的是
  // 玩家还站在地图前、这一小时怎么用都还没定的那一刻。走到结局之后，结局窗口的
  // "从某个时间点继续"列的就是这些点（见 state.js snapshotTime / showEnding）。
  snapshotTime(state);

  state.location = id;
  if (!state.visitedToday.includes(id)) state.visitedToday.push(id);

  const event = (dayContent.events || []).find(
    e => e.loc === id && !state.triggeredEvents.includes(e.id) && eventAvailable(e)
  );

  // 这个地点已经没有没触发过的事件了（之前都翻完了）：没什么好调查的，
  // 这次点击原地不动——不消耗时间，也不判定信号闪现。
  if (!event) {
    afterInvestigation();
    return;
  }

  // 每次交互固定推进 1 小时，不管事件内容里写的 time 是多少——内容里的 time
  // 字段现在只是给作者自己看的"大概几点发生"注释，引擎不读它，避免不同事件
  // 之间耗时忽长忽短（有的 30 分钟有的 4 小时）导致的体感不一致。
  const beforeMin = state.minutes;
  pendingDayOver = timeSys.addMinutes(state, timeSys.TRAVEL_TIME_MIN, dayContent);

  // 这一小时里跨过了定时全局事件（两次地震）的话，先把它演完再接着走这个地点本来的
  // 事件——"到点就发生，跟玩家当时在哪无关"，见下面 playTimedEvents 一节。
  const timed = findTimedEvents(dayContent, beforeMin, state.minutes);

  const enterSpotEvent = () => {
    // 信号闪现：每次探索调查地点都额外判定一次，见 design-doc.md 3.3 节。
    // 放在定时事件之后：地震演出要花两三秒，横幅先弹会在抖动里白白过期。
    const shownIds = state.signalToday.map(s => s.id);
    const flare = signalSys.tryTrigger(dayContent, shownIds);
    if (flare) {
      signalSys.record(state, flare);
      showSignalToast(flare.text);
    }

    playEvent(event);
  };

  if (timed.length) playTimedEvents(timed, enterSpotEvent);
  else enterSpotEvent();
}

/**
 * 按 type 把一个事件交给对应的播放器，顺带记进 triggeredEvents（事件全程只触发一次）。
 *
 * 抉择事件（type:'choice'）是唯一的例外——它要等玩家真的选了一个选项才算触发过（记在
 * pickChoice 里）。理由是它关不掉也跳不过（renderWindow 的 noClose），但玩家仍然可能
 * 在做选择的中途刷新页面；如果进窗口就记成"已触发"，刷新回来这个地点就再也没有事件了，
 * 高潮抉择白白丢掉、只能走"一无所知"。现在的行为是：刷新回来再点一次那个地点，抉择
 * 重新摆出来（代价只是再花掉一小时）。
 */
function playEvent(event) {
  if (event.type !== 'choice' && !state.triggeredEvents.includes(event.id)) {
    state.triggeredEvents.push(event.id);
  }
  if (event.type === 'choice') showChoiceEvent(event);
  else if (event.type === 'diceCheck') showDiceEvent(event);
  else showTextEvent(event);
}

/**
 * 事件的准入门槛（days.json 里事件可选的 requires 字段）。不满足的事件在"这个地点
 * 有没有可调查的事件"这一步就被跳过，玩家点上去等于没事件（不耗时间）——所以同一个
 * 地点可以按顺序摆「够格才给的那一版」和「不够格时的那一版」两条事件，引擎会取数组里
 * 第一条满足条件的：
 *
 *   requires.allMainClues: true  关键线索必须已经收齐（见 ending.js mainCluesComplete）
 *                          false 反过来，只在还没收齐时出现（写兜底事件用）
 *   requires.clues:    [id...]   这些线索必须都已经采集到（state.collectedClues）
 *   requires.archives: [key...]  这些记事本词条必须都已经解锁
 */
function eventAvailable(event) {
  const req = event.requires;
  if (!req) return true;
  if (typeof req.allMainClues === 'boolean' && endingSys.mainCluesComplete(state) !== req.allMainClues) return false;
  if (req.clues && !req.clues.every(c => state.collectedClues.includes(c))) return false;
  if (req.archives && !req.archives.every(k => archiveSys.isUnlocked(state, k))) return false;
  return true;
}

// ---------- 发布之后的"手机数据页" ----------
//
// 确认发布 → 掏出手机刷当期互动数据（播放/点赞/评论/完播率/评论区，见
// engine/vlogstats.js）→ 收起手机 → 旅馆的"进入下一天"。播放量本身还是
// engine/publish.js 结算的，手机页只负责展示和派生其余指标。

/**
 * @param {number} [day] 想看哪一天的数据，默认今天
 * @param {Function|null} [onClose] 收起手机之后走的下一步；默认接旅馆流程，
 *        传 null 表示"看完就回到原来的界面"（加油站/剪辑台里的补看入口用）
 */
function openVlogPhone(day = state.day, onClose = openHotelNight) {
  const opened = vlogStats.open({
    state,
    day,
    dayContent: content.days[String(day)],
    channel: content.days.meta && content.days.meta.channel,
    cover: content.map && content.map.mapImage,
    onClose
  });
  // 首次打开会把派生出来的数据缓存进 publishLog 那条记录，存一次档让它固定下来
  if (opened) saveState(state);
  else if (onClose) onClose(); // 那天没有发布记录（比如超时未归），直接走下一步
}

// ---------- 沙狐旅馆：发布之后的"回房休息" → 进入下一天 ----------
//
// 加油站剪辑确认发布成功后自动弹出，不需要玩家再跑一趟地图上的旅馆——
// 用旅馆的名义包一层"回房睡觉"的叙事，实际触发点还是紧跟在发布流程后面。
// renderPublishTab 的"今天已经发布过了"分支也复用这个弹窗，作为玩家提前
// 关掉这个窗口之后的补救入口。

function openHotelNight() {
  renderWindow('沙狐旅馆', `
    <div class="event-text">今天的素材已经剪好发布了，两人回房间休息，准备迎接明天。</div>
    <button class="btn" id="btn-hotel-next-day">进入下一天</button>
  `);
  openModal('event');
  document.getElementById('btn-hotel-next-day').addEventListener('click', () => {
    closeModal();
    advanceDay();
  });
}

function afterInvestigation() {
  refreshAll();
  // pendingDayOver 留到下一次交互开头再判定，见 onHotspotClick。
}

// ---------- 扫描演出的触发：理智低位时的常驻循环 ----------
// 演出本身在 engine/scan.js，那个模块只管怎么演、不判断什么时候演（跟 quake.js 一个分工）。
// 什么时候演写在这里。
//
// 这不是"事件的后果"，是挂在世界时钟上的环境效果：理智一跌破阈值循环就开着，自己按
// 随机间隔一次次地放，理智回升到阈值以上立刻停。所以它跟玩家在做什么无关——正是这一点
// 让它比"每次关掉窗口闪一下"更瘆人：玩家算不出下一次在什么时候。

const SCAN_SANITY_MAX = 30;     // 理智低于这个值循环就开着。注意比 sanity.js 的 BREAKING
                                // 档（<35）更严一点：濒崩刚进门就满地图闪框会太廉价，
                                // 留 5 点缓冲，让玩家先在"濒崩但世界还正常"里待一会儿。
const SCAN_GAP_MIN_MS = 20000;  // 两次之间的间隔，每次重新随机
const SCAN_GAP_MAX_MS = 60000;
const SCAN_COUNT_MIN = 8;       // 每次亮几个框，每次重新随机
const SCAN_COUNT_MAX = 15;

let scanTimer = 0;  // 非 0 表示循环开着；只在本模块里流转，不进存档（读档后由 refreshAll 重新拉起）
let scanNextAt = 0; // 下一次扫描的时间戳。只给调试面板做倒计时读，游戏逻辑不依赖它——
                    // 但留着它值：不然"循环到底有没有在跑"从外面完全看不出来，
                    // 首次触发又要等 20~60 秒，很容易误判成功能坏了。

const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

/**
 * 按理智值开/关扫描循环。每次 refreshAll() 都会调一次——理智值的每一次变动最后都会走到
 * refreshAll，挂在这里就不用在每个改理智的地方各记一笔。幂等，重复调不会叠出第二个定时器。
 */
function syncScanLoop() {
  const shouldRun = !state.ending && state.sanity < SCAN_SANITY_MAX;
  if (shouldRun && !scanTimer) scheduleScan();
  else if (!shouldRun && scanTimer) stopScanLoop();
}

function stopScanLoop() {
  clearTimeout(scanTimer);
  scanTimer = 0;
  scanNextAt = 0;
  scanSys.cancel(); // 理智刚回升时，正亮着的那一批也立刻收掉，不让它演完
}

function scheduleScan() {
  const gap = randInt(SCAN_GAP_MIN_MS, SCAN_GAP_MAX_MS);
  scanNextAt = Date.now() + gap;
  scanTimer = setTimeout(runScan, gap);
}

function runScan() {
  scanTimer = 0;
  // 定时器排下来的这段时间里理智可能已经回升了（也可能进了结局），这里再确认一次
  if (state.ending || state.sanity >= SCAN_SANITY_MAX) return;

  // 弹窗盖着地图、或正在演地震/纸条时，这一次就跳过、不往后补。它是挂在世界时钟上的
  // 环境效果，玩家在读窗口的时候错过了就是错过了；补演反而会退化成"每次关窗口都闪一下"，
  // 也就是这次改动要甩掉的那个手感。
  if (!currentModal && !quakeSys.isPlaying() && !paperSys.isPlaying()) playScanNow();

  scheduleScan(); // 不管这次演没演，都接着排下一次
}

/**
 * 调试按钮组：只在地址栏带 ?debug=1 时露出来（index.html 里默认 hidden）。用 URL 开关
 * 而不是常量，是因为不用改代码、也不会有人手滑把"改回 false"这一步忘了带进正式版本。
 *
 * - 「演一次扫描」：立刻放一次，参数跟循环完全一样（都走 playScanNow）。只验演出本身。
 * - 「立刻触发循环」：把排着的定时器提前到现在，直接跑 runScan()。跟上一个的区别是它走的是
 *   真正的循环代码路径（含"演完接着排下一次"），所以能验循环逻辑，而不只是验演出能放。
 * - 「理智→20 / →80」：在"循环该开"和"循环该停"两个状态之间来回切。
 * - 右边的倒计时：显示下一次扫描还有几秒。没有它的话，循环首次触发要等 20~60 秒、
 *   中间零反馈，等个二三十秒没动静就会误判成功能坏了。
 */
function wireDebugButtons() {
  if (new URLSearchParams(location.search).get('debug') !== '1') return;
  const group = document.getElementById('debug-buttons');
  if (!group) return;
  group.classList.remove('hidden');

  const sanityBtn = document.getElementById('btn-debug-sanity');
  const statusEl = document.getElementById('debug-scan-status');
  const syncLabel = () => {
    sanityBtn.textContent = state.sanity < SCAN_SANITY_MAX ? '🧠 理智→80' : '🧠 理智→20';
  };
  syncLabel();

  document.getElementById('btn-debug-scan').addEventListener('click', () => playScanNow());

  document.getElementById('btn-debug-tick').addEventListener('click', () => {
    if (!scanTimer) { showToast('循环没开着——先点「理智→20」'); return; }
    clearTimeout(scanTimer); // 把排着的那一次取消掉，改成现在就跑，避免等下重复触发
    scanTimer = 0;
    runScan();               // 走真正的循环路径：演一次 + 自动排下一次
  });

  sanityBtn.addEventListener('click', () => {
    state.sanity = state.sanity < SCAN_SANITY_MAX ? 80 : 20;
    refreshAll(); // 循环的开关就挂在这里面的 syncScanLoop()
    syncLabel();
    showToast(state.sanity < SCAN_SANITY_MAX
      ? `理智 → ${state.sanity}，扫描循环已开启（每 ${SCAN_GAP_MIN_MS / 1000}~${SCAN_GAP_MAX_MS / 1000} 秒一次）`
      : `理智 → ${state.sanity}，扫描循环已停止`);
  });

  // 倒计时。只读 scanNextAt，不碰循环本身——调试面板不该影响被调试的东西。
  setInterval(() => {
    if (!scanTimer) { statusEl.textContent = '循环未开启'; return; }
    const left = Math.max(0, Math.ceil((scanNextAt - Date.now()) / 1000));
    statusEl.textContent = `下次扫描 ${left}s`;
  }, 500);
}

/**
 * 按当前地图数据放一次扫描。循环和调试按钮都走这里，所以调试时看到的就是玩家会看到的
 * ——参数只有一份，不会出现"调试面板调好了、游戏里不是这个样子"。
 */
function playScanNow() {
  const mapData = content.map || {};
  return scanSys.play({
    points: mapData.scanPoints || [],
    bleedWords: mapData.bleedWords || [],
    bleedChance: mapData.bleedChance, // 没写就是 undefined，scan.js 那边会退回自己的默认值
    count: randInt(SCAN_COUNT_MIN, SCAN_COUNT_MAX)
  });
}

/**
 * 事件/掷骰结果里共用的效果字段：clue / clues / sanityCost / unlocksLocation。
 * clue 是单条线索（vlog 素材）的老写法；clues（数组）用于一个事件一次性发放多条线索，
 * 两个字段可以同时写。
 *
 * 注意：记事本词条的解锁不在这里处理——统一只能靠玩家点击正文里的 [[显示文字|key]]
 * 链接触发（见 onKeywordClick），不会因为事件效果自动解锁。内容里的 unlocksArchive
 * 字段现在只是给内容作者自己看的文档说明（"这个事件应该会解锁哪个词条"），引擎不再
 * 读取它——每个 unlocksArchive 列出的 key，正文里必须配一个对应的 [[...|key]] 链接，
 * 不然这个词条就永远进不了记事本。
 */
function applyOutcomeEffects(effect) {
  for (const clue of [effect.clue, ...(effect.clues || [])].filter(Boolean)) {
    if (!state.collectedClues.includes(clue)) {
      state.collectedClues.push(clue);
      state.todayClues.push(clue);
      notifyClueGained(clue);
    }
  }
  if (effect.sanityCost) {
    sanitySys.adjust(state, -effect.sanityCost);
  }
  if (effect.unlocksLocation) {
    state.extraUnlockedLocations ||= [];
    for (const id of effect.unlocksLocation) {
      if (!state.extraUnlockedLocations.includes(id)) {
        state.extraUnlockedLocations.push(id);
        notifyLocationUnlock(id);
      }
    }
  }
}

/**
 * 记一条"调查回顾"用的事件记录：按触发顺序追加进 state.todayEventLog，
 * 见 openTracker。text 存原始文本（未解析关键词），渲染回顾列表时才解析，
 * 跟正文事件窗口的处理方式保持一致（关键词是否已解锁看当时的状态）。
 */
function recordEventLog(event, text, note) {
  const hotspot = mapSys.getHotspot(event.loc);
  state.todayEventLog.push({
    eventId: event.id,
    loc: event.loc || null,
    // 定时全局事件（地震）不挂在任何地点上，没有 loc 可查，回顾列表里标成"全镇"
    locName: hotspot ? hotspot.name : (event.locName || '全镇'),
    minutes: state.minutes,
    text,
    note: note || null
  });
}

// ---------- 定时全局事件（days.json 的 timedEvents） ----------
//
// 跟普通事件的区别：不挂在任何地点上，到点就发生。对应 design-doc.md 1.6 节的两次
// 地震——它们是"封印正在衰减"在现实世界留下的物理签名，玩家做什么都拦不住，所以
// 既不能写成某个地点的 events（去没去过那儿都得震），也不该由玩家的行为来解释。
//
// 判定方式：每次交互推进时间之后，看这一小时有没有跨过 timedEvents[].at 配的分钟数
// （左开右闭 (before, after]）。引擎每次交互固定推进 60 分钟，所以实际弹出会落在跨过
// 该时刻的那一次交互上，文案要写得容得下这点误差（"大约十点半"而不是"10 点 33 分整"）。
//
// 触发记录跟普通事件、每天的开场旁白共用 state.triggeredEvents（id 别跟它们撞车），
// 所以"重新度过今日"回退到当天存档点之后，那一天的地震会重新再来一次。

function findTimedEvents(dayContent, fromMin, toMin) {
  // 哪些时刻被跨过了是纯时间问题，放在 time.js 里（顺带能脱离 DOM 单测）；
  // 这里只补一道"已经触发过的不再来一次"的过滤。
  return timeSys.crossedTimedEvents(dayContent, fromMin, toMin)
    .filter(e => !state.triggeredEvents.includes(e.id));
}

/**
 * 依次播放定时事件，全部播完才走 onDone（通常是"接着进这个地点本来的事件"）。
 * 每条的顺序是：地震演出（配了 quake 才有）→ 一拍死寂 → 事件窗口（正文按换行分页、
 * 逐句淡入）→ 下一条。演出期间弹窗还没开，抖的是地图那一层，落灰层顺带挡住点击。
 */
function playTimedEvents(list, onDone) {
  const [current, ...rest] = list;
  if (!current) {
    onDone();
    return;
  }

  state.triggeredEvents.push(current.id);
  applyOutcomeEffects(current); // clue / sanityCost 这些字段跟普通事件共用同一套处理
  recordEventLog(current, current.text, current.note || null);

  const showWindow = () => {
    openModal('event');
    playEventPages(current.id, splitSegments(current.text), pageHTML => renderWindow(current.title || '……', `
      <div class="event-text">${pageHTML}</div>
      <button class="btn" id="btn-event-continue">继续</button>
    `), () => {
      closeModal();
      refreshAll();
      playTimedEvents(rest, onDone);
    }, { reveal: true, paperSegments: current.paperSegments });
  };

  if (current.quake) quakeSys.play(current.quake).then(showWindow);
  else showWindow();
}

// ---------- 文本事件 ----------

function showTextEvent(event) {
  applyOutcomeEffects(event);
  recordEventLog(event, event.text); // 调查回顾用原始整段文本，不受下面的分页影响，见 openTracker
  openModal('event');
  playEventPages(event.id, splitSegments(event.text), pageHTML => renderWindow('事件记录', `
    <div class="event-text">${pageHTML}</div>
    <button class="btn" id="btn-event-continue">继续</button>
  `), () => {
    closeModal();
    afterInvestigation();
  }, { paperSegments: event.paperSegments });
}

// ---------- 掷骰事件 ----------

function showDiceEvent(event) {
  const tier = sanitySys.getTier(state.sanity);
  const bodyHTML = kw.parseKeywords(event.text, k => archiveSys.isUnlocked(state, k));
  const body = renderWindow('掷骰检定', `
    <div class="event-text">${bodyHTML}</div>
    <button class="btn" id="btn-roll">掷骰 (1d20)</button>
    ${tier === sanitySys.TIER.BREAKING
      ? '<button class="btn btn-danger" id="btn-force">不计代价，直接获得真相（额外理智代价）</button>'
      : ''}
  `);
  bindKeywordClicks(body);
  openModal('event');

  document.getElementById('btn-roll').addEventListener('click', () => {
    finishDice(event, diceSys.resolveDiceCheck(event, state.sanity));
  });
  const forceBtn = document.getElementById('btn-force');
  if (forceBtn) {
    forceBtn.addEventListener('click', () => {
      finishDice(event, diceSys.resolveDiceCheck(event, state.sanity, { forceCritSuccess: true }));
    });
  }
}

function finishDice(event, result) {
  applyOutcomeEffects(result.outcome);
  if (result.extraSanityCost) sanitySys.adjust(state, -result.extraSanityCost);

  state.diceLog.push({
    eventId: event.id,
    day: state.day,
    rolls: result.rollInfo ? result.rollInfo.rolls : null,
    chosen: result.rollInfo ? result.rollInfo.chosen : null,
    outcome: result.outcomeKey,
    forced: result.forced
  });

  const rollLine = result.rollInfo
    ? `掷出 [${result.rollInfo.rolls.join(', ')}]，取 ${result.rollInfo.chosen}（判定：${result.outcomeKey}）`
    : '（未掷骰——主动选择承受代价）';
  recordEventLog(event, result.outcome.text, rollLine); // 调查回顾用原始整段文本，不受下面的分页影响

  playEventPages(event.id, splitSegments(result.outcome.text), pageHTML => renderWindow('事件记录', `
    <div class="hint">${rollLine}</div>
    <div class="event-text">${pageHTML}</div>
    <button class="btn" id="btn-event-continue">继续</button>
  `), () => {
    closeModal();
    afterInvestigation();
  }, { paperSegments: result.outcome.paperSegments });
}

// ---------- 抉择事件（days.json 里 type: 'choice'）----------
//
// 用途只有一个，但它是全篇最重的一个：第 3 天在废弃工厂的高潮抉择，直接决定走哪个结局
// （见 design-doc.md 5.3 节 / engine/ending.js 的五结局模型）。流程跟普通文本事件一样
// 先把 text 按换行分页播完，最后一页的"继续"换成一组选项按钮；玩家点掉一个之后：
//
//   1. option 的效果字段（clue/clues/sanityCost/unlocksLocation）照常走 applyOutcomeEffects
//   2. option.tag 写进 choiceLog，供结局 variants 匹配
//   3. option.finale（{ meridian, baby } 或后门 ending）交给 ending.js applyFinaleChoice，
//      真值表凑齐就当场锁定结局
//   4. 播完 option.text，然后三选一收尾：锁定了结局 → 直接进结局窗口；配了 option.next →
//      接着播同一天 events 里那个 id 的事件（大纲里"选了修复之后镇民才会来劝救婴儿"就是
//      这么串的，被串的那条事件不写 loc，免得它自己也挂到某个地点上去）；都没有 → 照常收工
//
// 窗口关不掉（renderWindow 的 noClose）：这个事件被跳过等于玩家只剩"一无所知"一条路。

function showChoiceEvent(event) {
  // 抉择存档点：记在 applyOutcomeEffects 之前，所以它代表"选项还没摆出来"的那一刻——
  // 从结局窗口回到这里时，这条事件的 sanityCost/线索会重新结算一遍，跟第一次走到
  // 它面前完全一样（见 state.js snapshotChoice / applyCheckpointRewind）。
  snapshotChoice(state, { eventId: event.id, label: event.rewindLabel || event.title || '重大抉择' });
  applyOutcomeEffects(event);
  recordEventLog(event, event.text);
  openModal('event');
  playEventPages(event.id, splitSegments(event.text), pageHTML => renderWindow(event.title || '抉择', `
    <div class="event-text">${pageHTML}</div>
    <button class="btn" id="btn-event-continue">继续</button>
  `, { noClose: true }), () => renderChoiceOptions(event), {
    reveal: event.reveal === true,
    paperSegments: event.paperSegments
  });
}

/** 正文播完之后那一屏：只剩选项，没有"继续"，也关不掉——必须选一个。 */
function renderChoiceOptions(event) {
  const options = event.options || [];
  const parse = seg => kw.parseKeywords(seg, k => archiveSys.isUnlocked(state, k));
  const body = renderWindow(event.title || '抉择', `
    ${event.prompt ? `<div class="event-text">${parse(event.prompt)}</div>` : ''}
    <div class="choice-list">
      ${options.map((o, i) => `
        <button class="btn btn-option choice-btn" data-idx="${i}">
          <span class="choice-label">${o.label}</span>
          ${o.hint ? `<span class="choice-hint">${parse(o.hint)}</span>` : ''}
        </button>`).join('')}
    </div>
  `, { noClose: true });
  bindKeywordClicks(body);
  body.querySelectorAll('.choice-btn').forEach(btn => {
    btn.addEventListener('click', () => pickChoice(event, options[Number(btn.dataset.idx)]));
  });
}

function pickChoice(event, option) {
  if (!option) return;
  if (!state.triggeredEvents.includes(event.id)) state.triggeredEvents.push(event.id);
  applyOutcomeEffects(option);

  if (option.tag) {
    // 同一个抉择只留最近一次的 tag（跟 review.js 里的处理一致），"重新度过今日"回退
    // 之后重选不会在 choiceLog 里堆两条互相矛盾的记录
    state.choiceLog = state.choiceLog.filter(c => c.choiceId !== event.id);
    state.choiceLog.push({ choiceId: event.id, day: state.day, tag: option.tag });
  }

  const endingId = (option.finale || option.ending)
    ? endingSys.applyFinaleChoice(state, { ...(option.finale || {}), ending: option.ending })
    : null;

  recordEventLog(event, option.text || option.label, `抉择：${option.label}`);
  saveState(state);

  const finish = () => {
    if (endingId) {
      state.ending = endingId;
      saveState(state);
      closeModal();
      showEnding(endingId);
      return;
    }
    if (option.next) {
      playChainedEvent(option.next);
      return;
    }
    closeModal();
    afterInvestigation();
  };

  if (!option.text) {
    finish();
    return;
  }
  playEventPages(`${event.id}:${option.tag || 'opt'}`, splitSegments(option.text), pageHTML => renderWindow(event.title || '抉择', `
    <div class="event-text">${pageHTML}</div>
    <button class="btn" id="btn-event-continue">继续</button>
  `, { noClose: true }), finish, { reveal: true, paperSegments: option.paperSegments });
}

/**
 * 接着播同一天 events 里指定 id 的事件（option.next）。被串的事件不该写 loc——写了的话
 * 它同时也会挂在那个地点上，玩家没走到这一步也能点出来。不耗时间：串起来的几段属于
 * 同一次交互，时间在进这个地点时已经推过了。
 */
function playChainedEvent(id) {
  const dayContent = getDayContent();
  const next = (dayContent.events || []).find(e => e.id === id);
  if (!next || state.triggeredEvents.includes(next.id)) {
    if (!next) console.warn(`[choice] option.next 指向的事件不存在：${id}`);
    closeModal();
    afterInvestigation();
    return;
  }
  playEvent(next);
}

// ---------- 事件正文分页 ----------
//
// 事件正文（events[].text / diceCheck 的 outcome.text）按 \n 拆成几"页"：内容作者
// 写草稿时主动换行分段，一段太长的叙述就不用挤在同一屏——每页一个"继续"，翻到最后
// 一页才真正关窗、结束这次调查。调查回顾（openTracker）用的是 recordEventLog 存的
// 原始整段文本，不受这里的分页影响，还是照旧整段显示。

/** 按换行拆分正文，丢掉纯空白的行（对应作者手滑打的空行）；结果始终至少有一页。 */
function splitSegments(text) {
  const segments = (text || '').split('\n').filter(s => s.trim().length > 0);
  return segments.length ? segments : [''];
}

/**
 * 通用"多页事件正文"播放器。renderPage(pageHTML) 由调用方决定整个弹窗内容长什么样
 * （标题、掷骰提示等），返回 .mac-body 元素，这里负责绑关键词点击和"继续"按钮；
 * bindKeywordClicks 内部按容器去重，重复调用不会重复绑定。翻到最后一页再点"继续"
 * 才会触发 onFinish（真正关窗，走 afterInvestigation）。每页翻页前要不要等 QQ/BB
 * 讨论完，见 maybePlayDialogue/dialogue.js 的 afterSegment。
 *
 * opts.reveal：正文逐句淡入（见 reveal.js / ui.css 的 .rv-clause）。默认关——普通调查
 * 事件一屏文字看完就走，每次都浮现一遍反而拖节奏；只给地震这类"要有分量"的场合开。
 *
 * opts.paperSegments：哪几页做成"折叠纸条"（days.json 里事件的 paperSegments 字段）。
 * 这几页的正文不进窗口，改成一张折着的纸条在屏幕中央摊开、摊平之后字迹才淡入，玩家
 * 点一下收起（见 paper.js）。文字仍然写在同一段 text 里，所以调查回顾照样收录全文。
 */
function playEventPages(eventId, segments, renderPage, onFinish, opts = {}) {
  let idx = 0;
  const parse = seg => kw.parseKeywords(seg, k => archiveSys.isUnlocked(state, k));
  const paperSegments = opts.paperSegments || [];

  const advance = () => {
    if (idx < segments.length - 1) {
      idx += 1;
      showPage();
    } else {
      onFinish();
    }
  };

  const showPage = () => {
    // 配成纸条页的那一页不进窗口：窗口停在上一页不动（上一页正文刚交代完"桌上压着一张
    // 纸条"），纸条在屏幕正中央摊开，纸条层顺带挡住底下那颗"继续"。玩家点掉纸条之后
    // 再播这一页绑的 QQ/BB 讨论，讨论完，上一页留下的那颗"继续"就是下一步——它闭包里
    // 读的是最新的 idx，所以点下去该翻页翻页、该结束结束，不用另外补按钮。
    if (paperSegments.includes(idx) && idx > 0) {
      const btn = document.getElementById('btn-event-continue');
      if (btn) btn.disabled = true; // 纸条挡住了鼠标，但键盘还能按到它，顺手锁上
      paperSys.play({ text: segments[idx], parse, onReady: bindKeywordClicks }).then(() => {
        if (btn) btn.disabled = false;
        maybePlayDialogue(eventId, idx, segments.length); // 绑了讨论就会再锁一次，播完才放开
      });
      return;
    }
    // 纸条页不能是第一页：窗口里得先有一页把纸条摆在场景里，纸条才有地方摊、"继续"才有
    // 着落。真配成第 0 页就退化成普通正文，顺带在控制台提醒内容作者。
    if (paperSegments.includes(idx)) {
      console.warn(`[paper] 事件 ${eventId} 把第 0 页配成了纸条页，纸条页不能是第一页，这一页按普通正文显示`);
    }

    const html = opts.reveal ? revealSys.clauses(segments[idx], parse) : parse(segments[idx]);
    const body = renderPage(html);
    bindKeywordClicks(body);
    document.getElementById('btn-event-continue').addEventListener('click', advance);
    maybePlayDialogue(eventId, idx, segments.length);
  };

  showPage();
}

// ---------- QQ/BB 事件后闲聊 ----------
//
// 见 dialogue.js：跟事件 id（+ 第几页）绑定，翻到那一页、准备点"继续"之前，如果
// 绑了一段对话，就锁住"继续"按钮，等两人讨论完才解锁。
//
// 演出交给 engine/chat.js —— 它是手机里的一个 app：手机从屏幕右下角升上来，停在
// corner 姿态（不压住中间的事件正文、overlay 本身不吃点击），消息一条条弹进
// iOS「信息」样式的聊天串里。手机不在这里收，是 closeModal() 关事件窗时才收。
//
// 关键词链接由这边传两个回调过去（renderText / bindLinks）：解锁只能发生在点击那一下，
// 这条规则留在 onKeywordClick 里独占，chat.js 不碰 archives。

/** 事件/掷骰某一页的"继续"按钮渲染完之后调用：查到绑在这一页后面的对话就锁按钮、播完再解锁。 */
function maybePlayDialogue(eventId, segmentIndex, totalSegments) {
  const dialogue = dialogueSys.findForEvent(getDayContent(), eventId, segmentIndex, totalSegments);
  if (!dialogue) return;
  const btn = document.getElementById('btn-event-continue');
  if (!btn) return;
  btn.disabled = true;
  const hint = document.createElement('p');
  hint.className = 'hint chat-wait-hint';
  hint.textContent = 'QQ 和 BB 正在讨论……';
  btn.insertAdjacentElement('beforebegin', hint);
  chatSys.play(dialogue, eventId, {
    clock: state.minutes,
    renderText: text => kw.parseKeywords(text, k => archiveSys.isUnlocked(state, k)),
    bindLinks: bindKeywordClicks,
    onDone: () => {
      btn.disabled = false;
      hint.remove();
    }
  });
}

// ---------- 超时未归 ----------

function handleDayOver() {
  // 不分第几天：晚上十二点还在镇子里瞎逛、没能在这之前剪辑发布并回旅馆过夜，
  // 一律直接被黑暗吞噬判为"陷入疯狂"坏结局，游戏就此结束——不再有"未能按时
  // 返回"那种温和惩罚（扣理智、直接进下一天）的分支。
  state.ending = 'night_madness';
  saveState(state);
  renderWindow('午夜', `
    <div class="event-text">十二点的钟声敲过，四周的黑忽然浓稠得不像话——两人还没来得及往回走，就被彻底吞了进去。早该赶在十二点前把当天的素材剪出来发布、回旅馆过夜，不该在外面多逗留。</div>
    <button class="btn" id="btn-continue-madness">继续</button>
  `);
  openModal('event');
  document.getElementById('btn-continue-madness').addEventListener('click', () => {
    closeModal();
    showEnding('night_madness');
  });
}

// ---------- 加油站：翻旧报纸 / 发布 vlog ----------

function openBasecamp() {
  renderBasecampTab('newspaper');
  openModal('basecamp');
}

function renderBasecampTab(tab) {
  const dayContent = getDayContent();
  renderWindow('加油站', `
    <div class="tabs">
      <button class="tab-btn ${tab === 'newspaper' ? 'active' : ''}" id="tab-btn-newspaper">翻旧报纸</button>
      <button class="tab-btn ${tab === 'publish' ? 'active' : ''}" id="tab-btn-publish">发布 vlog</button>
    </div>
    <div id="tab-body"></div>
    <button class="btn btn-gray" id="btn-leave-basecamp" style="margin-top:12px;">离开加油站</button>
  `);
  document.getElementById('tab-btn-newspaper').addEventListener('click', () => renderBasecampTab('newspaper'));
  document.getElementById('tab-btn-publish').addEventListener('click', () => renderBasecampTab('publish'));
  document.getElementById('btn-leave-basecamp').addEventListener('click', closeModal);

  const body = document.getElementById('tab-body');
  if (tab === 'newspaper') {
    renderNewspaperTab(body, dayContent);
  } else {
    renderPublishTab(body, dayContent);
  }
}

function renderNewspaperTab(body, dayContent) {
  // "每天限一次"限的是"翻出新东西"，已经翻出来的这批可以反复看：报纸正文里的
  // [[关键词]] 是解锁词条（乃至地点——第 1 天的中心广场就是这么开的）的唯一入口，
  // 只让看一眼的话，玩家一次没点中就再也回不去了，当天直接卡死。
  const firstTimeToday = basecampSys.canReadNewspaper(state);
  const entries = basecampSys.readNewspaper(state, dayContent) || dayContent.newspaper || [];
  const paragraphs = entries
    .map(e => `<p class="archive-entry">${kw.parseKeywords(e.text, k => archiveSys.isUnlocked(state, k))}</p>`)
    .join('');
  body.innerHTML = entries.length
    ? `${firstTimeToday ? '' : '<p class="hint">今天已经翻过一遍了，这是刚才翻到的东西：</p>'}${paragraphs}`
    : '<p class="hint">今天没有新的旧报纸/论坛老帖。</p>';
  bindKeywordClicks(body);
  saveState(state);
}

function renderPublishTab(body, dayContent) {
  const alreadyPublished = state.publishLog.some(p => p.day === state.day && !p.failed);
  if (alreadyPublished) {
    // 正常流程发布成功后会自动弹出旅馆的"进入下一天"窗口；这里是玩家提前把那个
    // 窗口关掉之后，再翻回发布 tab 时的补救入口。
    body.innerHTML = `
      <p class="hint">今天已经发布过了。</p>
      <button class="btn btn-gray" id="btn-view-stats">查看本期数据</button>
      <button class="btn" id="btn-back-to-hotel">回旅馆休息</button>
    `;
    document.getElementById('btn-view-stats').addEventListener('click', () => openVlogPhone(state.day, null));
    document.getElementById('btn-back-to-hotel').addEventListener('click', () => { closeModal(); openHotelNight(); });
    return;
  }

  const clues = state.todayClues;
  const digest = signalSys.getDailyDigest(state);

  body.innerHTML = `
    <p class="hint">今日采集到 ${clues.length} 条线索，可以剪进今天的 vlog。</p>
    <ul class="clue-list">${clues.map(c => `<li>${c}</li>`).join('') || '<li class="hint">（今天什么都没拍到）</li>'}</ul>
    ${digest.length ? `
      <div class="signal-digest">
        <div class="hint">今日评论区：</div>
        ${digest.map(s => `<p class="signal-line">${s.text}</p>`).join('')}
      </div>` : ''}
    <button class="btn" id="btn-open-publish-editor" style="margin-top:10px;">剪辑</button>
  `;

  document.getElementById('btn-open-publish-editor').addEventListener('click', () => openPublishEditor(dayContent));
}

// ---------- 推日/结局 ----------

function advanceDay() {
  const total = content.days.meta?.totalDays
    || Object.keys(content.days).filter(k => k !== 'meta').length;

  if (state.day >= total) {
    // 走到这里的只剩"平安开出小镇"那一类：走到高潮抉择并选完的人，在 pickChoice 里
    // 当场就进结局窗口了，根本不会回来睡这一觉（见 ending.js decide 的注释）。
    const decision = endingSys.decide(state);
    state.ending = decision.id;
    saveState(state);
    showEnding(decision.id);
    return;
  }

  state.day += 1;
  state.location = 'gasStation';
  timeSys.resetToday(state, content.days[String(state.day)]);
  state.visitedToday = [];
  state.todayClues = [];
  state.todayEventLog = [];
  state.usedNewspaperToday = false;
  signalSys.resetDaily(state);
  snapshotDay(state); // 记下新一天开始时的存档点，供"重新度过今日"/"回到上一天"用

  if (!maybeShowDayIntro()) refreshAll();
}

/**
 * 结局窗口。分页播出：正文（按换行分段）→ 玩家点"继续"→ 后日谈（endings.json 的
 * epilogue）。design-doc.md 1.4 节要求结局②必须两段式——正文那一段是一场不留破绽的
 * 胜利，翻转只能等玩家主动点过"继续"之后才在后日谈里揭晓，所以这两段在这里也是分开
 * 的页，绝不拼成一整块一次性倒给玩家。
 *
 * 演出：标题逐字上浮 → 正文逐句淡入 → 按钮最后出现（见 reveal.js / ui.css 的 .rv-*）。
 * 这是全篇唯一一处用得起这种慢节奏的地方——普通事件正文照旧整段直出。
 *
 * 最后一页是"走到结局之后怎么办"的菜单。除了从头再来，任何结局都给两条回头路，
 * 它们都只是把 state.js 里那条存档点链上的某一个点还原回来（见 applyCheckpointRewind）：
 *
 *   从某个时间点继续  按"几月几号几点"列出这一局走过的每一个整点
 *   回到某个重大抉择  列出这一局做过的每一个抉择（是否摧毁子午线仪 / 是否要帮助婴儿），
 *                     回去的是选项还没摆出来的那一刻，那条抉择事件会重新播一遍
 *
 * @param {object} [opts]
 * @param {boolean} [opts.intro] 传 false 表示"直接把窗口摆出来"，跳过 endings.json 里
 *        配的 quake 演出。读档进来时用（见 boot），免得每次刷新页面都重震一遍。
 */
function showEnding(id, opts = {}) {
  // 进结局就把低理智扫描循环停死。两条设置 state.ending 的路径都不走 refreshAll()，
  // 所以不能指望 syncScanLoop() 来收尾；runScan() 里的 state.ending 闸只能保证下一拍
  // 不演，定时器会一直挂到那一拍为止。
  stopScanLoop();

  const ending = endingSys.getText(id, state, content.endings);
  // "陷入疯狂"是当天中途的意外死亡，不是整个旅程走完后的真结局——比起强制从第 1 天
  // 重开，更合理的是直接问要不要重新度过今天（复用"重新度过今日"的存档点机制，见
  // state.js snapshotDay/restoreDayCheckpoint），"重新开始"整个旅程只作为次要选项保留。
  const isNightMadness = id === 'night_madness';

  // 结局窗口摆出来之后 state 不会再变，两份清单在这里取一次就够，翻页/来回进出子窗口都复用。
  const timePoints = listCheckpoints(state, ['day', 'time']);
  const choicePoints = listCheckpoints(state, ['choice']);
  const hasRewind = isNightMadness || timePoints.length > 0 || choicePoints.length > 0;

  const pages = [
    ...splitSegments(ending.text).map(text => ({ text, epilogue: false })),
    ...(ending.epilogue ? splitSegments(ending.epilogue).map(text => ({ text, epilogue: true })) : [])
  ];

  const parse = seg => kw.parseKeywords(seg, k => archiveSys.isUnlocked(state, k));
  let idx = 0;

  const showPage = () => {
    const page = pages[idx];
    const isLast = idx === pages.length - 1;
    const titleText = page.epilogue ? '后日谈' : ending.title;
    // 三层延迟首尾相接：后一层的起点 = 前一层播完的时刻 + 一点停顿。
    // 每字 0.05s、每句 0.18s 跟 ui.css 里 .rv-char / .rv-clause 的默认步长对齐，改那边记得同步。
    const bodyBase = 0.15 + [...titleText].length * 0.05 + 0.2;
    const btnBase = bodyBase + revealSys.clauseCount(page.text) * 0.18 + 0.25;

    const body = renderWindow('旅程 · 结局', `
      <div class="ending-title${page.epilogue ? ' ending-title-epilogue' : ''}">${revealSys.chars(titleText)}</div>
      <div class="event-text" style="--rv-base:${bodyBase.toFixed(2)}s">${revealSys.clauses(page.text, parse)}</div>
      <div class="rv-block" style="--rv-base:${btnBase.toFixed(2)}s">
        ${!isLast ? '<button class="btn" id="btn-ending-continue">继续</button>' : ''}
        ${isLast && isNightMadness ? `<button class="btn" id="btn-redo-day">重新度过今日（第 ${state.day} 天）</button>` : ''}
        ${isLast && choicePoints.length ? `<button class="btn" id="btn-rewind-choice" ${isNightMadness ? 'style="margin-top:8px;"' : ''}>回到某个重大抉择</button>` : ''}
        ${isLast && timePoints.length ? `<button class="btn" id="btn-rewind-time" ${isNightMadness || choicePoints.length ? 'style="margin-top:8px;"' : ''}>从某个时间点继续</button>` : ''}
        ${isLast ? `<button class="btn ${hasRewind ? 'btn-gray' : ''}" id="btn-restart" ${hasRewind ? 'style="margin-top:8px;"' : ''}>重新开始${hasRewind ? '整个旅程' : ''}</button>` : ''}
      </div>
    `);
    bindKeywordClicks(body);

    if (!isLast) {
      document.getElementById('btn-ending-continue').addEventListener('click', () => {
        idx += 1;
        showPage();
      });
      return;
    }

    if (isNightMadness) {
      document.getElementById('btn-redo-day').addEventListener('click', () => applyTimeRewind(state.day));
    }
    // 两个回退清单开在同一个窗口里，"返回"回到结局的最后一页（也就是重画这一屏）。
    if (choicePoints.length) {
      document.getElementById('btn-rewind-choice')
        .addEventListener('click', () => openEndingRewind({ kind: 'choice', list: choicePoints, back: showPage }));
    }
    if (timePoints.length) {
      document.getElementById('btn-rewind-time')
        .addEventListener('click', () => openEndingRewind({ kind: 'time', list: timePoints, back: showPage }));
    }
    document.getElementById('btn-restart').addEventListener('click', () => {
      quakeSys.cancel(); // 保险：演出还没收尾就重开时，把抖动/落灰一并复位
      paperSys.cancel(); // 同上：纸条摊到一半重开，把那一层也收掉
      stopScanLoop();    // 同上：扫描框还亮着就重开，地图会被 map.init 重建，那一层得先摘干净；
                         // 连排在后面的定时器一起停掉，不然重开后还会冒一次
      clearSave();
      state = createInitialState(content.days['1']);
      snapshotDay(state); // 补一份第 1 天存档点，不然重开这一局之后"重新度过今日"会找不到存档
      closeModal();
      refreshAll();
    });
  };

  const start = () => {
    openModal('ending');
    showPage();
  };

  // 结局自己配了 quake 就先震一次再出窗口——design-doc.md 1.6 节：无论走到哪个结局，
  // 现实世界都一定会记录到那两次地震，结局文本里那句新闻是固定收尾。
  if (ending.quake && opts.intro !== false) quakeSys.play(ending.quake).then(start);
  else start();
}

// ---------- 结局之后的回退清单 ----------
//
// "从某个时间点继续"和"回到某个重大抉择"是同一件事的两种排法——都是把 state.js 那条
// 存档点链摆成一份可点的清单，点下去就把整局状态还原到那一刻（applyCheckpointRewind）。
// 所以它们共用这一个窗口，只在排版和小字说明上分岔：时间点按天分组、条目是"几点"，
// 抉择是平铺一列、条目是抉择本身的名字（days.json 里的 rewindLabel）。

/** 存档点条目底下那行小字：还原回去之后玩家手里握着什么。 */
function checkpointStateHint(cp) {
  const snap = cp.snapshot || {};
  return `理智 ${snap.sanity} · 已收集 ${(snap.collectedClues || []).length} 条线索`;
}

function checkpointDateLabel(cp) {
  return timeSys.formatDayDate(content.days[String(cp.day)], cp.day);
}

/**
 * @param {object} args
 * @param {'time'|'choice'} args.kind 这份清单排成哪一种
 * @param {object[]} args.list 要列出来的存档点（已按时间排好序，见 state.js listCheckpoints）
 * @param {Function} args.back "返回"按下去做什么——结局窗口传的是重画最后一页
 */
function openEndingRewind({ kind, list, back }) {
  const isChoice = kind === 'choice';

  // 时间点按天分组：链本来就是按时间排的，所以相邻同一天的挨在一起，顺着扫一遍就能分组
  const groups = [];
  for (const cp of list) {
    const last = groups[groups.length - 1];
    if (last && last.day === cp.day) last.items.push(cp);
    else groups.push({ day: cp.day, items: [cp] });
  }

  const rowHTML = cp => `
    <button class="btn btn-option choice-btn" data-cp="${cp.id}">
      <span class="choice-label">${isChoice ? cp.label : `${timeSys.formatMinutes(cp.minutes)}${cp.kind === 'day' ? ' · 出发' : ''}`}</span>
      <span class="choice-hint">${isChoice
        ? `${timeStampLabel(cp.day, cp.minutes)} · ${checkpointStateHint(cp)}`
        : checkpointStateHint(cp)}</span>
    </button>`;

  const body = renderWindow(isChoice ? '旅程 · 回到某个重大抉择' : '旅程 · 从某个时间点继续', `
    <p class="hint">${isChoice
      ? '回到那个抉择摆在眼前的一刻重新选。那之后发生的一切——理智、线索、这次走到的结局——都会一并还原。'
      : '回到那一刻重新走一遍。那之后发生的一切——理智、线索、发布记录、这次走到的结局——都会一并还原。'}</p>
    ${isChoice
      ? `<div class="choice-list">${list.map(rowHTML).join('')}</div>`
      : groups.map(g => `
          <div class="rewind-day">${checkpointDateLabel({ day: g.day })}</div>
          <div class="choice-list">${g.items.map(rowHTML).join('')}</div>
        `).join('')}
    <button class="btn btn-gray" id="btn-rewind-back" style="margin-top:12px;">返回</button>
  `, { noClose: true }); // 关不掉：这一屏是结局窗口的下一层，出口只有"返回"和挑一个点，
                         // 免得红灯一点把整个结局窗口关掉、玩家对着地图不知道该干什么

  body.querySelectorAll('.choice-btn').forEach(btn => {
    btn.addEventListener('click', () => applyCheckpointRewind(btn.dataset.cp));
  });
  document.getElementById('btn-rewind-back').addEventListener('click', back);
}

// ---------- 剪辑编辑器共用素材展示 helper ----------
//
// 素材库图标 / 时间轴长方形 / 拖放判定，供剪辑编辑器（加油站"剪辑" tab、顶部菜单
// "开始剪辑"两个入口，最终都是同一个编辑器，见后面 openClipEditor/openPublishEditor）使用。

function importanceLabel(importance) {
  return { low: '低', mid: '中', high: '高' }[importance] || '中';
}

function clipIconHTML(clueId) {
  const m = reviewSys.getMaterial(clueId);
  return `
    <div class="clip-icon" draggable="true" data-clue="${clueId}" title="拖到下面的时间轴上">
      <div class="clip-icon-thumb">🎞️</div>
      <div class="clip-icon-label">${m.label}</div>
      <span class="clip-tag tag-${m.importance}">${importanceLabel(m.importance)}</span>
    </div>`;
}

function clipBlockHTML(clueId, idx) {
  const m = reviewSys.getMaterial(clueId);
  return `
    <div class="clip-block imp-${m.importance}" draggable="true" data-idx="${idx}" data-clue="${clueId}" title="${m.label}">
      <span class="clip-block-label">${m.label}</span>
      <button class="clip-block-remove" data-idx="${idx}" title="移出时间轴">×</button>
    </div>`;
}

/** 拖拽放到时间轴上的哪个位置：比较落点 x 坐标和已有素材块的中点。 */
function getDropIndex(track, clientX) {
  const blocks = Array.from(track.querySelectorAll('.clip-block'));
  for (const block of blocks) {
    const rect = block.getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) return Number(block.dataset.idx);
  }
  return blocks.length;
}

/**
 * 素材库 + 时间轴的拖拽交互，供剪辑编辑器（renderPublishEditor）使用。
 * @param {HTMLElement} body renderWindow 返回的 .mac-body 容器
 * @param {string[]} timeline 当前时间轴数组，就地增删/重排
 * @param {()=>void} rerender 时间轴变化后重新渲染整个编辑器的回调
 */
function wireClipDragDrop(body, timeline, rerender) {
  body.querySelectorAll('.clip-icon, .clip-block').forEach(el => {
    el.addEventListener('dragstart', e => {
      const payload = el.classList.contains('clip-icon') ? `lib:${el.dataset.clue}` : `tl:${el.dataset.idx}`;
      e.dataTransfer.setData('text/plain', payload);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
  });

  body.querySelectorAll('.clip-block-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      timeline.splice(Number(btn.dataset.idx), 1);
      rerender();
    });
  });

  const track = body.querySelector('#timeline-track');
  track.addEventListener('dragover', e => {
    e.preventDefault(); // 必须 preventDefault 才允许 drop
    track.classList.add('drag-over');
  });
  track.addEventListener('dragleave', e => {
    const r = track.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      track.classList.remove('drag-over');
    }
  });
  track.addEventListener('drop', e => {
    e.preventDefault();
    track.classList.remove('drag-over');
    applyClipDrop(e.dataTransfer.getData('text/plain'), track, e.clientX, timeline);
    rerender();
  });

  wireClipTouchDrag(body, track, timeline, rerender);
}

/** dragover/drop（鼠标）和 touchend（触屏）落点算法共用：payload 决定是从素材库拿一个还是在时间轴内挪动。 */
function applyClipDrop(payload, track, clientX, timeline) {
  const dropIdx = getDropIndex(track, clientX);
  if (payload.startsWith('lib:')) {
    const clueId = payload.slice(4);
    if (!timeline.includes(clueId)) timeline.splice(dropIdx, 0, clueId);
  } else if (payload.startsWith('tl:')) {
    const fromIdx = Number(payload.slice(3));
    const [moved] = timeline.splice(fromIdx, 1);
    timeline.splice(fromIdx < dropIdx ? dropIdx - 1 : dropIdx, 0, moved);
  }
}

/**
 * 手机浏览器基本不触发原生 HTML5 拖拽事件（dragstart/dragover/drop），所以另外接一套
 * touch 事件手动实现同样的效果：手指按住素材移动超过一点距离就判定为"开始拖拽"，
 * 用一个跟手指走的浮动副本（ghost）做视觉反馈，松手时用当前坐标复用 applyClipDrop 落位。
 * 没有明显移动的轻触仍然只触发普通 click（打开素材简介），不受影响。
 */
function wireClipTouchDrag(body, track, timeline, rerender) {
  const DRAG_THRESHOLD = 8; // px，超过这个距离才算开始拖拽，避免误吞正常的点击

  body.querySelectorAll('.clip-icon, .clip-block').forEach(el => {
    let startX = 0, startY = 0, dragging = false, ghost = null;

    const cleanup = () => {
      if (ghost) { ghost.remove(); ghost = null; }
      el.classList.remove('dragging');
      track.classList.remove('drag-over');
      dragging = false;
    };

    el.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dragging = false;
    }, { passive: true });

    el.addEventListener('touchmove', e => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (!dragging) {
        if (Math.abs(t.clientX - startX) < DRAG_THRESHOLD && Math.abs(t.clientY - startY) < DRAG_THRESHOLD) return;
        dragging = true;
        el.classList.add('dragging');
        ghost = el.cloneNode(true);
        ghost.classList.remove('dragging');
        ghost.classList.add('clip-drag-ghost');
        ghost.style.width = `${el.getBoundingClientRect().width}px`;
        document.body.appendChild(ghost);
      }
      e.preventDefault(); // 拖拽过程中不让页面跟着滚
      ghost.style.left = `${t.clientX}px`;
      ghost.style.top = `${t.clientY}px`;
      const over = document.elementFromPoint(t.clientX, t.clientY);
      track.classList.toggle('drag-over', !!(over && track.contains(over)));
    }, { passive: false });

    el.addEventListener('touchend', e => {
      if (!dragging) return;
      const t = e.changedTouches[0];
      const over = document.elementFromPoint(t.clientX, t.clientY);
      if (over && track.contains(over)) {
        const payload = el.classList.contains('clip-icon') ? `lib:${el.dataset.clue}` : `tl:${el.dataset.idx}`;
        applyClipDrop(payload, track, t.clientX, timeline);
        cleanup();
        rerender();
        return;
      }
      cleanup();
    });

    el.addEventListener('touchcancel', cleanup);
  });
}

// ---------- 剪辑编辑器：加油站"剪辑" tab + 顶部"开始剪辑"共用入口 ----------
//
// 两个入口最终打开的是同一个编辑页（素材库 + 时间轴）、走的是同一次"确认发布"：
// 今天的素材（state.todayClues）先摆在素材库里，玩家手动拖到时间轴上，点
// "确认发布"才真正结算播放量、写入 publishLog，一天只能发布一次。如果
// content/days.json 给当天配置了 reviews（结构见 review.js 顶部注释），确认发布时
// 会顺带用 reviewSys 判定玩家摆的顺序对不对，在编辑页里追加一段成功/失败反馈——
// 这个判定不影响播放量，只影响 choiceLog、用于同一结局内的文案分支；没配置
// reviews 的天数（比如第 1 天）就跟以前一样，确认即走，没有对错这一步。反馈展示
// 完，玩家点"完成"再关掉编辑页、弹出旅馆的"进入下一天"窗口（见 openHotelNight）；
// 没有反馈要展示的话，确认发布后直接关闭走这一步，播放量结果走 toast 提示。

let publishEditorTimeline = []; // 剪辑编辑页的时间轴，纯前端临时编辑状态，不写进存档

/** 顶部菜单"开始剪辑"入口：跟加油站里点"剪辑"打开的是同一个编辑器。 */
function openClipEditor() {
  const dayContent = getDayContent();
  if (!dayContent) return;
  const alreadyPublished = state.publishLog.some(p => p.day === state.day && !p.failed);
  if (alreadyPublished) {
    renderWindow('剪辑', `
      <p class="hint">今天已经发布过了。</p>
      <button class="btn btn-gray" id="btn-view-stats">查看本期数据</button>
      <button class="btn" id="btn-back-to-hotel">回旅馆休息</button>
    `);
    openModal('publishEdit');
    document.getElementById('btn-view-stats').addEventListener('click', () => openVlogPhone(state.day, null));
    document.getElementById('btn-back-to-hotel').addEventListener('click', () => { closeModal(); openHotelNight(); });
    return;
  }
  openPublishEditor(dayContent);
}

function openPublishEditor(dayContent) {
  publishEditorTimeline = []; // 素材都从素材库开始，需要玩家手动拖到时间轴上
  renderPublishEditor(dayContent, null);
  openModal('publishEdit');
}

/**
 * @param {object} dayContent
 * @param {{success:boolean,text:string}|null} result 确认发布后的复盘判定结果；
 *        当天没配置 reviews、或还没点确认发布时是 null。非 null 时编辑页锁定为反馈态。
 */
function renderPublishEditor(dayContent, result) {
  const done = !!result;
  const libraryIds = state.todayClues.filter(id => !publishEditorTimeline.includes(id));

  const body = renderWindow('剪辑', `
    <div class="editor">
      <div class="editor-brief">
        <div class="event-text">把今天拍到的素材剪进 vlog。</div>
        <p class="hint">拖拽调整时间轴上的素材，确认后即发布，不能反悔。</p>
      </div>

      <div class="editor-panel-label">素材库</div>
      <div class="clip-library" id="clip-library">
        ${libraryIds.length
          ? libraryIds.map(clipIconHTML).join('')
          : '<p class="hint">今天的素材都在时间轴上了。</p>'}
      </div>

      <div class="editor-panel-label">时间轴</div>
      <div class="timeline-track" id="timeline-track">
        ${publishEditorTimeline.length
          ? publishEditorTimeline.map(clipBlockHTML).join('')
          : '<div class="timeline-empty">把素材库里的素材拖到这里</div>'}
      </div>

      ${result ? `<div class="editor-feedback ${result.success ? 'feedback-ok' : 'feedback-bad'}">${result.text}</div>` : ''}

      <div class="editor-actions">
        <button class="btn btn-gray" id="btn-editor-close">${done ? '完成' : '关闭'}</button>
        ${done ? '' : `<button class="btn" id="btn-confirm-publish" ${publishEditorTimeline.length ? '' : 'disabled'}>确认发布</button>`}
      </div>
    </div>
  `);

  document.getElementById('btn-editor-close').addEventListener('click', () => {
    closeModal();
    if (done) openVlogPhone();
  });

  body.querySelectorAll('.clip-icon, .clip-block').forEach(el => {
    el.addEventListener('click', () => showClipInfo(el.dataset.clue));
  });

  if (done) return; // 已经确认发布，锁定时间轴，不再允许拖拽/重复提交

  wireClipDragDrop(body, publishEditorTimeline, () => renderPublishEditor(dayContent, null));

  document.getElementById('btn-confirm-publish').addEventListener('click', () => {
    // 当天配置了 reviews 的话，先按玩家实际摆的顺序判定一次对错（不影响播放量）。
    const review = reviewSys.getAvailable(state, dayContent.reviews || [])[0] || null;
    const reviewResult = review ? reviewSys.submit(state, review, publishEditorTimeline) : null;
    if (reviewResult && reviewResult.effect) applyOutcomeEffects(reviewResult.effect);

    publishSys.publish(state, publishEditorTimeline);
    refreshAll();

    // 播放量不再用 toast 报，改成发完掏出手机看后台数据（见 openVlogPhone）。
    // 当天配了复盘的话先停在编辑页看对错反馈，点"完成"再弹手机。
    if (reviewResult) {
      renderPublishEditor(dayContent, reviewResult);
    } else {
      closeModal();
      openVlogPhone();
    }
  });
}

// ---------- 记事本（原"档案库"，按分类分 tab；旧的纯线索列表版记事本已合并进来）/ 调查回顾 ----------

/**
 * 记事本：以前是"档案库"（分类堆在同一屏里滚动）+ 一个单独的"记事本"（线索 id 平铺列表）
 * 两个入口。现在合并成一个，按 category 分 tab 展示，一次只看一类，不再全部塞进同一个界面。
 * @param {string} [tab] 想切到的分类；不传或传了个不存在的分类就沿用上次选中的 tab，
 *        都没有的话取第一个分类。
 */
function openNotebook(tab) {
  const categories = archiveSys.allCategories();

  if (categories.length === 0) {
    renderWindow('记事本', `
      <p class="hint">还没有解锁任何词条，点击正文里的高亮/虚线词试试。</p>
      <button class="btn btn-gray" id="btn-close-plain">关闭</button>
    `);
    openModal('notebook');
    document.getElementById('btn-close-plain').addEventListener('click', closeModal);
    updateNotebookDot();
    return;
  }

  const activeTab = categories.includes(tab) ? tab
    : categories.includes(notebookTab) ? notebookTab
    : categories[0];
  notebookTab = activeTab;

  const entries = archiveSys.listByCategory(state)[activeTab] || [];
  // 未读角标要用"这次渲染之前"的状态算，不然自己正打开的这个 tab 的角标会跟着自己一起消失得太早
  const unreadCats = archiveSys.categoriesWithUnread(state);

  // 仿 Notes.app：左侧分类侧栏 + 右侧词条内容区，而不是顶部 tab 切页
  const body = renderWindow('记事本', `
    <div class="mac-split">
      <div class="mac-sidebar">
        ${categories.map(cat => `
          <button class="sidebar-item ${cat === activeTab ? 'active' : ''}" data-cat="${cat}">
            <span>${cat}</span>${cat !== activeTab && unreadCats.has(cat) ? '<span class="notif-dot"></span>' : ''}
          </button>
        `).join('')}
      </div>
      <div class="mac-pane">
        ${entries.length === 0
          ? '<p class="hint">这一类还没有解锁任何词条。</p>'
          : entries.map(e => `
            <div class="archive-entry">
              <div class="archive-entry-title">${e.title}${state.archives.newSinceLastView.includes(e.key) ? ' 🆕' : ''}</div>
              <div class="archive-entry-body" data-key="${e.key}">${kw.parseKeywords(e.body, k => archiveSys.isUnlocked(state, k))}</div>
            </div>
          `).join('')}
      </div>
    </div>
    <button class="btn btn-gray" id="btn-close-plain" style="margin-top:12px;">关闭</button>
  `);
  bindKeywordClicks(body);
  body.querySelectorAll('.archive-entry-body').forEach(el => archiveSys.markViewed(state, el.dataset.key));
  body.querySelectorAll('.sidebar-item').forEach(btn => {
    btn.addEventListener('click', () => openNotebook(btn.dataset.cat));
  });
  openModal('notebook');
  document.getElementById('btn-close-plain').addEventListener('click', closeModal);
  updateNotebookDot(); // 当前 tab 里的词条标记已读后，状态栏角标可能要跟着消失
}

function openTracker() {
  const progress = archiveSys.computeProgress(state);
  const log = state.todayEventLog; // 已经是触发顺序，即当天从早到晚的调查顺序，不用再排序
  const body = renderWindow('调查回顾', `
    <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
    <div class="hint">探索进度：${progress}%（主线相关记事本词条解锁占比）</div>
    <div class="tracker-log">
      ${log.length === 0
        ? '<p class="hint" style="margin-top:12px;">今天还没有在任何调查地点触发事件，去地图上看看。</p>'
        : log.map(entry => `
          <div class="archive-entry">
            <div class="archive-entry-title">${timeSys.formatMinutes(entry.minutes)} · ${entry.locName}</div>
            ${entry.note ? `<div class="hint">${entry.note}</div>` : ''}
            <div class="event-text" data-key="${entry.eventId}">${kw.parseKeywords(entry.text, k => archiveSys.isUnlocked(state, k))}</div>
          </div>
        `).join('')}
    </div>
    <button class="btn btn-gray" id="btn-close-plain" style="margin-top:12px;">关闭</button>
  `);
  bindKeywordClicks(body);
  openModal('tracker');
  document.getElementById('btn-close-plain').addEventListener('click', closeModal);
}

// ---------- 时间线：重新度过今日 / 回到上一天 / 回到任意存档点 ----------
//
// 依赖 state.js 的 checkpoints：新开一局记第 1 天、每次 advanceDay() 记一次"当天开始"、
// 每次去调查地点记一次整点、每个重大抉择摆出选项前记一次。这里只是把恢复动作接到 UI 上，
// 不做业务判断。地图上的"时间线"按钮只用得到前两种，结局窗口的两份清单用的是全部。

function openTimeControl() {
  const canRedo = hasDayCheckpoint(state, state.day);
  const canGoBack = state.day > 1 && hasDayCheckpoint(state, state.day - 1);
  renderWindow('时间线', `
    <p class="hint">回退会丢掉回退目标之后发生的一切——已采集的线索、理智值变化、发布记录都会跟着一起还原。</p>
    <button class="btn" id="btn-redo-today" ${canRedo ? '' : 'disabled'}>重新度过今日（第 ${state.day} 天）</button>
    <button class="btn btn-gray" id="btn-go-back-day" ${canGoBack ? '' : 'disabled'} style="margin-top:8px;">
      ${state.day > 1 ? `回到上一天（第 ${state.day - 1} 天）` : '回到上一天（第 1 天没有上一天）'}
    </button>
    <button class="btn btn-gray" id="btn-close-plain" style="margin-top:8px;">关闭</button>
  `);
  openModal('timeControl');
  if (canRedo) document.getElementById('btn-redo-today').addEventListener('click', () => applyTimeRewind(state.day));
  if (canGoBack) document.getElementById('btn-go-back-day').addEventListener('click', () => applyTimeRewind(state.day - 1));
  document.getElementById('btn-close-plain').addEventListener('click', closeModal);
}

function applyTimeRewind(targetDay) {
  const restored = restoreDayCheckpoint(state, targetDay);
  if (!restored) {
    showToast('没有找到可回退的存档点');
    return;
  }
  applyRestoredState(restored);
}

/**
 * 结局窗口两份清单的落点：按 id 还原任意一个存档点。
 * 抉择存档点还原之后要多做一步——把那条抉择事件重新播一遍，见下面的注释。
 */
function applyCheckpointRewind(id) {
  const cp = (state.checkpoints || []).find(c => c.id === id);
  const restored = restoreCheckpoint(state, id);
  if (!cp || !restored) {
    showToast('没有找到可回退的存档点');
    return;
  }
  // 抉择存档点记的是"选项还没摆出来"的那一刻，只还原状态的话玩家会站在地图前，
  // 选项不会自己再出现——高潮抉择的第二问（e_finale_baby）甚至根本没挂在任何地点上，
  // 那就再也回不去了。所以这里把那条事件也一起接在信号断掉的那一刻重新播：
  // 信号回来时选项已经摆好了，跟第一次走到它面前一样。
  const event = cp.kind === 'choice'
    ? ((content.days[String(cp.day)] || {}).events || []).find(e => e.id === cp.eventId)
    : null;

  applyRestoredState(restored, {
    after: () => {
      if (cp.kind !== 'choice') return;
      if (event) showChoiceEvent(event);
      else showToast('这个抉择在当前剧本里已经找不到了');
    }
  });
}

/**
 * 把一份还原出来的状态接管成当前局面：演出层收干净 → 放监控信号异常的转场 → 在画面
 * 断掉的那一刻换 state、清掉不进存档的临时状态、关窗刷新（见 engine/glitch.js 的
 * onCut：换挡这一下藏在雪花后面，信号回来时已经是另一个时刻了）。
 * 回退可能是从结局窗口发起的，所以地震/纸条/扫描这些演出都得在这里先收尾。
 *
 * @param {object} [opts]
 * @param {Function} [opts.after] 换完状态、界面刷新之后还要做的事（回到抉择时把那条事件重播一遍）
 */
function applyRestoredState(restored, opts = {}) {
  quakeSys.cancel();
  paperSys.cancel();
  stopScanLoop();             // 新状态的理智值决定要不要重新开，交给下面 refreshAll 里的 syncScanLoop

  glitchSys.play({
    from: timeStampLabel(state.day, state.minutes),
    to: timeStampLabel(restored.day, restored.minutes),
    onCut: () => {
      state = restored;
      pendingDayOver = false;     // 回退掉了触发这个标记的那部分进程，避免残留一次假的"超时"判定
      publishEditorTimeline = []; // 剪辑编辑页的临时拖拽状态本来就不写进存档，回退后清空更保险
      closeModal();
      refreshAll();
      if (opts.after) opts.after();
    }
  });
}

/** "7月4日 10:00"：给信号异常演出的时间码用，也是回退清单上那个"几月几号几点"的同一份写法。 */
function timeStampLabel(day, minutes) {
  return `${timeSys.formatDayDate(content.days[String(day)], day)} ${timeSys.formatMinutes(minutes)}`;
}

// ---------- 事件绑定 ----------

function wireStatusButtons() {
  document.getElementById('btn-notebook').addEventListener('click', () => openNotebook());
  document.getElementById('btn-tracker').addEventListener('click', openTracker);
  document.getElementById('btn-review').addEventListener('click', openClipEditor);
  document.getElementById('btn-time-control').addEventListener('click', openTimeControl);
}

function wireMapControls() {
  document.getElementById('zoom-in').addEventListener('click', mapSys.zoomIn);
  document.getElementById('zoom-out').addEventListener('click', mapSys.zoomOut);
}

window.addEventListener('DOMContentLoaded', boot);
