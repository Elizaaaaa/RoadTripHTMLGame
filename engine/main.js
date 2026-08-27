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
import * as signalSys from './signal.js';
import * as basecampSys from './basecamp.js';
import * as endingSys from './ending.js';
import {
  createInitialState, loadState, saveState, clearSave,
  snapshotDay, hasDayCheckpoint, restoreDayCheckpoint
} from './state.js';

let state;
let content = {};      // { days, archive, endings }
let modalBox;
let currentModal = null;   // 'event' | 'basecamp' | 'review' | 'notebook' | 'tracker' | 'ending'
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

  archiveSys.init(content.archive);
  reviewSys.init(content.materials);
  const loaded = loadState();
  state = loaded || createInitialState(content.days['1']);
  // 新开一局要记第 1 天的存档点；读到的是旧格式存档（还没有 dayCheckpoints）时，
  // 退而求其次地把"读档这一刻"记成当天的存档点，好过完全不能用"重新度过今日"。
  if (!hasDayCheckpoint(state, state.day)) snapshotDay(state);

  mapSys.init(document.getElementById('map-viewport'), mapData, onHotspotClick);
  wireStatusButtons();
  wireMapControls();

  if (state.ending) {
    showEnding(state.ending);
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
  // 剪辑台（review 复盘 / publishEdit 加油站发布）素材库 + 时间轴两块内容并排放，
  // 默认弹窗宽度放不下，单独放宽。
  modalBox.classList.toggle('modal-wide', mode === 'review' || mode === 'publishEdit');
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  modalBox.innerHTML = '';
  modalBox.classList.remove('modal-wide');
  currentModal = null;
  closeClipInfo(); // 保险起见：主窗口关掉时，叠在它上面的素材简介小窗也一并收掉
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
 * @returns {HTMLElement} 内容区 .mac-body，后续查询/绑定事件仍可用 document.getElementById
 *          或这个返回值，两者等价（.mac-body 就在 modalBox 内部）。
 */
function renderWindow(title, bodyHTML) {
  modalBox.innerHTML = `
    <div class="mac-titlebar">
      <div class="mac-traffic">
        <button class="mac-dot mac-dot-red" id="mac-close" title="关闭"></button>
        <span class="mac-dot mac-dot-yellow"></span>
        <span class="mac-dot mac-dot-green"></span>
      </div>
      <div class="mac-title">${title}</div>
    </div>
    <div class="mac-body">${bodyHTML}</div>
  `;
  document.getElementById('mac-close').addEventListener('click', closeModal);
  return modalBox.querySelector('.mac-body');
}

function bindKeywordClicks(container) {
  kw.attachKeywordHandlers(container, onKeywordClick);
}

function onKeywordClick(key) {
  const isNew = archiveSys.unlock(state, key, 'keyword_click');
  if (isNew) notifyArchiveUnlock(key);
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

  state.location = id;
  if (!state.visitedToday.includes(id)) state.visitedToday.push(id);
  pendingDayOver = timeSys.addMinutes(state, timeSys.TRAVEL_TIME_MIN, dayContent);

  // 信号闪现：每次探索调查地点都额外判定一次，见 design-doc.md 3.3 节
  const shownIds = state.signalToday.map(s => s.id);
  const flare = signalSys.tryTrigger(dayContent, shownIds);
  if (flare) {
    signalSys.record(state, flare);
    showSignalToast(flare.text);
  }

  const event = (dayContent.events || []).find(
    e => e.loc === id && !state.triggeredEvents.includes(e.id)
  );

  if (!event) {
    afterInvestigation();
    return;
  }

  state.triggeredEvents.push(event.id);
  if (event.type === 'diceCheck') {
    showDiceEvent(event);
  } else {
    showTextEvent(event);
  }
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
  if (pendingDayOver) {
    pendingDayOver = false;
    handleDayOver();
  }
}

/**
 * 事件/掷骰结果里共用的效果字段：clue / clues / sanityCost / unlocksArchive / unlocksLocation。
 * clue 是单条线索（vlog 素材）的老写法；clues（数组）用于一个事件一次性发放多条线索，
 * 两个字段可以同时写。注意"线索/素材"（clue，会进剪辑台素材库）和"记事本词条"
 * （unlocksArchive，含"物品"分类，比如房间钥匙这种实物道具）是两套不同的东西——
 * 拍到的素材才用 clue，拿到手的道具/解锁的背景资料走 unlocksArchive。
 */
function applyOutcomeEffects(effect, sourceId) {
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
  if (effect.unlocksArchive) {
    for (const key of effect.unlocksArchive) {
      if (archiveSys.unlock(state, key, `event:${sourceId}`)) notifyArchiveUnlock(key);
    }
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

// ---------- 文本事件 ----------

function showTextEvent(event) {
  applyOutcomeEffects(event, event.id);
  const bodyHTML = kw.parseKeywords(event.text, k => archiveSys.isUnlocked(state, k));
  const body = renderWindow('事件记录', `
    <div class="event-text">${bodyHTML}</div>
    <button class="btn" id="btn-event-continue">继续</button>
  `);
  bindKeywordClicks(body);
  openModal('event');
  document.getElementById('btn-event-continue').addEventListener('click', () => {
    closeModal();
    afterInvestigation();
  });
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
  applyOutcomeEffects(result.outcome, event.id);
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
  const outcomeHTML = kw.parseKeywords(result.outcome.text, k => archiveSys.isUnlocked(state, k));

  const body = renderWindow('事件记录', `
    <div class="hint">${rollLine}</div>
    <div class="event-text">${outcomeHTML}</div>
    <button class="btn" id="btn-event-continue">继续</button>
  `);
  bindKeywordClicks(body);
  document.getElementById('btn-event-continue').addEventListener('click', () => {
    closeModal();
    afterInvestigation();
  });
}

// ---------- 超时未归 ----------

function handleDayOver() {
  // 第 1 天特殊规则（草稿约定）：晚上十二点还在镇子里瞎逛、没能在这之前剪辑发布
  // 并进入下一天，直接被黑暗吞噬判为"陷入疯狂"坏结局，不走下面几天通用的
  // "未能按时返回"温和惩罚流程。以后如果别的天也要加类似的即时判定，再把这段
  // 抽成通用的"提前结局检查"，现在先按第 1 天单独写，避免过度设计。
  if (state.day === 1) {
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
    return;
  }

  publishSys.failReturn(state);
  refreshAll();
  renderWindow('未能按时返回', `
    <div class="event-text">天黑前没能走回加油站——今天的素材没能剪出来，两人心里都有点发毛。</div>
    <button class="btn" id="btn-continue-fail">进入下一天</button>
  `);
  openModal('event');
  document.getElementById('btn-continue-fail').addEventListener('click', () => {
    closeModal();
    advanceDay();
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
  if (!basecampSys.canReadNewspaper(state)) {
    body.innerHTML = `<p class="hint">今天已经翻过旧报纸/论坛老帖了，明天再来看看。</p>`;
    return;
  }
  const entries = basecampSys.readNewspaper(state, dayContent) || [];
  body.innerHTML = entries.length
    ? entries.map(e => `<p class="archive-entry">${kw.parseKeywords(e.text, k => archiveSys.isUnlocked(state, k))}</p>`).join('')
    : '<p class="hint">今天没有新的旧报纸/论坛老帖。</p>';
  bindKeywordClicks(body);
  saveState(state);
}

function renderPublishTab(body, dayContent) {
  const alreadyPublished = state.publishLog.some(p => p.day === state.day && !p.failed);
  if (alreadyPublished) {
    // 正常流程发布成功后会自动弹出旅馆的"进入下一天"窗口；这里是玩家提前把那个
    // 窗口关掉之后，再翻回发布 tab 时的补救入口。
    body.innerHTML = `<p class="hint">今天已经发布过了。</p><button class="btn" id="btn-back-to-hotel">回旅馆休息</button>`;
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
  state.usedNewspaperToday = false;
  signalSys.resetDaily(state);
  snapshotDay(state); // 记下新一天开始时的存档点，供"重新度过今日"/"回到上一天"用

  if (!maybeShowDayIntro()) refreshAll();
}

function showEnding(id) {
  const text = endingSys.getText(id, state, content.endings);
  renderWindow('旅程 · 结局', `
    <div class="ending-title">${text.title}</div>
    <div class="event-text">${text.text.replace(/\n/g, '<br>')}</div>
    <button class="btn" id="btn-restart">重新开始</button>
  `);
  openModal('ending');
  document.getElementById('btn-restart').addEventListener('click', () => {
    clearSave();
    state = createInitialState(content.days['1']);
    closeModal();
    refreshAll();
  });
}

// ---------- 开始剪辑（剪辑台复盘）----------
//
// 简易"剪辑软件"界面：左侧素材库摆出全部已收集素材（视频素材图标 + 重要度 低/中/高
// 标签），玩家把自己认为有关联的素材拖到下方时间轴上、按顺序排好；每块素材落到
// 时间轴上会变成一段长方形，长度由该素材的重要度决定。顺序、内容都对上 review.timeline
// 才算复盘成功。editorTimeline 是纯前端的临时编辑状态，不写进存档——复盘没做完就关掉
// 窗口的话，下次打开会从空时间轴重新开始拖。

let editorTimeline = []; // 当前剪辑台时间轴上的线索 id，按摆放顺序排列

function openReviewList() {
  const dayContent = getDayContent();
  const available = reviewSys.getAvailable(state, dayContent ? dayContent.reviews : []);
  if (available.length === 0) {
    renderWindow('开始剪辑', `<p class="hint">今天的素材还凑不出一条能剪的时间轴，先去多拍点素材。</p><button class="btn btn-gray" id="btn-close-plain">关闭</button>`);
    openModal('review');
    document.getElementById('btn-close-plain').addEventListener('click', closeModal);
    return;
  }
  editorTimeline = [];
  renderEditor(available[0], null); // 框架阶段简化：直接打开第一个可用复盘
  openModal('review');
}

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

function renderEditor(review, result) {
  const done = !!(result && result.success);
  const libraryIds = state.collectedClues.filter(id => !editorTimeline.includes(id));

  const body = renderWindow('开始剪辑', `
    <div class="editor">
      <div class="editor-brief">
        <div class="event-text">${review.title}</div>
        <p class="hint">${review.prompt}</p>
      </div>

      <div class="editor-panel-label">素材库</div>
      <div class="clip-library" id="clip-library">
        ${libraryIds.length
          ? libraryIds.map(clipIconHTML).join('')
          : '<p class="hint">素材库空了，能用的素材都在时间轴上了。</p>'}
      </div>

      <div class="editor-panel-label">时间轴</div>
      <div class="timeline-track" id="timeline-track">
        ${editorTimeline.length
          ? editorTimeline.map(clipBlockHTML).join('')
          : '<div class="timeline-empty">把素材库里的素材拖到这里，按顺序摆好</div>'}
      </div>

      ${result ? `<div class="editor-feedback ${done ? 'feedback-ok' : 'feedback-bad'}">${result.text}</div>` : ''}

      <div class="editor-actions">
        <button class="btn btn-gray" id="btn-editor-close">${done ? '完成' : '关闭'}</button>
        ${done ? '' : `<button class="btn" id="btn-editor-submit" ${editorTimeline.length ? '' : 'disabled'}>完成剪辑</button>`}
      </div>
    </div>
  `);

  document.getElementById('btn-editor-close').addEventListener('click', closeModal);

  // 左键点开某段素材的内容简介，跟拖拽/锁定状态无关，随时都能看。
  body.querySelectorAll('.clip-icon, .clip-block').forEach(el => {
    el.addEventListener('click', () => showClipInfo(el.dataset.clue));
  });

  if (done) return; // 复盘已成功，锁定这个时间轴，不再允许拖拽/重新提交

  wireClipDragDrop(body, editorTimeline, () => renderEditor(review, null));

  const submitBtn = document.getElementById('btn-editor-submit');
  if (submitBtn) {
    submitBtn.addEventListener('click', () => {
      const res = reviewSys.submit(state, review, editorTimeline);
      if (res.effect) applyOutcomeEffects(res.effect, review.id);
      refreshAll();
      renderEditor(review, res);
    });
  }
}

/**
 * 素材库 + 时间轴的拖拽交互，"开始剪辑"复盘编辑器和加油站"剪辑"发布编辑器共用。
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
    const payload = e.dataTransfer.getData('text/plain');
    const dropIdx = getDropIndex(track, e.clientX);
    if (payload.startsWith('lib:')) {
      const clueId = payload.slice(4);
      if (!timeline.includes(clueId)) timeline.splice(dropIdx, 0, clueId);
    } else if (payload.startsWith('tl:')) {
      const fromIdx = Number(payload.slice(3));
      const [moved] = timeline.splice(fromIdx, 1);
      timeline.splice(fromIdx < dropIdx ? dropIdx - 1 : dropIdx, 0, moved);
    }
    rerender();
  });
}

// ---------- 加油站：剪辑发布编辑页 ----------
//
// "剪辑并发布"一步到位的按钮拆成两步：加油站里点"剪辑"打开一个跟"开始剪辑"
// 同款的编辑页（素材库 + 时间轴），今天的素材都先摆在素材库里，需要玩家手动
// 拖到时间轴上，只有在这个编辑页里点"确认发布"才真正结算播放量、写入
// publishLog——确认发布之后不需要玩家再操作，直接关掉编辑页、弹出旅馆的
// "进入下一天"窗口（见 openHotelNight），播放量结果走 toast 提示，不再单独占一屏反馈。

let publishEditorTimeline = []; // 加油站剪辑发布编辑页的时间轴，同样不写进存档

function openPublishEditor(dayContent) {
  publishEditorTimeline = []; // 素材都从素材库开始，需要玩家手动拖到时间轴上
  renderPublishEditor(dayContent);
  openModal('publishEdit');
}

function renderPublishEditor(dayContent) {
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

      <div class="editor-actions">
        <button class="btn btn-gray" id="btn-editor-close">关闭</button>
        <button class="btn" id="btn-confirm-publish" ${publishEditorTimeline.length ? '' : 'disabled'}>确认发布</button>
      </div>
    </div>
  `);

  document.getElementById('btn-editor-close').addEventListener('click', closeModal);

  body.querySelectorAll('.clip-icon, .clip-block').forEach(el => {
    el.addEventListener('click', () => showClipInfo(el.dataset.clue));
  });

  wireClipDragDrop(body, publishEditorTimeline, () => renderPublishEditor(dayContent));

  document.getElementById('btn-confirm-publish').addEventListener('click', () => {
    const result = publishSys.publish(state, publishEditorTimeline);
    refreshAll();
    closeModal();
    showToast(`🎬 发布成功，当晚播放量：${result.playcount}${result.glitched ? '（素材出了点问题，效果打了折扣）' : ''}`);
    openHotelNight();
  });
}

// ---------- 记事本（原"档案库"，按分类分 tab；旧的纯线索列表版记事本已合并进来）/ 主案追踪 ----------

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
  renderWindow('主案追踪', `
    <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
    <div class="hint">探索进度：${progress}%（主线相关记事本词条解锁占比）</div>
    <button class="btn btn-gray" id="btn-close-plain">关闭</button>
  `);
  openModal('tracker');
  document.getElementById('btn-close-plain').addEventListener('click', closeModal);
}

// ---------- 时间线：重新度过今日 / 回到上一天 ----------
//
// 依赖 state.js 的 dayCheckpoints：新开一局记第 1 天、每次 advanceDay() 都会记一次
// "当天开始时"的快照。这里只是把恢复动作接到 UI 上，不做业务判断。

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
  state = restored;
  pendingDayOver = false;     // 回退掉了触发这个标记的那部分进程，避免残留一次假的"超时"判定
  editorTimeline = [];        // 两个剪辑编辑页的临时拖拽状态本来就不写进存档，回退后一起清空更保险
  publishEditorTimeline = [];
  closeModal();
  refreshAll();
}

// ---------- 事件绑定 ----------

function wireStatusButtons() {
  document.getElementById('btn-notebook').addEventListener('click', () => openNotebook());
  document.getElementById('btn-tracker').addEventListener('click', openTracker);
  document.getElementById('btn-review').addEventListener('click', openReviewList);
  document.getElementById('btn-time-control').addEventListener('click', openTimeControl);
}

function wireMapControls() {
  document.getElementById('zoom-in').addEventListener('click', mapSys.zoomIn);
  document.getElementById('zoom-out').addEventListener('click', mapSys.zoomOut);
}

window.addEventListener('DOMContentLoaded', boot);
