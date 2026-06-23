// 형광펜 마크 유틸. 사용자가 친 형광펜은 탭의 marks(문구 목록)로 따로 보관하고,
// 렌더·복사·Notion 저장 시 원본 markdown에 백틱으로 입혀 보여준다.
// → 원본(모델이 쓴 code 포함)은 그대로 유지되므로 "사람이 친 형광펜만" 개별/전체 제거할 수 있다.
// 매칭: 렌더 텍스트는 문단 줄바꿈이 공백으로 합쳐지므로 공백 run을 \s+로 유연화. 첫 일치만 처리(best-effort).

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 비교·저장용 정규화: 앞뒤 공백 제거 + 내부 공백 run을 한 칸으로.
export function normalizeMark(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

// 한 문구를 markdown에서 백틱으로 감싼다(첫 일치). 이미 백틱 안이거나 내부에 백틱/문단경계가 있으면 그대로 둔다.
function wrapOnce(md: string, phrase: string): string {
  const words = phrase.trim().split(/\s+/).filter(Boolean).map(escapeRegex);
  if (!words.length) return md;
  const m = new RegExp(words.join('\\s+')).exec(md);
  if (!m) return md;
  const start = m.index;
  const end = start + m[0].length;
  if (md[start - 1] === '`' && md[end] === '`') return md; // 이미 마크/코드
  if (m[0].includes('`') || m[0].includes('\n\n')) return md;
  return md.slice(0, start) + '`' + m[0] + '`' + md.slice(end);
}

// 원본 markdown에 사용자 형광펜 문구들을 모두 입힌다(복사·Notion·렌더 공용).
export function applyMarks(markdown: string, marks: string[]): string {
  let out = markdown;
  for (const mk of marks) out = wrapOnce(out, mk);
  return out;
}
