// keyword-parser.js —— 解析 [[显示文字|档案库key]] 语法，渲染成可点击 span。
// 对应 design-doc.md 第 4.2 节。不依赖具体档案库实现，解锁状态通过回调传入，
// 方便档案库正文自身也能复用同一个 parser（词条互跳，见 4.3 节）。

const KEYWORD_RE = /\[\[([^\|\]]+)\|([^\]]+)\]\]/g;

/**
 * @param {string} text 原始正文，可能包含 [[显示文字|key]]
 * @param {(key:string)=>boolean} isUnlockedFn 判断某个档案库 key 是否已解锁
 * @returns {string} 处理后的 HTML 字符串
 */
export function parseKeywords(text, isUnlockedFn) {
  return text.replace(KEYWORD_RE, (_, display, key) => {
    const unlocked = isUnlockedFn(key);
    const cls = unlocked ? 'kw kw-unlocked' : 'kw kw-locked';
    return `<span class="${cls}" data-kw="${key}">${display}</span>`;
  });
}

/**
 * 给容器绑定一次事件委托，点击任意 [data-kw] 都会回调 onClick(key, spanEl)。
 * 可以重复调用同一个容器不会重复绑定（用 dataset 标记）。
 */
export function attachKeywordHandlers(containerEl, onClick) {
  if (containerEl.dataset.kwBound === '1') return;
  containerEl.dataset.kwBound = '1';
  containerEl.addEventListener('click', (e) => {
    const el = e.target.closest('[data-kw]');
    if (!el) return;
    onClick(el.getAttribute('data-kw'), el);
  });
}
