// 동적 모델 목록 조회 — 옵션 "모델 새로고침" 버튼이 호출. 게이트웨이가 실제 가용 모델을
// 돌려주므로 하드코딩 목록(models.ts)이 낡아도 최신 목록을 쓸 수 있다. 결과는 storage.local에 캐시.
// (듀얼자막 mindlogic.ts:listMindlogicModels 이식.)

import { getMindlogicApiKey } from '../shared/secrets';
import { DEFAULT_MINDLOGIC_BASE_URL } from '../shared/settings';

export interface ModelInfo {
  id: string;
  group: string; // 드롭다운 optgroup 라벨 (owned_by)
}

const CACHE_KEY = 'cachedMindlogicModels';

// base URL(조직별) + 경로로 실제 엔드포인트 조립. 끝 슬래시는 제거해 `//` 중복 방지.
function endpoint(baseUrl: string, path: string): string {
  const base = (baseUrl || DEFAULT_MINDLOGIC_BASE_URL).trim().replace(/\/+$/, '');
  return base + path;
}

export async function listMindlogicModels(baseUrl: string, apiKey?: string): Promise<ModelInfo[]> {
  const key = apiKey || (await getMindlogicApiKey());
  if (!key) throw new Error('Mindlogic API 키가 없음 (옵션 페이지에서 입력 필요)');
  const res = await fetch(endpoint(baseUrl, '/models'), {
    headers: { Authorization: `Bearer ${key}` },
  });
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

export async function getCachedModels(): Promise<ModelInfo[] | null> {
  const r = await chrome.storage.local.get(CACHE_KEY);
  const v = r[CACHE_KEY];
  return Array.isArray(v) ? (v as ModelInfo[]) : null;
}

export async function setCachedModels(models: ModelInfo[]): Promise<void> {
  await chrome.storage.local.set({ [CACHE_KEY]: models });
}
