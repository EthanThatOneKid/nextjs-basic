// src/plugin.ts — BasicPlugin webpack integration

import * as path from 'path';
import * as fs from 'fs';
import type { Compiler } from 'webpack';
import { parseBasFile, writeGeneratedFiles } from './codegen';
import { compileRoute } from './compiler';

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

function buildRoute(basFile: string, projectRoot: string, isVerbose: boolean): void {
  const label = path.relative(projectRoot, basFile).replace(/\\/g, '/');
  if (isVerbose) console.log(`[nextjs-basic] building ${label}`);

  const parsed = parseBasFile(basFile);
  writeGeneratedFiles(parsed);

  const binDir = path.join(projectRoot, 'bin');
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
