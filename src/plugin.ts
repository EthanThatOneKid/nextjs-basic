// src/plugin.ts — BasicPlugin webpack integration

import * as path from 'path';
import * as fs from 'fs';
import type { Compiler } from 'webpack';
import { parseBasFile, writeGeneratedFiles } from './codegen';
import { compileRoute } from './compiler';
import type { ParsedRoute } from './types';

function globBasFiles(projectRoot: string): string[] {
  const apiDir = path.join(projectRoot, 'app', 'api');
  if (!fs.existsSync(apiDir)) return [];

  const results: string[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name === 'route.bas') {
        results.push(full);
      }
    }
  }

  walk(apiDir);
  return results;
}

/** Parse a route and write its generated files (route.ts, types, glue). */
function prepareRoute(basFile: string, projectRoot: string): ParsedRoute {
  const label = path.relative(projectRoot, basFile).split(path.sep).join('/');
  const parsed = parseBasFile(basFile);
  if (parsed.methods.length === 0) {
    throw new Error(
      `[nextjs-basic] ${label} defines no handler. Add at least one of: ` +
      'SUB OnGet, SUB OnPost, SUB OnPut, SUB OnDelete, SUB OnPatch, SUB OnHead, SUB OnOptions'
    );
  }
  writeGeneratedFiles(parsed);
  return parsed;
}

/**
 * Write the generated route.ts files for every route.bas, without compiling anything.
 *
 * Next.js looks for route files before webpack starts, so on a fresh checkout these
 * files must already exist when the config loads. Otherwise `next build` never sees
 * the API routes. (`next dev` picks new files up later, which hid this.)
 */
export function prepareRoutes(projectRoot: string): void {
  for (const basFile of globBasFiles(projectRoot)) prepareRoute(basFile, projectRoot);
}

function buildRoute(basFile: string, projectRoot: string, isVerbose: boolean): void {
  const label = path.relative(projectRoot, basFile).replace(/\\/g, '/');
  if (isVerbose) console.log(`[nextjs-basic] building ${label}`);

  const parsed = prepareRoute(basFile, projectRoot);

  const binDir = path.join(projectRoot, 'bin');
  const ext = process.platform === 'win32' ? '.exe' : '';
  const outBin = path.join(binDir, parsed.routeName + ext);

  // Skip when the binary is newer than its sources. Rebuilding would also fail on
  // Windows while the persistent process holds the exe open.
  const runtimeBas = path.join(__dirname, '..', 'src', 'runtime', 'runtime.bas');
  if (fs.existsSync(outBin)) {
    const binTime = fs.statSync(outBin).mtimeMs;
    // The plugin's own code decides the generated glue, so upgrading it rebuilds too
    const inputs = [basFile, runtimeBas, path.join(__dirname, 'codegen.js'), path.join(__dirname, 'compiler.js')];
    if (inputs.every(f => !fs.existsSync(f) || fs.statSync(f).mtimeMs <= binTime)) {
      if (isVerbose) console.log(`[nextjs-basic] up to date ${label}`);
      return;
    }
  }

  compileRoute(basFile, binDir);

  if (isVerbose) console.log(`[nextjs-basic] built ${label} → bin/${parsed.routeName}`);
}

export class BasicPlugin {
  private projectRoot: string;
  private isVerbose: boolean;

  constructor(options: { dir?: string; isServer?: boolean } = {}) {
    this.projectRoot = options.dir ?? process.cwd();
    this.isVerbose = process.env.NEXTJS_BASIC_VERBOSE === '1';
  }

  apply(compiler: Compiler): void {
    compiler.hooks.beforeCompile.tapAsync(
      'BasicPlugin',
      (_params: unknown, callback: (err?: Error) => void) => {
        const basFiles = globBasFiles(this.projectRoot);
        if (basFiles.length === 0) { callback(); return; }

        let failed = false;
        for (const basFile of basFiles) {
          try {
            buildRoute(basFile, this.projectRoot, this.isVerbose);
          } catch (err) {
            console.error(String(err));
            failed = true;
          }
        }
        callback(failed ? new Error('[nextjs-basic] one or more routes failed to build') : undefined);
      }
    );

    compiler.hooks.watchRun.tapAsync(
      'BasicPlugin',
      (watchCompiler: Compiler, callback: () => void) => {
        const changed: ReadonlySet<string> = watchCompiler.modifiedFiles ?? new Set<string>();

        for (const file of changed) {
          if (file.endsWith('route.bas')) {
            try {
              buildRoute(file, this.projectRoot, this.isVerbose);
              compiler.hooks.invalid.call(
                path.join(path.dirname(file), 'route.ts'),
                Date.now()
              );
            } catch (err) {
              console.error(String(err));
            }
          }
        }
        callback();
      }
    );
  }
}
