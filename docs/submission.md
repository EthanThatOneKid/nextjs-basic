# Kiroween 2026 — nextjs-basic

**Category:** Frankenstein
**Repo:** https://github.com/EthanThatOneKid/nextjs-basic

---

I've been a QB64 BASIC fan for a while. When I saw that Next.js is experimenting
with Go as a backend language — `.go` files as API routes — my first thought was:
what's the least reasonable language you could do that with?

QB64 BASIC. Obviously.

So I built it.

---

## The idea

`nextjs-basic` is a Next.js plugin. You write a `.bas` file at
`app/api/hello/route.bas`, and it becomes a real Next.js API route. TypeScript
types are generated from your BASIC `TYPE` blocks. You never touch a `route.ts`.

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

That's the whole file. The plugin takes it from there.

---

## Why QB64 actually works here

QB64 isn't a toy. It transpiles to C++ and compiles to a native binary via GCC.
The same source file builds on Windows, Linux, and macOS without changes.

The one thing QB64 can't do is WebSockets or gRPC. But it can read from STDIN
and write to STDOUT, which is all you need. The plugin spawns the binary once
per route and keeps it alive — every request is a JSON line in, a JSON line out.
No cold starts, no per-request process overhead.

In theory a QB64 route is faster than the same logic in TypeScript, because it's
not running in a JavaScript VM.

---

## How it works

At `next build` time:

1. The plugin finds every `app/api/**/route.bas`
2. It parses the `TYPE` blocks and generates `route.types.ts` (TypeScript interfaces) and `route.ts` (a thin Next.js shim)
3. It concatenates the framework's STDIO loop (`runtime.bas`), the generated type-conversion code (`route.glue.bas`), and your code (`route.bas`), then runs QB64 to compile the whole thing to a binary in `bin/`

At request time:

```
Next.js → route.ts shim → Node.js child process → QB64 binary (STDIO) → response
```

The QB64 binary fills `Req` from the query string or JSON body, calls the
`OnGet` / `OnPost` SUB that matches the method, and writes `Resp` back as JSON.
The code that moves data between JSON and your `TYPE`s is generated from your
type definitions, so your handler just reads and writes fields. `Fail 404,
"not found"` stops the handler and sends an error.

---

## Setup

```bash
npm install github:EthanThatOneKid/nextjs-basic
```

```js
// next.config.js
const { withBasic } = require('nextjs-basic');
module.exports = withBasic({});
```

Requires QB64-PE (or QB64) on your PATH, or set `QB64_PATH`. The plugin does the rest.

---

## Built with Kiro

I used Kiro's spec-driven workflow: wrote `requirements.md` and `design.md`
first, then Kiro implemented against them. The specs are committed in
`.kiro/specs/` if you want to see how the design evolved.

The codebase:

| File | What it is |
|---|---|
| `src/codegen.ts` | TYPE parser, TS codegen, QB64 glue SUB generator |
| `src/compiler.ts` | QB64 compile step |
| `src/plugin.ts` | webpack plugin |
| `src/runtime/basicRuntime.ts` | Node.js child process manager |
| `src/runtime/runtime.bas` | QB64 STDIO loop (user never sees this) |
| `src/__tests__/codegen.test.ts` | 19 unit tests |
| `src/__tests__/e2e.test.ts` | 12 integration tests (need QB64-PE or QB64 to run) |

CI runs on ubuntu, windows, and macos on every push. The Windows job installs QB64-PE, so the 12 end-to-end tests compile and run real routes there; the other two platforms run the unit tests.

---

## Known limitations

- Strings in `TYPE` blocks must be fixed-length (`STRING * 50`, not `STRING`).
  The parser gives a clear build error if you forget.
- Needs a persistent server — Vercel and other serverless platforms won't work.
  Railway, Fly.io, and Render all work fine. There's a `Dockerfile` in
  `example/` and a guide in `docs/deployment.md`.
- No streaming, no middleware in v1.

---

## Repo layout

```
src/                   plugin
example/
  app/api/hello/       GET example
  app/api/echo/        POST example
  Dockerfile           for Railway / Fly.io / Render
docs/
  deployment.md        hosting guide
  submission.md        this file
.kiro/specs/
  requirements.md
  design.md
```
