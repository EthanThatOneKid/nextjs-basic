# Requirements — nextjs-basic

## Overview

`nextjs-basic` is a Next.js plugin that lets developers write backend API route
handlers in QB64 BASIC. A `.bas` file at `app/api/<path>/route.bas` becomes a
Next.js route handler with generated TypeScript types. The user writes BASIC
`TYPE`s and one `SUB` per HTTP method, and never writes the process management,
JSON handling or Next.js glue.

The user-facing reference is `docs/writing-routes.md`. This file states what the
system must do; `design.md` states how.

---

## Functional Requirements

### FR-1 Route file convention

- A file at `app/api/**/route.bas` is a route handler. The folder path is the URL.
- Dynamic segments (`[id]`, `[...slug]`) work like they do for `route.ts`.
- No `route.ts` is written by the user; the plugin generates it.
- Other Next.js backend files (`proxy`, `instrumentation`, metadata routes, Server
  Actions) are out of scope.

### FR-2 Handlers

- The user defines one `SUB` per method: `OnGet`, `OnPost`, `OnPut`, `OnDelete`,
  `OnPatch`, `OnHead`, `OnOptions`.
- The set of supported methods is exactly the set of handler SUBs the file defines.
  It is read from the source, not from string literals.
- A route with no handler fails the build with a message naming the options.
- The old `FUNCTION RunRoute$` form is rejected with a message that points to the
  new form.
- Methods without a handler return 405.

### FR-3 Request and response types

- `TYPE Request` (input) and `TYPE Response` (output) are optional, one of each per
  route, with fixed names.
- Before a handler runs, `Req` is filled from the request: from the query string for
  `GET` and `HEAD`, from the JSON body for every other method. Missing fields are
  empty or zero. `Req` never keeps values from a previous request.
- Numbers may arrive as `3` or `"3"`.
- An integer outside the range of its QB64 type fails the request with a 400
  (`<field> is out of range`) instead of wrapping.
- `Resp` is cleared before every request. When the handler ends, `Resp` is sent as a
  JSON object with status 200 unless the handler chose another status.
- Strings in responses are JSON-escaped; numbers are written as valid JSON
  (`0.5`, not `.5`).

### FR-4 Handler API

| Name | Behavior |
|---|---|
| `Respond code` | Sets the HTTP status (default 200) |
| `Fail code, "message"` | Stops the handler from anywhere and sends `{"error": "message"}` with that status |
| `SetHeader name, value` | Adds a response header; repeats add another header; headers set before a `Fail` are still sent |
| `AllowCors origin` | Sets the CORS headers for the route's methods |
| `Query$("k")`, `Header$("k")`, `Param$("k")` | Read the query string, a request header (case-insensitive) and a dynamic segment; empty when missing |
| `Ctx.method`, `Ctx.path`, `Ctx.bodyJson` | The request envelope |
| `JStr$`, `JVal$` | Read a top-level key from any JSON string |

- A header name that is not an HTTP token, or a value containing CR, LF or NUL,
  fails the request with a 500 instead of sending it.
- A QB64 runtime error in a handler returns a 400 (overflow) or a 500 and the
  process keeps serving.

### FR-4a HEAD, OPTIONS and bodyless responses

- Without `OnHead`, Next.js answers HEAD by running the `OnGet` handler without a
  body.
- Without `OnOptions`, Next.js answers OPTIONS with an `Allow` header.
- A route that defines `OnOptions` still gets an `Allow` header, unless the route
  set its own.
- Responses with status 204, 205, 304 and every HEAD response are sent without a
  body.

### FR-5 TypeScript generation

- For every route the plugin writes `route.types.ts` and re-exports its types from
  the generated `route.ts`.
- `Request` and `Response` are named per route so they never shadow the DOM types:
  `HelloRequest`, `HelloResponse`, and a pair `HelloRoute { request; response }`.
  A route at `users/[id]` is `UsersId...`.

### FR-6 Supported field types

| QB64 type | TypeScript |
|---|---|
| `STRING * N` | `string` |
| `INTEGER`, `LONG`, `SINGLE`, `DOUBLE`, `_BYTE`, `_FLOAT`, `_UNSIGNED INTEGER/LONG/_BYTE` | `number` |
| `_INTEGER64`, `_UNSIGNED _INTEGER64` | `bigint` |

Rejected with a build error naming the file, field and reason: bare `STRING`,
`_BIT`, `_OFFSET`, `_MEM`, array fields, and fields whose type is another `TYPE`
(nested types are not supported).

### FR-7 Runtime

- Each route compiles to one native binary, started on its first request and kept
  alive. Node and the binary exchange one JSON line per request and per response
  over STDIO.
- Requests carry `_id`, `method`, `path`, `endpoint`, `bodyJson`, `queryJson`,
  `headersJson`, `paramsJson`. Replies carry `_id`, `statusCode`, `bodyJson`,
  `headers` and, when the process asks to be replaced, `recycle`.
- A request that gets no answer within 5 seconds fails with a timeout and the
  process is replaced.
- A crash fails the requests in flight; the next request starts a new process.
- QB64 cannot detect a closed stdin, so the host ends processes explicitly: a
  `{"_quit":true}` message, plus killing them when Node exits.
- Each early exit (`Fail`, runtime error) leaks a little QB64 stack. After 25
  failed requests the process asks to be replaced. New requests go to a fresh
  process, the old one finishes what it was sent, then quits. No request is
  dropped.

### FR-8 Build integration

- `withBasic(nextConfig)` in `next.config.js` hooks the webpack build.
- On `next build` and `next dev` the plugin, for every route: parses it, writes
  the generated files, and compiles one binary into `bin/`.
- A route whose binary is newer than its source, the runtime and the plugin is not
  rebuilt (rebuilding an exe that is running fails on Windows).
- Compiler lookup: `QB64_PATH`, then `qb64pe`, then `qb64` on `PATH`. Compilation
  is headless (`-x`). QB64 error output is shown in the build error.
- Endpoint and binary names come from the folder path below `app/api`, with unsafe
  characters replaced, so two `[id]` routes never share a binary.
- Generated files are ignored by git: the plugin writes a `.gitignore` next to each
  route and one into `bin/`.
- `next build` must pass: the generated `route.ts` must type-check.

### FR-9 Distribution

- Distributed from a public GitHub repository, not the npm registry.
- `npm install github:EthanThatOneKid/nextjs-basic` must produce a working
  package: a `prepare` script builds `dist/` on install.
- The package exposes `nextjs-basic` and `nextjs-basic/runtime`.

---

## Non-Functional Requirements

### NFR-1 No cold starts
One process per route is spawned once. Per-request overhead is STDIO line I/O.

### NFR-2 Cross-platform
The build and the runtime work on Windows, Linux and macOS, with QB64-PE and with
QB64 2.1. CI runs the unit tests and the end-to-end tests (real compiled routes)
on all three systems, and fails when no compiler is found instead of skipping.

### NFR-3 No boilerplate
The user writes `TYPE`s and handler SUBs. Everything else is generated or provided.

### NFR-4 Type safety end to end
Generated types contain no `any`.

### NFR-5 Errors are visible
Build errors name the file and reason. Runtime failures return an HTTP error with a
message. Nothing hangs: timeouts, crashes and runaway stack use are all handled.

### NFR-6 Tested against the real thing
The end-to-end tests compile and run routes through the same STDIO protocol the
Node runtime uses, including field types, limits, failures and headers.

---

## Out of scope

- Nested `TYPE` fields, variable-length strings in `TYPE`s, non-JSON bodies
- Replacing or removing a response header; CORS credentials, origin lists, max-age
- Per-method `Request`/`Response` types, a generated typed client
- Streaming, middleware (`proxy`), the Edge runtime, `src/app`
- Serverless hosting (Vercel, Lambda): a long-lived process is required
