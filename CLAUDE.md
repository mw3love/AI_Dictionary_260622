# CLAUDE.md — AI 사전 (Chrome 확장)

프로젝트 작업 규칙. 이 파일은 git으로 따라다니므로 어느 PC에서 작업하든 동일하게 적용된다.

## 빌드 — 코드 변경 후 항상 빌드한다

`src/` 아래 코드(HTML/CSS/TS 포함)를 고치면, 사용자에게 보고하기 *전에* 반드시 `npm run build`까지 돌린다.

- 이유: 확장은 `dist/` 빌드 산출물을 로드한다. 소스만 고치면 `chrome://extensions`에서 새로고침해도 변경이 반영되지 않아 사용자가 실제로 확인할 수 없다.
- `npm run build` = `tsc --noEmit && vite build`. 타입 에러가 있으면 빌드가 실패하므로, 빌드 통과 자체가 타입 검증을 겸한다.
- 빌드 후 사용자에게 `chrome://extensions`에서 확장 새로고침(↻)이 필요함을 안내한다.
