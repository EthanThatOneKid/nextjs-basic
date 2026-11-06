// src/__tests__/plugin.test.ts
//
// Route files must exist as soon as the Next.js config loads: `next build` looks for
// app/api/**/route.ts before webpack (and so before the plugin) runs, so on a fresh
// checkout the generated files have to be written at config time.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { prepareRoutes } from '../plugin';
import { withBasic } from '../index';

const ROUTE = `
TYPE Response
    message AS STRING * 10
END TYPE

SUB OnGet
END SUB
`;

function project(routes: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-plugin-'));
  for (const [rel, source] of Object.entries(routes)) {
    const file = path.join(dir, 'app', 'api', rel, 'route.bas');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source, 'utf8');
  }
  return dir;
}

const exists = (dir: string, rel: string, name: string) =>
  fs.existsSync(path.join(dir, 'app', 'api', rel, name));

describe('prepareRoutes', () => {
  test('writes the generated files for every route without compiling anything', () => {
    const dir = project({ hello: ROUTE, 'users/[id]': ROUTE });
    prepareRoutes(dir);

    for (const rel of ['hello', 'users/[id]']) {
      for (const name of ['route.ts', 'route.types.ts', 'route.glue.bas', 'route.glue_decls.bas']) {
        expect(exists(dir, rel, name)).toBe(true);
      }
    }
    expect(fs.existsSync(path.join(dir, 'bin'))).toBe(false);
  });

  test('does nothing for a project without app/api', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-plugin-'));
    expect(() => prepareRoutes(dir)).not.toThrow();
  });

  test('a route with no handler fails with a message that names the file', () => {
    const dir = project({ broken: 'TYPE Request\n    a AS INTEGER\nEND TYPE\n' });
    expect(() => prepareRoutes(dir)).toThrow(/app\/api\/broken\/route\.bas defines no handler/);
  });

  test('a parse error surfaces with the field and reason', () => {
    const dir = project({ bad: 'TYPE Request\n    name AS STRING\nEND TYPE\n\nSUB OnGet\nEND SUB\n' });
    expect(() => prepareRoutes(dir)).toThrow('bare STRING');
  });
});

describe('withBasic', () => {
  test('writes the route files as soon as the config is created', () => {
    const dir = project({ hello: ROUTE });
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      expect(exists(dir, 'hello', 'route.ts')).toBe(false);
      withBasic({});
      expect(exists(dir, 'hello', 'route.ts')).toBe(true);
    } finally {
      process.chdir(cwd);
    }
  });

  test('keeps the rest of the user config', () => {
    const dir = project({});
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const config = withBasic({ reactStrictMode: true }) as Record<string, unknown>;
      expect(config.reactStrictMode).toBe(true);
      expect(typeof config.webpack).toBe('function');
    } finally {
      process.chdir(cwd);
    }
  });
});
