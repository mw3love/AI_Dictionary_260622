# CLAUDE.md — AI 사전 (Chrome 확장)

프로젝트 작업 규칙. 이 파일은 git으로 따라다니므로 어느 PC에서 작업하든 동일하게 적용된다.

## 빌드 — 코드 변경 후 항상 빌드한다

`src/` 아래 코드(HTML/CSS/TS 포함)를 고치면, 사용자에게 보고하기 *전에* 반드시 `npm run build`까지 돌린다.

- 이유: 확장은 `dist/` 빌드 산출물을 로드한다. 소스만 고치면 `chrome://extensions`에서 새로고침해도 변경이 반영되지 않아 사용자가 실제로 확인할 수 없다.
- `npm run build` = `tsc --noEmit && vite build`. 타입 에러가 있으면 빌드가 실패하므로, 빌드 통과 자체가 타입 검증을 겸한다.
- 빌드 후 사용자에게 `chrome://extensions`에서 확장 새로고침(↻)이 필요함을 안내한다.

## 아키텍처 함정 — 오버레이 팝업

- UI는 브라우저 액션 팝업이 아니라 **페이지에 주입하는 iframe 오버레이**다(`src/background/index.ts`가 `Alt+Q`/아이콘 클릭 시 현재 탭에 주입). 이유: 액션 팝업은 위치를 Chrome이 툴바 아이콘에 앵커해 결정 → YouTube 전체화면처럼 툴바가 숨으면 팝업이 왼쪽/화면 밖으로 튀어 일관성이 없었다.
- 오버레이가 띄우는 `src/popup/index.html`은 **manifest 엔트리가 아니므로** `vite.config.ts`의 `rollupOptions.input.popup`으로 직접 등록해야 변환된다. 빠지면 crxjs가 원본을 그대로 복사해 `./popup.css`·`./main.ts`(TS 원본)를 가리켜 **iframe이 스타일·JS 없이 뜬다.**
