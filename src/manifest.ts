import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'AI Dictionary',
  description: pkg.description,
  version: pkg.version,
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'AI 사전 (단축키로 열기)',
  },
  options_page: 'src/options/index.html',
  // 팝업/옵션은 확장 origin 페이지라 host_permissions가 있으면 직접 fetch 가능 → 별도 SW 불필요(v1).
  permissions: ['storage'],
  host_permissions: [
    // Gemini (BYOK) — 사용자가 옵션에서 본인 키 입력 시에만 호출.
    'https://generativelanguage.googleapis.com/*',
    // Mindlogic API Gateway (BYOK) — 학교/조직 계정 키로 OpenAI/Anthropic/Gemini 등 통과.
    'https://factchat-cloud.mindlogic.ai/*',
    // Notion API (BYOK) — 답변을 사용자의 Notion DB에 저장. host_permission이 있어야 확장에서 직접 fetch(CORS 면제).
    'https://api.notion.com/*',
  ],
  commands: {
    // 전역 단축키로 팝업을 연다. 사용자는 chrome://extensions/shortcuts 에서 재지정 가능.
    _execute_action: {
      suggested_key: { default: 'Ctrl+Shift+Y', mac: 'Command+Shift+Y' },
      description: 'AI 사전 열기',
    },
  },
});
