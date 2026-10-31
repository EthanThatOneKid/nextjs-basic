# Deployment

`nextjs-basic` requires a **long-running Node.js server** — it keeps a
persistent QB64 child process alive per route. Serverless platforms (Vercel,
Netlify, AWS Lambda) are not supported.

Use any platform that runs a Docker container or a persistent process:

- [Railway](#railway)
- [Fly.io](#flyio)
- [Render](#render)
- [Self-hosted / VPS](#self-hosted--vps)

---

## Prerequisites

The `Dockerfile` in `example/` handles everything:

- Installs QB64-PE (headless Linux build)
- Compiles your `.bas` routes to native binaries at build time
- Runs `next build` + `next start`

Your binaries land in `bin/` and are copied into the runtime image.

---

## Railway

1. Push your project to GitHub.
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from
   GitHub repo**.
3. Railway auto-detects the `Dockerfile`. If it doesn't, set the **Dockerfile
   path** to `example/Dockerfile` in the service settings.
4. Add a **PORT** environment variable: `3000` (Railway injects `$PORT` but
   Next.js needs it set).
5. Click **Deploy**.

Railway provides a public HTTPS URL automatically.

**Optional — `railway.json`** (place at repo root):

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "dockerfilePath": "example/Dockerfile"
  },
  "deploy": {
    "startCommand": "node_modules/.bin/next start",
    "healthcheckPath": "/api/hello",
    "restartPolicyType": "ON_FAILURE"
  }
}
```

---

## Fly.io

1. Install the [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/).
2. From the `example/` directory:

```bash
fly launch --dockerfile Dockerfile --no-deploy
```

3. Edit the generated `fly.toml` — ensure the `[[services]]` block uses
   `internal_port = 3000`.
4. Deploy:

```bash
fly deploy
```

Fly gives you a `<app-name>.fly.dev` URL.

**Memory:** QB64 binaries are lean, but give the machine at least **512MB RAM**
(`fly scale memory 512`).

---

## Render

1. Go to [render.com](https://render.com) → **New** → **Web Service**.
2. Connect your GitHub repo.
3. Set:
   - **Environment**: Docker
   - **Dockerfile path**: `example/Dockerfile`
   - **Port**: `3000`
4. Click **Create Web Service**.

---

## Self-hosted / VPS

```bash
# Build
docker build -f example/Dockerfile -t nextjs-basic-app .

# Run
docker run -d -p 3000:3000 --name nextjs-basic-app nextjs-basic-app
```

Add a reverse proxy (nginx, Caddy) for HTTPS.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port Next.js listens on |
| `NODE_ENV` | `production` | Set to `production` for the runtime image |
| `NEXTJS_BASIC_VERBOSE` | `0` | Set to `1` for build-time QB64 compile logs |

---

## Why not Vercel?

Vercel's Functions are stateless Lambdas in a read-only sandbox. They cannot:

- Execute arbitrary native binaries
- Keep a persistent child process alive between requests
- Run a compile step at deploy time

The STDIO keep-alive loop is fundamental to this project's design. Use any
platform that gives you a persistent container instead.
