# Writing routes

Reference for what a `route.bas` file can see and do, and how the plugin connects it to Next.js.

## The contract

A route lives at `app/api/<path>/route.bas`. The folder path is the URL. You write:

1. A `TYPE Request` (optional): the input fields.
2. A `TYPE Response` (optional): the output fields.
3. One `SUB` per HTTP method you support: `OnGet`, `OnPost`, `OnPut`, `OnDelete`, `OnPatch`.

```basic
TYPE Request
    name AS STRING * 50
END TYPE

TYPE Response
    message AS STRING * 100
END TYPE

SUB OnGet
    IF RTRIM$(Req.name) = "" THEN Fail 400, "name is required"
    Resp.message = "Hello, " + RTRIM$(Req.name) + "!"
END SUB
```

Before your SUB runs, the plugin fills `Req`. Your SUB sets fields on `Resp`. When it ends, `Resp` is sent as JSON with status 200. Nothing else is needed.

The methods a route supports are exactly the `On...` SUBs it defines. A request for any other method gets a 405 from Next.js. A route with no handler at all fails the build.

The names are fixed. You always write `Request`, `Response`, `Req` and `Resp`, whatever the route is called.

## Request: `Req`

`Req` has the fields of your `TYPE Request`, filled in for you:

| Method | Filled from |
|---|---|
| `GET`, `HEAD` | The query string (`?name=Ada`) |
| everything else | The JSON body |

- Missing fields are empty (`""`) or `0`.
- Numbers can arrive as `3` or `"3"`, so query strings work for number fields.
- An integer outside its type's range fails the request with a 400 (`count is out of range`). QB64 would otherwise wrap it silently.
- Strings are fixed length and space padded. Use `RTRIM$(Req.name)` before comparing.
- Text longer than the field is cut.
- `Req` is refilled for every request, so nothing carries over.

## Response: `Resp`

Set any of the fields of your `TYPE Response`. `Resp` is cleared before each request, so fields you do not set are empty or `0`.

| Statement | Effect |
|---|---|
| `Respond 201` | Sets the HTTP status. The default is 200 |
| `Fail 404, "not found"` | Stops your SUB right there and sends `{"error": "not found"}` with that status |

`Fail` works from anywhere, including a helper SUB you call. Nothing after it runs. If your SUB runs into a QB64 runtime error (for example dividing by zero), the request gets a 500 and the process keeps serving.

## Reading more of the request

| Name | Reads | Example |
|---|---|---|
| `Query$("name")` | A query string value | `Ada` |
| `Header$("user-agent")` | A request header (the name is case-insensitive) | `Mozilla/5.0 ...` |
| `Param$("id")` | A dynamic segment (`app/api/users/[id]/route.bas`) | `42` |
| `Ctx.method`, `Ctx.path` | The method and URL path | `GET`, `/api/hello` |
| `Ctx.bodyJson` | The raw JSON body, if you want to parse it yourself | `{"a":1}` |

Missing values come back as `""`. Limits: query 2048, headers 4096, params 1024, body 4096 characters, and anything longer is cut.

For one-off values, `JStr$(json, "key")` and `JVal$(json, "key")` read a top-level key from any JSON string you hold. `JVal$` accepts both `3` and `"3"`.

## Types

| QB64 | TypeScript |
|---|---|
| `STRING * N` | `string` |
| `INTEGER`, `LONG`, `SINGLE`, `DOUBLE`, `_BYTE`, `_FLOAT` and the `_UNSIGNED` forms | `number` |
| `_INTEGER64`, `_UNSIGNED _INTEGER64` | `bigint` |

Rejected at build time: bare `STRING`, `_BIT`, `_OFFSET`, `_MEM`, array fields, and fields whose type is another `TYPE` (nested types are not supported yet).

Only `Request` and `Response` become JSON code. Other `TYPE`s are allowed in the file for your own use, but nothing is generated for them.

`_INTEGER64` values are read as double precision numbers, so values above 2^53 lose digits.

## TypeScript types

The generated `route.types.ts` names the types after the route, so they never shadow the DOM `Request` and `Response`:

```ts
// app/api/hello/route.bas
export interface HelloRequest { name: string; }
export interface HelloResponse { message: string; }
export interface HelloRoute { request: HelloRequest; response: HelloResponse; }
```

`HelloRoute` pairs the two, for typing a `fetch` call. A route at `users/[id]` becomes `UsersId...`. The route file re-exports them.

## What the plugin generates

All of these sit next to your `route.bas`, and none should be committed.

| File | Purpose |
|---|---|
| `route.types.ts` | TypeScript interfaces |
| `route.ts` | One Next.js handler per `On...` SUB. It forwards the body, query string, headers and params, then returns your JSON with your status code |
| `route.glue_decls.bas` | The `Req` and `Resp` variables |
| `route.glue.bas` | Code that reads `Req`, writes `Resp`, and calls the right SUB |

The compiled binary goes to `bin/<name>` (`.exe` on Windows) at the project root. `<name>` is the folder path below `app/api`, with unsafe characters replaced by `_`. For example `users/[id]` becomes `users___id_`.

## Runtime behavior

- One process per route, started on its first request and kept alive. There is no cold start after that.
- Each request is one line of JSON on STDIN and one line on STDOUT. Do not `PRINT` in a route.
- A request that takes more than 5 seconds kills the process and fails with a timeout. The next request starts a fresh one.
- A crash fails the requests in flight, and the next request restarts it.
- Your own variables keep their values between requests inside one process. The process can restart at any time, so don't rely on that.
- Requests to the same route go down one pipe, so a slow handler holds up the others.
- QB64 cannot see its input close. The Node runtime sends `{"_quit":true}` and also kills its routes on exit, but a process whose parent was killed outright keeps running until you stop it.

## Build behavior

- Routes are compiled when Next.js builds or starts, with `qb64pe -x` (headless).
- A route whose binary is newer than its `route.bas`, `runtime.bas` and the plugin itself is not rebuilt.
- Compiler lookup: `QB64_PATH`, then `qb64pe`, then `qb64` on your `PATH`.
- A compile error from QB64 fails the Next.js build.
- The old `FUNCTION RunRoute$` form is rejected with a message pointing here.

## QB64 gotchas

- Names cannot start with `_`.
- A name that equals a QB64 keyword fails (`key`, `pos`, `line`, `out`, `sin`, ...), including as a parameter name.
- `DIM x$ AS STRING` is an error, because the `$` already makes it a string.
- A function with no parameters is called without `()`.
- User-defined types cannot be passed to a `SUB` or `FUNCTION`. That is why `Req` and `Resp` are shared variables.
- Main-module code and `DIM SHARED` must come before the first `SUB` or `FUNCTION`. Your route file only has `TYPE`s and `SUB`s, so this only matters if you add main-module code.

## Rough edges

- `HEAD` and `OPTIONS` are not handled yet ([#3](https://github.com/EthanThatOneKid/nextjs-basic/issues/3)).
- Only `app/api` is scanned. `src/app` is not.
- Nested `TYPE` fields are not supported.
- No way to set response headers or return a non-JSON body.
- A `GET` always reads the query string. There is no way to send it a body.
- One `Request` and one `Response` type per route, shared by all methods.
- Everything above 4096 characters of body is cut silently.

## Open design questions

1. **Per-method types.** `GetRequest` / `PostRequest` when methods need different shapes.
2. **Response headers.** Something like `Header "Cache-Control", "no-store"`.
3. **Typed client.** A generated `fetch` wrapper built on `HelloRoute`.
4. **`proxy.bas`.** Whether other Next.js backend files (see the file conventions) deserve the same treatment.
