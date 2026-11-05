// src/runtime/basicRuntime.ts — persistent QB64 child process manager

import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import * as path from 'path';
import { QB64TimeoutError, QB64CrashError } from '../types';

const TIMEOUT_MS = 5000;

interface PendingCall {
  resolve: (line: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface RuntimeProcess {
  routeName: string;
  proc: ChildProcess;
  rl: readline.Interface;
  pending: Map<string, PendingCall>;
  /** Told us to stop sending it work; it quits once its queued requests are answered. */
  retiring: boolean;
}

// The process that takes new requests for each route name
const procs = new Map<string, RuntimeProcess>();
// Every live process, including retiring ones, so shutdown can reach them all
const all = new Set<RuntimeProcess>();
let idCounter = 0;

function getBinPath(routeName: string): string {
  const ext = process.platform === 'win32' ? '.exe' : '';
  return path.join(process.cwd(), 'bin', routeName + ext);
}

function stopProcess(rt: RuntimeProcess): void {
  try { rt.proc.stdin?.write('{"_quit":true}\n'); } catch { /* already closed */ }
  try { rt.proc.kill(); } catch { /* already dead */ }
}

function failPending(rt: RuntimeProcess, code: number | null): void {
  for (const [, call] of rt.pending) {
    clearTimeout(call.timer);
    call.reject(new QB64CrashError(rt.routeName, code));
  }
  rt.pending.clear();
}

function killRuntime(routeName: string, rt: RuntimeProcess): void {
  if (procs.get(routeName) === rt) procs.delete(routeName);
  failPending(rt, null);
  stopProcess(rt);
}

/**
 * A QB64 process leaks a little stack every time a handler ends early with Fail, so
 * the runtime asks to be replaced after a few hundred failures. New requests go to a
 * fresh process at once; this one answers what is already queued, then quits.
 */
function retire(routeName: string, rt: RuntimeProcess): void {
  rt.retiring = true;
  if (procs.get(routeName) === rt) procs.delete(routeName);
  if (rt.pending.size === 0) stopProcess(rt);
}

function getRuntime(routeName: string): RuntimeProcess {
  const existing = procs.get(routeName);
  if (existing) return existing;

  const binPath = getBinPath(routeName);
  const proc = spawn(binPath, [], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  if (!proc.stdin || !proc.stdout) {
    throw new Error(`[nextjs-basic] Failed to open STDIO streams for ${routeName}`);
  }

  const rl = readline.createInterface({ input: proc.stdout });
  const rt: RuntimeProcess = { routeName, proc, rl, pending: new Map<string, PendingCall>(), retiring: false };

  rl.on('line', (line) => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const id = String(parsed['_id']);
    const call = rt.pending.get(id);
    if (!call) return;
    rt.pending.delete(id);
    clearTimeout(call.timer);
    call.resolve(line);

    if (parsed['recycle'] === true) retire(routeName, rt);
    else if (rt.retiring && rt.pending.size === 0) stopProcess(rt);
  });

  proc.on('exit', (code) => {
    all.delete(rt);
    if (procs.get(routeName) === rt) procs.delete(routeName);
    failPending(rt, code);
  });

  procs.set(routeName, rt);
  all.add(rt);
  return rt;
}

export interface BasicPayload {
  endpoint: string;
  method: string;
  path: string;
  bodyJson: string;
  [key: string]: unknown;
}

export function callBasic(payload: BasicPayload): Promise<string> {
  const { endpoint } = payload;

  return new Promise<string>((resolve, reject) => {
    const id = String(++idCounter);
    const rt = getRuntime(endpoint);

    const timer = setTimeout(() => {
      rt.pending.delete(id);
      killRuntime(endpoint, rt);
      reject(new QB64TimeoutError(endpoint));
    }, TIMEOUT_MS);

    rt.pending.set(id, { resolve, reject, timer });

    const line = JSON.stringify({ ...payload, _id: id }) + '\n';
    rt.proc.stdin!.write(line, (err) => {
      if (err) {
        clearTimeout(timer);
        rt.pending.delete(id);
        reject(err);
      }
    });
  });
}

export function shutdownAll(): void {
  for (const rt of [...all]) {
    procs.clear();
    failPending(rt, null);
    stopProcess(rt);
  }
}

// QB64 cannot see its stdin close, so make sure no route process outlives this one.
process.once('exit', shutdownAll);
