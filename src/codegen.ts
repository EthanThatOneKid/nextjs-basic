// src/codegen.ts — QB64 TYPE parser and TypeScript code generator

import * as fs from 'fs';
import * as path from 'path';
import { QB64Field, QB64TypeBlock, ParsedRoute, ParseError } from './types';

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

const UNSUPPORTED: Record<string, string> = {
  '_BIT':    '_BIT is not allowed inside QB64 TYPE blocks',
  '_OFFSET': '_OFFSET is a pointer type with no JavaScript equivalent',
  '_MEM':    '_MEM is a memory handle type with no JavaScript equivalent',
  'STRING':  'bare STRING is not allowed in TYPE blocks; use STRING * N (e.g. STRING * 50)',
};

function qb64TypeToTs(rawType: string, file: string, line: number, field: string): string {
  const t = rawType.trim().toUpperCase();

  // Allow fixed-length strings before the bare-STRING rejection fires
  if (t.startsWith('STRING *'))         return 'string';

  // Reject unsupported types: exact match only (no prefix collision with STRING *)
  for (const [key, reason] of Object.entries(UNSUPPORTED)) {
    if (t === key) {
      throw new ParseError(file, line, field, reason);
    }
  }
  if (t === 'INTEGER')                  return 'number';
  if (t === 'LONG')                     return 'number';
  if (t === 'SINGLE')                   return 'number';
  if (t === 'DOUBLE')                   return 'number';
  if (t === '_BYTE')                    return 'number';
  if (t === '_FLOAT')                   return 'number';
  if (t === '_INTEGER64')               return 'bigint';
  if (t === '_UNSIGNED INTEGER')        return 'number';
  if (t === '_UNSIGNED LONG')           return 'number';
  if (t === '_UNSIGNED _BYTE')          return 'number';
  if (t === '_UNSIGNED _INTEGER64')     return 'bigint';
  if (t === '_UNSIGNED _FLOAT')         return 'number';

  // Anything else is treated as a reference to another user-defined TYPE.
  // Validation that it exists happens at emit time.
  return rawType.trim(); // preserve original casing for the interface name
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Unique, filesystem-safe endpoint name. Files under app/api use their path below
 * it (users/[id] -> users___id_), so two [id] routes never share a binary.
 */
export function routeNameFor(basFile: string): string {
  const parts = path.dirname(path.resolve(basFile)).split(path.sep);
  const idx = parts.lastIndexOf('api');
  const rel = idx > 0 && parts[idx - 1] === 'app' ? parts.slice(idx + 1) : [parts[parts.length - 1]];
  return rel.join('__').replace(/[^A-Za-z0-9_-]/g, '_') || 'index';
}

export function parseBasFile(basFile: string): ParsedRoute {
  const src = fs.readFileSync(basFile, 'utf8');
  const lines = src.split(/\r?\n/);

  const types: QB64TypeBlock[] = [];
  const methods: string[] = [];

  let inType = false;
  let currentType: QB64TypeBlock | null = null;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i];
    const trimmed = raw.trim();
    const upper = trimmed.toUpperCase();

    // Skip comments and blank lines
    if (upper.startsWith("'") || trimmed === '') continue;

    // Handlers are `SUB OnGet`, `SUB OnPost`, ... (outside TYPE blocks)
    if (!inType) {
      if (upper.startsWith('FUNCTION RUNROUTE')) {
        throw new ParseError(
          basFile, lineNo, 'RunRoute$',
          'RunRoute$ was replaced by one SUB per method: SUB OnGet, SUB OnPost, SUB OnPut, SUB OnDelete, SUB OnPatch, SUB OnHead, SUB OnOptions'
        );
      }
      const handler = upper.match(/^SUB +ON(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)( |[(]|$)/);
      if (handler && !methods.includes(handler[1])) methods.push(handler[1]);
    }

    // TYPE block open
    if (!inType && upper.startsWith('TYPE ')) {
      const name = trimmed.slice(5).trim();
      if (!name) throw new ParseError(basFile, lineNo, '(type name)', 'TYPE keyword missing a name');
      currentType = { name, fields: [] };
      inType = true;
      continue;
    }

    // TYPE block close
    if (inType && upper === 'END TYPE') {
      if (currentType) types.push(currentType);
      currentType = null;
      inType = false;
      continue;
    }

    // Inside a TYPE block — parse field lines
    if (inType && currentType) {
      // Two syntaxes:
      //   fieldName AS type
      //   AS type fieldName1, fieldName2, ...
      const asMatch = upper.match(/^(\w+)\s+AS\s+(.+)$/);
      const asFirst = upper.match(/^AS\s+(.+?)\s+(.+)$/);

      if (asMatch) {
        const fieldName = trimmed.split(/\s+/)[0];
        const qbType = trimmed.slice(asMatch[1].length).replace(/^\s*AS\s*/i, '').trim();
        const tsType = qb64TypeToTs(qbType, basFile, lineNo, fieldName);
        currentType.fields.push({ name: fieldName, qbType, tsType });
      } else if (asFirst) {
        // AS INTEGER x, y, z
        const qbType = trimmed.replace(/^AS\s+/i, '').split(/\s+/)[0];
        const rest = trimmed.slice(trimmed.toUpperCase().indexOf(qbType) + qbType.length).trim();
        const fieldNames = rest.split(',').map(s => s.trim()).filter(Boolean);
        for (const fieldName of fieldNames) {
          const tsType = qb64TypeToTs(qbType, basFile, lineNo, fieldName);
          currentType.fields.push({ name: fieldName, qbType, tsType });
        }
      }
      // Lines that don't match (e.g. empty or comments inside TYPE) are skipped
    }
  }

  if (inType) {
    throw new ParseError(basFile, lines.length, currentType?.name ?? '?', 'TYPE block not closed with END TYPE — missing END TYPE');
  }

  // Derive route name from directory
  const routeName = routeNameFor(basFile);

  return { basFile, routeName, methods, types };
}

// ---------------------------------------------------------------------------
// Codegen — route.types.ts
// ---------------------------------------------------------------------------

/** PascalCase form of the route name, used to namespace generated TypeScript types. */
export function routePascal(routeName: string): string {
  const pascal = routeName
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  if (!pascal) return 'Route';
  return /^[0-9]/.test(pascal) ? 'R' + pascal : pascal;
}

/**
 * The BASIC types `Request` and `Response` are renamed per route on the TypeScript
 * side (HelloRequest, HelloResponse) so they never shadow the DOM globals.
 */
export function tsName(routeName: string, typeName: string): string {
  return typeName === 'Request' || typeName === 'Response'
    ? routePascal(routeName) + typeName
    : typeName;
}

export function generateTypes(parsed: ParsedRoute): string {
  const lines: string[] = [
    '// AUTO-GENERATED by nextjs-basic — do not edit',
    `// Source: ${parsed.basFile.replace(/\\/g, '/')}`,
    '',
  ];

  // Collect all known type names for reference validation
  const knownTypes = new Set(parsed.types.map(t => t.name.toUpperCase()));

  for (const type of parsed.types) {
    lines.push(`export interface ${tsName(parsed.routeName, type.name)} {`);
    for (const field of type.fields) {
      // Validate nested type references
      const ts = field.tsType;
      const isBuiltin = ['string', 'number', 'bigint', 'boolean'].includes(ts);
      if (!isBuiltin && !knownTypes.has(ts.toUpperCase())) {
        throw new ParseError(
          parsed.basFile, 0, field.name,
          `references type "${ts}" which is not defined in this file`
        );
      }
      lines.push(`  ${field.name}: ${isBuiltin ? ts : tsName(parsed.routeName, ts)};`);
    }
    lines.push('}');
    lines.push('');
  }

  const hasReq = parsed.types.some(t => t.name === 'Request');
  const hasRes = parsed.types.some(t => t.name === 'Response');
  if (hasReq && hasRes) {
    const base = routePascal(parsed.routeName);
    lines.push(`export interface ${base}Route {`);
    lines.push(`  request: ${base}Request;`);
    lines.push(`  response: ${base}Response;`);
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Codegen — route.ts shim
// ---------------------------------------------------------------------------

/**
 * The Allow header for an OPTIONS handler. Next.js sets it automatically only when
 * it implements OPTIONS itself, so a route that defines OnOptions would lose it.
 */
function allowHeader(parsed: ParsedRoute): string {
  const allowed = [...parsed.methods];
  if (allowed.includes('GET') && !allowed.includes('HEAD')) allowed.push('HEAD');
  if (!allowed.includes('OPTIONS')) allowed.push('OPTIONS');
  return allowed.join(', ');
}

export function generateShim(parsed: ParsedRoute): string {
  const names = parsed.types.map(t => tsName(parsed.routeName, t.name));
  if (parsed.types.some(t => t.name === 'Request') && parsed.types.some(t => t.name === 'Response')) {
    names.push(routePascal(parsed.routeName) + 'Route');
  }
  const typeNames = names.join(', ');
  const hasTypes = parsed.types.length > 0;

  const lines: string[] = [
    '// AUTO-GENERATED by nextjs-basic — do not edit',
    `// Source: ${parsed.basFile.replace(/\\/g, '/')}`,
    "import { NextRequest, NextResponse } from 'next/server';",
    "import { callBasic } from 'nextjs-basic/runtime';",
  ];

  if (hasTypes) {
    lines.push(`export type { ${typeNames} } from './route.types';`);
  }

  lines.push('');

  for (const method of parsed.methods) {
    lines.push(`export async function ${method}(req: NextRequest, ctx: { params?: unknown } = {}) {`);
    lines.push(`  const body = await req.json().catch(() => ({}));`);
    lines.push(`  const raw = await callBasic({`);
    lines.push(`    endpoint: ${JSON.stringify(parsed.routeName)},`);
    lines.push(`    method: ${JSON.stringify(method)},`);
    lines.push(`    path: req.nextUrl.pathname,`);
    lines.push(`    bodyJson: JSON.stringify(body),`);
    lines.push(`    queryJson: JSON.stringify(Object.fromEntries(req.nextUrl.searchParams)),`);
    lines.push(`    headersJson: JSON.stringify(Object.fromEntries(req.headers)),`);
    lines.push(`    paramsJson: JSON.stringify(await ctx.params ?? {}),`);
    lines.push(`  });`);
    lines.push(`  const result = JSON.parse(raw);`);
    lines.push(`  const data = JSON.parse(result.bodyJson ?? '{}');`);
    lines.push(`  const headers = new Headers();`);
    lines.push(`  for (const [name, value] of (result.headers ?? []) as [string, string][]) headers.append(name, value);`);
    if (method === 'OPTIONS') {
      lines.push(`  if (!headers.has('Allow')) headers.set('Allow', ${JSON.stringify(allowHeader(parsed))});`);
    }
    lines.push(`  const status = result.statusCode ?? 200;`);
    lines.push(`  if (${JSON.stringify(method)} === 'HEAD' || status === 204 || status === 205 || status === 304) {`);
    lines.push(`    return new NextResponse(null, { status, headers });`);
    lines.push(`  }`);
    lines.push(`  return NextResponse.json(data, { status, headers });`);
    lines.push(`}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Codegen — QB64 type-specific ParseBody / WriteBody SUBs
// ---------------------------------------------------------------------------
//
// For each user TYPE, we emit two QB64 SUBs that the compiler inserts between
// runtime.bas and route.bas so the user can call:
//
//   ParseBody req, body    ' req.bodyJson -> HelloBody
//   WriteBody resp, result ' HelloResult  -> resp.bodyJson
//
// Because QB64 SUBs cannot be generic (no void*, no overloading), we generate
// one overloaded pair per TYPE name:
//
//   SUB ParseHelloBody (req AS Request, body AS HelloBody)
//   SUB WriteHelloResult (resp AS Response, result AS HelloResult)
//
// AND two alias SUBs so the user calls the simpler form:
//   ParseBody req, body    -> delegates to ParseHelloBody
//   WriteBody resp, result -> delegates to WriteHelloResult
//
// Because QB64 SELECT CASE can't dispatch on TYPE identity either, we use the
// naming convention: the handler declares which types it uses (DIM body AS X),
// and the generated glue SUBs have the concrete names. Users call the typed
// versions directly: ParseHelloBody req, body  /  WriteHelloResult resp, result.
// ParseBody / WriteBody remain as convenience wrappers only when there is
// exactly ONE request/response type per method.

/** Emit BASIC string literal: wraps value in double-quote escaped CHR$(34) */
function basStr(value: string): string {
  return `CHR$(34) + "${value}" + CHR$(34)`;
}

/** Value ranges of the QB64 integer types that need a bounds check on input. */
const INTEGER_RANGES: Record<string, [number, number]> = {
  'INTEGER': [-32768, 32767],
  'LONG': [-2147483648, 2147483647],
  '_BYTE': [-128, 127],
  '_UNSIGNED INTEGER': [0, 65535],
  '_UNSIGNED LONG': [0, 4294967295],
  '_UNSIGNED _BYTE': [0, 255],
};

const WHOLE_NUMBER_TYPES = [
  'INTEGER', 'LONG', '_BYTE', '_INTEGER64',
  '_UNSIGNED INTEGER', '_UNSIGNED LONG', '_UNSIGNED _BYTE', '_UNSIGNED _INTEGER64',
];

function nestedUnsupported(file: string, field: QB64Field): never {
  throw new ParseError(
    file, 0, field.name,
    `nested type "${field.qbType.trim()}" is not supported in generated JSON code yet; use flat fields`
  );
}

/** Emit QB64 code to read one field from JSON string variable jsonVar into typeVar.fieldName */
function emitParseField(field: QB64Field, typeVar: string, jsonVar: string, file: string): string[] {
  const t = field.qbType.trim().toUpperCase();

  if (t.startsWith('STRING *')) {
    return [`    ${typeVar}.${field.name} = JStr$(${jsonVar}, "${field.name}")`];
  }
  const range = INTEGER_RANGES[t];
  if (range) {
    // Assigning an out-of-range number to a QB64 integer wraps silently, so check first.
    // JVal$ accepts both 3 and "3", so query-string values work too.
    return [
      `    pv = VAL(JVal$(${jsonVar}, "${field.name}"))`,
      `    IF pv < ${range[0]} OR pv > ${range[1]} THEN Fail 400, "${field.name} is out of range"`,
      `    ${typeVar}.${field.name} = pv`,
    ];
  }
  if (t === '_INTEGER64' || t === '_UNSIGNED _INTEGER64' || t === 'SINGLE' || t === 'DOUBLE' || t === '_FLOAT' || t === '_UNSIGNED _FLOAT') {
    return [`    ${typeVar}.${field.name} = VAL(JVal$(${jsonVar}, "${field.name}"))`];
  }
  return nestedUnsupported(file, field);
}

/** Emit QB64 code to write one field from typeVar.fieldName into a JSON fragment */
function emitWriteField(field: QB64Field, typeVar: string, isFirst: boolean, file: string): string[] {
  const t = field.qbType.trim().toUpperCase();
  const comma = isFirst ? '' : ' + ","';
  const key = `${basStr(field.name)} + ":"`;
  const v = `${typeVar}.${field.name}`;
  const put = (expr: string) => [`    json$ = json$${comma} + ${key} + ${expr}`];

  if (t.startsWith('STRING *')) return put(`CHR$(34) + JEn$(TrimF$(${v})) + CHR$(34)`);
  if (WHOLE_NUMBER_TYPES.includes(t)) return put(`LTRIM$(STR$(${v}))`);
  if (t === 'SINGLE') return put(`NumS$(${v})`);
  if (t === 'DOUBLE') return put(`NumD$(${v})`);
  if (t === '_FLOAT' || t === '_UNSIGNED _FLOAT') return put(`NumD$(CDBL(${v}))`);
  return nestedUnsupported(file, field);
}

// QB64 does not allow user-defined TYPE variables as SUB/FUNCTION parameters, so
// the generated code works on shared variables:
//
//   TYPE Request / TYPE Response   (written by the user, one each per route)
//   DIM SHARED Req AS Request      (route.glue_decls.bas)
//   DIM SHARED Resp AS Response
//
//   ParseRequest json$     fills Req from the JSON string
//   WriteResponse$         returns Resp as a JSON object string
//   GluePrepare / GlueDispatch / GlueFinish$   called by the runtime loop
//
// GET and HEAD fill Req from the query string; every other method fills it from the
// JSON body.

function roleTypes(parsed: ParsedRoute): { req?: QB64TypeBlock; res?: QB64TypeBlock } {
  return {
    req: parsed.types.find(t => t.name === 'Request'),
    res: parsed.types.find(t => t.name === 'Response'),
  };
}

export function generateQB64GlueDecls(parsed: ParsedRoute): string {
  // Only the DIM SHARED declarations -- must appear in main module before any SUBs
  const { req, res } = roleTypes(parsed);
  const out: string[] = [
    `' route.glue_decls.bas — AUTO-GENERATED — do not edit`,
    `' DIM SHARED declarations for Req and Resp. Must be concatenated BEFORE runtime.bas.`,
    '',
  ];
  if (req) out.push('DIM SHARED Req AS Request');
  if (res) {
    out.push('DIM SHARED Resp AS Response');
    out.push('DIM SHARED RespBlank AS Response');
  }
  out.push('');
  return out.join('\n');
}

export function generateQB64Glue(parsed: ParsedRoute): string {
  const { req, res } = roleTypes(parsed);
  const file = parsed.basFile;
  const out: string[] = [
    `' route.glue.bas — AUTO-GENERATED by nextjs-basic — do not edit`,
    `' Source: ${parsed.basFile.replace(/\\/g, '/')}`,
    `' Inserted AFTER runtime.bas and route.bas by the compiler step.`,
    '',
  ];

  if (req) {
    out.push(`' Fill Req from a JSON string. Missing fields become empty or 0.`);
    out.push(`SUB ParseRequest (jsonIn AS STRING)`);
    out.push(`    DIM pv AS DOUBLE`);
    for (const field of req.fields) out.push(...emitParseField(field, 'Req', 'jsonIn', file));
    out.push(`END SUB`);
    out.push('');
  }

  if (res) {
    out.push(`' Serialize Resp to a JSON object string`);
    out.push(`FUNCTION WriteResponse$ ()`);
    out.push(`    json$ = "{"`);
    for (let i = 0; i < res.fields.length; i++) {
      out.push(...emitWriteField(res.fields[i], 'Resp', i === 0, file));
    }
    out.push(`    json$ = json$ + "}"`);
    out.push(`    WriteResponse$ = json$`);
    out.push(`END FUNCTION`);
    out.push('');
  }

  // ---- called by the runtime loop ----
  out.push(`' Reset Resp and fill Req for this request`);
  out.push(`SUB GluePrepare (m AS STRING)`);
  if (res) out.push(`    Resp = RespBlank`);
  if (req) {
    out.push(`    IF m = "GET" OR m = "HEAD" THEN`);
    out.push(`        ParseRequest RTRIM$(Ctx.queryJson)`);
    out.push(`    ELSE`);
    out.push(`        ParseRequest RTRIM$(Ctx.bodyJson)`);
    out.push(`    END IF`);
  }
  out.push(`END SUB`);
  out.push('');

  out.push(`' Call the handler for this method; anything else is a 405`);
  out.push(`SUB GlueDispatch (m AS STRING)`);
  out.push(`    SELECT CASE m`);
  for (const method of parsed.methods) {
    const sub = 'On' + method.charAt(0) + method.slice(1).toLowerCase();
    out.push(`        CASE "${method}"`);
    out.push(`            ${sub}`);
  }
  out.push(`        CASE ELSE`);
  out.push(`            Fail 405, "Method Not Allowed"`);
  out.push(`    END SELECT`);
  out.push(`END SUB`);
  out.push('');

  out.push(`' CORS headers for this route: call it from each handler and from OnOptions`);
  out.push(`SUB AllowCors (origin AS STRING)`);
  out.push(`    SetHeader "Access-Control-Allow-Origin", origin`);
  out.push(`    IF origin <> "*" THEN SetHeader "Vary", "Origin"`);
  out.push(`    SetHeader "Access-Control-Allow-Methods", "${allowHeader(parsed)}"`);
  out.push(`    SetHeader "Access-Control-Allow-Headers", "Content-Type, Authorization"`);
  out.push(`END SUB`);
  out.push('');

  out.push(`' JSON for the response body`);
  out.push(`FUNCTION GlueFinish$ ()`);
  out.push(res ? `    GlueFinish$ = WriteResponse$` : `    GlueFinish$ = "{}"`);
  out.push(`END FUNCTION`);
  out.push('');

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Write generated files to disk
// ---------------------------------------------------------------------------

export function writeGeneratedFiles(parsed: ParsedRoute): void {
  const dir = path.dirname(parsed.basFile);

  if (parsed.types.length > 0) {
    const typesContent = generateTypes(parsed);
    fs.writeFileSync(path.join(dir, 'route.types.ts'), typesContent, 'utf8');
  }

  if (parsed.methods.length > 0) {
    const shimContent = generateShim(parsed);
    fs.writeFileSync(path.join(dir, 'route.ts'), shimContent, 'utf8');
  }

  // Always write the QB64 glue files
  const glueContent = generateQB64Glue(parsed);
  fs.writeFileSync(path.join(dir, 'route.glue.bas'), glueContent, 'utf8');

  // Write declarations separately -- must come BEFORE runtime.bas in the concat order
  const declsContent = generateQB64GlueDecls(parsed);
  fs.writeFileSync(path.join(dir, 'route.glue_decls.bas'), declsContent, 'utf8');
}







