// API 키를 chrome.storage.local에 저장. settings(storage.sync)와 의도적으로 분리:
// 웹스토어 배포 시 사용자의 BYOK 키가 Google 계정 동기화로 다른 기기에 전파되지 않도록.
// storage.local은 확장 sandbox 내부에서만 접근 가능.
// (듀얼자막 프로젝트 secrets.ts에서 사전 도구에 필요한 두 키만 추려 이식.)

const KEY_GEMINI_API = 'geminiApiKey';
const KEY_MINDLOGIC_API = 'mindlogicApiKey';

export async function getGeminiApiKey(): Promise<string | null> {
  const r = await chrome.storage.local.get(KEY_GEMINI_API);
  const v = r[KEY_GEMINI_API];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export async function setGeminiApiKey(key: string | null): Promise<void> {
  if (!key) {
    await chrome.storage.local.remove(KEY_GEMINI_API);
    return;
  }
  await chrome.storage.local.set({ [KEY_GEMINI_API]: key });
}

export async function getMindlogicApiKey(): Promise<string | null> {
  const r = await chrome.storage.local.get(KEY_MINDLOGIC_API);
  const v = r[KEY_MINDLOGIC_API];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export async function setMindlogicApiKey(key: string | null): Promise<void> {
  if (!key) {
    await chrome.storage.local.remove(KEY_MINDLOGIC_API);
    return;
  }
  await chrome.storage.local.set({ [KEY_MINDLOGIC_API]: key });
}
