// 형광펜(하이라이트) — DOM 오버레이 방식.
// 사용자가 친 형광펜은 렌더된 답변 DOM에서 <code class="user-hl">로 직접 감싼다.
// 모델이 쓴 코드(<code>·<pre>)와는 클래스로 구분 → 모델 코드는 클릭/전체해제에 불변.
// 마크는 "렌더 텍스트 기준 offset 범위"로 탭에 저장 → 재렌더·세션 복원 시 다시 입힌다.
// 복사·Notion 저장은 이 DOM을 markdown으로 직렬화(domToMarkdown)해서 형광펜을 백틱으로 내보낸다.
// (자매 프로젝트 260613 Chrome Annotation의 toggleMarkSelection/serializeInline 방식을 이식·적응.)

export interface MarkRange {
  start: number;
  end: number;
}

const HL_CLASS = 'user-hl';

// (root,0) ~ (container,offset) 사이 렌더 텍스트 길이 = 선형 offset.
// 코드/블록 안 텍스트도 모두 포함(applyMarksToDom의 누적과 동일 좌표계).
function offsetOf(root: Node, container: Node, offset: number): number {
  const r = document.createRange();
  r.setStart(root, 0);
  r.setEnd(container, offset);
  return r.toString().length;
}

// 현재 선택을 root 기준 offset 범위로. 선택이 비었거나 root 밖이면 null.
export function rangeFromSelection(root: HTMLElement, sel: Selection | null): MarkRange | null {
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const dr = sel.getRangeAt(0);
  if (!root.contains(dr.commonAncestorContainer)) return null;
  let start = offsetOf(root, dr.startContainer, dr.startOffset);
  let end = offsetOf(root, dr.endContainer, dr.endOffset);
  if (start > end) [start, end] = [end, start];
  if (start === end) return null;
  return { start, end };
}

// 겹치거나 맞닿은 범위 병합(정렬).
export function mergeRanges(ranges: MarkRange[]): MarkRange[] {
  const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const out: MarkRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ start: r.start, end: r.end });
  }
  return out;
}

// 토글: 선택이 기존 마크 안에 완전히 들면 그 마크 제거, 아니면 추가(+병합).
export function toggleRange(marks: MarkRange[], sel: MarkRange): MarkRange[] {
  const covering = marks.find((m) => m.start <= sel.start && sel.end <= m.end);
  if (covering) return marks.filter((m) => m !== covering);
  return mergeRanges([...marks, sel]);
}

// 클릭한 user-hl 코드가 속한 마크를 제거. 어떤 마크에도 안 걸리면 그대로(모델 코드 클릭=무시).
export function removeRangeAt(root: HTMLElement, marks: MarkRange[], el: HTMLElement): MarkRange[] {
  const off = offsetOf(root, el, 0);
  return marks.filter((m) => !(m.start <= off && off < m.end));
}

// 텍스트 노드가 <code>/<pre> 안인지 — 모델 인라인코드·코드블록은 형광펜 대상에서 제외.
function inCode(node: Node, root: HTMLElement): boolean {
  let el = node.parentElement;
  while (el && el !== root) {
    if (el.tagName === 'CODE' || el.tagName === 'PRE') return true;
    el = el.parentElement;
  }
  return false;
}

// 저장된 마크 범위를 렌더된 DOM에 입힌다(코드 밖 부분만 <code class=user-hl>로 감쌈).
export function applyMarksToDom(root: HTMLElement, marks: MarkRange[]): void {
  const merged = mergeRanges(marks);
  if (!merged.length) return;

  // 모든 텍스트 노드와 그 전역 시작 offset 수집(코드 안 텍스트도 offset 누적에는 포함).
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number; skip: boolean }[] = [];
  let total = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n as Text;
    nodes.push({ node: t, start: total, skip: inCode(t, root) });
    total += t.nodeValue?.length ?? 0;
  }

  // 수집을 끝낸 뒤 변형(DOM을 바꿔도 이미 잡아둔 node·start는 유효).
  for (const { node, start, skip } of nodes) {
    if (skip) continue;
    const text = node.nodeValue ?? '';
    const nodeEnd = start + text.length;

    // 이 노드와 겹치는 마크 구간(로컬 offset)들.
    const locals: { a: number; b: number }[] = [];
    for (const m of merged) {
      const a = Math.max(m.start, start) - start;
      const b = Math.min(m.end, nodeEnd) - start;
      if (b > a) locals.push({ a, b });
    }
    if (!locals.length) continue;

    // 노드를 [text / <code> / text …] 조각으로 교체.
    const frag = document.createDocumentFragment();
    let cur = 0;
    for (const { a, b } of locals) {
      if (a > cur) frag.appendChild(document.createTextNode(text.slice(cur, a)));
      const code = document.createElement('code');
      code.className = HL_CLASS;
      code.textContent = text.slice(a, b);
      frag.appendChild(code);
      cur = b;
    }
    if (cur < text.length) frag.appendChild(document.createTextNode(text.slice(cur)));
    node.replaceWith(frag);
  }
}

// ----- DOM → markdown 직렬화 (복사·Notion 저장 공용) -----

// 인라인: 텍스트 + `code`(모델·형광펜 공통) + **bold** / *italic*.
// 강조 안에 코드가 있으면(형광펜이 볼드 글자에 걸친 경우) **코드 우선** — Notion 파서가
// **`x`** 를 리터럴 백틱으로 처리해서 깨지는 걸 피하려고 강조 마커는 떨군다.
function inlineOf(el: Node): string {
  let s = '';
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      s += n.nodeValue ?? '';
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const e = n as HTMLElement;
    if (e.tagName === 'CODE') {
      s += '`' + (e.textContent ?? '') + '`';
    } else if (e.tagName === 'STRONG') {
      const inner = inlineOf(e);
      s += inner.includes('`') ? inner : '**' + inner + '**';
    } else if (e.tagName === 'EM') {
      const inner = inlineOf(e);
      s += inner.includes('`') ? inner : '*' + inner + '*';
    } else {
      s += inlineOf(e);
    }
  });
  return s;
}

function tableToMarkdown(table: HTMLElement): string {
  const head = Array.from(table.querySelectorAll('thead th')).map((th) => inlineOf(th));
  const rows = Array.from(table.querySelectorAll('tbody tr')).map((tr) =>
    Array.from(tr.children).map((td) => inlineOf(td)),
  );
  const w = head.length || (rows[0]?.length ?? 0);
  if (!w) return '';
  const line = (cells: string[]): string =>
    '| ' + Array.from({ length: w }, (_, i) => (cells[i] ?? '').replace(/\|/g, '\\|')).join(' | ') + ' |';
  const out = [line(head), '| ' + Array.from({ length: w }, () => '---').join(' | ') + ' |'];
  for (const r of rows) out.push(line(r));
  return out.join('\n');
}

function blockToMarkdown(node: Node): string | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = (node.nodeValue ?? '').trim();
    return t || null;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as HTMLElement;
  switch (el.tagName) {
    case 'P':
      return inlineOf(el);
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      const lvl = Number(el.dataset.level) || Number(el.tagName[1]) || 1;
      return '#'.repeat(Math.min(6, lvl)) + ' ' + inlineOf(el);
    }
    case 'UL':
    case 'OL': {
      const ordered = el.tagName === 'OL';
      const items = Array.from(el.children).filter((c) => c.tagName === 'LI');
      return items.map((li, i) => (ordered ? `${i + 1}. ` : '- ') + inlineOf(li)).join('\n');
    }
    case 'PRE': {
      const code = el.querySelector('code');
      const lang = el.dataset.lang ?? '';
      const text = (code ? code.textContent : el.textContent) ?? '';
      return '```' + lang + '\n' + text + '\n```';
    }
    case 'HR':
      return '---';
    case 'TABLE':
      return tableToMarkdown(el);
    default:
      return inlineOf(el);
  }
}

// 렌더된 답변 컨테이너를 markdown으로 직렬화(형광펜·모델 코드 모두 백틱으로).
export function domToMarkdown(root: HTMLElement): string {
  const parts: string[] = [];
  for (const child of Array.from(root.childNodes)) {
    const md = blockToMarkdown(child);
    if (md != null && md !== '') parts.push(md);
  }
  return parts.join('\n\n');
}
