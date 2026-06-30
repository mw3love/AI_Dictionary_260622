import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'AI Dictionary',
  description: pkg.description,
  version: pkg.version,
  action: {
    // default_popup 없음 → 아이콘 클릭이 action.onClicked로 떨어져 배경 SW가 현재 탭에 오버레이를 토글 주입.
    // (예전엔 브라우저 액션 팝업이었으나 위치를 Chrome이 툴바 아이콘에 앵커해 결정 →
    //  YouTube 전체화면처럼 툴바가 숨으면 팝업이 왼쪽/화면 밖으로 튀어 일관성이 없었다. background/index.ts 참고.)
    default_title: 'AI 사전 (Alt+Q 또는 클릭)',
  },
  options_page: 'src/options/index.html',
  // 오버레이는 페이지에 주입한 iframe(확장 origin)이 기존 팝업(src/popup)을 그대로 띄운다 →
  // iframe은 확장 origin이라 host_permissions로 직접 fetch 가능(팝업 코드 무수정 재사용).
  // 단축키/아이콘은 사용자 제스처라 activeTab으로 그 탭에만 그 순간 주입 → 광범위 host 권한 불필요.
  permissions: ['storage', 'scripting', 'activeTab'],
  host_permissions: [
    // Gemini (BYOK) — 사용자가 옵션에서 본인 키 입력 시에만 호출.
    'https://generativelanguage.googleapis.com/*',
    // Mindlogic API Gateway (BYOK) — 학교/조직 계정 키로 OpenAI/Anthropic/Gemini 등 통과.
    'https://factchat-cloud.mindlogic.ai/*',
    // Notion API (BYOK) — 답변을 사용자의 Notion DB에 저장. host_permission이 있어야 확장에서 직접 fetch(CORS 면제).
    'https://api.notion.com/*',
  ],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  web_accessible_resources: [
    {
      // 오버레이 iframe의 src. 임의 페이지에 주입하므로 모든 origin에서 embed 허용.
      // (crxjs가 이 HTML이 의존하는 빌드 산출물 JS/CSS도 함께 web_accessible로 묶는다.)
      resources: ['src/popup/index.html'],
      matches: ['<all_urls>'],
    },
  ],
  commands: {
    // default_popup이 없으므로 _execute_action(=아이콘 활성화)은 action.onClicked로 떨어진다 → 오버레이 토글.
    // 커스텀 커맨드를 따로 두면 Chrome이 항상 보여주는 "확장 활성화" 단축키와 중복돼 항목이 2개가 되므로,
    // 액션 활성화 단축키 하나로 통합한다. 왼손 전용(오른손은 마우스).
    // 기존 install은 이 기본값이 자동 반영 안 될 수 있어 chrome://extensions/shortcuts 에서 확인/지정 필요.
    _execute_action: {
      suggested_key: { default: 'Alt+Q', mac: 'Alt+Q' },
      description: 'AI 사전 오버레이 열기/닫기',
    },
  },
});
