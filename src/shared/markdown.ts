// 최소 markdown → DOM 렌더러. 신뢰할 수 없는 LLM 출력이라 innerHTML 미사용 — 모든 텍스트를
// textContent로만 넣고 element를 직접 생성해 HTML 주입을 원천 차단(sanitizer 불필요).
// 지원 문법: 헤딩(#~######), GFM 표, 순서/비순서 목록, 코드펜스, 가로줄, 인라인(`code`/**bold**/*italic*).
// (듀얼자막 content/explain/markdown.ts의 renderMarkdown 부분만 이식. 복사는 모델 원본 markdown을
//  그대로 쓰므로 domToMarkdown 역직렬화는 v1에서 생략.)

export function renderMarkdown(md: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;

  let para: string[] = [];
  const flushPara = (): void => {
    if (para.length === 0) return;
    const p = document.createElement('p');
    appendInline(p, para.join(' '));
    frag.appendChild(p);
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      flushPara();
      i++;
      continue;
    }

    // 가로줄(---/***/___) → <hr>. 표 구분줄(|---|)은 파이프가 있어 안 걸림.
    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      flushPara();
      frag.appendChild(document.createElement('hr'));
      i++;
      continue;
    }

    // 코드 펜스 ```lang ... ```
    const fence = trimmed.match(/^```(\w*)\s*$/);
    if (fence) {
      flushPara();
      i++;
      const code: string[] = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        code.push(lines[i]);
        i++;
      }
      i++; // 닫는 펜스 소비
      const pre = document.createElement('pre');
      pre.dataset.lang = fence[1] || ''; // 직렬화 시 코드 언어 복원용
      const codeEl = document.createElement('code');
      codeEl.textContent = code.join('\n');
      pre.appendChild(codeEl);
      frag.appendChild(pre);
      continue;
    }

    // 헤딩
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara();
      const level = Math.min(6, heading[1].length);
      const h = document.createElement(`h${Math.min(6, level + 2)}`); // h1→h3 … 팝업 안 과대 방지
      h.dataset.level = String(level); // 복사·Notion 직렬화 시 원 헤딩 레벨 복원용
      appendInline(h, heading[2].trim());
      frag.appendChild(h);
      i++;
      continue;
    }

    // GFM 표
    if (isTableRow(line) && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      flushPara();
      const header = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      frag.appendChild(buildTable(header, rows));
      continue;
    }

    // 목록
    if (isListItem(trimmed)) {
      flushPara();
      const ordered = /^\d+[.)]\s/.test(trimmed);
      const list = document.createElement(ordered ? 'ol' : 'ul');
      while (i < lines.length && isListItem(lines[i].trim())) {
        const li = document.createElement('li');
        appendInline(li, lines[i].trim().replace(/^(?:[-*+]|\d+[.)])\s+/, ''));
        list.appendChild(li);
        i++;
      }
      frag.appendChild(list);
      continue;
    }

    para.push(trimmed);
    i++;
  }
  flushPara();
  return frag;
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.includes('|') && t.replace(/[^|]/g, '').length >= 1 && !/^\|?\s*$/.test(t);
}

function isTableDivider(line: string): boolean {
  const t = line.trim();
  return /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$/.test(t) && t.includes('-');
}

function splitTableRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

function buildTable(header: string[], rows: string[][]): HTMLTableElement {
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  for (const cell of header) {
    const th = document.createElement('th');
    appendInline(th, cell);
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (let c = 0; c < header.length; c++) {
      const td = document.createElement('td');
      appendInline(td, row[c] ?? '');
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function isListItem(trimmed: string): boolean {
  return /^([-*+]\s+|\d+[.)]\s+)/.test(trimmed);
}

// 인라인 토큰: `code`, **bold**, *italic*. element + textContent로만 구성 — HTML 주입 불가.
const INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;

function appendInline(parent: HTMLElement, text: string): void {
  const parts = text.split(INLINE_RE);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      const code = document.createElement('code');
      code.textContent = part.slice(1, -1);
      parent.appendChild(code);
    } else if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      const strong = document.createElement('strong');
      strong.textContent = part.slice(2, -2);
      parent.appendChild(strong);
    } else if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      const em = document.createElement('em');
      em.textContent = part.slice(1, -1);
      parent.appendChild(em);
    } else {
      parent.appendChild(document.createTextNode(part));
    }
  }
}
