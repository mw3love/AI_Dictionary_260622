// AI 사전 호출 — 선택 표현/질문 하나에 대한 자유서술 1회 chat 호출.
// (듀얼자막 background/explain.ts를 단발 사전 도구용으로 이식: router/길이검증/캐시 없음,
//  system=사전 프롬프트, user=사용자가 입력한 텍스트 그대로.)
//
// 팝업/옵션은 확장 origin 페이지라 host_permissions가 있으면 직접 fetch 가능 → SW 불필요.

import { getGeminiApiKey, getMindlogicApiKey } from '../shared/secrets';
import { loadSettings } from '../shared/settings';

const TAG = '[AID/ask]';
const GEMINI_ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MINDLOGIC_ENDPOINT = 'https://factchat-cloud.mindlogic.ai/v1/gateway/chat/completions';

// 표·예문 여러 개로 길어질 수 있어 토큰 여유를 크게(잘림 방지).
const MAX_TOKENS = 4096;

// 옛 Gemini 모델 별칭 → 실제 ID. 호환용(현재 기본값은 이미 실제 ID).
const GEMINI_ALIAS: Record<string, string> = {
  flash: 'gemini-2.5-flash',
  'flash-lite': 'gemini-2.5-flash-lite',
  '3.5-flash': 'gemini-3.5-flash',
};
function resolveGeminiModelId(model: string): string {
  return GEMINI_ALIAS[model] ?? model;
}

// 팝업에서 호출하는 메인 진입점 — 현재 설정의 backend/model/prompt로 호출.
export async function ask(userText: string): Promise<string> {
  const s = await loadSettings();
  if (s.backend === 'mindlogic') {
    return askMindlogic(s.dictPrompt, userText, s.mindlogicModel);
  }
  return askGemini(s.dictPrompt, userText, s.geminiModel);
}

export async function askGemini(
  prompt: string,
  userMsg: string,
  model: string,
  apiKeyOverride?: string,
): Promise<string> {
  const apiKey = apiKeyOverride ?? (await getGeminiApiKey());
  if (!apiKey) throw new Error('Gemini API 키가 없음 (옵션 페이지에서 입력 필요)');
  const url = `${GEMINI_ENDPOINT_BASE}/${resolveGeminiModelId(model)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: prompt }] },
    contents: [{ role: 'user', parts: [{ text: userMsg }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: MAX_TOKENS },
  };

  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw httpError('Gemini', res.status, await res.text().catch(() => ''));
  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
  };
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text.trim()) {
    throw new Error(`Gemini 응답 없음 (finishReason=${candidate?.finishReason ?? 'unknown'})`);
  }
  return text;
}

export async function askMindlogic(
  prompt: string,
  userMsg: string,
  model: string,
  apiKeyOverride?: string,
): Promise<string> {
  const apiKey = apiKeyOverride ?? (await getMindlogicApiKey());
  if (!apiKey) throw new Error('Mindlogic API 키가 없음 (옵션 페이지에서 입력 필요)');
  const body = {
    model,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: userMsg },
    ],
    temperature: 0.3,
    max_tokens: MAX_TOKENS,
  };

  const res = await fetchWithRetry(MINDLOGIC_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw httpError('Mindlogic', res.status, await res.text().catch(() => ''));
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  };
  const choice = data.choices?.[0];
  const text = choice?.message?.content ?? '';
  if (!text.trim()) {
    throw new Error(`Mindlogic 응답 없음 (finish_reason=${choice?.finish_reason ?? 'unknown'})`);
  }
  return text;
}

// 옵션 "테스트" 버튼용 — 저장 우회로 explicit 키/모델을 직접 검증.
export async function testGemini(apiKey: string, model: string): Promise<string> {
  return askGemini('You are a helpful assistant. Answer briefly.', 'Say "OK" in one word.', model, apiKey);
}
export async function testMindlogic(apiKey: string, model: string): Promise<string> {
  return askMindlogic('You are a helpful assistant. Answer briefly.', 'Say "OK" in one word.', model, apiKey);
}

// 429/5xx만 1회 1500ms 백오프 재시도. 나머지는 그대로 반환해 호출 측이 status로 분기.
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let res = await fetch(url, init);
  if ((res.status === 429 || res.status >= 500) && res.status !== 501) {
    console.warn(TAG, `HTTP ${res.status}, retry in 1500ms`);
    await new Promise((r) => setTimeout(r, 1500));
    res = await fetch(url, init);
  }
  return res;
}

function httpError(name: string, status: number, body: string): Error {
  if (status === 401 || status === 403) return new Error(`${name} 키 인증 실패 (HTTP ${status})`);
  if (status === 429) return new Error(`${name} 한도 초과 (HTTP 429) — 잠시 후 다시`);
  const detail = body.length > 200 ? body.slice(0, 200) + '…' : body;
  return new Error(`${name} 오류 (HTTP ${status})${detail ? `: ${detail}` : ''}`);
}
