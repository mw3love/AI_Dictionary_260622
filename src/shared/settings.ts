// 설정값 — storage.sync. API 키는 여기 두지 않고 secrets.ts(storage.local)에 분리.
// zod 없이 단순 defaults 머지로 마이그레이션(필드 수가 적어 충분). 손상된 값은 default가 흡수.

import { DEFAULT_DICT_PROMPT } from './prompts';

// mindlogic 게이트웨이의 base(엔드포인트 경로 앞부분). 조직마다 호스트가 다르므로 옵션에서 지정.
// 코드가 여기에 `/chat/completions`·`/models`를 붙여 실제 엔드포인트를 만든다(끝 슬래시는 무시).
export const DEFAULT_MINDLOGIC_BASE_URL = 'https://factchat-cloud.mindlogic.ai/v1/gateway';

export interface Settings {
  mindlogicModel: string;
  // 가입 단체별로 다른 게이트웨이 base URL(비밀 아님 → sync). 예: 다른 조직은 mindlogic-kr-api.com.
  mindlogicBaseUrl: string;
  dictPrompt: string;
  // Notion 저장 대상 데이터베이스 ID(비밀 아님 → sync). 토큰은 secrets.ts(local)에 분리.
  notionDbId: string;
}

export const DEFAULT_SETTINGS: Settings = {
  mindlogicModel: 'claude-sonnet-4-6',
  mindlogicBaseUrl: DEFAULT_MINDLOGIC_BASE_URL,
  dictPrompt: DEFAULT_DICT_PROMPT,
  notionDbId: '',
};

export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const merged = { ...DEFAULT_SETTINGS, ...raw } as Settings;
  // base URL이 비었거나 손상되면 default로 회복(끝 슬래시 제거는 엔드포인트 조립 시점에서 처리).
  const url = typeof merged.mindlogicBaseUrl === 'string' ? merged.mindlogicBaseUrl.trim() : '';
  merged.mindlogicBaseUrl = url || DEFAULT_MINDLOGIC_BASE_URL;
  return merged;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set(patch);
}
