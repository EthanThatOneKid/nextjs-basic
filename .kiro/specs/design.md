# Design — nextjs-basic

## Repository layout

```
nextjs-basic/
├── .kiro/specs/               requirements.md, design.md (this file)
├── docs/
│   ├── writing-routes.md      user reference for route.bas
│   ├── deployment.md          Railway / Fly.io / Render
│   └── submission.md          hackathon write-up
├── src/
│   ├── index.ts               withBasic()
│   ├── plugin.ts              webpack plugin: scan, generate, compile
│   ├── codegen.ts             parser, TS generator, QB64 glue generator
│   ├── compiler.ts            QB64 invocation
│   ├── types.ts               shared types and error classes
│   ├── runtime/
│   │   ├── basicRuntime.ts    Node side: child processes, STDIO protocol
│   │   └── runtime.bas        QB64 side: request loop and handler API
│   └── __tests__/             unit tests, e2e tests, fixtures
├── example/                   hello, echo, users/[id], status routes; Dockerfile
├── tsconfig.json              type-checks everything, tests included
├── tsconfig.build.json        what ships in dist/ (no tests)
└── .github/workflows/ci.yml
```

## Layers

```
 route.bas  (user: TYPE Request/Response, SUB OnGet ...)
     │  parsed at build time
     ▼
 codegen.ts ──► route.types.ts   TypeScript interfaces
            ──► route.ts         Next.js handler per method
            ──► route.glue_decls.bas / route.glue.bas   QB64 glue
     │
     ▼
 compiler.ts: glue_decls + runtime.bas + route.bas + glue ──qb64 -x──► bin/<route>

 at request time:
 Next.js ► route.ts ► basicRuntime.ts ══ one JSON line over STDIO ══► bin/<route>
                                      ◄═ one JSON line back ═══════
```

## Components

### `withBasic()` and `BasicPlugin` (`index.ts`, `plugin.ts`)

`withBasic` adds the webpack plugin to the Next.js config. `BasicPlugin` walks
`app/api/**/route.bas` before each compile and again when a `route.bas` changes in
watch mode. For each route it parses the file, fails the build if no handler exists,
writes the generated files, and compiles unless the binary is up to date. "Up to
date" means newer than `route.bas`, `runtime.bas` and the plugin's own `codegen.js`
and `compiler.js`. Errors from any route are printed and fail the build.

### Parser and generators (`codegen.ts`)

`parseBasFile` reads the file line by line:

- `TYPE … END TYPE` blocks: fields are mapped to TypeScript types; unsupported
  types raise a `ParseError` with file, line, field and reason.
- Handlers are recognised as `SUB On<Method>` at the start of a line, case
  insensitive. `FUNCTION RunRoute$` raises a migration error.
- `routeNameFor` derives the endpoint name from the path below `app/api`.

Generators:

- `generateTypes`: interfaces, with `Request`/`Response` renamed per route and a
  `…Route` pair when both exist.
- `generateShim`: one exported function per handler. It reads the body (empty on
  failure), query string, headers and `await ctx.params`, calls `callBasic`, applies
  `headers` from the reply, and returns the parsed body with the route's status.
  HEAD, and statuses 204, 205 and 304, return no body. An OPTIONS handler gets an
  `Allow` header listing the route's methods unless the route set one. The shim must
  type-check under `next build`.
- `generateQB64GlueDecls`: `DIM SHARED Req AS Request`, `Resp AS Response` and a
  blank `RespBlank`, only for the types that exist. It is concatenated first because
  QB64 needs shared declarations before the first `SUB`.
- `generateQB64Glue`: `ParseRequest` (JSON → `Req`, with integer range checks),
  `WriteResponse$` (`Resp` → JSON, escaped, valid numbers), `GluePrepare` (clear
  `Resp`; fill `Req` from the query for GET and HEAD, from the body otherwise),
  `GlueDispatch` (a `SELECT CASE` over the detected methods, `Fail 405` otherwise),
  `GlueFinish$` and `AllowCors`.
- `writeGeneratedFiles` also writes the `.gitignore` next to the route.

QB64 cannot pass a user `TYPE` to a `SUB` or `FUNCTION`, which is why `Req` and
`Resp` are shared variables and the glue takes and returns strings.

### Compiler (`compiler.ts`)

Finds QB64 (`QB64_PATH`, `qb64pe`, `qb64`), concatenates the four sources in a
fixed order (glue declarations, runtime, user route, glue), compiles headless with
`-x` to an absolute output path, ensures `bin/.gitignore`, and reports QB64's own
error lines on failure.

### QB64 runtime (`runtime.bas`)

- Types `Context` (the request) and `Reply`; shared `Ctx`.
- Main loop: read a line, fill `Ctx`, reset the reply, run `GluePrepare`,
  `GlueDispatch`, `GlueFinish$`, print one reply line. `{"_quit":…}` ends the
  process. Stdout carries only reply lines.
- Errors: `ON ERROR GOTO` with `RESUME` to a label after the dispatch. `Fail` sets
  the status and message, then raises error 250, which leaves the handler from any
  depth. Overflow becomes a 400 and any other runtime error a 500.
- Known limit: this `ERROR`/`RESUME` path leaks stack. A process dies of "Out of
  stack space" after about 290 failures on macOS and 1,500 on Windows, sooner when
  `Fail` is called from deeper helpers. Re-arming `ON ERROR` or leaving the handler
  with `GOTO` did not help, so the runtime counts failures and sets
  `"recycle":true` on the reply once it reaches `RecycleAfter` (25).
- Headers: `SetHeader` validates, then appends a `["name","value"]` pair to the
  reply. `AllowCors` (generated) calls it for the CORS headers.
- JSON helpers: `JStr$`, `JVal$` (accepts `3` and `"3"`), `JUn$`/`JEn$` for
  escapes, `TrimF$`, `NumD$`/`NumS$` for number text, all bounds-checked.

### Node runtime (`basicRuntime.ts`)

One process per route name takes new requests. `callBasic` writes a JSON line with
a correlation id and waits for the reply with the same id, with a 5 second timeout.
On a `recycle` reply the process is retired: removed from the table so new requests
spawn a replacement, and sent `{"_quit":true}` once its queue is empty. A timeout
kills the process that timed out. An unexpected exit rejects what was in flight.
`shutdownAll` runs when Node exits. Binaries are looked up in `bin/` under the
working directory.

## Wire protocol

Request line (JSON):

```
{"_id":"7","endpoint":"users___id_","method":"GET","path":"/api/users/42",
 "bodyJson":"{}","queryJson":"{\"verbose\":\"1\"}",
 "headersJson":"{\"user-agent\":\"x\"}","paramsJson":"{\"id\":\"42\"}"}
```

Reply line:

```
{"_id":"7","statusCode":200,"bodyJson":"{\"id\":\"42\"}",
 "headers":[["Cache-Control","no-store"]],"recycle":true}
```

`bodyJson` is a JSON string holding the response body. `recycle` appears only when
the process wants to be replaced.

## Error handling

| Situation | Result |
|---|---|
| Unsupported type, nested type, no handler, old `RunRoute$` | Build error with file and reason |
| QB64 compile error | Build error with QB64's message |
| `Fail 404, "x"` | 404 `{"error":"x"}`, headers so far kept |
| Integer out of range | 400 `<field> is out of range` |
| Invalid header name or value | 500, nothing sent |
| QB64 runtime error in a handler | 400 (overflow) or 500, process keeps serving |
| Method without a handler | 405 |
| No answer in 5 seconds | Timeout error, process replaced |
| Process crash | In-flight requests fail, next request restarts it |

## Build sequence (`next build`)

1. `withBasic` registers the plugin.
2. Before compilation the plugin scans `app/api`, and for each route generates
   files and compiles if needed.
3. Next.js compiles and type-checks the generated `route.ts` files.
4. At runtime the first request to a route starts its binary.

`next dev` runs the same steps, and rebuilds a route when its `route.bas` changes.

## Testing

- Unit tests cover the parser, every generator and the route-name logic.
- End-to-end tests copy the example routes and a fixture that uses every field
  type into a scratch folder, compile them with a real QB64, and talk to the
  binaries over STDIO. They cover requests, escaping, ranges, headers and CORS,
  HEAD and OPTIONS, lifecycle, and 1,700 failures through the real Node runtime.
- CI runs both on Ubuntu, Windows and macOS, with QB64-PE installed (Windows) or
  built from source and cached (Linux, macOS). `REQUIRE_QB64` turns a missing
  compiler into a failure. A separate step packs the package, installs the tarball
  into an empty project and loads both entry points.
- Manual checks that CI does not cover: `next dev`, `next build` and `next start`
  on the example app, and a clean install from GitHub into a new Next.js app.

## Deployment

A persistent Node server is required. `example/Dockerfile` builds QB64-PE, compiles
the routes and runs `next start`. See `docs/deployment.md`.
