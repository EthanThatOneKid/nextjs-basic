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

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

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

    // Detect FUNCTION GET / POST / etc.
    if (!inType) {
      for (const method of HTTP_METHODS) {
        if (upper.startsWith(`FUNCTION ${method}`) || upper.startsWith(`SUB ${method}`)) {
          if (!methods.includes(method)) methods.push(method);
        }
      }
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
  const routeName = path.basename(path.dirname(basFile));

  return { basFile, routeName, methods, types };
}

// ---------------------------------------------------------------------------
// Codegen — route.types.ts
// ---------------------------------------------------------------------------

export function generateTypes(parsed: ParsedRoute): string {
  const lines: string[] = [
    '// AUTO-GENERATED by nextjs-basic — do not edit',
    `// Source: ${parsed.basFile.replace(/\\/g, '/')}`,
    '',
  ];

  // Collect all known type names for reference validation
  const knownTypes = new Set(parsed.types.map(t => t.name.toUpperCase()));

  for (const type of parsed.types) {
    lines.push(`export interface ${type.name} {`);
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
      lines.push(`  ${field.name}: ${ts};`);
    }
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Codegen — route.ts shim
// ---------------------------------------------------------------------------

export function generateShim(parsed: ParsedRoute): string {
  const typeNames = parsed.types.map(t => t.name).join(', ');
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
    lines.push(`export async function ${method}(req: NextRequest) {`);
    lines.push(`  const body = await req.json().catch(() => ({}));`);
    lines.push(`  const raw = await callBasic({`);
    lines.push(`    endpoint: ${JSON.stringify(parsed.routeName)},`);
    lines.push(`    method: ${JSON.stringify(method)},`);
    lines.push(`    path: req.nextUrl.pathname,`);
    lines.push(`    bodyJson: JSON.stringify(body),`);
    lines.push(`  });`);
    lines.push(`  const result = JSON.parse(raw);`);
    lines.push(`  return NextResponse.json(result, { status: result.statusCode ?? 200 });`);
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

/** Emit QB64 code to read one field from JSON string variable jsonVar into typeVar.fieldName */
function emitParseField(field: QB64Field, typeVar: string, jsonVar: string): string[] {
  const lines: string[] = [];
  const t = field.qbType.trim().toUpperCase();

  if (t.startsWith('STRING *')) {
    lines.push(`    ${typeVar}.${field.name} = JsonGetString$(${jsonVar}, "${field.name}")`);
  } else if (
    t === 'INTEGER' || t === 'LONG' || t === '_BYTE' ||
    t === '_UNSIGNED INTEGER' || t === '_UNSIGNED LONG' || t === '_UNSIGNED _BYTE'
  ) {
    lines.push(`    ${typeVar}.${field.name} = JsonGetInt%(${jsonVar}, "${field.name}")`);
  } else if (t === 'SINGLE' || t === 'DOUBLE' || t === '_FLOAT') {
    lines.push(`    ${typeVar}.${field.name} = VAL(JsonGetString$(${jsonVar}, "${field.name}"))`);
  } else if (t === '_INTEGER64' || t === '_UNSIGNED _INTEGER64') {
    lines.push(`    ${typeVar}.${field.name} = VAL(JsonGetString$(${jsonVar}, "${field.name}"))`);
  } else {
    // Nested type — recursively call ParseXxx for that type
    const nestedTypeName = field.qbType.trim();
    lines.push(`    CALL Parse${nestedTypeName}(${jsonVar}, ${typeVar}.${field.name})`);
  }
  return lines;
}

/** Emit QB64 code to write one field from typeVar.fieldName into a JSON fragment */
function emitWriteField(field: QB64Field, typeVar: string, isFirst: boolean): string[] {
  const lines: string[] = [];
  const t = field.qbType.trim().toUpperCase();
  const comma = isFirst ? '' : ' + ","';
  const key = `${basStr(field.name)} + ":"`;

  if (t.startsWith('STRING *')) {
    // Strings: wrap in quotes, RTRIM$ strips QB64 padding
    lines.push(`    json$ = json$${comma} + ${key} + CHR$(34) + RTRIM$(${typeVar}.${field.name}) + CHR$(34)`);
  } else if (
    t === 'INTEGER' || t === 'LONG' || t === '_BYTE' ||
    t === '_UNSIGNED INTEGER' || t === '_UNSIGNED LONG' || t === '_UNSIGNED _BYTE' ||
    t === 'SINGLE' || t === 'DOUBLE' || t === '_FLOAT'
  ) {
    lines.push(`    json$ = json$${comma} + ${key} + LTRIM$(STR$(${typeVar}.${field.name}))`);
  } else if (t === '_INTEGER64' || t === '_UNSIGNED _INTEGER64') {
    lines.push(`    json$ = json$${comma} + ${key} + LTRIM$(STR$(${typeVar}.${field.name}))`);
  } else {
    // Nested type — recursively call WriteXxx for that type
    const nestedTypeName = field.qbType.trim();
    lines.push(`    DIM nested${field.name}$ AS STRING`);
    lines.push(`    CALL Write${nestedTypeName}(${typeVar}.${field.name}, nested${field.name}$)`);
    lines.push(`    json$ = json$${comma} + ${key} + nested${field.name}$`);
  }
  return lines;
}

export function generateQB64Glue(parsed: ParsedRoute): string {
  const out: string[] = [
    `' route.glue.bas — AUTO-GENERATED by nextjs-basic — do not edit`,
    `' Source: ${parsed.basFile.replace(/\\/g, '/')}`,
    `' Inserted between runtime.bas and route.bas by the compiler step.`,
    `'`,
    `' Provides type-specific ParseXxx / WriteXxx SUBs for each user TYPE.`,
    '',
  ];

  for (const type of parsed.types) {
    const typeName = type.name;
    const parseSubName = `Parse${typeName}`;
    const writeSubName = `Write${typeName}`;

    // ---- ParseXxx(req AS Request, body AS TypeName) ----
    out.push(`' Parse req.bodyJson into a ${typeName} variable`);
    out.push(`SUB ${parseSubName} (req AS Request, body AS ${typeName})`);
    out.push(`    DIM json$ AS STRING`);
    out.push(`    json$ = RTRIM$(req.bodyJson)`);
    for (const field of type.fields) {
      out.push(...emitParseField(field, 'body', 'json$'));
    }
    out.push(`END SUB`);
    out.push('');

    // ---- WriteXxx(result AS TypeName, resp AS Response) ----
    out.push(`' Serialize a ${typeName} variable into resp.bodyJson`);
    out.push(`SUB ${writeSubName} (result AS ${typeName}, resp AS Response)`);
    out.push(`    DIM json$ AS STRING`);
    out.push(`    json$ = "{"`);
    for (let i = 0; i < type.fields.length; i++) {
      out.push(...emitWriteField(type.fields[i], 'result', i === 0));
    }
    out.push(`    json$ = json$ + "}"`);
    out.push(`    resp.bodyJson = json$`);
    out.push(`END SUB`);
    out.push('');
  }

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

  // Always write the QB64 glue file (even with zero types, it's valid empty)
  const glueContent = generateQB64Glue(parsed);
  fs.writeFileSync(path.join(dir, 'route.glue.bas'), glueContent, 'utf8');
}
