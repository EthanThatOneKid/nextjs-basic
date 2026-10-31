// src/__tests__/codegen.test.ts

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseBasFile,
  generateTypes,
  generateShim,
  generateQB64Glue,
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
  test('parses a simple TYPE and GET function', () => {
    const file = tmpBas(`
TYPE HelloBody
    name AS STRING * 50
    age  AS INTEGER
END TYPE

FUNCTION GET (req AS Request, resp AS Response)
    ' handler
END FUNCTION
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

  test('parses multiple HTTP methods', () => {
    const file = tmpBas(`
FUNCTION GET (req AS Request, resp AS Response)
END FUNCTION

FUNCTION POST (req AS Request, resp AS Response)
END FUNCTION
`);
    const parsed = parseBasFile(file);
    expect(parsed.methods).toContain('GET');
    expect(parsed.methods).toContain('POST');
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
  test('emits GET and POST exports', () => {
    const file = tmpBas(`
TYPE Body
    name AS STRING * 50
END TYPE

FUNCTION GET (req AS Request, resp AS Response)
END FUNCTION

FUNCTION POST (req AS Request, resp AS Response)
END FUNCTION
`);
    const parsed = parseBasFile(file);
    const shim = generateShim(parsed);
    expect(shim).toContain("export async function GET");
    expect(shim).toContain("export async function POST");
    expect(shim).toContain("callBasic");
    expect(shim).toContain('endpoint: "hello"');
    expect(shim).toContain("export type { Body }");
  });
});

// ---------------------------------------------------------------------------
// generateQB64Glue
// ---------------------------------------------------------------------------

describe('generateQB64Glue', () => {
  test('emits ParseXxx and WriteXxx SUBs', () => {
    const file = tmpBas(`
TYPE HelloBody
    name AS STRING * 50
    age  AS INTEGER
END TYPE
`);
    const parsed = parseBasFile(file);
    const glue = generateQB64Glue(parsed);

    expect(glue).toContain('SUB ParseHelloBody (req AS Request, body AS HelloBody)');
    expect(glue).toContain('SUB WriteHelloBody (result AS HelloBody, resp AS Response)');
    // String field uses JsonGetString$
    expect(glue).toContain('JsonGetString$');
    // Integer field uses JsonGetInt%
    expect(glue).toContain('JsonGetInt%');
    // String field serialized with RTRIM$
    expect(glue).toContain('RTRIM$');
  });

  test('uses LTRIM$(STR$()) for numeric fields in WriteXxx', () => {
    const file = tmpBas(`
TYPE NumBody
    count AS LONG
END TYPE
`);
    const parsed = parseBasFile(file);
    const glue = generateQB64Glue(parsed);
    expect(glue).toContain('LTRIM$(STR$');
  });

  test('emits empty glue (header only) for a route with no types', () => {
    const file = tmpBas(`
FUNCTION GET (req AS Request, resp AS Response)
END FUNCTION
`);
    const parsed = parseBasFile(file);
    const glue = generateQB64Glue(parsed);
    expect(glue).toContain('AUTO-GENERATED');
    expect(glue).not.toContain('SUB Parse');
  });
});
