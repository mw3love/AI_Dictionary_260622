// 팝업 — 입력창에 단어/표현/질문을 적고 Enter → AI 사전 답을 markdown으로 렌더.
// 답변은 "탭"으로 쌓인다: 답을 읽다 단어를 드래그 → 🔎 바로 묻기로 새 탭(기존 답 유지)에서 다시 묻거나,
// ✏ 입력창에로 그 텍스트를 입력창에 넣어 수정 후 물어볼 수 있다. 탭 2개 이상이면 상단 탭 스트립 표시.
// 상태(탭 목록·활성 탭·입력 초안)는 chrome.storage.session에 저장 → 팝업을 닫았다 열어도 유지(브라우저 재시작 시 비워짐).

import { ask } from '../backends/ask';
import { saveToNotion } from '../backends/notion';
import {
  applyMarksToDom,
  domToMarkdown,
  rangeFromSelection,
  removeRangeAt,
  toggleRange,
} from './mark';
import type { MarkRange } from './mark';
import { renderMarkdown } from '../shared/markdown';
import { loadSettings } from '../shared/settings';
import type { Settings } from '../shared/settings';
import { getGeminiApiKey, getMindlogicApiKey } from '../shared/secrets';

const input = document.getElementById('input') as HTMLTextAreaElement;
const form = document.getElementById('ask-form') as HTMLFormElement;
const askBtn = document.getElementById('ask-btn') as HTMLButtonElement;
const answerEl = document.getElementById('answer') as HTMLDivElement;
const noticeEl = document.getElementById('notice') as HTMLDivElement;
const metaEl = document.getElementById('meta') as HTMLSpanElement;
const tabbar = document.getElementById('tabbar') as HTMLDivElement;
const toolbar = document.getElementById('toolbar') as HTMLDivElement;
const markBtn = document.getElementById('mark-btn') as HTMLButtonElement;
const clearMarkBtn = document.getElementById('clearmark-btn') as HTMLButtonElement;
const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
const notionBtn = document.getElementById('notion-btn') as HTMLButtonElement;
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;

const SESSION_KEY = 'popupState';
const MAX_TABS = 10; // 매 검색이 새 탭이 되므로, 이 수를 넘으면 가장 오래된(오른쪽 끝) 탭부터 버려 폭증 방지.
interface Tab {
  query: string; // 이 탭을 만든 질문(탭 라벨·Notion 제목)
  markdown: string; // 모델 원본 답변(그대로 보존)
  marks: MarkRange[]; // 사용자가 친 형광펜(렌더 텍스트 기준 offset 범위) — 재렌더 시 DOM에 다시 입힘
  notion?: { title: string; url: string }; // Notion 저장 결과(제목·페이지 URL). 있으면 탭에 ✓ 표시 + 저장됨 알림 유지. url은 없을 수 있음('').
}
interface PopupState {
  tabs: Tab[];
  active: number;
  input: string; // 아직 안 물은 입력 초안(활성 탭 질문과 다를 수 있어 따로 보존)
}

let settings: Settings;
let tabs: Tab[] = [];
let active = -1; // 활성 탭 인덱스 (-1 = 답변 없음)
let busy = false;
let markMode = false; // 🖍 형광펜 ON이면 답변에서 드래그 선택 시 그 부분을 백틱(빨강)으로 토글.

const curTab = (): Tab | undefined => (active >= 0 ? tabs[active] : undefined);

// 세션 복원 시 마크 형식 보정(구버전 string[] 등 비정상 항목 제거).
const sanitizeMarks = (m: unknown): MarkRange[] =>
  Array.isArray(m)
    ? (m as MarkRange[]).filter(
        (r) => r && typeof r.start === 'number' && typeof r.end === 'number' && r.end > r.start,
      )
    : [];

void init();

async function init(): Promise<void> {
  settings = await loadSettings();
  metaEl.textContent =
    settings.backend === 'gemini'
      ? `Gemini · ${settings.geminiModel}`
      : `Mindlogic · ${settings.mindlogicModel}`;

  // 키 확인 — 없으면 설정 안내.
  const key =
    settings.backend === 'gemini' ? await getGeminiApiKey() : await getMindlogicApiKey();
  if (!key) {
    showNotice(
      `${settings.backend === 'gemini' ? 'Gemini' : 'Mindlogic'} API 키가 없습니다. ⚙ 설정에서 입력하세요.`,
      false,
    );
  }

  // 닫기 전 상태가 있으면 복원.
  const saved = await loadState();
  if (saved && saved.tabs && saved.tabs.length) {
    tabs = saved.tabs.map((t) => ({ query: t.query, markdown: t.markdown, marks: sanitizeMarks(t.marks), notion: t.notion }));
    active = Math.min(Math.max(0, saved.active ?? 0), tabs.length - 1);
    input.value = saved.input ?? curTab()?.query ?? '';
    renderActive();
    syncNotice(); // 복원된 활성 탭이 이미 저장돼 있으면 "저장됨" 알림도 되살림
  } else if (saved && saved.input) {
    input.value = saved.input;
  }

  input.focus();
  // 복원된 입력은 전체 선택해 둔다 — 팝업을 열자마자 타이핑하면 기존 단어가 바로 교체되고,
  // 그대로 이어쓰려면 →(오른쪽 화살표)나 클릭으로 선택을 풀면 된다. 빈 입력이면 select()는 무동작.
  input.select();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  void submit();
});

// Enter 전송 / Shift+Enter 줄바꿈.
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void submit();
  }
});

// 입력 변화도 세션에 보존 — 답변 전에 닫아도 적은 내용이 남게.
input.addEventListener('input', debounce(saveNow, 300));

// Esc — 오버레이(iframe)로 떠 있을 때 부모에 닫기 요청. 폴백 단독 창에선 부모=자기 자신이라 무해하게 무시됨.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && window.parent !== window) window.parent.postMessage('ai-dict-close', '*');
});

// 오버레이(iframe)일 때만 — 내용 높이를 부모에 알려 패널이 내용만큼만 차지하게(검색 전 짧게 → 답 길면 늘어남).
// (단독 창 폴백에선 창 자체 크기를 쓰므로 불필요.) body는 margin 0 + #app(max-height 588) 단일 자식이라
// body.scrollHeight가 곧 콘텐츠 높이. 긴 답변은 #app 안 .answer가 자체 스크롤하므로 이 값이 과하게 안 커진다.
if (window.parent !== window) {
  // 높이 변화를 프레임당 1회로 합쳐 부모에 전달 — ResizeObserver가 렌더 중 여러 번 발화해도
  // 호스트(유튜브) 페이지 리플로우가 중복되지 않게(버벅임 완화).
  let pending = false;
  const reportHeight = (): void => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      window.parent.postMessage({ type: 'ai-dict-height', height: document.body.scrollHeight }, '*');
    });
  };
  new ResizeObserver(reportHeight).observe(document.body);
  window.addEventListener('load', reportHeight);
  reportHeight();
}

// 오버레이(iframe)로 열릴 때 커서를 입력창에 잡아 준다.
// 부모(background)가 iframe에 포커스를 넘기는 시점(frame.focus())이 init()의 input.focus()보다
// 늦으면, 포커스 없는 iframe에서 준 input.focus()는 활성요소로 등록되지 않아 커서가 입력창에
// 안 잡힌다(브라우저 quirk — 마우스로 한 번 클릭해야 입력됨). 부모가 iframe에 포커스를 준 순간
// (=iframe window의 focus 이벤트)에 입력창으로 커서를 다시 옮겨 순서와 무관하게 보장한다.
// 열린 직후 잠깐만 감시하고 해제 → 이후 답변을 보다 창을 떠났다 돌아올 때 커서가 튀지 않게.
if (window.parent !== window) {
  const focusInput = (): void => {
    input.focus();
    input.select(); // 복원된 입력은 전체 선택(init과 동일 동작) — 빈 입력이면 무동작.
  };
  window.addEventListener('focus', focusInput);
  setTimeout(() => window.removeEventListener('focus', focusInput), 1000);
}

copyBtn.addEventListener('click', () => {
  const t = curTab();
  if (!t || !t.markdown) return;
  void navigator.clipboard.writeText(domToMarkdown(answerEl)).then(() => {
    copyBtn.textContent = '✓ 복사됨';
    setTimeout(() => (copyBtn.textContent = '📋 복사'), 1500);
  });
});

// 💾 Notion 저장 — 답변 속 예문(없으면 질문)을 제목, 답변 markdown을 본문 블록으로 새 페이지 생성.
notionBtn.addEventListener('click', () => void saveToNotionFlow());

async function saveToNotionFlow(): Promise<void> {
  const t = curTab();
  if (!t || !t.markdown || notionBtn.disabled) return;
  const word = t.query || input.value.trim() || '(제목 없음)';
  notionBtn.disabled = true;
  notionBtn.textContent = '저장 중…';
  hideNotice();
  try {
    const { url, title } = await saveToNotion(word, domToMarkdown(answerEl));
    notionBtn.textContent = '✓ 저장됨';
    t.notion = { title, url: url ?? '' }; // 탭에 저장 사실 기록 → ✓ 배지 + 탭 전환해도 알림 유지
    renderTabbar(); // 활성 탭 라벨에 ✓ 즉시 반영
    saveNow();
    showSavedNotice(t);
    setTimeout(() => {
      notionBtn.textContent = '💾 Notion 저장';
      notionBtn.disabled = false;
    }, 1500);
  } catch (err) {
    notionBtn.textContent = '💾 Notion 저장';
    notionBtn.disabled = false;
    showNotice(err instanceof Error ? err.message : String(err), true);
  }
}

// 🖍 형광펜 — 모드 토글. 켤 때 답변에 이미 선택이 있으면 그 선택을 즉시 마크(드래그 후 눌러도 동작).
markBtn.addEventListener('click', () => {
  const turningOn = !markMode;
  setMarkMode(turningOn);
  if (turningOn) {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.anchorNode && answerEl.contains(sel.anchorNode)) {
      hideSelMenu();
      markSelection();
    }
  }
});

// 버튼 클릭이 답변의 텍스트 선택을 지우지 않게(선택 후 켜도 유지).
markBtn.addEventListener('mousedown', (e) => e.preventDefault());

// ↺ 형광펜 전체 해제 — 사람이 친 형광펜(marks)만 비운다(모델 코드는 그대로).
clearMarkBtn.addEventListener('mousedown', (e) => e.preventDefault());
clearMarkBtn.addEventListener('click', () => {
  const t = curTab();
  if (!t || !t.marks.length) return;
  t.marks = [];
  renderActive();
  saveNow();
});

// 답변에서 선택 확정(mouseup): 형광펜 모드면 마크, 아니면 "재질문" 미니메뉴 표시.
answerEl.addEventListener('mouseup', () => {
  if (markMode) setTimeout(markSelection, 0);
  else setTimeout(showSelMenu, 0);
});

// 형광펜 친 부분(빨강 code)을 클릭하면 그 마크만 취소. 모델 코드는 class가 없어 무시(불변).
answerEl.addEventListener('click', (e) => {
  const code = (e.target as HTMLElement).closest('code.user-hl');
  if (!code) return;
  const t = curTab();
  if (!t) return;
  t.marks = removeRangeAt(answerEl, t.marks, code as HTMLElement);
  renderActive();
  saveNow();
});

// Shift+백틱(~) — 답변에 선택이 있으면 그 선택을 토글, 없으면 형광펜 모드 자체를 켜고/끔.
document.addEventListener('keydown', (e) => {
  if (e.key !== '~' || toolbar.hidden) return; // 답변(툴바)이 있을 때만
  const sel = window.getSelection();
  e.preventDefault();
  if (sel && !sel.isCollapsed && sel.anchorNode && answerEl.contains(sel.anchorNode)) {
    markSelection();
  } else {
    setMarkMode(!markMode); // 선택이 없으면 형광펜 모드 토글
  }
});

function setMarkMode(on: boolean): void {
  markMode = on;
  markBtn.classList.toggle('active', on);
  answerEl.classList.toggle('mark-mode', on);
}

// 현재 선택을 활성 탭의 형광펜 목록(marks)에 토글 → 재렌더 + 세션 저장. 복사·Notion도 같은 marks를 입혀 자동 반영.
function markSelection(): void {
  const t = curTab();
  if (!t) return;
  const sel = window.getSelection();
  const r = rangeFromSelection(answerEl, sel);
  sel?.removeAllRanges();
  if (!r) return;
  t.marks = toggleRange(t.marks, r); // 기존 마크 안 선택=해제, 아니면 추가(+병합)
  renderActive();
  saveNow();
}

// ----- 재질문 미니메뉴 — 답변에서 단어/문장을 선택하면 두 버튼이 뜬다 -----
// [🔎 바로 묻기] = 새 탭(기존 답 유지)에서 그 텍스트로 즉시 질문 / [✏ 입력창에] = 입력창에 넣어 수정 후 물어보기.
const selMenu = document.createElement('div');
selMenu.id = 'sel-menu';
selMenu.hidden = true;
const askSelBtn = document.createElement('button');
askSelBtn.type = 'button';
askSelBtn.textContent = '🔎 바로 묻기';
const editSelBtn = document.createElement('button');
editSelBtn.type = 'button';
editSelBtn.textContent = '✏ 입력창에';
selMenu.append(askSelBtn, editSelBtn);
document.body.appendChild(selMenu);

let selText = '';
selMenu.addEventListener('mousedown', (e) => e.preventDefault()); // 선택 유지
askSelBtn.addEventListener('click', () => {
  const text = selText;
  hideSelMenu();
  if (!text || busy) return;
  input.value = text;
  void submit();
});
editSelBtn.addEventListener('click', () => {
  const text = selText;
  hideSelMenu();
  if (!text) return;
  input.value = text;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
});

function showSelMenu(): void {
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';
  if (!text || !sel || sel.isCollapsed || !sel.anchorNode || !answerEl.contains(sel.anchorNode)) {
    hideSelMenu();
    return;
  }
  selText = text;
  selMenu.hidden = false;
  // 선택 영역 위에 띄우고, 위 공간이 없으면 아래로. fixed 좌표(뷰포트 기준).
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  const mh = selMenu.offsetHeight || 30;
  const top = rect.top - mh - 6 >= 0 ? rect.top - mh - 6 : rect.bottom + 6;
  const left = Math.max(6, Math.min(rect.left, window.innerWidth - selMenu.offsetWidth - 6));
  selMenu.style.top = top + 'px';
  selMenu.style.left = left + 'px';
}
function hideSelMenu(): void {
  selMenu.hidden = true;
}
// 메뉴 밖을 누르거나 답변을 스크롤하면 닫음.
document.addEventListener('mousedown', (e) => {
  if (!selMenu.hidden && !selMenu.contains(e.target as Node)) hideSelMenu();
});
answerEl.addEventListener('scroll', hideSelMenu);

// ----- 탭 -----
// 활성 탭의 답변을 렌더하고 툴바·탭 스트립을 동기화(입력창은 건드리지 않음 — 전환 시에만 따로 설정).
function renderActive(): void {
  const t = curTab();
  answerEl.classList.remove('loading');
  if (!t) {
    answerEl.replaceChildren();
    toolbar.hidden = true;
  } else {
    answerEl.replaceChildren(renderMarkdown(t.markdown));
    applyMarksToDom(answerEl, t.marks); // 저장된 형광펜을 렌더 DOM에 다시 입힘
    toolbar.hidden = false;
  }
  clearMarkBtn.hidden = !curTab()?.marks.length; // ↺는 형광펜이 있을 때만
  renderTabbar();
}

// 탭 2개 이상일 때만 상단 스트립 표시(단일 조회는 깔끔하게).
function renderTabbar(): void {
  if (tabs.length < 2) {
    tabbar.hidden = true;
    tabbar.replaceChildren();
    return;
  }
  tabbar.hidden = false;
  tabbar.replaceChildren();
  tabs.forEach((t, i) => {
    const el = document.createElement('div');
    el.className = 'tab' + (i === active ? ' active' : '');
    // Notion에 저장된 탭엔 ✓ 배지 — 탭을 다시 눌러 보지 않아도 저장 여부가 한눈에 보이게.
    if (t.notion) {
      const check = document.createElement('span');
      check.className = 'tab-check';
      check.textContent = '✓';
      check.title = 'Notion에 저장됨';
      el.appendChild(check);
    }
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'tab-label';
    label.textContent = t.query || '(빈 탭)';
    label.title = t.query;
    label.addEventListener('click', () => switchTab(i));
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    close.textContent = '✕';
    close.title = '탭 닫기';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(i);
    });
    el.append(label, close);
    tabbar.appendChild(el);
  });
}

function switchTab(i: number): void {
  if (i < 0 || i >= tabs.length || i === active) return;
  active = i;
  input.value = tabs[i].query;
  setMarkMode(false);
  hideSelMenu();
  renderActive();
  syncNotice(); // 저장된 탭이면 "저장됨" 알림 유지, 아니면 숨김
  saveNow();
}

function closeTab(i: number): void {
  if (i < 0 || i >= tabs.length) return;
  tabs.splice(i, 1);
  if (i < active) active--;
  else if (i === active) active = Math.min(active, tabs.length - 1);
  if (tabs.length === 0) {
    active = -1;
    input.value = '';
  } else {
    input.value = tabs[active].query;
  }
  renderActive();
  syncNotice(); // 닫은 뒤 새 활성 탭 기준으로 알림 동기화
  saveNow();
}

resetBtn.addEventListener('click', () => void reset());

// 매 검색은 새 탭으로 — 왼쪽 끝(index 0)에 추가·활성화해 최신이 맨 앞에 오게 한다.
async function submit(): Promise<void> {
  const text = input.value.trim();
  if (!text || busy) return;
  busy = true;
  askBtn.disabled = true;
  hideNotice();
  hideSelMenu();
  setMarkMode(false);
  toolbar.hidden = true;

  tabs.unshift({ query: text, markdown: '', marks: [] });
  if (tabs.length > MAX_TABS) tabs.length = MAX_TABS; // 오래된(오른쪽 끝) 탭부터 버려 폭증 방지
  active = 0;
  const idx = 0;
  renderTabbar();
  answerEl.classList.add('loading');
  answerEl.textContent = '생각 중…';

  try {
    const md = await ask(text);
    tabs[idx].markdown = md;
    tabs[idx].marks = []; // 답변이 바뀌면 옛 형광펜(offset 범위)은 무의미 → 비움
    if (idx === active) renderActive();
    saveNow();
  } catch (err) {
    // 새로 만든 빈 탭이면 실패 시 제거(찌꺼기 방지).
    if (tabs[idx] && !tabs[idx].markdown) {
      tabs.splice(idx, 1);
      active = tabs.length ? Math.min(idx, tabs.length - 1) : -1;
    }
    renderActive();
    showNotice(err instanceof Error ? err.message : String(err), true);
  } finally {
    busy = false;
    askBtn.disabled = false;
  }
}

// 🔄 새로고침 — 모든 탭·입력·저장 상태를 비워 빈 입력창으로 초기화. 클립보드는 사용자가 직접 Ctrl+V.
async function reset(): Promise<void> {
  if (busy) return;
  tabs = [];
  active = -1;
  input.value = '';
  setMarkMode(false);
  hideSelMenu();
  renderActive();
  hideNotice();
  await clearState();
  input.focus();
}

async function loadState(): Promise<PopupState | null> {
  try {
    const r = await chrome.storage.session.get(SESSION_KEY);
    return (r[SESSION_KEY] as PopupState | undefined) ?? null;
  } catch {
    return null;
  }
}
function saveNow(): void {
  void saveState();
}
async function saveState(): Promise<void> {
  try {
    await chrome.storage.session.set({
      [SESSION_KEY]: { tabs, active, input: input.value } satisfies PopupState,
    });
  } catch {
    /* session 미지원/접근 불가 시 무시 — 보존 기능만 빠짐 */
  }
}
async function clearState(): Promise<void> {
  try {
    await chrome.storage.session.remove(SESSION_KEY);
  } catch {
    /* 무시 */
  }
}

function showNotice(msg: string, isError: boolean): void {
  noticeEl.textContent = msg;
  noticeEl.classList.toggle('error', isError);
  noticeEl.classList.remove('success');
  noticeEl.hidden = false;
}
// 성공 알림 + 클릭 가능한 링크(새 탭). 우리 생성 URL이지만 element로만 구성.
function showNoticeLink(text: string, url: string, linkText: string): void {
  noticeEl.replaceChildren(document.createTextNode(text));
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = linkText;
  noticeEl.appendChild(a);
  noticeEl.classList.remove('error');
  noticeEl.classList.add('success');
  noticeEl.hidden = false;
}
function hideNotice(): void {
  noticeEl.hidden = true;
}
// 저장된 탭의 "Notion에 저장됨" 알림(페이지 열기 링크 포함)을 띄운다. url이 없으면 링크 없이 텍스트만.
function showSavedNotice(t: Tab): void {
  if (!t.notion) return;
  if (t.notion.url) showNoticeLink(`Notion에 저장됨: 「${t.notion.title}」 — `, t.notion.url, '페이지 열기 ↗');
  else showNotice(`Notion에 저장됨: 「${t.notion.title}」`, false);
}
// 현재 활성 탭 기준으로 알림 동기화 — 저장된 탭이면 저장됨 알림 유지, 아니면 숨김.
function syncNotice(): void {
  const t = curTab();
  if (t?.notion) showSavedNotice(t);
  else hideNotice();
}

function debounce(fn: () => void, ms: number): () => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}
