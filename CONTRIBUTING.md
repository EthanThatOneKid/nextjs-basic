# Contributing to nextjs-basic

Thanks for your interest! This is a Kiroween 2026 hackathon project. Contributions are welcome.

## Prerequisites

- Node.js 20+
- [QB64](https://qb64.com) (for e2e tests and local compilation)
- npm

## Setup

```bash
git clone https://github.com/EthanThatOneKid/nextjs-basic.git
cd nextjs-basic
npm install --legacy-peer-deps
```

## Running tests

```bash
npm test
```

Unit tests run without QB64. E2e tests auto-skip when `qb64` is not on `PATH`.
Set `QB64_PATH=/path/to/qb64` to run e2e tests locally.

## Type-check

```bash
npx tsc --noEmit
```

## Build

```bash
npm run build
```

## Project structure

```
src/
  codegen.ts        QB64 TYPE parser + TypeScript codegen
  compiler.ts       QB64 → native binary compile step
  plugin.ts         webpack plugin (Next.js integration)
  index.ts          withBasic() public API
  types.ts          shared error classes
  runtime/
    basicRuntime.ts Node.js child process manager
    runtime.bas     QB64 STDIO loop (invisible to users)
  __tests__/
    codegen.test.ts unit tests
    e2e.test.ts     QB64 integration tests (skipped without QB64)
example/
  app/api/hello/route.bas   minimal GET example
  app/api/echo/route.bas    POST echo example
```

## Adding a new feature

1. Write the test first in `src/__tests__/codegen.test.ts`
2. Implement in the relevant `src/` file
3. Verify: `npx tsc --noEmit && npm test`
4. Open a PR against `main`

## QB64 type system notes

Only types valid inside a QB64 `TYPE` block are supported. See the type table
in `README.md`. Bare `STRING`, `_BIT`, `_OFFSET`, `_MEM`, and array fields
inside TYPE blocks are rejected with a build error.

## Commit style

Plain imperative subject line, 72 chars max. No emoji required.

## License

MIT
