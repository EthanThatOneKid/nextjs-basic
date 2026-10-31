# Design — nextjs-basic

## Repository layout

```
nextjs-basic/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # withBasic() export — Next.js config wrapper
│   ├── plugin.ts             # webpack plugin: scans .bas, triggers build steps
│   ├── compiler.ts           # shells out to qb64 + GCC, manages bin/ output
│   ├── codegen.ts            # bas-parser → route.types.ts + route.ts shim
│   ├── runtime/
│   │   ├── basicRuntime.ts   # Node.js child_process manager (callBasic)
│   │   └── runtime.bas       # QB64 STDIO loop + ParseBody/WriteBody helpers
│   └── types.ts              # shared internal TypeScript types
├── example/
│   └── app/api/hello/
│       └── route.bas         # minimal demo endpoint
└── docs/
    └── README.md
```

---

## Layer diagram

```
Next.js request
      │
      ▼
route.ts (generated shim)
      │  callBasic({ endpoint, _id, bodyJson, method, path })
      ▼
basicRuntime.ts
      │  JSON line → STDIN
      ▼
bin/<route-name>  (QB64 native binary, persistent process)
      │  JSON line ← STDOUT
      ▼
basicRuntime.ts
      │  resolved Promise
      ▼
route.ts  →  NextResponse.json(result)
```

---

## Component designs

### 1. `withBasic()` — `src/index.ts`

Wraps the user's Next.js config and injects the webpack plugin.

```ts
export function withBasic(nextConfig: NextConfig = {}): NextConfig {
  return {
    ...nextConfig,
    webpack(config, options) {
      config.plugins.push(new BasicPlugin(options));
      if (typeof nextConfig.webpack === 'function') {
        return nextConfig.webpack(config, options);
      }
      return config;
    },
  };
}
```

### 2. `BasicPlugin` — `src/plugin.ts`

A webpack plugin. On each compilation:

1. Calls `glob('app/api/**/route.bas')` relative to the project root.
2. For each found file, calls `buildRoute(filePath)`.
3. Emits the generated `.ts` files as webpack assets so Next.js sees them.
4. In `next dev` (watch mode), uses a `watchRun` hook to re-build changed
   `.bas` files only.

### 3. `buildRoute(basFile)` — `src/compiler.ts`

```
basFile: app/api/hello/route.bas
         │
         ├─ codegen.parseAndGenerate(basFile)
         │    → writes app/api/hello/route.types.ts
         │    → writes app/api/hello/route.ts  (shim)
         │
         └─ compiler.compile(basFile)
              → concatenates runtime.bas + route.bas → /tmp/<id>.bas
              → runs: qb64 -c /tmp/<id>.bas -o bin/hello
              → on error: throws BuildError with file + line
```

### 4. `bas-parser` — `src/codegen.ts`

Reads the `.bas` file and extracts `TYPE … END TYPE` blocks.

**Parse rules:**
- Lines are trimmed and uppercased for matching.
- `TYPE <name>` opens a block; `END TYPE` closes it.
- Each field line matches: `<name> AS <type>` or `AS <type> <name>, ...`
- Supported types: see FR-6 in requirements.md.
- Unsupported type → throw `ParseError(file, lineNumber, fieldName, reason)`.

**Type mapping function:**

```ts
function qb64TypeToTs(qbType: string): string {
  const t = qbType.trim().toUpperCase();
  if (t.startsWith('STRING *'))    return 'string';
  if (t === 'INTEGER')             return 'number';
  if (t === 'LONG')                return 'number';
  if (t === 'SINGLE')              return 'number';
  if (t === 'DOUBLE')              return 'number';
  if (t === '_BYTE')               return 'number';
  if (t === '_FLOAT')              return 'number';
  if (t === '_INTEGER64')          return 'bigint';
  if (t.startsWith('_UNSIGNED'))   return resolveUnsigned(t);
  // nested type reference — resolved at emit time
  return t; // treated as interface reference
}
```

**Emitted `route.types.ts`:**

```ts
// AUTO-GENERATED — do not edit
// Source: app/api/hello/route.bas

export interface HelloBody {
  name: string;
  age: number;
}

export interface HelloResult {
  message: string;
  statusCode: number;
}
```

**Emitted `route.ts` shim:**

```ts
// AUTO-GENERATED — do not edit
import { NextRequest, NextResponse } from 'next/server';
import { callBasic } from '@nextjs-basic/runtime';
export type { HelloBody, HelloResult } from './route.types';

export async function GET(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = await callBasic({
    endpoint: 'hello',
    method: 'GET',
    path: req.nextUrl.pathname,
    bodyJson: JSON.stringify(body),
  });
  return NextResponse.json(JSON.parse(raw));
}
```

### 5. `basicRuntime.ts` — `src/runtime/basicRuntime.ts`

Manages one persistent child process per route binary.

- `getProc(routeName)`: lazily spawns `./bin/<routeName>`, caches by name.
- `callBasic(payload)`: assigns `_id`, writes JSON line to STDIN, registers
  promise in a `Map<id, resolve>`, resolves when STDOUT line with matching
  `_id` arrives.
- 5-second timeout per call; rejects with `QB64TimeoutError`.
- On process exit: clears cache entry so next call re-spawns.
- All pending promises for a crashed process reject with `QB64CrashError`.

### 6. `runtime.bas` — `src/runtime/runtime.bas`

Injected before the user's `route.bas` at compile time. Never visible to the
user.

Responsibilities:
- Declare framework `TYPE Request` and `TYPE Response`.
- Run the main `DO … LOOP` reading `LINE INPUT` from STDIN.
- Parse the `_id` field from the incoming JSON line.
- Dispatch to the correct handler function based on the `method` field.
- Call `ParseBody` to fill user TYPE from `req.bodyJson`.
- Call `WriteBody` to serialize user TYPE into `resp.bodyJson`.
- Print the response JSON line (including `_id`) to STDOUT.
- `FLUSH` after every PRINT to ensure Node.js sees the line immediately.

**ParseBody / WriteBody** are macro-style SUBs that accept the raw JSON string
and a TYPE variable passed by reference. Implementation uses QB64 string
scanning (no external library). Fixed-length strings are null/space-padded;
the serializer calls `RTRIM$` before writing.

---

## Error handling

| Error site | Error type | Surface |
|---|---|---|
| Unsupported QB64 type in parser | `ParseError` | Next.js build error with file + line |
| `qb64` binary not found | `CompilerNotFoundError` | Build error with install hint |
| `qb64` compile failure | `CompileError` | Build error forwarding QB64 stderr |
| Runtime timeout (5s) | `QB64TimeoutError` | HTTP 500, logged to stderr |
| Binary crash / exit | `QB64CrashError` | HTTP 500, pending requests rejected |

---

## Build-time sequence (next build)

```
1. webpack init
2. BasicPlugin.apply(compiler)
3. compiler 'make' hook fires
4. glob app/api/**/route.bas  →  [hello, users, ...]
5. for each route (parallel):
   a. codegen: parse .bas → emit route.types.ts, route.ts
   b. compiler: concat runtime.bas + route.bas → tmp
   c. qb64 -c tmp -o bin/<name>
   d. rm tmp
6. webpack continues with generated .ts files in the graph
7. next build bundles route.ts shims normally
```

---

## Dev-mode sequence (next dev)

Same as above, plus:
- `watchRun` hook watches `.bas` files for changes.
- On change: re-run steps 5a–5d for the changed route only.
- Existing binary is replaced atomically (rename over old file).
- The running child process for that route is killed; next request re-spawns it.

---

## Example user file

```basic
' app/api/hello/route.bas

TYPE HelloBody
    name AS STRING * 50
END TYPE

TYPE HelloResult
    message AS STRING * 100
END TYPE

FUNCTION GET (req AS Request, resp AS Response)
    DIM body AS HelloBody
    DIM result AS HelloResult

    ParseBody req, body

    result.message = "Hello, " + RTRIM$(body.name) + "!"

    WriteBody resp, result
    resp.statusCode = 200
END FUNCTION
```

That is everything the user writes. The plugin handles the rest.

---

## Out of scope (v1)

See requirements.md — Out of Scope section.
