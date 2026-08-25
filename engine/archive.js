// archive.js —— 档案库：词条解锁、分类、跨天主案件进度。
// 对应 design-doc.md 第 4.3 节 + 5.3 节的 progress 计算。
// 数据本身来自 content/archive.json，本模块只认字段结构，不关心具体文案。

import { parseKeywords } from './keyword-parser.js';

let archiveData = {}; // { key: { title, category, body, unlockedBy, linkedMainCase } }

export function init(data) {
  archiveData = data;
}

export function getEntry(key) {
  return archiveData[key] || null;
}

export function isUnlocked(state, key) {
  return state.archives.unlocked.includes(key);
}

/**
 * 解锁一个词条。source 只用于记录/调试（比如 'keyword_click' 或 'event:e4'），
 * 不影响解锁结果——unlockedBy 字段目前是内容作者给自己看的文档说明，
 * 引擎侧任何途径触发 unlock() 都视为有效解锁，不做来源校验。
 * @returns {boolean} 是否是"新"解锁（用于触发 4.4 节的轻量正反馈）
 */
export function unlock(state, key, source = 'unknown') {
  if (!archiveData[key]) {
    console.warn(`[archive] 未知词条 key: ${key}`);
    return false;
  }
  if (state.archives.unlocked.includes(key)) return false;
  state.archives.unlocked.push(key);
  state.archives.newSinceLastView.push(key);
  console.debug(`[archive] 解锁 ${key}（来源: ${source}）`);
  return true;
}

export function markViewed(state, key) {
  state.archives.newSinceLastView = state.archives.newSinceLastView.filter(k => k !== key);
}

/** 记事本整体是否有未读内容（随便哪个分类），用来决定要不要在记事本按钮上点小红点。 */
export function hasUnread(state) {
  return state.archives.newSinceLastView.length > 0;
}

/** 有未读词条的分类集合，用来决定记事本里哪些 tab 按钮要点小红点。 */
export function categoriesWithUnread(state) {
  const result = new Set();
  for (const key of state.archives.newSinceLastView) {
    const entry = archiveData[key];
    if (entry && entry.category) result.add(entry.category);
  }
  return result;
}

/** 探索进度：linkedMainCase 词条里已解锁的占比，0-100 整数。见 5.3 节。 */
export function computeProgress(state) {
  const mainlineKeys = Object.keys(archiveData).filter(k => archiveData[k].linkedMainCase);
  if (mainlineKeys.length === 0) return 0;
  const unlockedCount = mainlineKeys.filter(k => state.archives.unlocked.includes(k)).length;
  return Math.round((unlockedCount / mainlineKeys.length) * 100);
}

/** 所有出现过的分类，按数据里首次出现的顺序返回（不受解锁状态影响，用来渲染稳定的 tab 列表）。 */
export function allCategories() {
  const seen = new Set();
  for (const entry of Object.values(archiveData)) {
    if (entry && entry.category) seen.add(entry.category); // 跳过 _comment 这类没有 category 字段的元数据键
  }
  return Array.from(seen);
}

export function listByCategory(state) {
  const byCategory = {};
  for (const [key, entry] of Object.entries(archiveData)) {
    if (!state.archives.unlocked.includes(key)) continue;
    (byCategory[entry.category] ||= []).push({ key, ...entry });
  }
  return byCategory;
}

/** 渲染某个词条的正文 HTML（内部 [[]] 语法一并解析，实现词条互跳）。 */
export function renderEntryHTML(key, state) {
  const entry = getEntry(key);
  if (!entry) return null;
  return {
    title: entry.title,
    category: entry.category,
    bodyHTML: parseKeywords(entry.body, (k) => isUnlocked(state, k))
  };
}
