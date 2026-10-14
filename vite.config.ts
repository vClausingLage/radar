import { defineConfig, loadEnv, type Plugin } from 'vite';

// The Jev tactician (src/controller/jevTactician.ts) asks /api/jev; this dev
// server middleware forwards the ask to OpenRouter with AI_KEY from .env
// attached. The key stays in Node: Vite only exposes VITE_-prefixed variables
// to the bundle. The model is pinned here, not taken from the browser, so the
// endpoint cannot be used to spend the key on anything but Jev.
//
// `apply: 'serve'` — the proxy exists only under `pnpm dev`. The static
// production build has nowhere safe to keep a key, so Jev ships fall back to
// the scripted doctrine there. Vite binds to localhost by default; running it
// with --host would let anyone on the network spend the key.

const JEV_MODEL = 'typesafe/jev-1.13';
const SYSTEM_ONE_URL = 'https://openrouter.ai/api/v1/systemone';
const MAX_BODY_CHARS = 64 * 1024; // a tactical picture is ~1 KB; anything near this is not one

function jevProxy(apiKey: string | undefined): Plugin {
  return {
    name: 'jev-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/jev', (req, res) => {
        const reply = (status: number, body: string) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(body);
        };
        if (req.method !== 'POST') return reply(405, '{"error":"POST only"}');
        if (!apiKey) return reply(503, '{"error":"AI_KEY missing from .env"}');

        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => {
          body += chunk;
          if (body.length > MAX_BODY_CHARS) req.destroy();
        });
        req.on('end', async () => {
          try {
            const { state, questions } = JSON.parse(body);
            const upstream = await fetch(SYSTEM_ONE_URL, {
              method: 'POST',
              headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: JEV_MODEL, state, questions }),
            });
            reply(upstream.status, await upstream.text());
          } catch (err) {
            reply(502, JSON.stringify({ error: String(err) }));
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [jevProxy(loadEnv(mode, process.cwd(), 'AI_').AI_KEY)],
}));
