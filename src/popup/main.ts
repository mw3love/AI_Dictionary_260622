// 팝업 — 입력창에 단어/표현/질문을 적고 Enter → AI 사전 답을 markdown으로 렌더.
// 상태(입력+답변)는 chrome.storage.session에 저장 → 팝업을 닫았다 다시 열어도 유지(브라우저 재시작 시 비워짐).
// 🔄 새로고침으로 입력·답변을 비우고 빈 입력창에서 새로 시작(클립보드는 사용자가 직접 Ctrl+V).

import { ask } from '../backends/ask';
import { saveToNotion } from '../backends/notion';
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
const toolbar = document.getElementById('toolbar') as HTMLDivElement;
const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
const notionBtn = document.getElementById('notion-btn') as HTMLButtonElement;
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;

const SESSION_KEY = 'popupState';
interface PopupState {
  input: string;
  answer: string;
}

let settings: Settings;
let lastMarkdown = ''; // 현재 답변 = 📋 복사 대상.
let busy = false;

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

  // 닫기 전 상태가 있으면 복원 — 이전 입력·답변을 그대로 유지.
  const saved = await loadState();
  if (saved && (saved.input || saved.answer)) {
    input.value = saved.input;
    if (saved.answer) {
      lastMarkdown = saved.answer;
      answerEl.replaceChildren(renderMarkdown(saved.answer));
      toolbar.hidden = false;
    }
  }

  input.focus();
  // 복원된 입력은 커서를 끝에 둔다 — 이어서 수정·추가해 질문할 수 있게
  // (전체 선택하면 첫 타이핑에 복원 텍스트가 통째로 지워져 "수정" 흐름과 충돌).
  input.setSelectionRange(input.value.length, input.value.length);
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
input.addEventListener(
  'input',
  debounce(() => void saveState({ input: input.value, answer: lastMarkdown }), 300),
);

copyBtn.addEventListener('click', () => {
  void navigator.clipboard.writeText(lastMarkdown).then(() => {
    copyBtn.textContent = '✓ 복사됨';
    setTimeout(() => (copyBtn.textContent = '📋 복사'), 1500);
  });
});

// 💾 Notion 저장 — 현재 입력(단어)을 제목, 답변 markdown을 본문 블록으로 새 페이지 생성.
notionBtn.addEventListener('click', () => void saveToNotionFlow());

async function saveToNotionFlow(): Promise<void> {
  if (!lastMarkdown || notionBtn.disabled) return;
  const word = input.value.trim() || '(제목 없음)';
  notionBtn.disabled = true;
  notionBtn.textContent = '저장 중…';
  hideNotice();
  try {
    await saveToNotion(word, lastMarkdown);
    notionBtn.textContent = '✓ 저장됨';
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

resetBtn.addEventListener('click', () => void reset());

async function submit(): Promise<void> {
  const text = input.value.trim();
  if (!text || busy) return;
  busy = true;
  askBtn.disabled = true;
  hideNotice();
  toolbar.hidden = true;
  answerEl.classList.add('loading');
  answerEl.textContent = '생각 중…';

  try {
    const md = await ask(text);
    lastMarkdown = md;
    answerEl.classList.remove('loading');
    answerEl.replaceChildren(renderMarkdown(md));
    toolbar.hidden = false;
    await saveState({ input: text, answer: md });
  } catch (err) {
    answerEl.classList.remove('loading');
    answerEl.textContent = '';
    showNotice(err instanceof Error ? err.message : String(err), true);
  } finally {
    busy = false;
    askBtn.disabled = false;
  }
}

// 🔄 새로고침 — 입력·답변·저장 상태를 비워 빈 입력창으로 초기화. 클립보드는 사용자가 직접 Ctrl+V.
async function reset(): Promise<void> {
  if (busy) return;
  input.value = '';
  lastMarkdown = '';
  answerEl.replaceChildren();
  answerEl.classList.remove('loading');
  toolbar.hidden = true;
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
async function saveState(state: PopupState): Promise<void> {
  try {
    await chrome.storage.session.set({ [SESSION_KEY]: state });
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
  noticeEl.hidden = false;
}
function hideNotice(): void {
  noticeEl.hidden = true;
}

function debounce(fn: () => void, ms: number): () => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}
