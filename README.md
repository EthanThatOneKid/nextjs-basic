# nextjs-basic

[![CI](https://github.com/EthanThatOneKid/nextjs-basic/actions/workflows/ci.yml/badge.svg)](https://github.com/EthanThatOneKid/nextjs-basic/actions/workflows/ci.yml)

Write Next.js API routes in QB64 BASIC.

```basic
' app/api/hello/route.bas

TYPE Request
    name AS STRING * 50
END TYPE

TYPE Response
    message  AS STRING * 100
    language AS STRING * 20
END TYPE

SUB OnGet
    IF RTRIM$(Req.name) = "" THEN Req.name = "World"

    Resp.message  = "Hello, " + RTRIM$(Req.name) + "! Greetings from QB64 BASIC."
    Resp.language = "QB64 BASIC"
END SUB
```

`GET /api/hello?name=Ada` returns the message as JSON. TypeScript types are
generated from your `TYPE` blocks. No boilerplate, no manual wiring.

---

## Install

```bash
npm install github:EthanThatOneKid/nextjs-basic
```

## Setup

```js
// next.config.js
const { withBasic } = require('nextjs-basic');
module.exports = withBasic({});
```

## Requirements

- [QB64-PE](https://github.com/QB64-Phoenix-Edition/QB64pe/releases) (recommended) or QB64 installed and on your `PATH` (or set `QB64_PATH`). The plugin looks for `qb64pe` first, then `qb64`.
- Next.js 14+
- TypeScript 5. Next.js 14 cannot load TypeScript 7, which a bare `npm install typescript` can pull in.
- Node.js 18.17 or newer (CI runs Node 24, and the Docker image uses Node 22)

## How it works

1. Any `app/api/**/route.bas` is detected when your Next.js config loads.
2. Right then the plugin writes `route.ts`, `route.types.ts` and the BASIC glue next to it. Next.js looks for route files before webpack starts, so they have to exist first.
3. During the build it compiles `runtime.bas` + `route.bas` + the glue into a native binary in `bin/` (headless, `-x`). Binaries that are newer than their sources are not rebuilt.
4. `route.ts` is a thin Next.js handler that calls the binary.
5. The binary runs as a persistent process: one spawn, no cold starts.

For everything a route can read and call (`Req`, `Resp`, `Fail`, `Respond`, `Query$`, `Header$`, `Param$`, and the `OnGet` ... `OnOptions` handlers), see [docs/writing-routes.md](docs/writing-routes.md).

## Docs

- [docs/writing-routes.md](docs/writing-routes.md): everything a route can read and call
- [docs/deployment.md](docs/deployment.md): running it in production
- [`.kiro/specs/`](.kiro/specs/): the requirements and design the code was built against

## Supported QB64 types in TYPE blocks

| QB64 | TypeScript |
|---|---|
| `STRING * N` | `string` |
| `INTEGER`, `LONG`, `SINGLE`, `DOUBLE`, `_BYTE`, `_FLOAT` | `number` |
| `_INTEGER64`, `_UNSIGNED _INTEGER64` | `bigint` |
| `_UNSIGNED INTEGER/LONG/_BYTE` | `number` |

Bare `STRING`, `_BIT`, `_OFFSET`, `_MEM`, array fields and fields whose type is another
`TYPE` (nested types) are rejected with a build error.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `QB64_PATH` | (from PATH) | Full path to the `qb64pe` or `qb64` executable |
| `NEXTJS_BASIC_VERBOSE` | `0` | Set to `1` for build-time logging |

## Testing

`npm test` runs the unit tests and the end-to-end tests. The end-to-end tests
compile the example routes with QB64 and talk to them over STDIO. They run when a
QB64 compiler is found (`QB64_PATH`, `qb64pe` or `qb64` on `PATH`) and skip
otherwise. CI installs or builds QB64-PE on Ubuntu, Windows and macOS, and fails if
no compiler is found, so the end-to-end tests run on all three on every push. A `docker` job
also builds the example image and calls every example route.

## Generated files

The plugin writes `route.ts`, `route.types.ts` and two `route.glue*.bas` files next to each `route.bas`, and compiled binaries into `bin/`. It adds a `.gitignore` in both places, so none of it lands in your git history.

## Deployment

Serverless platforms (Vercel, Netlify, Lambda) are not supported: the QB64
binary runs as a persistent child process. Use a host that runs a Docker container
or a long-lived Node server.

`example/Dockerfile` builds QB64-PE, compiles the example routes and runs
`next start`. CI builds that image and calls every route on each push. I have not
deployed it to Railway, Fly.io or Render.

See [docs/deployment.md](docs/deployment.md) for step-by-step guides.

## License

MIT
