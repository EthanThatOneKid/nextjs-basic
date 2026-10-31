# Requirements — nextjs-basic

## Overview

`nextjs-basic` is a Next.js plugin that lets developers write backend API route
handlers in QB64 BASIC. A `.bas` file at `app/api/<name>/route.bas` becomes a
first-class Next.js route with full TypeScript type safety — no boilerplate, no
manual wiring.

---

## Functional Requirements

### FR-1 Route file convention

- A file at `app/api/**/route.bas` is treated as a route handler.
- No `route.ts` is needed alongside it; the plugin generates one automatically.
- The user is never required to write TypeScript for the handler itself.

### FR-2 Handler functions

- The user defines one or more of: `FUNCTION GET`, `FUNCTION POST`,
  `FUNCTION PUT`, `FUNCTION DELETE`, `FUNCTION PATCH` in their `route.bas`.
- Each function receives `(req AS Request, resp AS Response)` where `Request`
  and `Response` are framework-owned envelope types injected at compile time.
- The user never writes the STDIO loop, process management, or JSON parsing
  glue.

### FR-3 Body types

- The user declares their own `TYPE` blocks in `route.bas` for request and
  response bodies (e.g. `HelloBody`, `HelloResult`).
- Framework helpers `ParseBody` and `WriteBody` (injected by the framework)
  handle JSON ↔ QB64 TYPE conversion invisibly.
- Only types valid inside a QB64 `TYPE` block are supported (see FR-6).

### FR-4 TypeScript type generation (codegen)

- At build time the plugin parses every `TYPE … END TYPE` block in `route.bas`.
- For each TYPE it emits a corresponding TypeScript `interface` in
  `route.types.ts` (auto-generated, not hand-edited).
- The generated `route.ts` shim imports those interfaces and re-exports them,
  giving callers full type safety.

### FR-5 Framework envelope types

The framework injects these into every compilation unit (invisible to the user):

```
TYPE Request
    method   AS STRING * 6
    path     AS STRING * 255
    bodyJson AS STRING * 4096
    _id      AS STRING * 36
END TYPE

TYPE Response
    statusCode AS INTEGER
    bodyJson   AS STRING * 4096
END TYPE
```

### FR-6 Supported field types inside TYPE blocks

| QB64 type              | TypeScript type | Notes                        |
|------------------------|-----------------|------------------------------|
| `STRING * N`           | `string`        | Only fixed-length allowed    |
| `INTEGER`              | `number`        |                              |
| `LONG`                 | `number`        |                              |
| `SINGLE`               | `number`        |                              |
| `DOUBLE`               | `number`        |                              |
| `_BYTE`                | `number`        |                              |
| `_INTEGER64`           | `bigint`        |                              |
| `_UNSIGNED INTEGER`    | `number`        |                              |
| `_UNSIGNED LONG`       | `number`        |                              |
| `_UNSIGNED _BYTE`      | `number`        |                              |
| `_UNSIGNED _INTEGER64` | `bigint`        |                              |
| `_FLOAT`               | `number`        | Precision may be lost in JS  |
| `AS AnotherType`       | (nested type)   | Must be declared in same file |

**Unsupported / rejected with a build error:**

- Bare `STRING` (no length) — user must write `STRING * N`
- `_BIT` — not allowed in QB64 TYPE blocks
- `_OFFSET`, `_MEM` — pointer types; no JS equivalent
- Array fields inside TYPE — QB64 does not support them in TYPE

### FR-7 STDIO runtime

- The plugin compiles `runtime.bas` (framework) + `route.bas` (user) into a
  single native binary per route via QB64's C++ transpile + GCC compile step.
- The binary runs as a persistent child process; Node.js spawns it once and
  reuses it for all requests to that route.
- Each request is a single JSON line written to STDIN; each response is a
  single JSON line read from STDOUT.
- Requests carry a `_id` field for correlation; the binary echoes it back.
- A per-call timeout of 5 seconds guards against hangs.

### FR-8 Build integration

- The plugin hooks into Next.js via a `withBasic(nextConfig)` wrapper in
  `next.config.js`.
- On `next build` and `next dev`, the plugin:
  1. Scans `app/api/**/route.bas`
  2. Runs the bas-parser to generate `route.types.ts`
  3. Concatenates `runtime.bas` + `route.bas` → temp file
  4. Invokes `qb64 -c <temp> -o bin/<route-name>` to produce the binary
  5. Generates `route.ts` shim that calls `callBasic`
- Build errors from steps 2–4 surface as Next.js build errors with the `.bas`
  file path and line number where possible.

### FR-9 Distribution

- The plugin is published as a GitHub repository, not to the npm registry.
- Users install via: `npm install github:<org>/nextjs-basic`
- The repository is public.

---

## Non-Functional Requirements

### NFR-1 Cold-start elimination
The QB64 binary for each route is spawned once and kept alive. Per-request
overhead is STDIO line I/O only — no process spawn per request.

### NFR-2 Cross-platform binaries
QB64 produces native binaries for Windows, Linux, and macOS. The build step
must work on all three. CI runs on all three.

### NFR-3 No user-visible boilerplate
The user writes only: TYPE blocks and handler functions. All framework code is
injected or generated.

### NFR-4 Type safety end-to-end
A caller importing from a route's generated `route.types.ts` gets full TS
types. No `any`.

### NFR-5 Graceful error reporting
- Unsupported TYPE fields produce a named build error: file, line, field name,
  reason.
- Runtime errors (timeout, binary crash) surface as HTTP 500 with a
  descriptive message; they do not silently hang.

---

## Out of Scope (v1)

- Variable-length QB64 strings in TYPE blocks (fixed-length only)
- Streaming responses
- Middleware
- Edge runtime (Vercel Edge); this targets Node.js runtime only
- Authentication helpers
- File upload handling
