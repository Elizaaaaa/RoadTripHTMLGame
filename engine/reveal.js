// reveal.js —— "逐字 / 逐句浮现"的文本包装器：只做字符串加工，不碰 DOM、不带定时器，
// 动画全部交给 ui.css 的 .rv-* 规则（靠每个 span 上的 --i 序号算 animation-delay）。
//
// 用在结局窗口和地震这类"要有分量"的文本上，普通事件正文照旧一次性整段显示——
// 到处都浮现一遍就不叫演出了。
//
// 中文没有空格分词，所以不照搬英文那套"逐词"：标题字数少，逐字上浮（rv-char）；
// 正文按句读点断句、逐句淡入（rv-clause）。正文那一层只动 opacity 不动 transform，
// 因为行内元素（inline）上的 transform 根本不生效，改成 inline-block 又会让整句
// 不能跨行折行——长句会直接撑出窗口。需要"整段往上浮"的话，把整块套一层 .rv-block，
// 位移做在块级元素上，行内只管淡入。

const CLAUSE_ENDS = '。！？…；!?';       // 在这些标点之后断句
const CLAUSE_TRAILERS = '”’」』)）"\'';  // 紧跟在句读点后面的收尾引号/括号，要跟着上一句走

/**
 * 把一段原始文本（还带着 [[显示文字|key]] 语法）按句读点切成若干句。
 * [[...]] 内部即使出现句号也不切——切开的话关键词语法会被拆坏。
 * @returns {string[]} 至少一项
 */
export function splitClauses(raw) {
  const text = String(raw || '');
  const out = [];
  let buf = '';
  let inLink = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    buf += ch;
    if (!inLink && ch === '[' && text[i + 1] === '[') inLink = true;
    else if (inLink && ch === ']' && text[i - 1] === ']') inLink = false;
    if (inLink) continue;
    if (CLAUSE_ENDS.includes(ch)) {
      // 把紧跟着的右引号/右括号并进这一句再断开
      while (i + 1 < text.length && CLAUSE_TRAILERS.includes(text[i + 1])) buf += text[++i];
      out.push(buf);
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf);
  return out.length ? out : [text];
}

/**
 * 逐句淡入：每句包一层 .rv-clause，序号写进 --i 供 CSS 算延迟。
 * @param {string} raw 原始文本（含 [[]] 语法）
 * @param {(s:string)=>string} parse 把一句原始文本转成 HTML，通常传 keyword-parser 的 parseKeywords
 * @param {number} [startIndex] 起始序号，用于接在标题后面继续排延迟
 */
export function clauses(raw, parse, startIndex = 0) {
  return splitClauses(raw)
    .map((s, i) => `<span class="rv-clause" style="--i:${startIndex + i}">${parse ? parse(s) : s}</span>`)
    .join('');
}

/**
 * 逐字上浮：适合结局标题这种短句。空格原样保留（不包 span，免得排版被拆散）。
 * @param {number} [startIndex] 起始序号
 */
export function chars(text, startIndex = 0) {
  let n = startIndex;
  return [...String(text || '')]
    .map(ch => (ch.trim() === '' ? ch : `<span class="rv-char" style="--i:${n++}">${ch}</span>`))
    .join('');
}

/** splitClauses 的句数，调用方用来算"正文播完之后"按钮该排在第几号延迟上。 */
export function clauseCount(raw) {
  return splitClauses(raw).length;
}
