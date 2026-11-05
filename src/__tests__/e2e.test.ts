// src/__tests__/e2e.test.ts
//
// End-to-end tests: compile real routes with QB64 and talk to them over STDIO,
// exactly as the Node runtime does.
//
// Skipped automatically when no QB64 compiler is found (QB64_PATH, qb64pe or qb64
// on PATH). The Windows CI job installs QB64-PE, so they run there.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync, spawn, spawnSync, ChildProcess } from 'child_process';
import * as readline from 'readline';
import { parseBasFile, writeGeneratedFiles } from '../codegen';

// ---------------------------------------------------------------------------
// QB64 availability check
// ---------------------------------------------------------------------------

function findQb64(): string | null {
  if (process.env.QB64_PATH) return process.env.QB64_PATH;
  for (const name of ['qb64pe', 'qb64']) {
    try {
      const cmd = os.platform() === 'win32' ? `where ${name}` : `which ${name}`;
      const result = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0].trim();
      if (result) return result;
    } catch { /* not on PATH */ }
  }
  return null;
}

const QB64 = findQb64();
const describeE2E = QB64 ? describe : describe.skip;

// CI sets REQUIRE_QB64 so a missing compiler fails the run instead of skipping the e2e tests
if (process.env.REQUIRE_QB64 && !QB64) {
  test('a QB64 compiler is available', () => {
    throw new Error('REQUIRE_QB64 is set but no QB64 compiler was found (QB64_PATH, qb64pe, qb64)');
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API = path.join(__dirname, '..', '..', 'example', 'app', 'api');
const HELLO_BAS = path.join(API, 'hello', 'route.bas');
const ECHO_BAS = path.join(API, 'echo', 'route.bas');
const USERS_BAS = path.join(API, 'users', '[id]', 'route.bas');
const TYPES_BAS = path.join(__dirname, 'fixtures', 'types', 'route.bas');
const RUNTIME_BAS = path.join(__dirname, '..', 'runtime', 'runtime.bas');

/**
 * Same order as compiler.ts: decls, runtime, user route, glue. The route is copied
 * into the scratch folder first so generated files never land in the source tree.
 */
function compileTestBinary(basFile: string, scratchDir: string, name: string): string {
  // sources and binaries live in separate folders: on Linux and macOS a binary has no
  // extension, so scratch/<name> would be both the route folder and the executable
  const routeDir = path.join(scratchDir, 'src', name);
  fs.mkdirSync(routeDir, { recursive: true });
  const copy = path.join(routeDir, 'route.bas');
  fs.copyFileSync(basFile, copy);
  writeGeneratedFiles(parseBasFile(copy));

  const read = (f: string) => {
    const p = path.join(routeDir, f);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  };
  const combined =
    read('route.glue_decls.bas') + '\n\n' +
    fs.readFileSync(RUNTIME_BAS, 'utf8') + '\n\n' +
    fs.readFileSync(copy, 'utf8') + '\n\n' +
    read('route.glue.bas');

  const tmpBas = path.join(routeDir, 'combined.bas');
  fs.writeFileSync(tmpBas, combined, 'utf8');

  fs.mkdirSync(path.join(scratchDir, 'bin'), { recursive: true });
  const outBin = path.join(scratchDir, 'bin', name + (os.platform() === 'win32' ? '.exe' : ''));
  const result = spawnSync(QB64!, ['-x', tmpBas, '-o', path.resolve(outBin)], {
    encoding: 'utf8',
    timeout: 120000,
  });
  if (result.status !== 0 || !fs.existsSync(outBin)) {
    const shown = (result.stdout || '').split('\n').filter(l => l.trim() && !l.startsWith('[')).join('\n');
    // QB64 keeps the C++ compiler's output in its own log next to the compiler
    const logFile = path.join(path.dirname(QB64!), 'internal', 'temp', 'compilelog.txt');
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').slice(-40).join('\n') : '(no compile log)';
    throw new Error(`QB64 compile failed for ${name}:\n${shown}${result.stderr}\n--- compile log (last lines) ---\n${log}`);
  }
  return outBin;
}

interface Reply {
  id: string;
  status: number;
  /** Parsed response body */
  body: any;
  /** Response headers the route set, as [name, value] pairs */
  headers: Array<[string, string]>;
}

/** One long-lived route process, like the real runtime keeps. */
class Client {
  private proc: ChildProcess;
  private waiting: Array<(line: string) => void> = [];
  private buffered: string[] = [];
  readonly exited: Promise<void>;
  private n = 0;

  constructor(bin: string) {
    this.proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    const rl = readline.createInterface({ input: this.proc.stdout! });
    rl.on('line', line => {
      const w = this.waiting.shift();
      if (w) w(line); else this.buffered.push(line);
    });
    this.exited = new Promise(resolve => this.proc.on('exit', () => resolve()));
  }

  call(payload: Record<string, unknown>): Promise<Reply> {
    const id = String(++this.n);
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no response within 5s')), 5000);
      const onLine = (line: string) => {
        clearTimeout(timer);
        const wire = JSON.parse(line);
        resolve({ id: wire._id, status: wire.statusCode, body: JSON.parse(wire.bodyJson), headers: wire.headers });
      };
      const early = this.buffered.shift();
      if (early !== undefined) onLine(early); else this.waiting.push(onLine);
      this.proc.stdin!.write(JSON.stringify({ _id: id, endpoint: 'test', path: '/t', bodyJson: '{}', ...payload }) + '\n');
    });
  }

  get(query: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
    return this.call({ method: 'GET', queryJson: JSON.stringify(query), ...extra });
  }

  post(body: unknown, method = 'POST') {
    return this.call({ method, bodyJson: JSON.stringify(body) });
  }

  async quit(): Promise<void> {
    this.proc.stdin!.write('{"_quit":true}\n');
    await Promise.race([this.exited, new Promise(r => setTimeout(r, 3000))]);
    if (this.proc.exitCode === null) this.proc.kill();
  }

  kill() {
    try { this.proc.kill(); } catch { /* already dead */ }
  }
}

let scratch: string;
const bins: Record<string, string> = {};

beforeAll(() => {
  if (!QB64) return;
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-e2e-'));
  bins.hello = compileTestBinary(HELLO_BAS, scratch, 'hello');
  bins.echo = compileTestBinary(ECHO_BAS, scratch, 'echo');
  bins.users = compileTestBinary(USERS_BAS, scratch, 'users');
  bins.types = compileTestBinary(TYPES_BAS, scratch, 'types');
}, 600000);

afterAll(() => {
  if (scratch) try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// hello: GET reads Req from the query string
// ---------------------------------------------------------------------------

describeE2E('hello route (GET, query -> Req)', () => {
  let c: Client;
  beforeEach(() => { c = new Client(bins.hello); });
  afterEach(() => c.kill());

  test('uses the name from the query string', async () => {
    const r = await c.get({ name: 'Ada' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ message: 'Hello, Ada! Greetings from QB64 BASIC.', language: 'QB64 BASIC' });
  });

  test('defaults to World, and does not read the body on GET', async () => {
    const r = await c.get({}, { bodyJson: JSON.stringify({ name: 'FromBody' }) });
    expect(r.body.message).toContain('Hello, World!');
  });

  test('request fields do not leak into the next request', async () => {
    await c.get({ name: 'First' });
    const r = await c.get({});
    expect(r.body.message).toContain('Hello, World!');
  });

  test('methods the route does not define return 405', async () => {
    const r = await c.post({ name: 'x' });
    expect(r.status).toBe(405);
    expect(r.body).toEqual({ error: 'Method Not Allowed' });
  });

  test('lowercase method names still dispatch', async () => {
    const r = await c.call({ method: 'get', queryJson: JSON.stringify({ name: 'Low' }) });
    expect(r.status).toBe(200);
  });

  test('the request id is echoed back', async () => {
    const r = await c.get({ name: 'x' });
    expect(r.id).toBe('1');
    const r2 = await c.get({ name: 'x' });
    expect(r2.id).toBe('2');
  });
});

// ---------------------------------------------------------------------------
// echo: POST reads Req from the JSON body, Fail ends the handler
// ---------------------------------------------------------------------------

describeE2E('echo route (POST, body -> Req, Fail)', () => {
  let c: Client;
  beforeEach(() => { c = new Client(bins.echo); });
  afterEach(() => c.kill());

  test('repeats the message', async () => {
    const r = await c.post({ message: 'BASIC', count: 3 });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ result: 'BASIC BASIC BASIC', repeats: 3 });
  });

  test('count is clamped to 1..10', async () => {
    expect((await c.post({ message: 'a', count: 0 })).body.repeats).toBe(1);
    expect((await c.post({ message: 'a', count: 99 })).body.repeats).toBe(10);
    expect((await c.post({ message: 'a' })).body.repeats).toBe(1);
  });

  test('Fail stops the handler and sends the error', async () => {
    const r = await c.post({ count: 2 });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'message is required' });
  });

  test('quotes, backslashes, newlines and unicode survive both directions', async () => {
    const message = 'say "hi" \\ back\nline é';
    const r = await c.post({ message, count: 1 });
    expect(r.body.result).toBe(message);
  });

  test('an integer outside the INTEGER range is rejected, not wrapped', async () => {
    const r = await c.post({ message: 'x', count: 99999 });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('count is out of range');
  });

  test('numbers sent as strings are accepted', async () => {
    const r = await c.post({ message: 'x', count: '2' });
    expect(r.body.repeats).toBe(2);
  });

  test('GET returns 405 because only POST is defined', async () => {
    const r = await c.get();
    expect(r.status).toBe(405);
  });

  test('survives many failures in a row and still answers', async () => {
    for (let i = 0; i < 300; i++) {
      expect((await c.post({})).status).toBe(400);
    }
    const ok = await c.post({ message: 'still alive', count: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body.result).toBe('still alive');
  }, 30000);

  test('malformed input does not crash the process', async () => {
    const r = await c.call({ method: 'POST', bodyJson: '{"message": "unterminated' });
    expect([200, 400]).toContain(r.status);
    const ok = await c.post({ message: 'after', count: 1 });
    expect(ok.body.result).toBe('after');
  });
});

// ---------------------------------------------------------------------------
// users/[id]: Param$, Query$, Header$
// ---------------------------------------------------------------------------

describeE2E('users/[id] route (Param$, Query$, Header$)', () => {
  let c: Client;
  beforeEach(() => { c = new Client(bins.users); });
  afterEach(() => c.kill());

  test('reads param, query and header', async () => {
    const r = await c.get({ verbose: '1' }, {
      paramsJson: JSON.stringify({ id: '42' }),
      headersJson: JSON.stringify({ 'user-agent': 'jest' }),
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ id: '42', verbose: '1', agent: 'jest' });
  });

  test('Header$ ignores the case of the name it is given', async () => {
    const r = await c.get({}, { paramsJson: '{"id":"1"}', headersJson: '{"user-agent":"x"}' });
    expect(r.body.agent).toBe('x');
  });

  test('missing values come back empty', async () => {
    const r = await c.get({}, { paramsJson: '{"id":"7"}' });
    expect(r.body).toEqual({ id: '7', verbose: '', agent: '' });
  });

  test('Fail can send a 404', async () => {
    const r = await c.get({}, { paramsJson: '{"id":"0"}' });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: 'user not found' });
  });
});

// ---------------------------------------------------------------------------
// types fixture: every field type, both directions
// ---------------------------------------------------------------------------

describeE2E('field types round trip', () => {
  let c: Client;
  beforeEach(() => { c = new Client(bins.types); });
  afterEach(() => c.kill());

  const sample = {
    anInt: -123, aLong: 2000000000, aDouble: -0.25, aSingle: 0.5,
    aBig: 123456789012, aByte: 200, note: 'a "quoted" note',
  };

  test('POST body -> Req -> Resp -> JSON', async () => {
    const r = await c.post(sample);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject(sample);
  });

  test('GET query strings (all text) fill the same fields', async () => {
    const asText = Object.fromEntries(Object.entries(sample).map(([k, v]) => [k, String(v)]));
    const r = await c.get(asText);
    expect(r.body).toMatchObject(sample);
  });

  test('fractions below one are written as valid JSON', async () => {
    const r = await c.post({ aDouble: 0.125, aSingle: -0.5 });
    expect(r.body.aDouble).toBe(0.125);
    expect(r.body.aSingle).toBe(-0.5);
  });

  test('missing fields are empty or zero', async () => {
    const r = await c.post({});
    expect(r.body).toMatchObject({ anInt: 0, aLong: 0, aDouble: 0, aSingle: 0, aBig: 0, aByte: 0, note: '' });
  });

  test('Resp is cleared between requests', async () => {
    const first = await c.post({ anInt: 7 });
    expect(first.body.onlyWhenSeven).toBe(1);
    const second = await c.post({ anInt: 8 });
    expect(second.body.onlyWhenSeven).toBe(0);
  });

  test.each([
    ['anInt', 40000],
    ['anInt', -40000],
    ['aLong', 3000000000],
    ['aByte', 300],
    ['aByte', -1],
  ])('%s = %p is out of range', async (field, value) => {
    const r = await c.post({ [field]: value });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe(`${field} is out of range`);
  });

  test('integer limits are accepted', async () => {
    const r = await c.post({ anInt: 32767, aLong: -2147483648, aByte: 255 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ anInt: 32767, aLong: -2147483648, aByte: 255 });
  });

  test('HEAD fills Req from the query string like GET', async () => {
    const r = await c.call({ method: 'HEAD', queryJson: JSON.stringify({ anInt: 5, note: 'head' }) });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ anInt: 5, note: 'head' });
  });

  test('OPTIONS runs OnOptions', async () => {
    const r = await c.call({ method: 'OPTIONS' });
    expect(r.status).toBe(204);
  });

  test('Respond sets a custom status', async () => {
    const r = await c.post({ anInt: 1 }, 'PUT');
    expect(r.status).toBe(201);
    expect(r.body.anInt).toBe(1);
  });

  test('Fail escapes quotes in the message', async () => {
    const r = await c.post({}, 'DELETE');
    expect(r.status).toBe(418);
    expect(r.body).toEqual({ error: 'teapot says "no"' });
  });

  test('a long string is cut to the field size', async () => {
    const r = await c.post({ note: 'x'.repeat(100) });
    expect(r.body.note).toBe('x'.repeat(40));
  });
});

// ---------------------------------------------------------------------------
// response headers
// ---------------------------------------------------------------------------

describeE2E('response headers (SetHeader, AllowCors)', () => {
  let c: Client;
  beforeEach(() => { c = new Client(bins.types); });
  afterEach(() => c.kill());

  const withNote = (note: string) => c.get({ note });

  test('a route with no SetHeader sends an empty list', async () => {
    const r = await withNote('plain');
    expect(r.headers).toEqual([]);
  });

  test('SetHeader sends the header, and repeats keep every value in order', async () => {
    const r = await withNote('headers');
    expect(r.status).toBe(200);
    expect(r.headers).toEqual([
      ['Cache-Control', 'no-store'],
      ['Set-Cookie', 'a=1'],
      ['Set-Cookie', 'b=2'],
    ]);
  });

  test('headers do not leak into the next request', async () => {
    await withNote('headers');
    const r = await withNote('plain');
    expect(r.headers).toEqual([]);
  });

  test('values with quotes and backslashes arrive intact', async () => {
    const r = await withNote('quote');
    expect(r.headers).toEqual([['X-Quote', 'say "hi" \\ done']]);
  });

  test('AllowCors for one origin adds Vary and lists the route methods', async () => {
    const r = await withNote('cors');
    const h = Object.fromEntries(r.headers);
    expect(h['Access-Control-Allow-Origin']).toBe('https://example.com');
    expect(h['Vary']).toBe('Origin');
    expect(h['Access-Control-Allow-Headers']).toBe('Content-Type, Authorization');
    for (const m of ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) {
      expect(h['Access-Control-Allow-Methods']).toContain(m);
    }
  });

  test('AllowCors "*" sends no Vary', async () => {
    const r = await withNote('cors-star');
    const h = Object.fromEntries(r.headers);
    expect(h['Access-Control-Allow-Origin']).toBe('*');
    expect(h['Vary']).toBeUndefined();
  });

  test('headers set before Fail are still sent', async () => {
    const r = await withNote('failheaders');
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: 'conflict' });
    expect(r.headers).toEqual([['X-Before', 'yes']]);
  });

  test.each(['badname', 'emptyname', 'badvalue'])('%s is rejected with a 500 and nothing is sent', async (note) => {
    const r = await withNote(note);
    expect(r.status).toBe(500);
    expect(r.body.error).toContain('Invalid response header');
    expect(r.headers).toEqual([]);
  });

  test('a bad header does not stop the process serving', async () => {
    await withNote('badvalue');
    const ok = await withNote('plain');
    expect(ok.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// process lifecycle
// ---------------------------------------------------------------------------

describeE2E('process lifecycle', () => {
  test('the {"_quit":true} message ends the process', async () => {
    const c = new Client(bins.hello);
    await c.get({ name: 'x' });
    const start = Date.now();
    await c.quit();
    expect(Date.now() - start).toBeLessThan(2500);
  });
});
