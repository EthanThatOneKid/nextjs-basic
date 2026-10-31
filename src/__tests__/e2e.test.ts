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
  try {
    const cmd = os.platform() === 'win32' ? 'where qb64' : 'which qb64';
    const result = execSync(cmd, { encoding: 'utf8' }).trim().split('\n')[0].trim();
    return result || null;
  } catch {
    return null;
  }
}

const QB64 = findQb64();
const SKIP = !QB64;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXAMPLE_BAS = path.join(__dirname, '..', '..', 'example', 'app', 'api', 'hello', 'route.bas');
const RUNTIME_BAS = path.join(__dirname, '..', 'runtime', 'runtime.bas');

function compileTestBinary(basFile: string, scratchDir: string): string {
  const runtimeSrc = fs.readFileSync(RUNTIME_BAS, 'utf8');
  const userSrc = fs.readFileSync(basFile, 'utf8');

  // Also bring in the glue file if it exists alongside the bas file
  const glueFile = path.join(path.dirname(basFile), 'route.glue.bas');
  const glueSrc = fs.existsSync(glueFile) ? fs.readFileSync(glueFile, 'utf8') : '';

  const combined = runtimeSrc + '\n\n' + glueSrc + '\n\n' + userSrc;
  const tmpBas = path.join(scratchDir, 'test.bas');
  fs.writeFileSync(tmpBas, combined, 'utf8');

  const ext = os.platform() === 'win32' ? '.exe' : '';
  const outBin = path.join(scratchDir, 'runtime' + ext);

  const result = spawnSync(QB64!, ['-c', tmpBas, '-o', outBin], {
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

    proc.stdin.write(JSON.stringify({ ...payload, _id: 'test-1' }) + '\n');
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

// Always-visible skip notice when QB64 is absent
if (SKIP) {
  test('QB64 e2e tests SKIPPED — qb64 not found on PATH (set QB64_PATH to enable)', () => {
    console.log('Install QB64 from https://qb64.com to run e2e tests locally.');
    expect(true).toBe(true);
  });
}
