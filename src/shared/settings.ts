// 설정값 — storage.sync. API 키는 여기 두지 않고 secrets.ts(storage.local)에 분리.
// zod 없이 단순 defaults 머지로 마이그레이션(필드 수가 적어 충분). 손상된 값은 default가 흡수.

import { DEFAULT_DICT_PROMPT } from './prompts';

export type Backend = 'gemini' | 'mindlogic';

export interface Settings {
  backend: Backend;
  geminiModel: string;
  mindlogicModel: string;
  dictPrompt: string;
  // Notion 저장 대상 데이터베이스 ID(비밀 아님 → sync). 토큰은 secrets.ts(local)에 분리.
  notionDbId: string;
}

export const DEFAULT_SETTINGS: Settings = {
  backend: 'gemini',
  geminiModel: 'gemini-3.5-flash',
  mindlogicModel: 'claude-sonnet-4-6',
  dictPrompt: DEFAULT_DICT_PROMPT,
  notionDbId: '',
};

export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const merged = { ...DEFAULT_SETTINGS, ...raw } as Settings;
  // backend가 알 수 없는 값이면 default로 회복.
  if (merged.backend !== 'gemini' && merged.backend !== 'mindlogic') {
    merged.backend = DEFAULT_SETTINGS.backend;
  }
  return merged;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set(patch);
}
