# AI Dictionary

궁금한 영어 표현을 **빠르게** 묻는 AI 사전 Chrome 확장. 전역 단축키로 팝업을 열어 단어·표현·질문을 입력하면 AI가 뜻·유래·예문을 markdown으로 답한다. BYOK(본인 키) — Gemini 또는 Mindlogic Gateway.

## 사용 흐름
1. (선택) PasteFlow 등 외부 OCR로 화면의 영단어를 추출해 클립보드에 복사.
2. 전역 단축키(기본 `Ctrl+Shift+Y`)로 팝업을 연다.
3. 입력창에 `Ctrl+V`로 붙여넣거나 직접 입력하고 Enter → AI 답변.
4. `📋 복사`로 markdown 복사 → Notion에 붙여넣으면 표·예문이 리치 블록으로 들어감. 또는 `💾 Notion 저장`으로 지정 DB에 새 페이지로 바로 저장(제목=단어, 본문=답변 블록).

팝업을 닫았다 다시 열어도 직전 입력·답변이 유지된다(브라우저 재시작 시 비워짐). 새 단어를 묻고 싶으면 `물어보기` 옆 `🔄 새로고침`으로 입력·답변을 비워 빈 입력창으로 초기화한다. `📋 복사`는 답변이 있을 때 입력창 아래에 뜬다(답변은 자체 스크롤이라 길어도 밀리지 않는다). 설정은 자주 쓰지 않으므로 별도 버튼 없이 **확장 아이콘 우클릭 → "옵션"** 으로 연다.

## 명령
| 명령 | 용도 |
|---|---|
| `npm install` | 의존성 설치 |
| `npm run dev` | HMR 개발 빌드 (`dist/`) |
| `npm run build` | `tsc --noEmit && vite build` → `dist/` |
| `npm run typecheck` | 타입 검사만 |

## 브라우저에 로드
1. `npm run build`
2. `chrome://extensions` → 개발자 모드 → "압축해제된 확장 프로그램 로드" → `dist/` 선택
3. `chrome://extensions/shortcuts` 에서 단축키 확인/변경

## 설정
옵션 페이지(다크 테마)에서 백엔드 선택, API 키 입력(+테스트), 모델 선택, **모델 새로고침**(게이트웨이/Gemini의 실제 가용 모델을 `/models`로 가져와 드롭다운에 표시 + `storage.local` 캐시), 사전 프롬프트 편집, **Notion 저장**(선택) 설정.
키는 `chrome.storage.local`(동기화 제외), 설정은 `chrome.storage.sync`, 팝업의 입력·답변 상태는 `chrome.storage.session`(브라우저 세션 동안만 유지).

### Notion 저장 (선택)
답변을 본인 Notion DB에 바로 저장하려면 옵션의 **Notion 저장** 섹션에 설정한다(BYOK):
1. `notion.so/my-integrations` 에서 internal integration 생성 → 토큰 복사(옵션에 입력, `storage.local`).
2. 저장할 데이터베이스 페이지 우상단 `⋯` → **연결(Connections)** 에서 그 integration 추가(이 1회 공유가 없으면 404).
3. DB ID 칸에 그 **DB 페이지 주소(URL)를 통째로 붙여넣어도** 된다(URL 속 32자리 hex를 자동 추출, 대시 UUID·맨 ID도 허용) — 옵션에 입력 후 **연결 테스트**로 확인.

저장 시 DB의 title 속성을 자동 탐지해 단어를 제목으로 넣고, 답변 markdown을 heading·문단·목록·코드·표·인라인(굵게/기울임/코드) 블록으로 변환한다.

## 구조
- `src/popup/` — 입력창 + 답변 렌더 (메인 UI)
- `src/options/` — 키·모델·프롬프트 설정
- `src/backends/ask.ts` — Gemini/Mindlogic 단발 chat 호출 (확장 origin에서 직접 fetch, SW 없음)
- `src/backends/notion.ts` — 답변을 Notion DB에 페이지로 저장 + markdown→Notion 블록 변환
- `src/shared/` — settings·secrets·markdown 렌더러·프롬프트·모델 목록

핵심 모듈(secrets·백엔드 호출·markdown 렌더러·사전 프롬프트)은 youtube_dual_subtitle 프로젝트의 해설 기능에서 이식.

## v2 후보
멀티턴 후속 질문, content-script 오버레이(풀스크린 영상 위), 확장 내장 OCR. (Notion API 직접 저장은 구현됨 → "설정 > Notion 저장".)
