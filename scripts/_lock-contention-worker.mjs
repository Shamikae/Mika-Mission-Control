#!/usr/bin/env node
// scripts/_lock-contention-worker.mjs
// Internal helper spawned as a CHILD PROCESS by
// validate-provider-execution-engine.mjs's real cross-process concurrency
// tests. Not a general-purpose script — do not run directly outside that
// context. Prints exactly one JSON line to stdout with the result.
//
// Usage: node _lock-contention-worker.mjs <jobId> <action> [ttlMs]
//   action: 'acquire' — attempt one acquisition and exit (lock stays held
//           if it succeeds, simulating a still-active or crashed holder
//           depending on whether the parent later releases it)

import { acquireExecutionLock } from '../lib/production/execution/executionLock.js';

const [, , jobId, action, ttlMsArg] = process.argv;
const ttlMs = ttlMsArg ? Number(ttlMsArg) : undefined;

if (action === 'acquire') {
  const result = acquireExecutionLock(jobId, {
    owner: `worker-${process.pid}`,
    ...(Number.isFinite(ttlMs) ? { ttlMs } : {}),
  });
  process.stdout.write(JSON.stringify(result));
} else {
  process.stdout.write(JSON.stringify({ ok: false, error: `Unknown action "${action}"` }));
}
