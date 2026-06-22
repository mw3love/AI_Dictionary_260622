import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest';

export default defineConfig(({ mode }) => ({
  plugins: [crx({ manifest })],
  // production 빌드에서 디버그 콘솔 제거. warn/error는 유지.
  esbuild: {
    pure: mode === 'production' ? ['console.log', 'console.info', 'console.debug'] : [],
    drop: mode === 'production' ? ['debugger'] : [],
  },
  // 듀얼자막(5173/5174)과 동시에 dev로 띄울 수 있게 포트 분리.
  server: {
    port: 5180,
    strictPort: true,
    hmr: { port: 5181 },
  },
}));
