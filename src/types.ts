// src/types.ts — shared internal types

export interface QB64Field {
  name: string;
  qbType: string;   // raw QB64 type string, e.g. "STRING * 50" or "INTEGER"
  tsType: string;   // mapped TypeScript type
}

export interface QB64TypeBlock {
  name: string;
  fields: QB64Field[];
}

export interface ParsedRoute {
  /** Absolute path to the route.bas file */
  basFile: string;
  /** Route name derived from directory, e.g. "hello" for app/api/hello/route.bas */
  routeName: string;
  /** HTTP methods found as FUNCTION GET / POST / etc. */
  methods: string[];
  /** User-defined TYPE blocks */
  types: QB64TypeBlock[];
}

export class ParseError extends Error {
  constructor(
    public readonly file: string,
    public readonly line: number,
    public readonly field: string,
    reason: string
  ) {
    super(`[nextjs-basic] ${file}:${line} — field "${field}": ${reason}`);
    this.name = 'ParseError';
  }
}

export class CompilerNotFoundError extends Error {
  constructor() {
    super(
      '[nextjs-basic] QB64 compiler not found. ' +
      'Install QB64 from https://qb64.com and ensure "qb64" is on your PATH.'
    );
    this.name = 'CompilerNotFoundError';
  }
}

export class CompileError extends Error {
  constructor(public readonly file: string, stderr: string) {
    super(`[nextjs-basic] QB64 compile failed for ${file}:\n${stderr}`);
    this.name = 'CompileError';
  }
}

export class QB64TimeoutError extends Error {
  constructor(public readonly route: string) {
    super(`[nextjs-basic] QB64 runtime timeout for route "${route}" (5s)`);
    this.name = 'QB64TimeoutError';
  }
}

export class QB64CrashError extends Error {
  constructor(public readonly route: string, code: number | null) {
    super(`[nextjs-basic] QB64 binary crashed for route "${route}" (exit code ${code})`);
    this.name = 'QB64CrashError';
  }
}
