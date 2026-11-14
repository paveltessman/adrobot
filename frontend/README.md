# Adrobot frontend

Next.js, TypeScript, Tailwind CSS, and shadcn/ui.

```sh
npm ci
npm run dev
```

Open <http://localhost:3000>.

## API connection

Run FastAPI from the repository root with `.venv/bin/python run.py`. Configure
`ADROBOT_KEITARO_BASE_URL` and `ADROBOT_KEITARO_API_KEY` in the root `.env` file;
these credentials belong only to FastAPI.

Next.js forwards `/api/v1/integrations/keitaro/campaigns` (including pagination
query parameters) to FastAPI. The default backend origin is
`http://127.0.0.1:8000`. To override it, set the server-only variable in
`frontend/.env.local` before starting or building Next.js:

```dotenv
ADROBOT_BACKEND_ORIGIN=http://127.0.0.1:8000
```

Use an HTTP(S) origin without a path, query, or credentials. Rewrites are resolved
when Next.js loads its configuration; rebuild for a different production backend
origin. Never prefix this variable with `NEXT_PUBLIC_`.

In production, expose only Next.js to users. Both services must share a private
network: for example, use `http://backend:8000` on a Docker network and publish
only the Next.js port. FastAPI must listen on its container interface, but its
port must not be published on the host. On a shared host without containers,
FastAPI can listen on `127.0.0.1`. The rewrite forwards requests; network bindings
and firewall rules enforce backend isolation. No browser CORS setup is needed.

The browser loader in `src/lib/campaigns.ts` uses a relative API URL, disables
caching, validates responses, and accepts an `AbortSignal` for cancellation.
The campaign list UI will use this loader in the next implementation step.

Run `npm test` for loader tests using Node's built-in TypeScript test runner.
