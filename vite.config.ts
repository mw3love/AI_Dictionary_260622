import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest';

const here = new URL('./', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

export default defineConfig(({ mode }) => ({
  plugins: [crx({ manifest })],
  // production 빌드에서 디버그 콘솔 제거. warn/error는 유지.
  esbuild: {
    pure: mode === 'production' ? ['console.log', 'console.info', 'console.debug'] : [],
    drop: mode === 'production' ? ['debugger'] : [],
  },
  build: {
    rollupOptions: {
      // CRXJS는 manifest entry로 등록된 HTML만 변환한다. default_popup을 떼면서 팝업 HTML이
      // entry에서 빠져(WAR로만 참조) 원본이 그대로 복사됨 → ./popup.css·./main.ts(TS)를 못 불러와
      // iframe이 스타일·스크립트 없이 떴다. 오버레이 iframe이 띄우는 페이지이므로 input에 직접 등록해
      // 정상 변환(에셋 번들)되게 한다. (prior art: youtube_dual_subtitle의 offscreen 문서 등록 방식)
      input: {
        popup: `${here}src/popup/index.html`,
      },
    },
  },
  // 듀얼자막(5173/5174)과 동시에 dev로 띄울 수 있게 포트 분리.
  server: {
    port: 5180,
    strictPort: true,
    hmr: { port: 5181 },
  },
}));
