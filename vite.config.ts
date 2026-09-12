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
      },
      plugins: [
        react(), 
        tailwindcss(),
        {
          name: 'html-transform-origin',
          transformIndexHtml(html, ctx: any) {
            const host = ctx.req?.headers?.host || ctx.server?.config?.server?.host || '';
            const proto = ctx.req?.headers?.['x-forwarded-proto'] || (ctx.req?.socket?.encrypted ? 'https' : 'http');
            const origin = host && typeof host === 'string' && !host.includes('0.0.0.0') ? `${proto}://${host}` : (process.env.APP_URL || env.APP_URL || '');
            if (origin) {
              return html.replace(
                '<head>',
                `<head>\n    <base href="${origin}/">\n    <script>window.__APP_ORIGIN__ = "${origin}";</script>`
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
        '__APP_URL__': JSON.stringify(process.env.APP_URL || env.APP_URL || 'https://ais-dev-j64utg4foiwsokqspyv354-50605485163.europe-west2.run.app'),
        'process.env.APP_URL': JSON.stringify(process.env.APP_URL || env.APP_URL || 'https://ais-dev-j64utg4foiwsokqspyv354-50605485163.europe-west2.run.app'),
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
