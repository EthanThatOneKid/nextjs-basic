# nextjs-basic

[![CI](https://github.com/EthanThatOneKid/nextjs-basic/actions/workflows/ci.yml/badge.svg)](https://github.com/EthanThatOneKid/nextjs-basic/actions/workflows/ci.yml)

Write Next.js API routes in QB64 BASIC.

```basic
' app/api/hello/route.bas

TYPE HelloBody
    name AS STRING * 50
END TYPE

TYPE HelloResult
    message AS STRING * 100
END TYPE

FUNCTION RunRoute$ (meth AS STRING)
    IF meth = "GET" THEN
        ParseHelloBody RTRIM$(gReq.bodyJson)
        IF RTRIM$(glue_HelloBody.name) = "" THEN glue_HelloBody.name = "World"

        glue_HelloResult.message  = "Hello, " + RTRIM$(glue_HelloBody.name) + "! Greetings from QB64 BASIC."
        glue_HelloResult.language = "QB64 BASIC"

        gResp.statusCode = 200
        RunRoute$ = WriteHelloResult$
    ELSE
        gResp.statusCode = 405
        RunRoute$ = "{" + CHR$(34) + "error" + CHR$(34) + ":" + CHR$(34) + "Method Not Allowed" + CHR$(34) + "}"
    END IF
END FUNCTION
```

TypeScript types are generated automatically from your `TYPE` blocks. No
boilerplate, no manual wiring.

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
- Node.js 18+

## How it works

1. Any `app/api/**/route.bas` is detected at build time.
2. The plugin runs the QB64 compiler: `runtime.bas` + `route.bas` + generated glue → native binary in `bin/` (headless, `-x`). Binaries that are newer than their sources are not rebuilt..
3. `route.types.ts` is generated from your `TYPE` blocks.
4. `route.ts` is generated as a thin Next.js shim that calls the binary.
5. The binary runs as a persistent process — one spawn, no cold starts.

For everything a route can read and call, see [docs/writing-routes.md](docs/writing-routes.md).

## Supported QB64 types in TYPE blocks

| QB64 | TypeScript |
|---|---|
| `STRING * N` | `string` |
| `INTEGER`, `LONG`, `SINGLE`, `DOUBLE`, `_BYTE`, `_FLOAT` | `number` |
| `_INTEGER64`, `_UNSIGNED _INTEGER64` | `bigint` |
| `_UNSIGNED INTEGER/LONG/_BYTE` | `number` |
| `AS AnotherType` (nested) | interface reference |

Bare `STRING`, `_BIT`, `_OFFSET`, `_MEM`, and array fields are rejected with a
build error.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `QB64_PATH` | (from PATH) | Full path to the `qb64pe` or `qb64` executable |
| `NEXTJS_BASIC_VERBOSE` | `0` | Set to `1` for build-time logging |

## Testing

`npm test` runs the unit tests everywhere. The end-to-end tests compile the
example routes with QB64 and talk to them over STDIO. They run when a QB64
compiler is found and skip otherwise. CI installs QB64-PE on the Windows job, so
the e2e tests run there on every push. Ubuntu and macOS run the unit tests only.

## Deployment

Serverless platforms (Vercel, Netlify, Lambda) are not supported — the QB64
binary runs as a persistent child process. Use Railway, Fly.io, Render, or any
Docker-capable host.

See [docs/deployment.md](docs/deployment.md) for step-by-step guides.

## License

MIT
