# Writing routes

Reference for what a `route.bas` file can see and do, and how the plugin connects it to Next.js. This describes how things work today, rough edges included. The last section lists open design questions.

## The contract

A route lives at `app/api/<name>/route.bas`. The file path is the route, and `<name>` is the endpoint name. You write:

1. Zero or more `TYPE` blocks for your request and response bodies.
2. One function, `FUNCTION RunRoute$ (meth AS STRING)`, that returns the response body as a JSON string.

```basic
TYPE HelloBody
    name AS STRING * 50
END TYPE

TYPE HelloResult
    message AS STRING * 100
END TYPE

FUNCTION RunRoute$ (meth AS STRING)
    IF meth = "GET" THEN
        ParseHelloBody RTRIM$(gReq.bodyJson)
        glue_HelloResult.message = "Hello, " + RTRIM$(glue_HelloBody.name) + "!"
        gResp.statusCode = 200
        RunRoute$ = WriteHelloResult$
    ELSE
        gResp.statusCode = 405
        RunRoute$ = "{" + CHR$(34) + "error" + CHR$(34) + ":" + CHR$(34) + "Method Not Allowed" + CHR$(34) + "}"
    END IF
END FUNCTION
```

`RunRoute$` is called once per request, with `meth` set to `"GET"`, `"POST"`, `"PUT"`, `"DELETE"` or `"PATCH"`. Any other method gets a 405 from the framework before your code runs.

## What you can see

These are defined by the framework (`runtime.bas`) and are in scope in your file.

### `gReq` (the request)

| Field | Type | Contents |
|---|---|---|
| `gReq.method` | `STRING * 6` | HTTP method |
| `gReq.path` | `STRING * 255` | URL path, for example `/api/hello` |
| `gReq.bodyJson` | `STRING * 4096` | The request body as a JSON string, padded with spaces |
| `gReq.reqId` | `STRING * 36` | Correlation id the framework uses to match responses (leave it alone) |
| `gReq.endpoint` | `STRING * 64` | Route name |

Fixed-length strings are space-padded, so always use `RTRIM$(...)` when you read them.

Query strings are not passed. The shim reads the JSON body (`{}` when there is none) and passes only `path`, so a GET with `?name=x` does not reach your code.

### `gResp` (the response)

| Field | Type | Meaning |
|---|---|---|
| `gResp.statusCode` | `INTEGER` | HTTP status. The framework sets it to 200 before calling you |
| `gResp.bodyJson` | `STRING * 4096` | Set by the framework from your return value. Don't write it |

You return the body from `RunRoute$` and set only the status on `gResp`. There is no way to set response headers.

### Generated per `TYPE`

For every `TYPE Foo` in your file the plugin generates:

| Name | Kind | What it does |
|---|---|---|
| `glue_Foo` | `DIM SHARED` variable of type `Foo` | The one instance of that type you read and write |
| `ParseFoo jsonString` | `SUB` | Fills `glue_Foo` from a JSON string. Missing fields become empty or 0 |
| `WriteFoo$` | `FUNCTION` | Returns `glue_Foo` as a JSON object string |

There is one `glue_Foo` per type, shared across calls. Parse into it, read from it, or fill it and write it. Call `ParseFoo` before you read it, because it still holds the previous request's values until then.

### JSON helpers

For one-off fields, without declaring a type:

| Function | Returns |
|---|---|
| `JStr$(json, "key")` | String value of a top-level key, with `\"` and `\\` unescaped. Empty if missing |
| `JInt%(json, "key")` | Integer value of a top-level key, `0` if missing |

These only read top-level keys, and there are no helpers for arrays or nested objects.

## How methods are detected

The plugin finds which methods your route supports by scanning the file for the string literals `"GET"`, `"POST"`, `"PUT"`, `"DELETE"` and `"PATCH"`. Each one found gets an exported handler in the generated `route.ts`. A literal that appears in a comment-free line is enough to count, even if it is not in an `IF`. A method that is not found gets Next.js's own 405, and your function never runs.

## Types

| QB64 | TypeScript |
|---|---|
| `STRING * N` | `string` |
| `INTEGER`, `LONG`, `SINGLE`, `DOUBLE`, `_BYTE`, `_FLOAT` and the `_UNSIGNED` forms | `number` |
| `_INTEGER64`, `_UNSIGNED _INTEGER64` | `bigint` |
| `AS OtherType` | interface reference |

Rejected at build time with an error: bare `STRING`, `_BIT`, `_OFFSET`, `_MEM`, and array fields.

Every string field needs a size, and the response has to fit it. The framework also caps the request and response bodies at 4096 characters.

## What the plugin generates

All of these are written next to your `route.bas`, and none should be committed.

| File | Purpose |
|---|---|
| `route.types.ts` | TypeScript interfaces from your `TYPE` blocks |
| `route.ts` | Next.js handler per detected method. It forwards the JSON body, then returns your JSON with your status code |
| `route.glue_decls.bas` | The `DIM SHARED glue_*` lines |
| `route.glue.bas` | The `Parse*` and `Write*$` code |

The compiled binary goes to `bin/<name>` (`.exe` on Windows) at the project root. Source is combined as: glue declarations, then `runtime.bas`, then your file, then glue code.

## Runtime behavior

- One process per route, started on its first request and kept alive. There is no cold start after that.
- Each request is one line of JSON on STDIN and one line on STDOUT.
- A request that takes more than 5 seconds kills the process and fails with a timeout. The next request starts a fresh one.
- A crash fails the requests in flight and the next request restarts it.
- State in your variables persists across requests inside one process. The process can restart at any time, so don't rely on it.
- Requests to the same route are sent down one pipe, so a slow handler holds up the others.
- Output to STDOUT other than the framework's response line will break the protocol. Don't use `PRINT` in a route.

## Build behavior

- Routes are compiled when Next.js builds or starts. A route whose binary is newer than its `route.bas` and `runtime.bas` is not rebuilt.
- Compiler lookup: `QB64_PATH`, then `qb64pe`, then `qb64` on your `PATH`.
- Compile errors come from QB64 and fail the Next.js build.

## Names that QB64 rejects

QB64 reads keywords inside identifiers more aggressively than the docs suggest. Things that have failed:

- Names that start with `_`.
- Names that are or contain keywords: `POST`, `GET`, `key`, `pos`, `line`, `out`, `sin` and `HP` all caused errors in some position.
- A `$` sigil together with `AS STRING` in a `DIM` (`DIM json$ AS STRING`).
- User-defined types as `SUB` or `FUNCTION` parameters. This is why the glue uses shared variables.
- Calling a function with `()` when it takes no parameters.
- Code that is not a declaration (the main loop and `DIM SHARED`) after the first `SUB` or `FUNCTION`.

When something fails to compile, rename it first.

## Rough edges

Things I know are weak today:

- `Write*$` does not escape quotes or backslashes in string fields, so a response string containing `"` produces invalid JSON. (`Parse*` input is unescaped correctly.)
- Nested `TYPE` fields are accepted by the parser, but the generated glue passes a user type as a parameter, which QB64 rejects. Treat nested types as unsupported.
- `_INTEGER64` fields are read through `VAL`, which loses precision above 2^53.
- The generated shim does not pass query strings or headers.
- No way to return a non-JSON body or set headers.
- Methods are guessed from string literals.
- The 4096 body limit is silent: longer input is truncated.
- All but the happy path is lightly tested.

## Open design questions

For you to decide:

1. **Entry point shape.** One `RunRoute$` that you `IF`/`SELECT` on, versus separate `SUB`s per method. The separate form is nicer to read but QB64 rejects `GET` and `POST` as names, so it needs a prefix such as `Get_` or an annotation.
2. **Method declaration.** Keep scanning literals, or require an explicit line such as `' METHODS: GET, POST`?
3. **Request access.** `gReq` plus `ParseFoo` plus `glue_Foo` is three concepts. Alternatives: pass the parsed body into the route as a typed variable, or generate `Request_Foo` / `Response_Bar` by naming convention.
4. **Response shape.** Today you set `glue_*`, call `Write*$`, and set status separately. Could be one call, such as `Respond 200, WriteFoo$`.
5. **Errors.** A standard way to fail, for example `Fail 404, "not found"`, instead of hand-building an error JSON string.
6. **Query string and headers.** Expose them on `gReq`, and decide how a `GET` with params maps onto a body type.
7. **Name collisions.** `glue_*`, `g*` and the helper names are global. Decide on a prefix rule and a reserved-name list.
8. **Typed client.** Whether the generated TypeScript should export the request and response types as a pair so callers get typed `fetch`.
