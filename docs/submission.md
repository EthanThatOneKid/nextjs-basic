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

`GET /api/hello?name=Ada` returns that message as JSON. That's the whole file. The
plugin takes it from there.

A route can also fail early, set headers, and answer CORS preflights, all from
BASIC:

```basic
SUB OnPost
    IF RTRIM$(Req.message) = "" THEN Fail 400, "message is required"
    SetHeader "Cache-Control", "no-store"
    AllowCors "https://app.example.com"
    ' ...
END SUB
```

---

## Why QB64 actually works here

QB64 isn't a toy. It transpiles to C++ and compiles to a native binary. The same
source builds on Windows, Linux and macOS without changes.

The one thing QB64 can't do is WebSockets or gRPC. But it can read from STDIN and
write to STDOUT, which is all you need. The plugin starts the binary once per
route and keeps it alive, so every request is a JSON line in and a JSON line out.
There's no process start per request.

---

## How it works

When Next.js builds, the plugin finds every `app/api/**/route.bas`. It parses the
`TYPE` blocks, writes the TypeScript interfaces and a thin `route.ts` handler, and
generates the BASIC code that moves data between JSON and your types. That, the
framework's request loop and your file are compiled into one native binary per
route.

At request time:

```
Next.js → route.ts → Node.js child process → QB64 binary (STDIO) → response
```

The binary fills `Req` from the query string or the JSON body, runs the `OnGet` or
`OnPost` that matches the method, and sends `Resp` back as JSON. I settled on that
shape after trying a few others. The first version had one big `RunRoute$` function
you wrote an `IF` in, and a pile of globals with names like `gReq` and `glue_Foo`.
It worked, but I didn't want to explain it, so I redesigned it around one `SUB` per
method and fixed names, then wrote down the rules in `docs/writing-routes.md`.

---

## What went wrong along the way

QB64 gave me more surprises than I expected. It can't pass a user `TYPE` into a
`SUB`, which is why `Req` and `Resp` are shared variables. A function with no
parameters can't be called with `()`. Names I'd have sworn were fine, like `key`,
`pos` and `out`, were rejected. Some of this I only learned by running it.

The bug I like least was in `Fail`. QB64 has no exceptions, so to stop a handler
early I raise an error and resume after the call. It worked in every test, until I
ran the tests on macOS in CI and the process died of "Out of stack space" after
about 290 failed requests. Each early exit leaks a little stack. Windows lasts about
1,500, which is why I hadn't seen it. I tried a few ways to make QB64 give the stack
back and none worked. So the binary now counts its failures and, after 25, asks the
plugin to replace it with a fresh process. New requests go to the new one, the old
one finishes what it was already sent and exits, and nothing gets dropped. A test
sends 1,700 failures through the real runtime to keep that honest.

`next dev` also hid a bug that `next build` found. The generated `route.ts`
compared a method name with `'HEAD'` in a way TypeScript rejects, and only the
production build type-checks. And the first `npm install github:…` from a clean
project gave me a package with no compiled code in it, because nothing built it on
install. A third one turned up when I finally tested the Docker image: on a fresh
checkout `next build` produced no API routes at all, because Next.js looks for route
files before the plugin has generated them. All three are fixed now.

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

Requires QB64-PE (or QB64) on your PATH, or set `QB64_PATH`. The plugin does the
rest. I checked this in an empty Next.js 14 app, and checked `next dev`,
`next build` and `next start` on the example app.

---

## Built with Kiro

I used Kiro's spec-driven workflow: wrote `requirements.md` and `design.md` first,
then built against them. The specs are in `.kiro/specs/`. They were rewritten after
the redesign, so they describe what ended up shipping, not the first draft.

The code is `src/codegen.ts` (parser and generators), `src/compiler.ts`,
`src/plugin.ts`, `src/runtime/basicRuntime.ts` for the Node side and
`src/runtime/runtime.bas` for the BASIC side. There are over a hundred tests. The
end-to-end ones compile real routes with QB64 and talk to them over the same STDIO
protocol the plugin uses, and CI runs them on Ubuntu, Windows and macOS.

---

## Known limitations

Strings in `TYPE` blocks must be fixed-length (`STRING * 50`), and nested types
aren't supported. A response header can be added but not replaced, and `AllowCors`
takes a single origin. Request and response types are shared by all methods of a
route. It needs a persistent server, so Vercel and other serverless platforms
won't work, but Railway, Fly.io and Render do; there's a `Dockerfile` in `example/`
and a guide in `docs/deployment.md`. CI builds that image and calls every route on
each push, but I haven't deployed it to any of those hosts. There's no streaming and no middleware.

---

## Repo layout

```
src/                   plugin
example/
  app/api/hello/       GET, query string
  app/api/echo/        POST, Fail
  app/api/users/[id]/  dynamic segment, headers
  app/api/status/      HEAD, OPTIONS, CORS
  Dockerfile           for Railway / Fly.io / Render
docs/
  writing-routes.md    reference for writing a route
  deployment.md        hosting guide
  submission.md        this file
.kiro/specs/
  requirements.md
  design.md
```
