// 팝업 — 입력창에 단어/표현/질문을 적고 Enter → AI 사전 답을 markdown으로 렌더.
// 열릴 때 (설정에 따라) 클립보드를 자동으로 입력창에 채움(PasteFlow 등 외부 OCR → 클립보드 흐름).

import { ask } from '../backends/ask';
import { renderMarkdown } from '../shared/markdown';
import { loadSettings } from '../shared/settings';
import { getGeminiApiKey, getMindlogicApiKey } from '../shared/secrets';

const input = document.getElementById('input') as HTMLTextAreaElement;
const form = document.getElementById('ask-form') as HTMLFormElement;
const askBtn = document.getElementById('ask-btn') as HTMLButtonElement;
const answerEl = document.getElementById('answer') as HTMLDivElement;
const noticeEl = document.getElementById('notice') as HTMLDivElement;
const metaEl = document.getElementById('meta') as HTMLSpanElement;
const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
const optionsBtn = document.getElementById('options-btn') as HTMLButtonElement;

let lastMarkdown = '';
let busy = false;

void init();

async function init(): Promise<void> {
  const s = await loadSettings();
  metaEl.textContent = s.backend === 'gemini' ? `Gemini · ${s.geminiModel}` : `Mindlogic · ${s.mindlogicModel}`;

  // 키 확인 — 없으면 설정 안내.
  const key = s.backend === 'gemini' ? await getGeminiApiKey() : await getMindlogicApiKey();
  if (!key) {
    showNotice(
      `${s.backend === 'gemini' ? 'Gemini' : 'Mindlogic'} API 키가 없습니다. ⚙ 설정에서 입력하세요.`,
      false,
    );
  }

  // 클립보드 자동 채움 (권한 clipboardRead). 실패해도 조용히 넘어감.
  if (s.autoPasteClipboard) {
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      if (clip) input.value = clip;
    } catch {
      /* 권한/포커스 문제 시 무시 */
    }
  }

  input.focus();
  // 프리필된 텍스트는 커서를 끝에 둔다 — OCR 텍스트를 그대로 Enter 하거나, 이어서 수정·추가해
  // 질문할 수 있게(전체 선택하면 첫 타이핑에 프리필이 통째로 지워져 "수정" 흐름과 충돌).
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

copyBtn.addEventListener('click', () => {
  void navigator.clipboard.writeText(lastMarkdown).then(() => {
    copyBtn.textContent = '✓ 복사됨';
    setTimeout(() => (copyBtn.textContent = '📋 복사'), 1500);
  });
});

optionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

async function submit(): Promise<void> {
  const text = input.value.trim();
  if (!text || busy) return;
  busy = true;
  askBtn.disabled = true;
  hideNotice();
  copyBtn.hidden = true;
  answerEl.classList.add('loading');
  answerEl.textContent = '생각 중…';

  try {
    const md = await ask(text);
    lastMarkdown = md;
    answerEl.classList.remove('loading');
    answerEl.replaceChildren(renderMarkdown(md));
    copyBtn.hidden = false;
  } catch (err) {
    answerEl.classList.remove('loading');
    answerEl.textContent = '';
    showNotice(err instanceof Error ? err.message : String(err), true);
  } finally {
    busy = false;
    askBtn.disabled = false;
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
