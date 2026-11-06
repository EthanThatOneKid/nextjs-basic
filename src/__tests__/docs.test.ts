// src/__tests__/docs.test.ts
//
// Keeps the docs from drifting away from the code. Each check reads a fact from the
// source (a constant, a regex, a file listing) and asserts that the docs still say it.
// When one fails, update the doc named in the message, not the test.

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const DOCS = [
  'README.md',
  'CONTRIBUTING.md',
  ...fs.readdirSync(path.join(ROOT, 'docs')).filter(f => f.endsWith('.md')).map(f => `docs/${f}`),
  ...fs.readdirSync(path.join(ROOT, '.kiro', 'specs')).filter(f => f.endsWith('.md')).map(f => `.kiro/specs/${f}`),
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const posix = (p: string) => p.split(path.sep).join('/');

describe('links', () => {
  test.each(DOCS)('%s: every relative link points at a file that exists', (doc) => {
    const links = [...read(doc).matchAll(/\]\(([^)\s]+)\)/g)].map(m => m[1]);
    const broken = links
      .filter(l => !/^(https?:|mailto:|#)/.test(l))
      .map(l => l.split('#')[0])
      .filter(l => l && !fs.existsSync(path.resolve(ROOT, path.dirname(doc), l)));
    expect(broken).toEqual([]);
  });
});

describe('handlers', () => {
  const source = read('src/codegen.ts');
  const found = source.match(/ON\(([A-Z|]+)\)/);
  const handlers = (found ? found[1].split('|') : []).map(m => 'On' + m.charAt(0) + m.slice(1).toLowerCase());

  test('the parser knows handlers to check', () => {
    expect(handlers.length).toBeGreaterThanOrEqual(7);
  });

  test.each(['docs/writing-routes.md', '.kiro/specs/requirements.md'])('%s names every handler SUB', (doc) => {
    const text = read(doc);
    expect(handlers.filter(h => !text.includes(h))).toEqual([]);
  });
});

describe('failure budget', () => {
  const match = read('src/runtime/runtime.bas').match(/CONST RecycleAfter = (\d+)/);
  const n = match ? match[1] : 'unknown';

  test('runtime.bas defines it', () => {
    expect(match).not.toBeNull();
  });

  test.each([
    ['docs/writing-routes.md', `every ${n} failed requests`],
    ['.kiro/specs/requirements.md', `After ${n} failed requests`],
    ['.kiro/specs/design.md', `(${n})`],
    ['docs/submission.md', `after ${n}`],
  ])('%s states the current number', (doc, phrase) => {
    // collapse whitespace so line wrapping in the docs cannot break the match
    expect(read(doc).replace(/\s+/g, ' ')).toContain(phrase);
  });
});

describe('environment variables', () => {
  const sources = walk(path.join(ROOT, 'src')).filter(f => f.endsWith('.ts'));
  const used = (files: string[]) => [...new Set(
    files.flatMap(f => [...fs.readFileSync(f, 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map(m => m[1]))
  )];

  test('the plugin documents every variable it reads, in the README', () => {
    const vars = used(sources.filter(f => !f.includes('__tests__')));
    expect(vars.length).toBeGreaterThan(0);
    const readme = read('README.md');
    expect(vars.filter(v => !readme.includes(v))).toEqual([]);
  });

  test('CONTRIBUTING documents every variable the tests read', () => {
    const vars = used(sources.filter(f => f.includes('__tests__')));
    const contributing = read('CONTRIBUTING.md');
    expect(vars.filter(v => !contributing.includes(v))).toEqual([]);
  });
});

describe('example routes', () => {
  const routes = walk(path.join(ROOT, 'example', 'app', 'api'))
    .filter(f => path.basename(f) === 'route.bas')
    .map(f => posix(path.relative(path.join(ROOT, 'example', 'app', 'api'), path.dirname(f))));

  test('there are example routes to check', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  test.each(['CONTRIBUTING.md', 'docs/submission.md'])('%s lists every example route', (doc) => {
    const text = read(doc);
    expect(routes.filter(r => !text.includes(`app/api/${r}`))).toEqual([]);
  });
});

describe('versions', () => {
  test('CI and the Dockerfile build the same QB64-PE release', () => {
    const ci = read('.github/workflows/ci.yml').match(/QB64PE_VERSION: (\S+)/);
    const docker = read('example/Dockerfile').match(/ARG QB64PE_VERSION=(\S+)/);
    expect(ci && ci[1]).toBeTruthy();
    expect(docker && docker[1]).toBe(ci && ci[1]);
  });

  test('the README states the Node versions CI and the Dockerfile really use', () => {
    const ciNode = read('.github/workflows/ci.yml').match(/node-version: (\d+)/);
    const dockerNode = read('example/Dockerfile').match(/FROM node:(\d+)/);
    const readme = read('README.md');
    expect(readme).toContain(`CI runs Node ${ciNode && ciNode[1]}`);
    expect(readme).toContain(`Docker image uses Node ${dockerNode && dockerNode[1]}`);
  });
});

describe('claims that used to be wrong', () => {
  test('nested types are not listed as supported', () => {
    expect(read('README.md')).not.toMatch(/AS AnotherType/);
  });

  test('no doc still describes the removed RunRoute$ contract as current', () => {
    for (const doc of DOCS.filter(d => d !== 'docs/submission.md')) {
      const lines = read(doc).split('\n').filter(l => /gReq|gResp|ParseBody|WriteBody|FUNCTION GET/.test(l));
      expect(lines).toEqual([]);
    }
  });
});
