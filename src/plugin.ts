// src/plugin.ts — BasicPlugin webpack integration

import * as path from 'path';
import * as fs from 'fs';
import { Compiler } from 'webpack';
import { parseBasFile, writeGeneratedFiles } from './codegen';
import { compileRoute } from './compiler';

function globBasFiles(projectRoot: string): string[] {
  const apiDir = path.join(projectRoot, 'app', 'api');
  if (!fs.existsSync(apiDir)) return [];

  const results: string[] = [];

  function walk(dir: string) {
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

  // 1. Parse + generate TypeScript files
  const parsed = parseBasFile(basFile);
  writeGeneratedFiles(parsed);

  // 2. Compile QB64 -> native binary
  const binDir = path.join(projectRoot, 'bin');
  compileRoute(basFile, binDir);

  if (isVerbose) console.log(`[nextjs-basic] built ${label} → bin/${parsed.routeName}`);
}

export class BasicPlugin {
  private projectRoot: string;
  private isVerbose: boolean;
  private watched: Set<string>;

  constructor(options: { dir?: string; isServer?: boolean } = {}) {
    this.projectRoot = options.dir ?? process.cwd();
    this.isVerbose = process.env.NEXTJS_BASIC_VERBOSE === '1';
    this.watched = new Set();
  }

  apply(compiler: Compiler): void {
    // Run before the main compilation so generated .ts files are in the graph
    compiler.hooks.beforeCompile.tapAsync('BasicPlugin', (_params, callback) => {
      const basFiles = globBasFiles(this.projectRoot);

      if (basFiles.length === 0) {
        callback();
        return;
      }

      let remaining = basFiles.length;
      let failed = false;

      for (const basFile of basFiles) {
        try {
          buildRoute(basFile, this.projectRoot, this.isVerbose);
        } catch (err) {
          console.error(String(err));
          failed = true;
        }
        remaining--;
        if (remaining === 0) {
          callback(failed ? new Error('[nextjs-basic] one or more routes failed to build') : undefined);
        }
      }
    });

    // In watch mode, rebuild only changed .bas files
    compiler.hooks.watchRun.tapAsync('BasicPlugin', (watchCompiler, callback) => {
      const changed = watchCompiler.modifiedFiles ?? new Set<string>();

      let rebuilt = false;
      for (const file of changed) {
        if (file.endsWith('route.bas')) {
          try {
            buildRoute(file, this.projectRoot, this.isVerbose);
            rebuilt = true;
          } catch (err) {
            console.error(String(err));
          }
        }
      }

      if (rebuilt) {
        // Signal Next.js that new .ts files exist
        for (const file of changed) {
          if (file.endsWith('route.bas')) {
            const dir = path.dirname(file);
            compiler.hooks.invalid.call(path.join(dir, 'route.ts'), Date.now().toString());
          }
        }
      }

      callback();
    });
  }
}
