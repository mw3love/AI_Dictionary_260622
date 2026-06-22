// 동적 모델 목록 조회 — 옵션 "모델 새로고침" 버튼이 호출. 게이트웨이/Gemini가 실제 가용 모델을
// 돌려주므로 하드코딩 목록(models.ts)이 낡아도 최신 목록을 쓸 수 있다. 결과는 storage.local에 캐시.
// (듀얼자막 gemini.ts:listGeminiModels / mindlogic.ts:listMindlogicModels 이식.)

import { getGeminiApiKey, getMindlogicApiKey } from '../shared/secrets';

export interface ModelInfo {
  id: string;
  group: string; // 드롭다운 optgroup 라벨 (Gemini=세대, Mindlogic=owner)
}

const GEMINI_MODELS_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200';
const MINDLOGIC_MODELS_ENDPOINT = 'https://factchat-cloud.mindlogic.ai/v1/gateway/models';

const CACHE_KEY = { gemini: 'cachedGeminiModels', mindlogic: 'cachedMindlogicModels' } as const;

export async function listGeminiModels(apiKey?: string): Promise<ModelInfo[]> {
  const key = apiKey || (await getGeminiApiKey());
  if (!key) throw new Error('Gemini API 키가 없음 (옵션 페이지에서 입력 필요)');
  const res = await fetch(GEMINI_MODELS_ENDPOINT, { headers: { 'x-goog-api-key': key } });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error(`키 인증 실패 (HTTP ${res.status})`);
    throw new Error(`모델 목록 실패 (HTTP ${res.status})`);
  }
  const data = (await res.json()) as {
    models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
  };
  const models = (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    .filter((id) => id && !/embedding|aqa|imagen|veo|tts|image-generation/i.test(id))
    .map((id) => ({ id, group: geminiFamily(id) }));
  if (models.length === 0) throw new Error('사용 가능한 모델이 없음 (응답 형식 변경?)');
  return models;
}

function geminiFamily(id: string): string {
  const m = id.match(/^(gemini-\d+(?:\.\d+)?|gemma)/);
  return m ? m[1] : '기타';
}

export async function listMindlogicModels(apiKey?: string): Promise<ModelInfo[]> {
  const key = apiKey || (await getMindlogicApiKey());
  if (!key) throw new Error('Mindlogic API 키가 없음 (옵션 페이지에서 입력 필요)');
  const res = await fetch(MINDLOGIC_MODELS_ENDPOINT, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error(`키 인증 실패 (HTTP ${res.status})`);
    throw new Error(`모델 목록 실패 (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { data?: Array<{ id?: string; owned_by?: string }> };
  const models = (data.data ?? [])
    .filter((m): m is { id: string; owned_by?: string } => typeof m.id === 'string' && !!m.id)
    .map((m) => ({ id: m.id, group: m.owned_by ?? 'other' }));
  if (models.length === 0) throw new Error('모델 목록이 비어 있음 (응답 형식 변경?)');
  return models;
}

export async function getCachedModels(which: 'gemini' | 'mindlogic'): Promise<ModelInfo[] | null> {
  const k = CACHE_KEY[which];
  const r = await chrome.storage.local.get(k);
  const v = r[k];
  return Array.isArray(v) ? (v as ModelInfo[]) : null;
}

export async function setCachedModels(which: 'gemini' | 'mindlogic', models: ModelInfo[]): Promise<void> {
  await chrome.storage.local.set({ [CACHE_KEY[which]]: models });
}
