// src/__tests__/e2e.test.ts
//
// End-to-end tests: compile the example route.bas with QB64 and exercise the
// full STDIO runtime loop via the Node.js basicRuntime.
//
// These tests are SKIPPED automatically when QB64 is not installed on the
// machine (no "qb64" on PATH and QB64_PATH not set). CI on GitHub Actions
// does not have QB64, so the skip is the expected outcome there.
// Run locally after installing QB64: https://qb64.com

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync, spawnSync } from 'child_process';

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
const SKIP = !QB64;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXAMPLE_BAS = path.join(__dirname, '..', '..', 'example', 'app', 'api', 'hello', 'route.bas');
const ECHO_BAS    = path.join(__dirname, '..', '..', 'example', 'app', 'api', 'echo',  'route.bas');
const RUNTIME_BAS = path.join(__dirname, '..', 'runtime', 'runtime.bas');

function compileTestBinary(basFile: string, scratchDir: string): string {
  const runtimeSrc = fs.readFileSync(RUNTIME_BAS, 'utf8');
  const userSrc = fs.readFileSync(basFile, 'utf8');

  // Regenerate glue so the test never runs against stale generated files
  const { parseBasFile, writeGeneratedFiles } = require('../codegen');
  writeGeneratedFiles(parseBasFile(basFile));

  // Same order as compiler.ts: decls, runtime, user route, glue subs
  const read = (f: string) => {
    const p = path.join(path.dirname(basFile), f);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  };
  const combined = read('route.glue_decls.bas') + '\n\n' + runtimeSrc + '\n\n' + userSrc + '\n\n' + read('route.glue.bas');
  const tmpBas = path.join(scratchDir, 'test.bas');
  fs.writeFileSync(tmpBas, combined, 'utf8');

  const ext = os.platform() === 'win32' ? '.exe' : '';
  const outBin = path.join(scratchDir, 'runtime' + ext);

  const result = spawnSync(QB64!, ['-x', tmpBas, '-o', path.resolve(outBin)], {
    encoding: 'utf8',
    timeout: 60000,
  });

  if (result.status !== 0) {
    throw new Error(`QB64 compile failed:\n${result.stderr}`);
  }

  return outBin;
}

function sendRequest(binPath: string, payload: object): Promise<object> {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const readline = require('readline');

    const proc = spawn(binPath, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    const rl = readline.createInterface({ input: proc.stdout });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('QB64 binary timeout after 5s'));
    }, 5000);

    rl.once('line', (line: string) => {
      clearTimeout(timer);
      proc.kill();
      try {
        resolve(JSON.parse(line));
      } catch (e) {
        reject(new Error(`Bad JSON from binary: ${line}`));
      }
    });

    proc.stdin.write(JSON.stringify({ _id: 'test-1', ...payload }) + '\n');
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const describeE2E = SKIP ? describe.skip : describe;

describeE2E('QB64 e2e — example hello route', () => {
  let scratchDir: string;
  let binPath: string;

  beforeAll(() => {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-e2e-'));
    console.log(`[e2e] Compiling with QB64 at: ${QB64}`);
    binPath = compileTestBinary(EXAMPLE_BAS, scratchDir);
    console.log(`[e2e] Binary: ${binPath}`);
  });

  afterAll(() => {
    try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('binary exists and is executable', () => {
    expect(fs.existsSync(binPath)).toBe(true);
    const stat = fs.statSync(binPath);
    expect(stat.size).toBeGreaterThan(0);
  });

  test('GET returns a greeting from BASIC', async () => {
    const resp = await sendRequest(binPath, {
      method: 'GET',
      path: '/api/hello',
      endpoint: 'hello',
      bodyJson: JSON.stringify({ name: 'Kiroween' }),
    }) as Record<string, unknown>;

    expect(resp['statusCode']).toBe(200);
    const body = JSON.parse(resp['bodyJson'] as string);
    expect(body.message).toContain('Kiroween');
    expect(body.language).toBe('QB64 BASIC');
  });

  test('GET with no name defaults to World', async () => {
    const resp = await sendRequest(binPath, {
      method: 'GET',
      path: '/api/hello',
      endpoint: 'hello',
      bodyJson: '{}',
    }) as Record<string, unknown>;

    const body = JSON.parse(resp['bodyJson'] as string);
    expect(body.message).toContain('World');
  });

  test('unknown method returns 405', async () => {
    const resp = await sendRequest(binPath, {
      method: 'TRACE',
      path: '/api/hello',
      endpoint: 'hello',
      bodyJson: '{}',
    }) as Record<string, unknown>;

    expect(resp['statusCode']).toBe(405);
  });

  test('_id is echoed back in the response', async () => {
    const resp = await sendRequest(binPath, {
      method: 'GET',
      path: '/api/hello',
      endpoint: 'hello',
      bodyJson: '{}',
      _id: 'test-1',
    }) as Record<string, unknown>;

    expect(resp['_id']).toBe('test-1');
  });
});

describeE2E('QB64 e2e — example echo route (POST)', () => {
  let scratchDir: string;
  let binPath: string;

  beforeAll(() => {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-echo-e2e-'));

    // The echo route needs a glue file generated from its TYPE blocks.
    // Run codegen inline here since we can't run the full plugin in tests.
    const { parseBasFile, writeGeneratedFiles } = require('../codegen');
    const parsed = parseBasFile(ECHO_BAS);
    writeGeneratedFiles(parsed);

    console.log(`[e2e] Compiling echo route with QB64 at: ${QB64}`);
    binPath = compileTestBinary(ECHO_BAS, scratchDir);
    console.log(`[e2e] Echo binary: ${binPath}`);
  });

  afterAll(() => {
    try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('binary exists and is executable', () => {
    expect(fs.existsSync(binPath)).toBe(true);
    expect(fs.statSync(binPath).size).toBeGreaterThan(0);
  });

  test('POST repeats message the requested number of times', async () => {
    const resp = await sendRequest(binPath, {
      method: 'POST',
      path: '/api/echo',
      endpoint: 'echo',
      bodyJson: JSON.stringify({ message: 'BASIC', count: 3 }),
    }) as Record<string, unknown>;

    expect(resp['statusCode']).toBe(200);
    const body = JSON.parse(resp['bodyJson'] as string);
    expect(body.result).toBe('BASIC BASIC BASIC');
    expect(body.repeats).toBe(3);
  });

  test('POST with count 1 returns the message once', async () => {
    const resp = await sendRequest(binPath, {
      method: 'POST',
      path: '/api/echo',
      endpoint: 'echo',
      bodyJson: JSON.stringify({ message: 'Hello', count: 1 }),
    }) as Record<string, unknown>;

    const body = JSON.parse(resp['bodyJson'] as string);
    expect(body.result).toBe('Hello');
    expect(body.repeats).toBe(1);
  });

  test('POST with count 0 defaults to 1 repeat', async () => {
    const resp = await sendRequest(binPath, {
      method: 'POST',
      path: '/api/echo',
      endpoint: 'echo',
      bodyJson: JSON.stringify({ message: 'QB64', count: 0 }),
    }) as Record<string, unknown>;

    const body = JSON.parse(resp['bodyJson'] as string);
    expect(body.repeats).toBe(1);
  });

  test('POST caps count at 10', async () => {
    const resp = await sendRequest(binPath, {
      method: 'POST',
      path: '/api/echo',
      endpoint: 'echo',
      bodyJson: JSON.stringify({ message: 'x', count: 99 }),
    }) as Record<string, unknown>;

    const body = JSON.parse(resp['bodyJson'] as string);
    expect(body.repeats).toBe(10);
  });

  test('GET returns 405 on echo route (only POST defined)', async () => {
    const resp = await sendRequest(binPath, {
      method: 'GET',
      path: '/api/echo',
      endpoint: 'echo',
      bodyJson: '{}',
    }) as Record<string, unknown>;

    expect(resp['statusCode']).toBe(405);
  });

  test('_id is echoed back in response', async () => {
    const resp = await sendRequest(binPath, {
      method: 'POST',
      path: '/api/echo',
      endpoint: 'echo',
      bodyJson: JSON.stringify({ message: 'id-test', count: 1 }),
      _id: 'echo-42',
    }) as Record<string, unknown>;

    expect(resp['_id']).toBe('echo-42');
  });
});



// Always-visible skip notice when QB64 is absent
if (SKIP) {
  test('QB64 e2e tests SKIPPED — qb64 not found on PATH (set QB64_PATH to enable)', () => {
    console.log('Install QB64 from https://qb64.com to run e2e tests locally.');
    expect(true).toBe(true);
  });
}
