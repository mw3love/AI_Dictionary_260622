import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'AI Dictionary',
  description: pkg.description,
  version: pkg.version,
  // 스파클 A 아이콘(다크 라운드 사각 + 흰 세리프 A + AI 스파클). crxjs가 매니페스트 경로를
  // <root>/icons/ 에서 찾아 그대로 dist/icons/ 로 출력한다(해싱 없음, public 자동복사와 겹치지 않게 루트에 둠).
  icons: {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
  action: {
    // default_popup 없음 → 아이콘 클릭이 action.onClicked로 떨어져 배경 SW가 현재 탭에 오버레이를 토글 주입.
    // (예전엔 브라우저 액션 팝업이었으나 위치를 Chrome이 툴바 아이콘에 앵커해 결정 →
    //  YouTube 전체화면처럼 툴바가 숨으면 팝업이 왼쪽/화면 밖으로 튀어 일관성이 없었다. background/index.ts 참고.)
    default_title: 'AI 사전 (Alt+Q 또는 클릭)',
    default_icon: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
  },
  options_page: 'src/options/index.html',
  // 오버레이는 페이지에 주입한 iframe(확장 origin)이 기존 팝업(src/popup)을 그대로 띄운다 →
  // iframe은 확장 origin이라 host_permissions로 직접 fetch 가능(팝업 코드 무수정 재사용).
  // 단축키/아이콘은 사용자 제스처라 activeTab으로 그 탭에만 그 순간 주입 → 광범위 host 권한 불필요.
  permissions: ['storage', 'scripting', 'activeTab'],
  host_permissions: [
    // Mindlogic API Gateway (BYOK) — 학교/조직 계정 키로 OpenAI/Anthropic/Gemini 등 통과.
    // 가입 단체(조직)마다 base URL 호스트가 다르므로 알려진 두 도메인을 와일드카드로 커버.
    // (factchat-cloud.mindlogic.ai / factchat.mindlogic-kr-api.com 등. 완전히 새로운 도메인의
    //  단체가 생기면 여기에 그 도메인을 추가해야 확장이 직접 fetch 가능하다.)
    'https://*.mindlogic.ai/*',
    'https://*.mindlogic-kr-api.com/*',
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
    // Alt+Q는 youtube_dual_subtitle 확장이 "자막 직접 질문" 단축키로 가져감(YouTube에서 동시 발화 방지).
    // 기본 단축키를 비운다 — 아이콘 클릭으로 토글되고, 원하면 chrome://extensions/shortcuts 에서
    // 사용자가 직접 키를 지정. (Alt+D 등은 Chrome 내장 단축키와 충돌해 무시되므로 기본값을 안 박음.
    //  기존 install은 어차피 옛 suggested_key가 Chrome에 캐시돼 수동 변경이 필요.)
    _execute_action: {
      description: 'AI 사전 오버레이 열기/닫기',
    },
  },
});
