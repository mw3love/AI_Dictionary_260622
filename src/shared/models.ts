// 알려진 모델 목록 — 옵션 드롭다운용. 게이트웨이/Gemini가 실제 유효성을 판정하므로 이 목록은
// "추천 + 새로고침 전 기본값" 성격의 하드코딩 부분집합(v1은 동적 /models 조회 생략, v2 후보).
// 모델 라인업이 바뀌면 코드로 갱신.

export interface ModelChoice {
  id: string;
  label: string;
}

export const GEMINI_MODELS: ModelChoice[] = [
  { id: 'gemini-3.5-flash', label: 'gemini-3.5-flash (품질, 사전 기본)' },
  { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
  { id: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite (저가)' },
];

export const MINDLOGIC_MODELS: ModelChoice[] = [
  { id: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6 (품질)' },
  { id: 'claude-haiku-4-5-20251001', label: 'claude-haiku-4-5 (가성비)' },
  { id: 'gemini-3.1-flash-lite', label: 'gemini-3.1-flash-lite (빠름)' },
  { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
  { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
  { id: 'gpt-5.4-nano', label: 'gpt-5.4-nano (저가)' },
];
