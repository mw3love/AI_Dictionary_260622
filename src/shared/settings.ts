// 설정값 — storage.sync. API 키는 여기 두지 않고 secrets.ts(storage.local)에 분리.
// zod 없이 단순 defaults 머지로 마이그레이션(필드 수가 적어 충분). 손상된 값은 default가 흡수.

import { DEFAULT_DICT_PROMPT } from './prompts';

export type Backend = 'gemini' | 'mindlogic';

export interface Settings {
  backend: Backend;
  geminiModel: string;
  mindlogicModel: string;
  dictPrompt: string;
  // 팝업이 열릴 때 클립보드를 입력창에 자동으로 채울지 (PasteFlow 등 외부 OCR → 클립보드 흐름).
  autoPasteClipboard: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  backend: 'gemini',
  geminiModel: 'gemini-3.5-flash',
  mindlogicModel: 'claude-sonnet-4-6',
  dictPrompt: DEFAULT_DICT_PROMPT,
  autoPasteClipboard: true,
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
