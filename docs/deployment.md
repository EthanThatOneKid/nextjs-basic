# Deployment

`nextjs-basic` requires a **long-running Node.js server** — it keeps a
persistent QB64 child process alive per route. Serverless platforms (Vercel,
Netlify, AWS Lambda) are not supported.

Use any platform that runs a Docker container or a persistent process:

- [Railway](#railway)
- [Fly.io](#flyio)
- [Google Cloud Run](#google-cloud-run)
- [Render](#render)
- [Self-hosted / VPS](#self-hosted--vps)

---

## Prerequisites

The `Dockerfile` in `example/` handles everything:

- Builds QB64-PE from its release source (a few minutes, once per image build)
- Compiles your `.bas` routes to native binaries during `next build`
- Runs `next start`, on `$PORT` or 3000

Build it from the repository root: `docker build -f example/Dockerfile -t nextjs-basic-example .`

CI builds this image, starts it, and calls every example route on each push, so the image itself is tested. The platform steps below (Railway, Fly.io, Render) only point those platforms at the same image, and I have not deployed to any of them.

In your own project the plugin comes from `npm install github:EthanThatOneKid/nextjs-basic`, so you can drop the plugin install and the copy of the plugin source from the Dockerfile.

---

## Railway

1. Push your project to GitHub.
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from
   GitHub repo**.
3. Railway auto-detects the `Dockerfile`. If it doesn't, set the **Dockerfile
   path** to `example/Dockerfile` in the service settings.
4. Click **Deploy**. Railway sets `$PORT`, and the image listens on it.

Railway provides a public HTTPS URL automatically.

**Optional — `railway.json`** (place at repo root):

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "dockerfilePath": "example/Dockerfile"
  },
  "deploy": {
    "healthcheckPath": "/api/hello",
    "restartPolicyType": "ON_FAILURE"
  }
}
```

---

## Fly.io

1. Install the [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/).
2. From the repository root (the image builds from there):

```bash
fly launch --dockerfile example/Dockerfile --no-deploy
```

3. Edit the generated `fly.toml` — ensure the `[[services]]` block uses
   `internal_port = 3000`.
4. Deploy:

```bash
fly deploy
```

Fly gives you a `<app-name>.fly.dev` URL.

**Memory:** I have not measured the image's memory use. 512MB is a starting guess (`fly scale memory 512`), so watch it under real traffic.

---

## Render

1. Go to [render.com](https://render.com) → **New** → **Web Service**.
2. Connect your GitHub repo.
3. Set:
   - **Environment**: Docker
   - **Dockerfile path**: `example/Dockerfile`
   - Leave the port to Render: it sets `$PORT` and the image listens on it
4. Click **Create Web Service**.

---

## Google Cloud Run

`scripts/deploy-cloud-run.sh` deploys the example, calls every route on the live URL, and deletes what it created. Cloud Build builds the image, so you do not need Docker locally.

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT   # billing must be on

scripts/deploy-cloud-run.sh --public           # deploy, check, delete
scripts/deploy-cloud-run.sh --public --keep    # deploy, check, leave it running
```

What it does, in order: enables the Cloud Run, Cloud Build and Artifact Registry APIs, creates an Artifact Registry repo, builds the image from `example/Dockerfile` with `deploy/cloudbuild.yaml` (QB64-PE builds from source, so expect several minutes), deploys one instance with 1GB of memory, and runs `scripts/check-routes.sh` against the URL. The same check runs in CI against the Docker image.

- `--public` is required. The check calls the service with plain `curl`, and the service accepts unauthenticated requests for as long as it exists.
- Without `--keep` the service and image are deleted when the check ends, pass or fail. The repo, the enabled APIs and Cloud Build's source bucket stay.
- It refuses to run if a service with the same name already exists, so it never deletes something that was not its own. Set `SERVICE`, `REGION`, `PROJECT` or `REPO` to change the defaults.
- It costs a little: Cloud Run and Cloud Build both have free tiers, and a short test normally stays inside them. Check your own billing.

Status: written and syntax-checked, and the route check is tested against a local server. It has not yet been run against a real project.

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
| `PORT` | `3000` | Port Next.js listens on (platforms like Railway and Render set it) |
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
