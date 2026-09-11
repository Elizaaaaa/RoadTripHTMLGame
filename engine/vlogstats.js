// vlogstats.js —— 手机数据页：每天在剪辑台点"确认发布"之后弹出的互动数据面板，
// 观感上就是两人发完当天的 vlog、掏出手机刷了一下后台（竖屏手机外壳 + 暖色玻璃
// 拟态，跟 ui.css 那套仿 macOS 的灰调窗口刻意区分开，样式见 engine/phone.css）。
//
// 数据从哪来：
//   - 播放量由 engine/publish.js 结算，写进 state.publishLog（本模块不改这条规则）；
//   - 点赞/评论/新增关注/完播率/回看次数是从"播放量 + 当期素材重要度 + 理智档位"
//     派生出来的，用一个以 (天数 + 播放量 + 素材 id) 为种子的伪随机数生成，
//     所以同一期数据每次打开都完全一致，不会因为重开面板就变一个数；
//   - 算出来后缓存进 publishLog 那条记录的 stats 字段，读档之后回看也是同一份。
//
// 内容作者可选字段（content/days.json 里每天的数据）：
//   "vlogTitle":  "第一夜：没有人的加油站"          // 这期视频标题，不写兜底"第 N 天的素材"
//   "vlogComments": [                                // 这期视频下面的评论，不写就只显示当天的信号闪现
//     { "user": "夜观星象", "text": "……", "likes": 12, "alien": true }
//   ]
// alien: true 的评论会显示成灰色斜体的"未知来源"样式，用来呼应"置顶那条不是我们发的"。
// 频道名走 content/days.json 的 meta.channel = { name, handle }，不写兜底 QQ & BB。

import * as reviewSys from './review.js';

const IMPORTANCE_WEIGHT = { high: 1, mid: 0.6, low: 0.3 };
const DEFAULT_CHANNEL = { name: 'QQ & BB', handle: '@on_the_road' };

let overlay = null;      // #phone-overlay 容器
let onCloseCb = null;    // 关闭后要走的下一步（正常流程里是"回旅馆休息"）
let viewMode = 'today';  // 'today' | 'total'，顶部胶囊切换本期/累计
let favIndex = 0;        // 最热片段卡当前显示第几条素材（右侧按钮循环切换）
let ctx = null;          // 本次打开用到的全部数据，见 open()

// ---------- 确定性随机 ----------

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32：同一个种子永远产出同一串数，用来让派生数据"看着随机、实际固定"。 */
function makeRng(seed) {
  let a = seed;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 数据派生 ----------

/** 当期素材的平均重要度（0~1），决定点赞率/完播率这些"内容质量"相关的系数。 */
function qualityOf(clueIds) {
  if (!clueIds || clueIds.length === 0) return 0.3;
  const sum = clueIds.reduce((acc, id) => acc + (IMPORTANCE_WEIGHT[reviewSys.getMaterial(id).importance] ?? 0.6), 0);
  return sum / clueIds.length;
}

/**
 * 按播放量 + 素材质量 + 理智档位派生出一整套互动数据。
 * 理智濒崩（tier === 'breaking'）时观众更爱看猎奇内容：点赞/评论上浮但完播率下降，
 * 呼应 publish.js 里"濒崩播放量反而更高"的那条规则。
 */
function compute(entry) {
  const clues = entry.clues || [];
  const views = entry.playcount || 0;
  const rng = makeRng(hashSeed(`${entry.day}|${views}|${clues.join(',')}`));
  const q = qualityOf(clues);
  const breaking = entry.tier === 'breaking';

  let likeRate = 0.08 + q * 0.10 + rng() * 0.02;
  let commentRate = 0.12 + q * 0.06 + rng() * 0.04;
  let followRate = 0.02 + q * 0.02 + rng() * 0.01;
  let completion = 40 + q * 32 + rng() * 10;

  if (breaking) { likeRate *= 1.25; commentRate *= 1.6; followRate *= 1.2; completion -= 8; }
  if (entry.glitched) { likeRate *= 0.6; commentRate *= 0.8; completion -= 15; }

  const likes = Math.max(0, Math.round(views * likeRate));
  return {
    views,
    likes,
    comments: Math.max(0, Math.round(likes * commentRate * 2.2)),
    follows: Math.max(0, Math.round(views * followRate)),
    completion: Math.max(5, Math.min(96, Math.round(completion))),
    // 每条素材各自的"回看次数"，用来排最热片段；跟素材重要度正相关
    replays: clues.map(id => {
      const w = IMPORTANCE_WEIGHT[reviewSys.getMaterial(id).importance] ?? 0.6;
      return { id, count: Math.max(1, Math.round(views * (0.05 + w * 0.12) * (0.85 + rng() * 0.3))) };
    })
  };
}

/** 取某条发布记录的数据，没算过就算一次并缓存进这条记录（存档里也就跟着固定下来）。 */
export function ensureStats(entry) {
  if (!entry || entry.failed) return null;
  if (!entry.stats) entry.stats = compute(entry);
  return entry.stats;
}

/** 某天的发布记录（没发布过/当天是"更新失败"时返回 null）。 */
export function getEntry(state, day) {
  return state.publishLog.find(p => p.day === day && !p.failed) || null;
}

/** 到目前为止的累计数据，胶囊切到"累计"时显示。 */
function totals(state) {
  const acc = { views: 0, likes: 0, comments: 0, follows: 0, episodes: 0 };
  for (const e of state.publishLog) {
    if (e.failed) continue;
    const s = ensureStats(e);
    acc.views += s.views;
    acc.likes += s.likes;
    acc.comments += s.comments;
    acc.follows += s.follows;
    acc.episodes += 1;
  }
  return acc;
}

// ---------- 评论区 ----------

/**
 * 这期视频下面的评论：内容作者写在当天 vlogComments 里的 + 当天真的弹出过的信号闪现
 * （signalToday，形如"@夜观星象：……"，这里把 @用户名 和正文拆开单独显示）。
 */
function collectComments(state, dayContent) {
  const authored = (dayContent && dayContent.vlogComments) || [];
  const list = authored.map(c => ({
    user: c.user || '匿名用户',
    text: c.text || '',
    likes: typeof c.likes === 'number' ? c.likes : null,
    alien: !!c.alien
  }));

  for (const flare of state.signalToday || []) {
    const m = /^@([^：:]{1,20})[：:]\s*(.+)$/s.exec(flare.text || '');
    list.push({
      user: m ? m[1] : '匿名用户',
      text: m ? m[2] : (flare.text || ''),
      likes: null,
      alien: false
    });
  }
  return list;
}

// ---------- 图标（内联 SVG，避免再引外部图片） ----------

const ICONS = {
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  comment: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9.4L4 21.2V5a1 1 0 0 1 0-1z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.2v13.6L19 12z"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 20.6S3.6 15.3 3.6 9.8A4.4 4.4 0 0 1 12 7.7a4.4 4.4 0 0 1 8.4 2.1c0 5.5-8.4 10.8-8.4 10.8z"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4zm0 1.8c-4 0-7.2 2.2-7.2 5v1.4h14.4v-1.4c0-2.8-3.2-5-7.2-5z"/></svg>',
  film: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 4.5h18v15H3zM6 4.5v15M18 4.5v15M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 4l3 3-3 3M20 7H14.5L6 17H3M17 20l3-3-3-3M20 17h-5.5L12.6 14.4M3 7h3l1.6 2.1"/></svg>'
};

/** 月桂枝：一根弯茎 + 一排往外张的叶子，右侧那枝在 CSS 里用 scaleX(-1) 镜像。 */
const LAUREL = `
  <svg class="phone-laurel phone-laurel-left" viewBox="0 0 44 74" aria-hidden="true">
    <path d="M37 71C29 61 21 49 19 34 17.5 22 20 11 25 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.85"/>
    <g fill="currentColor">
      <ellipse cx="27" cy="63" rx="9" ry="3.4" transform="rotate(-52 27 63)"/>
      <ellipse cx="21" cy="54" rx="9" ry="3.4" transform="rotate(-44 21 54)"/>
      <ellipse cx="16" cy="44" rx="9" ry="3.4" transform="rotate(-32 16 44)"/>
      <ellipse cx="13" cy="33" rx="9" ry="3.4" transform="rotate(-18 13 33)"/>
      <ellipse cx="13" cy="22" rx="8.5" ry="3.2" transform="rotate(-4 13 22)"/>
      <ellipse cx="16" cy="12" rx="8" ry="3" transform="rotate(12 16 12)"/>
      <ellipse cx="21" cy="4" rx="7" ry="2.8" transform="rotate(28 21 4)"/>
    </g>
  </svg>`;

// ---------- 渲染 ----------

function escapeHTML(str) {
  return String(str).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function formatNum(n) {
  return n >= 10000 ? `${(n / 10000).toFixed(1)}w` : String(n);
}

function statCardHTML(icon, num, label) {
  return `
    <div class="phone-card phone-stat">
      <div class="phone-stat-icon">${ICONS[icon]}</div>
      <div class="phone-stat-num" data-count="${num}">0</div>
      <div class="phone-stat-label">${label}</div>
    </div>`;
}

function statsGridHTML() {
  const { stats, total } = ctx;
  return viewMode === 'today'
    ? statCardHTML('play', stats.views, '播放')
      + statCardHTML('heart', stats.likes, '点赞')
      + statCardHTML('comment', stats.comments, '评论')
    : statCardHTML('play', total.views, '累计播放')
      + statCardHTML('heart', total.likes, '累计点赞')
      + statCardHTML('user', total.follows, '关注者');
}

function favoriteHTML() {
  const ranked = ctx.ranked;
  if (ranked.length === 0) {
    return `
      <div class="phone-card phone-favorite">
        <div class="phone-thumb">${ICONS.film}</div>
        <div class="phone-fav-text">
          <div class="phone-fav-kicker">最热片段</div>
          <div class="phone-fav-title">没有素材</div>
          <div class="phone-fav-sub">这期什么都没剪进去</div>
        </div>
      </div>`;
  }
  const item = ranked[favIndex % ranked.length];
  const mat = reviewSys.getMaterial(item.id);
  return `
    <div class="phone-card phone-favorite">
      <div class="phone-thumb">${ICONS.film}</div>
      <div class="phone-fav-text">
        <div class="phone-fav-kicker">${favIndex % ranked.length === 0 ? '最热片段' : `第 ${(favIndex % ranked.length) + 1} 热片段`}</div>
        <div class="phone-fav-title">${escapeHTML(mat.label)}</div>
        <div class="phone-fav-sub">被反复回看 ${formatNum(item.count)} 次</div>
      </div>
      ${ranked.length > 1 ? `<button class="glass phone-fav-btn" id="phone-fav-next" title="换一条">${ICONS.shuffle}</button>` : ''}
    </div>`;
}

function commentsHTML() {
  // 标题右边是派生出来的评论总数，下面只列内容里写到的那几条（观感上就是"只显示热评"）
  if (ctx.comments.length === 0) {
    return `<div class="phone-card phone-block" id="phone-comments">
      <div class="phone-block-title"><span>评论区</span><span class="phone-block-value">${formatNum(ctx.stats.comments)}</span></div>
      <div class="phone-subrow"><span>还没人在这期底下留言。</span></div>
    </div>`;
  }
  return `
    <div class="phone-card phone-block" id="phone-comments">
      <div class="phone-block-title"><span>评论区 · 热评</span><span class="phone-block-value">${formatNum(ctx.stats.comments)}</span></div>
      <div style="margin-top:6px;">
        ${ctx.comments.map(c => `
          <div class="phone-comment${c.alien ? ' phone-comment-alien' : ''}">
            <div class="phone-avatar">${escapeHTML((c.user || '?').slice(0, 1))}</div>
            <div class="phone-comment-body">
              <div class="phone-comment-user">@${escapeHTML(c.user)}</div>
              <div class="phone-comment-text">${escapeHTML(c.text)}</div>
            </div>
            ${c.likes != null ? `<div class="phone-comment-likes">♥ ${formatNum(c.likes)}</div>` : ''}
          </div>`).join('')}
      </div>
    </div>`;
}

function screenHTML() {
  const { stats, total, channel, title, cover, day, glitch } = ctx;
  return `
    <div class="phone-frame">
      <div class="phone-screen" id="phone-screen">
        <div class="phone-hero">
          <img class="phone-hero-img" src="${escapeHTML(cover)}" alt="">
          <div class="phone-hero-glow"></div>
          <div class="phone-hero-fade"></div>
          <div class="phone-topbar">
            <button class="glass circle" id="phone-btn-comments" title="看评论">${ICONS.comment}</button>
            <button class="glass circle" id="phone-btn-close" title="收起手机">${ICONS.close}</button>
          </div>
          <div class="phone-hero-meta">第 ${day} 天 · 刚刚发布</div>
        </div>

        <div class="phone-identity">
          ${LAUREL}${LAUREL.replace('phone-laurel-left', 'phone-laurel-right')}
          <div class="phone-name">${escapeHTML(channel.name)}</div>
          <div class="phone-subtitle">${escapeHTML(title)}</div>
        </div>

        <div class="phone-toggle-row">
          <button class="glass pill phone-toggle" id="phone-toggle">
            <span class="phone-trophy">🏆</span>
            <span id="phone-toggle-label">${viewMode === 'today' ? `${total.episodes} 期 · 本期数据` : `${total.episodes} 期 · 累计数据`}</span>
          </button>
        </div>

        <div class="phone-stats" id="phone-stats">${statsGridHTML()}</div>

        <div id="phone-fav-slot">${favoriteHTML()}</div>

        ${glitch ? `<div class="phone-warning">${escapeHTML(glitch)}</div>` : ''}

        <div class="phone-card phone-block">
          <div class="phone-block-title"><span>完播率</span><span class="phone-block-value" id="phone-completion">${stats.completion}%</span></div>
          <div class="phone-bar"><div class="phone-bar-fill" id="phone-bar"></div></div>
          <div class="phone-subrow"><span>本期新增关注</span><strong>+${formatNum(stats.follows)}</strong></div>
          <div class="phone-subrow"><span>关注者总数</span><strong>${formatNum(total.follows)}</strong></div>
        </div>

        ${commentsHTML()}

        <div class="phone-actions">
          <button class="glass pill" id="phone-btn-done">收起手机，回房休息</button>
        </div>
      </div>
    </div>`;
}

/** 数字滚上去的入场动画；开了"减少动态效果"就直接显示终值。 */
function countUp(el, target) {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || target <= 0) { el.textContent = formatNum(target); return; }
  const durationMs = 900;
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / durationMs);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = formatNum(Math.round(target * eased));
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function playNumbers(delayMs) {
  overlay.querySelectorAll('.phone-stat-num').forEach(el => {
    const target = Number(el.dataset.count) || 0;
    el.textContent = '0';
    setTimeout(() => countUp(el, target), delayMs);
  });
}

/** 手机是固定的 390x844 竖屏，游戏本体是横屏，所以按当前窗口算一个缩放塞进去。 */
function fitToViewport() {
  if (!overlay) return;
  const scale = Math.max(0.42, Math.min(0.92, (window.innerHeight - 36) / 844, (window.innerWidth - 36) / 390));
  overlay.style.setProperty('--phone-scale', scale.toFixed(3));
}

function wire() {
  document.getElementById('phone-btn-close').addEventListener('click', close);
  document.getElementById('phone-btn-done').addEventListener('click', close);

  document.getElementById('phone-btn-comments').addEventListener('click', () => {
    const target = document.getElementById('phone-comments');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  document.getElementById('phone-toggle').addEventListener('click', () => {
    viewMode = viewMode === 'today' ? 'total' : 'today';
    document.getElementById('phone-toggle-label').textContent =
      `${ctx.total.episodes} 期 · ${viewMode === 'today' ? '本期数据' : '累计数据'}`;
    const grid = document.getElementById('phone-stats');
    grid.innerHTML = statsGridHTML();
    playNumbers(0);
  });

  wireFav();
}

/** 最热片段卡每次重渲染都要重新挂一次按钮（卡片整块被替换掉了）。 */
function wireFav() {
  const btn = document.getElementById('phone-fav-next');
  if (btn) {
    btn.addEventListener('click', () => {
      favIndex += 1;
      document.getElementById('phone-fav-slot').innerHTML = favoriteHTML();
      wireFav();
    });
  }
}

/**
 * 弹出手机数据页。
 * @param {object} opts
 *   state       —— 全局状态（读 publishLog / signalToday）
 *   dayContent  —— 当天内容数据（读可选的 vlogTitle / vlogComments）
 *   day         —— 要看哪一天的数据，默认 state.day
 *   channel     —— { name, handle }，一般来自 content.days.meta.channel
 *   cover       —— 封面图路径，一般传地图底图（assets/maps/hotspots.json 的 mapImage）
 *   onClose     —— 关掉手机之后走的下一步（正常流程里是"回旅馆休息"）
 * @returns {boolean} 当天没有发布记录时返回 false（调用方应直接走 onClose 那一步）
 */
export function open(opts) {
  const state = opts.state;
  const day = opts.day || state.day;
  const entry = getEntry(state, day);
  if (!entry) return false;

  const stats = ensureStats(entry);
  const dayContent = opts.dayContent || {};

  ctx = {
    day,
    stats,
    total: totals(state),
    channel: { ...DEFAULT_CHANNEL, ...(opts.channel || {}) },
    title: dayContent.vlogTitle || `第 ${day} 天的素材`,
    cover: opts.cover || 'assets/maps/white-lake-map-now.png',
    comments: collectComments(state, dayContent),
    ranked: [...stats.replays].sort((a, b) => b.count - a.count),
    glitch: entry.glitched
      ? '这期素材出了点问题，有几段画面糊掉了——数据比平时难看。'
      : (entry.tier === 'breaking' ? '后台在这期视频上标了"猎奇"标签。数据好得有点反常。' : '')
  };
  viewMode = 'today';
  favIndex = 0;

  overlay = document.getElementById('phone-overlay');
  overlay.classList.toggle('phone-glitch', !!ctx.glitch);
  overlay.innerHTML = screenHTML();
  overlay.classList.remove('hidden');

  fitToViewport();
  window.addEventListener('resize', fitToViewport);

  wire();
  playNumbers(740); // 跟数据卡片的入场动画（0.74s 起）对齐，卡片浮上来时数字正好开始滚
  requestAnimationFrame(() => {
    const bar = document.getElementById('phone-bar');
    if (bar) bar.style.width = `${stats.completion}%`;
  });

  onCloseCb = opts.onClose || null;
  return true;
}

export function close() {
  if (!overlay) return;
  window.removeEventListener('resize', fitToViewport);
  overlay.classList.add('hidden');
  overlay.innerHTML = '';
  overlay.classList.remove('phone-glitch');
  overlay = null;
  ctx = null;
  const cb = onCloseCb;
  onCloseCb = null;
  if (cb) cb();
}
