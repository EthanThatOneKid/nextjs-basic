// src/__tests__/codegen.test.ts

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseBasFile,
  generateTypes,
  generateShim,
  generateQB64Glue,
  generateQB64GlueDecls,
  routeNameFor,
  routePascal,
  tsName,
} from '../codegen';
import { ParseError } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpBas(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-test-'));
  // Parser derives routeName from the parent directory name
  const routeDir = path.join(dir, 'hello');
  fs.mkdirSync(routeDir);
  const file = path.join(routeDir, 'route.bas');
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

// ---------------------------------------------------------------------------
// parseBasFile
// ---------------------------------------------------------------------------

describe('parseBasFile', () => {
  test('parses a simple TYPE and GET handler', () => {
    const file = tmpBas(`
TYPE HelloBody
    name AS STRING * 50
    age  AS INTEGER
END TYPE

SUB OnGet
    ' handler
END SUB
`);
    const parsed = parseBasFile(file);
    expect(parsed.routeName).toBe('hello');
    expect(parsed.methods).toEqual(['GET']);
    expect(parsed.types).toHaveLength(1);
    expect(parsed.types[0].name).toBe('HelloBody');
    expect(parsed.types[0].fields).toEqual([
      { name: 'name', qbType: 'STRING * 50', tsType: 'string' },
      { name: 'age',  qbType: 'INTEGER',     tsType: 'number' },
    ]);
  });

  test('detects every handler SUB, in any case', () => {
    const file = tmpBas(`
SUB OnGet
END SUB

sub onpost ()
end sub

SUB OnPut
END SUB

SUB OnDelete
END SUB

SUB OnPatch
END SUB

SUB OnHead
END SUB

SUB OnOptions
END SUB
`);
    expect(parseBasFile(file).methods).toEqual(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);
  });

  test('ignores method names in comments, strings and other SUBs', () => {
    const file = tmpBas(`
' SUB OnPost would go here
SUB Helper
    PRINT "GET and POST"
END SUB

SUB OnGet
END SUB
`);
    expect(parseBasFile(file).methods).toEqual(['GET']);
  });

  test('reports a route with no handlers as having no methods', () => {
    const file = tmpBas(`
TYPE Request
    a AS INTEGER
END TYPE
`);
    expect(parseBasFile(file).methods).toEqual([]);
  });

  test('explains how to migrate the old RunRoute$ function', () => {
    const file = tmpBas(`
FUNCTION RunRoute$ (meth AS STRING)
END FUNCTION
`);
    expect(() => parseBasFile(file)).toThrow(ParseError);
    expect(() => parseBasFile(file)).toThrow('SUB OnGet');
  });

  test('maps all supported numeric types', () => {
    const file = tmpBas(`
TYPE NumericTypes
    a AS INTEGER
    b AS LONG
    c AS SINGLE
    d AS DOUBLE
    e AS _BYTE
    f AS _FLOAT
    g AS _INTEGER64
    h AS _UNSIGNED INTEGER
    i AS _UNSIGNED LONG
    j AS _UNSIGNED _BYTE
    k AS _UNSIGNED _INTEGER64
END TYPE
`);
    const parsed = parseBasFile(file);
    const fields = parsed.types[0].fields;
    const byName = Object.fromEntries(fields.map(f => [f.name, f.tsType]));

    expect(byName['a']).toBe('number');
    expect(byName['b']).toBe('number');
    expect(byName['c']).toBe('number');
    expect(byName['d']).toBe('number');
    expect(byName['e']).toBe('number');
    expect(byName['f']).toBe('number');
    expect(byName['g']).toBe('bigint');
    expect(byName['h']).toBe('number');
    expect(byName['i']).toBe('number');
    expect(byName['j']).toBe('number');
    expect(byName['k']).toBe('bigint');
  });

  test('supports AS-first syntax (AS INTEGER x, y)', () => {
    const file = tmpBas(`
TYPE Point
    AS INTEGER x, y
END TYPE
`);
    const parsed = parseBasFile(file);
    expect(parsed.types[0].fields).toEqual([
      { name: 'x', qbType: 'INTEGER', tsType: 'number' },
      { name: 'y', qbType: 'INTEGER', tsType: 'number' },
    ]);
  });

  test('supports nested type references', () => {
    const file = tmpBas(`
TYPE Point
    x AS SINGLE
    y AS SINGLE
END TYPE

TYPE Circle
    center AS Point
    radius AS SINGLE
END TYPE
`);
    const parsed = parseBasFile(file);
    const circleFields = parsed.types[1].fields;
    expect(circleFields[0]).toMatchObject({ name: 'center', tsType: 'Point' });
    expect(circleFields[1]).toMatchObject({ name: 'radius', tsType: 'number' });
  });

  test('rejects bare STRING', () => {
    const file = tmpBas(`
TYPE Bad
    name AS STRING
END TYPE
`);
    expect(() => parseBasFile(file)).toThrow(ParseError);
    expect(() => parseBasFile(file)).toThrow('bare STRING');
  });

  test('rejects _BIT', () => {
    const file = tmpBas(`
TYPE Bad
    flag AS _BIT
END TYPE
`);
    expect(() => parseBasFile(file)).toThrow(ParseError);
    expect(() => parseBasFile(file)).toThrow('_BIT');
  });

  test('rejects _OFFSET', () => {
    const file = tmpBas(`
TYPE Bad
    ptr AS _OFFSET
END TYPE
`);
    expect(() => parseBasFile(file)).toThrow(ParseError);
  });

  test('rejects _MEM', () => {
    const file = tmpBas(`
TYPE Bad
    m AS _MEM
END TYPE
`);
    expect(() => parseBasFile(file)).toThrow(ParseError);
  });

  test('throws on unclosed TYPE block', () => {
    const file = tmpBas(`
TYPE Unclosed
    name AS STRING * 50
`);
    expect(() => parseBasFile(file)).toThrow(ParseError);
    expect(() => parseBasFile(file)).toThrow('not closed');
  });

  test('skips comment lines inside TYPE blocks', () => {
    const file = tmpBas(`
TYPE WithComment
    ' this is a comment
    name AS STRING * 50
    ' another comment
    age AS INTEGER
END TYPE
`);
    const parsed = parseBasFile(file);
    expect(parsed.types[0].fields).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// generateTypes
// ---------------------------------------------------------------------------

describe('generateTypes', () => {
  test('emits correct TypeScript interfaces', () => {
    const file = tmpBas(`
TYPE HelloBody
    name AS STRING * 50
    age  AS INTEGER
END TYPE
`);
    const parsed = parseBasFile(file);
    const ts = generateTypes(parsed);
    expect(ts).toContain('export interface HelloBody {');
    expect(ts).toContain('  name: string;');
    expect(ts).toContain('  age: number;');
    expect(ts).toContain('AUTO-GENERATED');
  });

  test('emits bigint for _INTEGER64', () => {
    const file = tmpBas(`
TYPE BigNums
    count AS _INTEGER64
END TYPE
`);
    const parsed = parseBasFile(file);
    const ts = generateTypes(parsed);
    expect(ts).toContain('  count: bigint;');
  });

  test('throws on unresolved nested type reference', () => {
    const file = tmpBas(`
TYPE Body
    loc AS UnknownType
END TYPE
`);
    const parsed = parseBasFile(file);
    expect(() => generateTypes(parsed)).toThrow(ParseError);
    expect(() => generateTypes(parsed)).toThrow('UnknownType');
  });
});

// ---------------------------------------------------------------------------
// generateShim
// ---------------------------------------------------------------------------

describe('generateShim', () => {
  const twoMethods = `
TYPE Body
    name AS STRING * 50
END TYPE

SUB OnGet
END SUB

SUB OnPost
END SUB
`;

  test('emits one export per handler', () => {
    const shim = generateShim(parseBasFile(tmpBas(twoMethods)));
    expect(shim).toContain('export async function GET');
    expect(shim).toContain('export async function POST');
    expect(shim).not.toContain('export async function PUT');
    expect(shim).toContain('callBasic');
    expect(shim).toContain('endpoint: "hello"');
    expect(shim).toContain('export type { Body }');
  });

  test('forwards query, headers and params', () => {
    const shim = generateShim(parseBasFile(tmpBas(twoMethods)));
    expect(shim).toContain('searchParams');
    expect(shim).toContain('req.headers');
    expect(shim).toContain('await ctx.params');
  });

  test('HEAD and OPTIONS handlers get exports too', () => {
    const shim = generateShim(parseBasFile(tmpBas(`
SUB OnHead
END SUB

SUB OnOptions
END SUB
`)));
    expect(shim).toContain('export async function HEAD');
    expect(shim).toContain('export async function OPTIONS');
  });

  test('responses that cannot carry a body are sent without one', () => {
    const shim = generateShim(parseBasFile(tmpBas(twoMethods)));
    expect(shim).toContain('status === 204 || status === 205 || status === 304');
    expect(shim).toContain('return new NextResponse(null, { status, headers });');
  });

  test('a HEAD handler always sends no body, with no comparison TypeScript would reject', () => {
    const shim = generateShim(parseBasFile(tmpBas(`
SUB OnHead
END SUB
`)));
    expect(shim).toContain('export async function HEAD');
    expect(shim).toContain('return new NextResponse(null, { status, headers });');
    expect(shim).not.toContain('NextResponse.json');
  });

  test('the generated shim has no always-false comparisons (next build type-checks it)', () => {
    const shim = generateShim(parseBasFile(tmpBas(twoMethods)));
    // "GET" === 'HEAD' is a TypeScript error: the two literal types do not overlap
    expect(shim).not.toMatch(/"[A-Z]+" === '/);
  });

  test('an OPTIONS handler sets the Allow header Next.js would have set', () => {
    const shim = generateShim(parseBasFile(tmpBas(`
SUB OnGet
END SUB

SUB OnPost
END SUB

SUB OnOptions
END SUB
`)));
    expect(shim).toContain("if (!headers.has('Allow')) headers.set('Allow', \"GET, POST, OPTIONS, HEAD\");");
  });

  test('every handler forwards the headers the route set', () => {
    const shim = generateShim(parseBasFile(tmpBas(twoMethods)));
    expect(shim).toContain('const headers = new Headers();');
    expect(shim).toContain('headers.append(name, value)');
    expect(shim).toContain('new NextResponse(null, { status, headers })');
    expect(shim).toContain('NextResponse.json(data, { status, headers })');
  });

  test('other handlers send no Allow header', () => {
    const shim = generateShim(parseBasFile(tmpBas(`
SUB OnGet
END SUB
`)));
    expect(shim).not.toContain('Allow');
  });

  test('returns the parsed body with the status the route chose', () => {
    const shim = generateShim(parseBasFile(tmpBas(twoMethods)));
    expect(shim).toContain('JSON.parse(result.bodyJson');
    expect(shim).toContain('const status = result.statusCode ?? 200;');
    expect(shim).toContain('return NextResponse.json(data, { status, headers });');
  });
});

// ---------------------------------------------------------------------------
// TypeScript names for Request / Response
// ---------------------------------------------------------------------------

describe('TypeScript names', () => {
  const route = `
TYPE Request
    name AS STRING * 50
END TYPE

TYPE Response
    message AS STRING * 100
END TYPE

SUB OnGet
END SUB
`;

  test('Request and Response get a per-route prefix so they never shadow the DOM types', () => {
    const parsed = parseBasFile(tmpBas(route));
    const ts = generateTypes(parsed);
    expect(ts).toContain('export interface HelloRequest {');
    expect(ts).toContain('export interface HelloResponse {');
    expect(ts).not.toContain('export interface Request');
    expect(ts).not.toContain('export interface Response');
  });

  test('exports a request/response pair', () => {
    const ts = generateTypes(parseBasFile(tmpBas(route)));
    expect(ts).toContain('export interface HelloRoute {');
    expect(ts).toContain('request: HelloRequest;');
    expect(ts).toContain('response: HelloResponse;');
  });

  test('the shim re-exports the renamed types and the pair', () => {
    const shim = generateShim(parseBasFile(tmpBas(route)));
    expect(shim).toContain('export type { HelloRequest, HelloResponse, HelloRoute }');
  });

  test('no pair when only one of the two types exists', () => {
    const file = tmpBas(`
TYPE Response
    message AS STRING * 10
END TYPE

SUB OnGet
END SUB
`);
    const ts = generateTypes(parseBasFile(file));
    expect(ts).toContain('export interface HelloResponse {');
    expect(ts).not.toContain('HelloRoute');
  });

  test('routePascal makes safe identifiers from dynamic route names', () => {
    expect(routePascal('hello')).toBe('Hello');
    expect(routePascal('users___id_')).toBe('UsersId');
    expect(routePascal('docs______slug_')).toBe('DocsSlug');
    expect(routePascal('2fa')).toBe('R2fa');
    expect(routePascal('___')).toBe('Route');
  });

  test('other type names are left alone', () => {
    expect(tsName('hello', 'Point')).toBe('Point');
    expect(tsName('hello', 'Request')).toBe('HelloRequest');
  });
});

describe('routeNameFor', () => {
  const api = (...p: string[]) => path.join('proj', 'app', 'api', ...p, 'route.bas');

  test('uses the path below app/api', () => {
    expect(routeNameFor(api('hello'))).toBe('hello');
    expect(routeNameFor(api('users', 'list'))).toBe('users__list');
  });

  test('makes dynamic segments filesystem-safe and unique per route', () => {
    expect(routeNameFor(api('users', '[id]'))).toBe('users___id_');
    expect(routeNameFor(api('posts', '[id]'))).not.toBe(routeNameFor(api('users', '[id]')));
    expect(routeNameFor(api('docs', '[...slug]'))).toBe('docs______slug_');
  });

  test('falls back to the folder name outside app/api', () => {
    expect(routeNameFor(path.join('tmp', 'hello', 'route.bas'))).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// generateQB64Glue / generateQB64GlueDecls
// ---------------------------------------------------------------------------

describe('generateQB64GlueDecls', () => {
  test('declares Req and Resp only for the types that exist', () => {
    const both = generateQB64GlueDecls(parseBasFile(tmpBas(`
TYPE Request
    a AS INTEGER
END TYPE
TYPE Response
    b AS INTEGER
END TYPE
`)));
    expect(both).toContain('DIM SHARED Req AS Request');
    expect(both).toContain('DIM SHARED Resp AS Response');
    expect(both).toContain('DIM SHARED RespBlank AS Response');

    const none = generateQB64GlueDecls(parseBasFile(tmpBas(`
SUB OnGet
END SUB
`)));
    expect(none).not.toMatch(/^DIM SHARED/m);
  });
});

describe('generateQB64Glue', () => {
  const full = `
TYPE Request
    name  AS STRING * 50
    count AS INTEGER
    ratio AS DOUBLE
END TYPE

TYPE Response
    message AS STRING * 100
    total   AS LONG
    share   AS SINGLE
END TYPE

SUB OnGet
END SUB

SUB OnPost
END SUB
`;

  test('ParseRequest takes a JSON string, never a TYPE parameter', () => {
    const glue = generateQB64Glue(parseBasFile(tmpBas(full)));
    expect(glue).toContain('SUB ParseRequest (jsonIn AS STRING)');
    expect(glue).toContain('Req.name = JStr$(jsonIn, "name")');
  });

  test('WriteResponse$ escapes strings and fixes number formatting', () => {
    const glue = generateQB64Glue(parseBasFile(tmpBas(full)));
    expect(glue).toContain('FUNCTION WriteResponse$ ()');
    expect(glue).toContain('JEn$(TrimF$(Resp.message))');
    expect(glue).toContain('LTRIM$(STR$(Resp.total))');
    expect(glue).toContain('NumS$(Resp.share)');
  });

  test('integer fields are range checked, floats are not', () => {
    const glue = generateQB64Glue(parseBasFile(tmpBas(full)));
    expect(glue).toContain('IF pv < -32768 OR pv > 32767 THEN Fail 400, "count is out of range"');
    expect(glue).toContain('Req.ratio = VAL(JVal$(jsonIn, "ratio"))');
    expect(glue).not.toContain('ratio is out of range');
  });

  test.each([
    ['LONG', '-2147483648', '2147483647'],
    ['_BYTE', '-128', '127'],
    ['_UNSIGNED INTEGER', '0', '65535'],
    ['_UNSIGNED LONG', '0', '4294967295'],
    ['_UNSIGNED _BYTE', '0', '255'],
  ])('%s uses its real range', (qbType, lo, hi) => {
    const glue = generateQB64Glue(parseBasFile(tmpBas(`
TYPE Request
    n AS ${qbType}
END TYPE
`)));
    expect(glue).toContain(`IF pv < ${lo} OR pv > ${hi} THEN Fail 400, "n is out of range"`);
  });

  test('AllowCors lists the methods the route supports', () => {
    const glue = generateQB64Glue(parseBasFile(tmpBas(`
SUB OnGet
END SUB

SUB OnPost
END SUB
`)));
    expect(glue).toContain('SUB AllowCors (origin AS STRING)');
    expect(glue).toContain('SetHeader "Access-Control-Allow-Origin", origin');
    expect(glue).toContain('IF origin <> "*" THEN SetHeader "Vary", "Origin"');
    expect(glue).toContain('SetHeader "Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS"');
  });

  test('the dispatcher routes HEAD and OPTIONS to OnHead and OnOptions', () => {
    const glue = generateQB64Glue(parseBasFile(tmpBas(`
SUB OnHead
END SUB

SUB OnOptions
END SUB
`)));
    expect(glue).toContain('CASE "HEAD"');
    expect(glue).toContain('OnHead');
    expect(glue).toContain('CASE "OPTIONS"');
    expect(glue).toContain('OnOptions');
  });

  test('GET and HEAD fill Req from the query string, other methods from the body', () => {
    const glue = generateQB64Glue(parseBasFile(tmpBas(full)));
    expect(glue).toContain('IF m = "GET" OR m = "HEAD" THEN');
    expect(glue).toContain('ParseRequest RTRIM$(Ctx.queryJson)');
    expect(glue).toContain('ParseRequest RTRIM$(Ctx.bodyJson)');
  });

  test('Resp is reset at the start of every request', () => {
    const glue = generateQB64Glue(parseBasFile(tmpBas(full)));
    expect(glue).toContain('Resp = RespBlank');
  });

  test('the dispatcher has a case per handler and a 405 for the rest', () => {
    const glue = generateQB64Glue(parseBasFile(tmpBas(full)));
    expect(glue).toContain('CASE "GET"');
    expect(glue).toContain('OnGet');
    expect(glue).toContain('CASE "POST"');
    expect(glue).toContain('OnPost');
    expect(glue).not.toContain('CASE "PUT"');
    expect(glue).toContain('Fail 405, "Method Not Allowed"');
  });

  test('a route with no types still gets a dispatcher and an empty body', () => {
    const glue = generateQB64Glue(parseBasFile(tmpBas(`
SUB OnGet
END SUB
`)));
    expect(glue).toContain('AUTO-GENERATED');
    expect(glue).toContain('SUB GlueDispatch (m AS STRING)');
    expect(glue).toContain('GlueFinish$ = "{}"');
    expect(glue).not.toContain('SUB ParseRequest');
    expect(glue).not.toContain('Resp = RespBlank');
  });

  test('nested types are rejected with a clear error', () => {
    const file = tmpBas(`
TYPE Point
    x AS INTEGER
END TYPE

TYPE Request
    where AS Point
END TYPE
`);
    const parsed = parseBasFile(file);
    expect(() => generateQB64Glue(parsed)).toThrow(ParseError);
    expect(() => generateQB64Glue(parsed)).toThrow('nested type "Point"');
  });

  test('types other than Request and Response produce no JSON code', () => {
    const glue = generateQB64Glue(parseBasFile(tmpBas(`
TYPE Helper
    x AS INTEGER
END TYPE
`)));
    expect(glue).not.toContain('Helper');
  });
});
