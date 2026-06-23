// AI 사전 답변을 사용자의 Notion 데이터베이스에 페이지로 저장.
// 팝업/옵션은 확장 origin 페이지라 host_permissions(api.notion.com)가 있으면 직접 fetch 가능(CORS 면제) → SW 불필요.
// markdownToBlocks는 markdown.ts의 줄 스캔 구조를 본떠 모델 답변 markdown을 Notion 블록 객체로 변환한다.

import { getNotionToken } from '../shared/secrets';
import { loadSettings } from '../shared/settings';

const TAG = '[AID/notion]';
const NOTION_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28'; // 필수 헤더.

// Notion 제약: rich_text 1개 content 최대 2000자, 블록 children 최대 100개.
const MAX_TEXT_LEN = 2000;
const MAX_CHILDREN = 100;

// --- rich text -------------------------------------------------------------

interface Annotations {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}
interface RichText {
  type: 'text';
  text: { content: string };
  annotations?: Annotations;
}

// markdown.ts의 INLINE_RE와 동일 — `code`, **bold**, *italic*.
const INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;

// 2000자 초과 content를 여러 RichText로 분할(Notion 한도 회피).
function pushText(out: RichText[], content: string, annotations?: Annotations): void {
  if (!content) return;
  for (let i = 0; i < content.length; i += MAX_TEXT_LEN) {
    const slice = content.slice(i, i + MAX_TEXT_LEN);
    out.push(annotations ? { type: 'text', text: { content: slice }, annotations } : { type: 'text', text: { content: slice } });
  }
}

function inlineToRichText(text: string): RichText[] {
  const out: RichText[] = [];
  for (const part of text.split(INLINE_RE)) {
    if (!part) continue;
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      pushText(out, part.slice(1, -1), { code: true });
    } else if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      pushText(out, part.slice(2, -2), { bold: true });
    } else if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      pushText(out, part.slice(1, -1), { italic: true });
    } else {
      pushText(out, part);
    }
  }
  // Notion은 빈 rich_text 배열도 허용하지만, 최소 1개를 보장해 형태 일관.
  return out.length ? out : [{ type: 'text', text: { content: '' } }];
}

// --- markdown → blocks -----------------------------------------------------

type NotionBlock = Record<string, unknown>;

// Notion code 블록이 받는 언어만 통과, 나머지는 'plain text'로.
const NOTION_CODE_LANGS = new Set([
  'bash', 'c', 'c++', 'c#', 'css', 'go', 'html', 'java', 'javascript', 'json',
  'kotlin', 'markdown', 'python', 'ruby', 'rust', 'shell', 'sql', 'swift',
  'typescript', 'yaml', 'plain text',
]);
function normalizeLang(lang: string): string {
  const l = lang.toLowerCase();
  if (l === 'js') return 'javascript';
  if (l === 'ts') return 'typescript';
  if (l === 'py') return 'python';
  if (l === 'sh') return 'shell';
  return NOTION_CODE_LANGS.has(l) ? l : 'plain text';
}

function heading(level: number, text: string): NotionBlock {
  const type = level <= 1 ? 'heading_1' : level === 2 ? 'heading_2' : 'heading_3';
  return { object: 'block', type, [type]: { rich_text: inlineToRichText(text) } };
}
function paragraph(text: string): NotionBlock {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: inlineToRichText(text) } };
}
function listItem(ordered: boolean, text: string): NotionBlock {
  const type = ordered ? 'numbered_list_item' : 'bulleted_list_item';
  return { object: 'block', type, [type]: { rich_text: inlineToRichText(text) } };
}
function codeBlock(lang: string, code: string): NotionBlock {
  return {
    object: 'block',
    type: 'code',
    code: { language: normalizeLang(lang), rich_text: [{ type: 'text', text: { content: code.slice(0, MAX_TEXT_LEN * 10) } }] },
  };
}
function divider(): NotionBlock {
  return { object: 'block', type: 'divider', divider: {} };
}
function tableBlock(header: string[], rows: string[][]): NotionBlock {
  const width = header.length;
  const toRow = (cells: string[]): NotionBlock => ({
    object: 'block',
    type: 'table_row',
    table_row: { cells: Array.from({ length: width }, (_, c) => inlineToRichText(cells[c] ?? '')) },
  });
  return {
    object: 'block',
    type: 'table',
    table: {
      table_width: width,
      has_column_header: true,
      has_row_header: false,
      children: [toRow(header), ...rows.map(toRow)],
    },
  };
}

// markdown.ts의 표 판별 헬퍼(이식): 렌더러와 동일 규칙으로 표를 인식.
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
function isListItem(trimmed: string): boolean {
  return /^([-*+]\s+|\d+[.)]\s+)/.test(trimmed);
}

export function markdownToBlocks(md: string): NotionBlock[] {
  const blocks: NotionBlock[] = [];
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  let para: string[] = [];
  const flushPara = (): void => {
    if (para.length === 0) return;
    blocks.push(paragraph(para.join(' ')));
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
    // 가로줄 (표 구분줄은 파이프가 있어 안 걸림).
    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      flushPara();
      blocks.push(divider());
      i++;
      continue;
    }
    // 코드 펜스
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
      blocks.push(codeBlock(fence[1], code.join('\n')));
      continue;
    }
    // 헤딩
    const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      blocks.push(heading(h[1].length, h[2].trim()));
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
      blocks.push(tableBlock(header, rows));
      continue;
    }
    // 목록
    if (isListItem(trimmed)) {
      flushPara();
      while (i < lines.length && isListItem(lines[i].trim())) {
        const t = lines[i].trim();
        const ordered = /^\d+[.)]\s/.test(t);
        blocks.push(listItem(ordered, t.replace(/^(?:[-*+]|\d+[.)])\s+/, '')));
        i++;
      }
      continue;
    }

    para.push(trimmed);
    i++;
  }
  flushPara();
  return blocks;
}

// --- API -------------------------------------------------------------------

function headers(token: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
  };
}

function httpError(status: number, body: string): Error {
  if (status === 401) return new Error('Notion 토큰 인증 실패 (HTTP 401) — 옵션에서 토큰 확인');
  if (status === 404) {
    return new Error('Notion DB를 찾을 수 없음 (HTTP 404) — DB ID 확인 + 해당 DB를 integration에 "연결"했는지 확인');
  }
  if (status === 429) return new Error('Notion 한도 초과 (HTTP 429) — 잠시 후 다시');
  const detail = body.length > 200 ? body.slice(0, 200) + '…' : body;
  return new Error(`Notion 오류 (HTTP ${status})${detail ? `: ${detail}` : ''}`);
}

interface DbSchema {
  properties?: Record<string, { type?: string }>;
}

// 사용자가 DB ID 칸에 전체 URL을 붙여넣어도(흔함) ID만 추출.
// 허용: 32자리 hex(대시 유무), 또는 그게 포함된 notion.so URL. 끝쪽 매치를 ID로 본다(앞 제목에 hex가 섞일 수 있어).
export function normalizeDbId(raw: string): string {
  const noQuery = raw.trim().split(/[?#]/)[0];
  const matches = noQuery.match(/[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}/g);
  const id = matches ? matches[matches.length - 1] : noQuery;
  return id.replace(/-/g, ''); // Notion API는 대시 없는 32 hex도 허용.
}

// DB의 title 타입 속성 이름을 찾는다(기본 "Name"/"이름"/커스텀 무관). 연결 테스트도 겸함.
export async function getDbTitleProp(token: string, dbId: string): Promise<string> {
  const id = normalizeDbId(dbId);
  if (!/^[0-9a-f]{32}$/i.test(id)) {
    throw new Error('DB ID 형식이 올바르지 않습니다 — DB URL 전체 또는 32자리 hex를 입력하세요');
  }
  const res = await fetch(`${NOTION_BASE}/databases/${id}`, { method: 'GET', headers: headers(token) });
  if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''));
  const data = (await res.json()) as DbSchema;
  const props = data.properties ?? {};
  const titleName = Object.keys(props).find((name) => props[name]?.type === 'title');
  if (!titleName) throw new Error('대상 DB에 title 속성이 없습니다 (데이터베이스가 맞는지 확인)');
  return titleName;
}

// 옵션 "연결 테스트"용 — 토큰/DB ID로 스키마를 읽어 통과 여부 확인.
export async function testNotion(token: string, dbId: string): Promise<void> {
  await getDbTitleProp(token, dbId);
}

// 답변 최상단의 영어 예문(인라인 코드)을 페이지 제목으로 뽑는다. 복습 DB 특성상 단어보다 예문이 제목으로 유용.
// 첫 인라인 코드 한 줄을 쓰고, 없으면(자유질문 등 예문 부재) fallback(=입력 단어)으로 되돌린다.
export function extractExampleTitle(markdown: string, fallback: string): string {
  const m = markdown.match(/`([^`\n]+)`/); // 첫 번째 인라인 코드. 코드펜스(```)는 [^`]에 막혀 걸리지 않음.
  const example = m?.[1].trim();
  return example || fallback;
}

// 답변을 Notion DB에 새 페이지로 저장. 반환: 생성된 페이지 URL과 실제 사용된 제목.
export async function saveToNotion(word: string, markdown: string): Promise<{ url: string; title: string }> {
  const token = await getNotionToken();
  const { notionDbId } = await loadSettings();
  if (!token || !notionDbId) {
    throw new Error('Notion 설정이 없습니다 — ⚙ 옵션에서 토큰과 DB ID를 입력하세요');
  }

  const dbId = normalizeDbId(notionDbId);
  const titleProp = await getDbTitleProp(token, dbId);
  let children = markdownToBlocks(markdown);
  let truncated = false;
  if (children.length > MAX_CHILDREN) {
    children = children.slice(0, MAX_CHILDREN);
    truncated = true;
  }

  const title = extractExampleTitle(markdown, word || '(제목 없음)').slice(0, MAX_TEXT_LEN);
  const body = {
    parent: { database_id: dbId },
    properties: {
      [titleProp]: { title: [{ text: { content: title } }] },
    },
    children,
  };

  const res = await fetch(`${NOTION_BASE}/pages`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''));
  const data = (await res.json()) as { url?: string };
  if (truncated) console.warn(TAG, `블록 ${MAX_CHILDREN}개 초과분은 잘림`);
  return { url: data.url ?? '', title };
}
