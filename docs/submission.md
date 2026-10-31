# Kiroween 2026 Hackathon Submission

**Project:** nextjs-basic
**Category:** Frankenstein
**Repository:** https://github.com/EthanThatOneKid/nextjs-basic

---

## What it does

`nextjs-basic` is a Next.js plugin that lets you write backend API route
handlers in **QB64 BASIC**. Drop a `.bas` file where you would normally drop a
`route.ts`, and it becomes a fully wired, type-safe Next.js route — no
TypeScript, no boilerplate.

```basic
' app/api/hello/route.bas

TYPE HelloBody
    name AS STRING * 50
END TYPE

TYPE HelloResult
    message  AS STRING * 100
    language AS STRING * 20
END TYPE

FUNCTION GET (req AS Request, resp AS Response)
    DIM body AS HelloBody
    DIM result AS HelloResult

    ParseHelloBody req, body

    result.message  = "Hello, " + RTRIM$(body.name) + "! Greetings from QB64 BASIC."
    result.language = "QB64 BASIC"

    WriteHelloResult result, resp
    resp.statusCode = 200
END FUNCTION
```

That is the entire handler. The plugin handles everything else.

---

## The Frankenstein angle

Next.js is one of the most modern web frameworks available. QB64 BASIC is a
language from 1985 compiled via C++ to native machine code.

This project makes them work together — and it actually makes sense:

- QB64 compiles to native binaries via GCC. A BASIC backend can be *faster*
  than a TypeScript one running in Node.js.
- QB64 is inherently cross-platform: the same `.bas` file compiles on Windows,
  Linux, and macOS without changes.
- The developer experience mirrors what Next.js is experimenting with for Go:
  one file, one function, the rest is invisible.

The combination is absurd on its face and technically coherent underneath.
That's the Frankenstein.

---

## How it works

### Build time

```
app/api/hello/route.bas
        │
        ├─ bas-parser → route.types.ts   (TypeScript interfaces, auto-generated)
        │              → route.ts         (Next.js shim, auto-generated)
        │
        └─ QB64 compiler
               runtime.bas       (framework STDIO loop — invisible)
             + route.glue.bas    (ParseXxx/WriteXxx SUBs — auto-generated)
             + route.bas         (user code)
               ──────────────────
               → bin/hello       (native binary)
```

The user's `TYPE` blocks are parsed and converted to TypeScript `interface`s.
Callers get full type safety. No one writes a single line of TypeScript.

### Runtime

```
Next.js request
      │
      ▼
route.ts (generated shim)
      │  callBasic({ endpoint, method, path, bodyJson })
      ▼
basicRuntime.ts  ── JSON line ──▶  bin/hello  (persistent QB64 process)
                 ◀─ JSON line ──
      │
      ▼
NextResponse.json(result)
```

The QB64 binary spawns **once** and stays alive. Every request is a JSON line
over STDIN; every response is a JSON line over STDOUT. No cold starts. No
per-request process overhead.

### Type generation

QB64 `TYPE` blocks map to TypeScript interfaces automatically:

| QB64 | TypeScript |
|---|---|
| `STRING * N` | `string` |
| `INTEGER`, `LONG`, `SINGLE`, `DOUBLE`, `_BYTE`, `_FLOAT` | `number` |
| `_INTEGER64` | `bigint` |
| Unsupported types | Build error with file + line |

---

## Developer experience

Installing the plugin into any Next.js project:

```bash
npm install github:EthanThatOneKid/nextjs-basic
```

```js
// next.config.js
const { withBasic } = require('nextjs-basic');
module.exports = withBasic({});
```

After that, any `.bas` file at `app/api/**/route.bas` is a live route. No other
configuration required.

---

## What was built with Kiro

This project was built spec-first using Kiro's spec-driven development workflow:

- `requirements.md` — functional and non-functional requirements, type tables,
  out-of-scope items
- `design.md` — component breakdown, layer diagram, error table, build sequence

Kiro then implemented every component against those specs:

| File | What it does |
|---|---|
| `src/codegen.ts` | QB64 TYPE parser + TypeScript codegen + QB64 glue SUB generator |
| `src/compiler.ts` | QB64 → native binary compile step |
| `src/plugin.ts` | webpack plugin (hooks into `next build` / `next dev`) |
| `src/index.ts` | `withBasic()` public API |
| `src/runtime/basicRuntime.ts` | Node.js persistent child process manager |
| `src/runtime/runtime.bas` | QB64 STDIO loop (invisible to users) |
| `src/__tests__/codegen.test.ts` | 19 unit tests |
| `src/__tests__/e2e.test.ts` | 12 QB64 integration tests (auto-skip without QB64) |

CI passes on ubuntu, windows, and macos.

---

## Technical highlights

**No per-request cold starts.** The QB64 binary is spawned once. Node.js
reuses it via STDIO for every subsequent request. A timed-out or crashed binary
is re-spawned automatically on the next request.

**Full type safety end-to-end.** The bas-parser reads `TYPE … END TYPE` blocks
and emits TypeScript interfaces. The generated `route.ts` shim imports them.
Callers get autocomplete and type checking with zero manual work.

**Codegen is zero-magic.** Every generated file (`route.ts`, `route.types.ts`,
`route.glue.bas`) is written to disk alongside the `.bas` file. You can read,
inspect, and commit them.

**Cross-platform.** QB64 compiles to native binaries on all three major OSes.
CI verifies the plugin on ubuntu-latest, windows-latest, and macos-latest on
every push.

---

## Limitations (v1)

- Fixed-length strings only in `TYPE` blocks (`STRING * N`; bare `STRING`
  gives a build error with a clear message)
- Node.js runtime only — not compatible with Vercel Edge or serverless
  Functions (see `docs/deployment.md`)
- No streaming responses
- No middleware support

---

## Repository

https://github.com/EthanThatOneKid/nextjs-basic

```
nextjs-basic/
├── src/                   plugin source
├── example/
│   ├── app/api/hello/     GET example
│   ├── app/api/echo/      POST example
│   └── Dockerfile         Railway / Fly.io / Render deployment
├── docs/
│   └── deployment.md      hosting guide
└── .kiro/specs/
    ├── requirements.md
    └── design.md
```
