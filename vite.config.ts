import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        hmr: false,
      },
      plugins: [
        react(), 
        tailwindcss(),
        {
          name: 'html-transform-origin',
          transformIndexHtml(html, ctx: any) {
            const rawHost = String(ctx.req?.headers?.['x-forwarded-host'] || ctx.req?.headers?.host || '').split(',')[0].trim();
            const safeHost = /^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(rawHost) ? rawHost : '';
            const rawProto = String(ctx.req?.headers?.['x-forwarded-proto'] || (ctx.req?.socket?.encrypted ? 'https' : 'http')).split(',')[0].trim().toLowerCase();
            const safeProto = rawProto === 'https' ? 'https' : 'http';
            const origin = safeHost && !safeHost.includes('0.0.0.0') && !safeHost.includes('localhost')
              ? `${safeProto}://${safeHost}`
              : (process.env.APP_URL || env.APP_URL || '');
            if (origin && !origin.includes('google.com') && !origin.includes('ai.studio')) {
              const serializedOrigin = JSON.stringify(origin).replace(/</g, '\\u003c');
              return html.replace(
                '<head>',
                `<head>\n    <script>window.__APP_ORIGIN__ = ${serializedOrigin};</script>`
              );
            }
            return html;
          }
        }
      ],
      esbuild: {
        target: 'esnext'
      },
      build: {
        target: 'esnext'
      },
      optimizeDeps: {
        esbuildOptions: {
          target: 'esnext'
        }
      },
      define: {
        '__APP_URL__': JSON.stringify(process.env.APP_URL || env.APP_URL || 'https://ais-pre-j64utg4foiwsokqspyv354-50605485163.europe-west2.run.app'),
        'process.env.APP_URL': JSON.stringify(process.env.APP_URL || env.APP_URL || 'https://ais-pre-j64utg4foiwsokqspyv354-50605485163.europe-west2.run.app'),
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.VITE_BUILD_DATE': JSON.stringify(new Date().toLocaleString('de-DE', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }))
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        },
        dedupe: ['react', 'react-dom']
      }
    };
});
