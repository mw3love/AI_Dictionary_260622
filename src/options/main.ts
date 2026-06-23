// 옵션 페이지 — 키(storage.local)와 설정(storage.sync)을 편집. 변경 즉시 저장.
// 키 입력은 250ms 디바운스 저장, 테스트/새로고침 버튼은 보류 저장을 먼저 flush.
// 모델 드롭다운은 "모델 새로고침"으로 가져온 동적 목록(storage.local 캐시)을 우선 쓰고,
// 캐시가 없으면 하드코딩 목록(models.ts)을 fallback으로 표시.

import { loadSettings, saveSettings } from '../shared/settings';
import type { Backend } from '../shared/settings';
import {
  getGeminiApiKey,
  setGeminiApiKey,
  getMindlogicApiKey,
  setMindlogicApiKey,
  getNotionToken,
  setNotionToken,
} from '../shared/secrets';
import { GEMINI_MODELS, MINDLOGIC_MODELS } from '../shared/models';
import type { ModelChoice } from '../shared/models';
import { DEFAULT_DICT_PROMPT } from '../shared/prompts';
import { testGemini, testMindlogic } from '../backends/ask';
import { testNotion } from '../backends/notion';
import {
  listGeminiModels,
  listMindlogicModels,
  getCachedModels,
  setCachedModels,
} from '../backends/list-models';
import type { ModelInfo } from '../backends/list-models';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const backendSel = $<HTMLSelectElement>('backend');
const geminiKey = $<HTMLInputElement>('gemini-key');
const geminiModel = $<HTMLSelectElement>('gemini-model');
const mindlogicKey = $<HTMLInputElement>('mindlogic-key');
const mindlogicModel = $<HTMLSelectElement>('mindlogic-model');
const notionToken = $<HTMLInputElement>('notion-token');
const notionDb = $<HTMLInputElement>('notion-db');
const promptEl = $<HTMLTextAreaElement>('prompt');

void init();

async function init(): Promise<void> {
  const s = await loadSettings();
  backendSel.value = s.backend;
  await populateModels('gemini', s.geminiModel);
  await populateModels('mindlogic', s.mindlogicModel);
  promptEl.value = s.dictPrompt;
  notionDb.value = s.notionDbId;
  geminiKey.value = (await getGeminiApiKey()) ?? '';
  mindlogicKey.value = (await getMindlogicApiKey()) ?? '';
  notionToken.value = (await getNotionToken()) ?? '';
  reflectBackend(s.backend);
}

// 설정 변경 → 즉시 저장.
backendSel.addEventListener('change', () => {
  const b = backendSel.value as Backend;
  void saveSettings({ backend: b });
  reflectBackend(b);
});
geminiModel.addEventListener('change', () => void saveSettings({ geminiModel: geminiModel.value }));
mindlogicModel.addEventListener('change', () =>
  void saveSettings({ mindlogicModel: mindlogicModel.value }),
);
promptEl.addEventListener('input', debounce(() => void saveSettings({ dictPrompt: promptEl.value }), 250));

$<HTMLButtonElement>('prompt-reset').addEventListener('click', () => {
  promptEl.value = DEFAULT_DICT_PROMPT;
  void saveSettings({ dictPrompt: DEFAULT_DICT_PROMPT });
});

// 키 입력 — 디바운스 저장.
geminiKey.addEventListener(
  'input',
  debounce(() => void setGeminiApiKey(geminiKey.value.trim() || null), 250),
);
mindlogicKey.addEventListener(
  'input',
  debounce(() => void setMindlogicApiKey(mindlogicKey.value.trim() || null), 250),
);
notionToken.addEventListener(
  'input',
  debounce(() => void setNotionToken(notionToken.value.trim() || null), 250),
);
notionDb.addEventListener(
  'input',
  debounce(() => void saveSettings({ notionDbId: notionDb.value.trim() }), 250),
);

// 테스트 버튼 — 보류 저장 flush 후 explicit 키로 검증.
$<HTMLButtonElement>('gemini-test').addEventListener('click', async () => {
  const out = $<HTMLSpanElement>('gemini-test-result');
  const key = geminiKey.value.trim();
  if (!key) return setResult(out, '키를 입력하세요', false);
  await setGeminiApiKey(key);
  setResult(out, '확인 중…', true);
  try {
    await testGemini(key, geminiModel.value);
    setResult(out, '✓ 연결 성공', true);
  } catch (e) {
    setResult(out, '✗ ' + msg(e), false);
  }
});
$<HTMLButtonElement>('mindlogic-test').addEventListener('click', async () => {
  const out = $<HTMLSpanElement>('mindlogic-test-result');
  const key = mindlogicKey.value.trim();
  if (!key) return setResult(out, '키를 입력하세요', false);
  await setMindlogicApiKey(key);
  setResult(out, '확인 중…', true);
  try {
    await testMindlogic(key, mindlogicModel.value);
    setResult(out, '✓ 연결 성공', true);
  } catch (e) {
    setResult(out, '✗ ' + msg(e), false);
  }
});

// Notion 연결 테스트 — 보류 저장 flush 후 토큰+DB ID로 스키마 조회 통과 여부 확인.
$<HTMLButtonElement>('notion-test').addEventListener('click', async () => {
  const out = $<HTMLSpanElement>('notion-test-result');
  const token = notionToken.value.trim();
  const dbId = notionDb.value.trim();
  if (!token || !dbId) return setResult(out, '토큰과 DB ID를 입력하세요', false);
  await setNotionToken(token);
  await saveSettings({ notionDbId: dbId });
  setResult(out, '확인 중…', true);
  try {
    await testNotion(token, dbId);
    setResult(out, '✓ 연결 성공', true);
  } catch (e) {
    setResult(out, '✗ ' + msg(e), false);
  }
});

// 모델 새로고침 — 게이트웨이/Gemini에서 동적 목록을 가져와 드롭다운 갱신 + storage.local 캐시.
$<HTMLButtonElement>('gemini-refresh').addEventListener('click', () => void refreshModels('gemini'));
$<HTMLButtonElement>('mindlogic-refresh').addEventListener('click', () =>
  void refreshModels('mindlogic'),
);

async function refreshModels(which: 'gemini' | 'mindlogic'): Promise<void> {
  const sel = which === 'gemini' ? geminiModel : mindlogicModel;
  const keyEl = which === 'gemini' ? geminiKey : mindlogicKey;
  const out = which === 'gemini' ? $<HTMLSpanElement>('gemini-test-result') : $<HTMLSpanElement>('mindlogic-test-result');
  const key = keyEl.value.trim();
  if (!key) return setResult(out, '키를 입력하세요', false);
  // 보류 저장 flush — 디바운스로 아직 안 저장됐을 수 있어 explicit set.
  await (which === 'gemini' ? setGeminiApiKey(key) : setMindlogicApiKey(key));
  setResult(out, '불러오는 중…', true);
  try {
    const models = which === 'gemini' ? await listGeminiModels(key) : await listMindlogicModels(key);
    await setCachedModels(which, models);
    const cur = sel.value;
    fillGrouped(sel, models);
    ensureOption(sel, cur);
    sel.value = cur;
    setResult(out, `✓ 모델 ${models.length}개 불러옴`, true);
  } catch (e) {
    setResult(out, '✗ ' + msg(e), false);
  }
}

// 캐시된 동적 목록이 있으면 그걸로(그룹), 없으면 하드코딩 목록(추천)로 채운다.
async function populateModels(which: 'gemini' | 'mindlogic', current: string): Promise<void> {
  const sel = which === 'gemini' ? geminiModel : mindlogicModel;
  const cached = await getCachedModels(which);
  if (cached && cached.length) fillGrouped(sel, cached);
  else fillStatic(sel, which === 'gemini' ? GEMINI_MODELS : MINDLOGIC_MODELS);
  ensureOption(sel, current);
  sel.value = current;
}

function fillStatic(sel: HTMLSelectElement, models: ModelChoice[]): void {
  sel.replaceChildren();
  const og = document.createElement('optgroup');
  og.label = '추천';
  for (const m of models) {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.label;
    og.appendChild(o);
  }
  sel.appendChild(og);
}

function fillGrouped(sel: HTMLSelectElement, models: ModelInfo[]): void {
  sel.replaceChildren();
  const groups = new Map<string, ModelInfo[]>();
  for (const m of models) {
    const arr = groups.get(m.group) ?? [];
    arr.push(m);
    groups.set(m.group, arr);
  }
  for (const [group, arr] of groups) {
    const og = document.createElement('optgroup');
    og.label = group;
    for (const m of arr) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.id;
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
}

// 저장된 모델이 목록에 없으면(옛 값/직접 입력) 옵션을 추가해 select가 비지 않게.
function ensureOption(sel: HTMLSelectElement, value: string): void {
  if (!value) return;
  if (!Array.from(sel.options).some((o) => o.value === value)) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    sel.appendChild(opt);
  }
}

function reflectBackend(b: Backend): void {
  $<HTMLElement>('sec-gemini').classList.toggle('dimmed', b !== 'gemini');
  $<HTMLElement>('sec-mindlogic').classList.toggle('dimmed', b !== 'mindlogic');
}

function setResult(el: HTMLSpanElement, message: string, ok: boolean): void {
  el.textContent = message;
  el.classList.toggle('ok', ok);
  el.classList.toggle('err', !ok);
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function debounce(fn: () => void, ms: number): () => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}
