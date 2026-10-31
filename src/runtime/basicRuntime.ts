// src/runtime/basicRuntime.ts — persistent QB64 child process manager

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as readline from 'readline';
import * as path from 'path';
import { QB64TimeoutError, QB64CrashError } from '../types';

const TIMEOUT_MS = 5000;

interface PendingCall {
  resolve: (line: string) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface RuntimeProcess {
  proc: ChildProcessWithoutNullStreams;
  rl: readline.Interface;
  pending: Map<string, PendingCall>;
}

// One process per route name
const procs = new Map<string, RuntimeProcess>();
let idCounter = 0;

function getBinPath(routeName: string): string {
  // Binaries are written to <project-root>/bin/ by the compiler step.
  // In production the project root is process.cwd(); in dev it's the same.
  const ext = process.platform === 'win32' ? '.exe' : '';
  return path.join(process.cwd(), 'bin', routeName + ext);
}

function killRuntime(routeName: string): void {
  const rt = procs.get(routeName);
  if (!rt) return;
  procs.delete(routeName);
  // Reject all pending calls for this route
  for (const [, call] of rt.pending) {
    clearTimeout(call.timer);
    call.reject(new QB64CrashError(routeName, null));
  }
  rt.pending.clear();
  try { rt.proc.kill(); } catch { /* already dead */ }
}

function getRuntime(routeName: string): RuntimeProcess {
  const existing = procs.get(routeName);
  if (existing) return existing;

  const binPath = getBinPath(routeName);
  const proc = spawn(binPath, [], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  const pending = new Map<string, PendingCall>();

  const rl = readline.createInterface({ input: proc.stdout });

  rl.on('line', (line) => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Malformed line — ignore; the timeout will clean up
      return;
    }

    const id = String(parsed['_id']);
    const call = pending.get(id);
    if (!call) return;

    pending.delete(id);
    clearTimeout(call.timer);
    call.resolve(line);
  });

  proc.on('exit', (code) => {
    const rt = procs.get(routeName);
    if (rt && rt.proc === proc) {
      procs.delete(routeName);
      for (const [, call] of rt.pending) {
        clearTimeout(call.timer);
        call.reject(new QB64CrashError(routeName, code));
      }
      rt.pending.clear();
    }
  });

  const rt: RuntimeProcess = { proc, rl, pending };
  procs.set(routeName, rt);
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
      // Kill the process so it doesn't accumulate stalled state
      killRuntime(endpoint);
      reject(new QB64TimeoutError(endpoint));
    }, TIMEOUT_MS);

    rt.pending.set(id, { resolve, reject, timer });

    const line = JSON.stringify({ ...payload, _id: id }) + '\n';
    rt.proc.stdin.write(line, (err) => {
      if (err) {
        clearTimeout(timer);
        rt.pending.delete(id);
        reject(err);
      }
    });
  });
}

/** Gracefully shut down all running QB64 processes (call on server shutdown). */
export function shutdownAll(): void {
  for (const [routeName] of procs) {
    killRuntime(routeName);
  }
}
