# nextjs-basic

Write Next.js API routes in QB64 BASIC.

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
    body.name = JsonGetString$(RTRIM$(req.bodyJson), "name")

    DIM result AS HelloResult
    result.message = "Hello, " + RTRIM$(body.name) + "!"

    resp.bodyJson = "{""message"":""" + RTRIM$(result.message) + """}"
    resp.statusCode = 200
END FUNCTION
```

TypeScript types are generated automatically from your `TYPE` blocks. No
boilerplate, no manual wiring.

---

## Install

```bash
npm install github:<your-org>/nextjs-basic
```

## Setup

```js
// next.config.js
const { withBasic } = require('nextjs-basic');
module.exports = withBasic({});
```

## Requirements

- [QB64](https://qb64.com) installed and on your `PATH` (or set `QB64_PATH`)
- Next.js 14+
- Node.js 18+

## How it works

1. Any `app/api/**/route.bas` is detected at build time.
2. The plugin runs the QB64 compiler: `runtime.bas` + `route.bas` → native binary in `bin/`.
3. `route.types.ts` is generated from your `TYPE` blocks.
4. `route.ts` is generated as a thin Next.js shim that calls the binary.
5. The binary runs as a persistent process — one spawn, no cold starts.

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
| `QB64_PATH` | (from PATH) | Full path to the qb64 executable |
| `NEXTJS_BASIC_VERBOSE` | `0` | Set to `1` for build-time logging |

## License

MIT
