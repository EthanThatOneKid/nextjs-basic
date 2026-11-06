# Contributing to nextjs-basic

Thanks for your interest! This is a Kiroween 2026 hackathon project. Contributions are welcome.

## Prerequisites

- Node.js 20 or newer
- [QB64-PE](https://github.com/QB64-Phoenix-Edition/QB64pe/releases), for the end-to-end tests and local compilation. QB64 2.1 also works. The tests look for `QB64_PATH`, then `qb64pe`, then `qb64` on your `PATH`.
- npm
- Docker, only if you want to build the example image locally. CI builds it anyway.

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

This runs three kinds of test:

- **Unit tests** (`codegen.test.ts`, `plugin.test.ts`) need no compiler.
- **End-to-end tests** (`e2e.test.ts`) compile the example routes and a fixture that uses every field type, then talk to the binaries over the same STDIO protocol the plugin uses. They skip when no QB64 compiler is found. Set `QB64_PATH=/path/to/qb64pe` to run them.
- **Docs checks** (`docs.test.ts`) compare the docs with the code: handler names, the recycle budget, environment variables, example routes, the QB64-PE version and links. If you change one of those, update the docs in the same PR and this test will tell you what you missed.

Two environment variables help when debugging:

| Variable | Effect |
|---|---|
| `REQUIRE_QB64=1` | Fail instead of skipping the e2e tests when no compiler is found (CI sets it) |
| `E2E_TRACE=1` | Log each compile, process start and test name to stderr, so a hang shows where it stopped |

CI runs everything on Ubuntu, Windows and macOS, and a `docker` job builds the example image and calls every route.

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
  codegen.ts        parser, TypeScript generator, QB64 glue generator
  compiler.ts       QB64 → native binary compile step
  plugin.ts         webpack plugin, and prepareRoutes() (writes route files at config load)
  index.ts          withBasic() public API
  types.ts          shared error classes
  runtime/
    basicRuntime.ts Node.js child process manager
    runtime.bas     QB64 request loop and handler API (invisible to users)
  __tests__/
    codegen.test.ts unit tests for the parser and generators
    plugin.test.ts  unit tests for config-time generation
    docs.test.ts    checks that the docs match the code
    e2e.test.ts     end-to-end tests (need a QB64 compiler)
    fixtures/types/ route that uses every field type
example/
  app/api/hello/route.bas      GET, query string
  app/api/echo/route.bas       POST, Fail
  app/api/users/[id]/route.bas dynamic segment, headers
  app/api/status/route.bas     HEAD, OPTIONS, CORS
  Dockerfile                   image for Railway / Fly.io / Render
scripts/
  check-routes.sh         calls every example route on a running server (CI and deploys)
  deploy-cloud-run.sh     deploys the example to Google Cloud Run, checks it, deletes it
deploy/
  cloudbuild.yaml         Cloud Build config for the example image
docs/
  writing-routes.md reference for writing a route
  deployment.md     hosting guide
  submission.md     hackathon write-up
.kiro/specs/        requirements and design
tsconfig.json       type-checks everything, tests included
tsconfig.build.json what ships in dist/ (no tests)
```

## Adding a new feature

1. Write the test first: `codegen.test.ts` for the parser and generators, `e2e.test.ts` for runtime behavior
2. Implement in the relevant `src/` file
3. Update the docs it touches (`docs/writing-routes.md`, and the specs for design changes)
4. Verify: `npx tsc --noEmit && npm test`
5. Open a PR against `main`

## QB64 type system notes

Only types valid inside a QB64 `TYPE` block are supported. See the type table
in `README.md`. Bare `STRING`, `_BIT`, `_OFFSET`, `_MEM`, array fields and nested
`TYPE` fields are rejected with a build error. `docs/writing-routes.md` lists the
QB64 naming and calling rules that have bitten before.

## Commit style

Plain imperative subject line, 72 chars max. No emoji required.

## License

MIT
