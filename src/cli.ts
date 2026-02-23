#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ClankaKernel } from './runtime/kernel.js';

const RUNS_DIR = path.resolve(process.cwd(), 'runs');

function usage() {
  console.log('Usage: clanka-core <command> [args]');
  console.log('Commands:');
  console.log('  run <runId>');
  console.log('  log <runId> <type> <payload-json>');
  console.log('  verify <runId>');
  console.log('  ls');
  console.log('  export <runId>');
}

function runPath(runId: string): string {
  return path.join(RUNS_DIR, `${runId}.jsonl`);
}

function ensureRunsDir() {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
}

function saveRun(runId: string, kernel: ClankaKernel) {
  ensureRunsDir();
  fs.writeFileSync(runPath(runId), kernel.serialize() + '\n', 'utf-8');
}

function loadRun(runId: string): ClankaKernel {
  const filePath = runPath(runId);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Run not found: ${runId}`);
  }
  return ClankaKernel.loadFromFile(runId, RUNS_DIR);
}

async function cmdRun(runId: string) {
  const kernel = new ClankaKernel(runId);
  const start = await kernel.log('run.start', 'cli', {}, []);
  await kernel.log('run.commit', 'cli', {}, [start.id]);
  saveRun(runId, kernel);
  console.log(`${runId} ${kernel.getHistory().length}`);
}

async function cmdLog(runId: string, type: string, payloadJson: string) {
  let payload: any;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    throw new Error('Invalid payload JSON');
  }

  const kernel = loadRun(runId);
  await kernel.log(type, 'cli', payload, []);
  saveRun(runId, kernel);

  const count = kernel.getHistory().length;
  console.log(`${runId} ${count}`);
}

function cmdVerify(runId: string) {
  try {
    const kernel = loadRun(runId);
    const result = kernel.verify();
    console.log(`PASS ${runId} ${result.eventCount}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL ${runId} ${message}`);
    process.exitCode = 1;
  }
}

function cmdLs() {
  ensureRunsDir();
  const files = fs.readdirSync(RUNS_DIR).filter(name => name.endsWith('.jsonl')).sort();

  for (const file of files) {
    const runId = file.slice(0, -'.jsonl'.length);
    try {
      const kernel = loadRun(runId);
      const history = kernel.getHistory();
      const eventCount = history.length;
      const lastTs = eventCount > 0 ? history[eventCount - 1].timestamp : 0;
      let status = 'PASS';

      try {
        kernel.verify();
      } catch {
        status = 'FAIL';
      }

      console.log(`${runId}\t${eventCount}\t${lastTs}\t${status}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`${runId}\t0\t0\tFAIL (${message})`);
    }
  }
}

function cmdExport(runId: string) {
  const filePath = runPath(runId);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Run not found: ${runId}`);
  }
  process.stdout.write(fs.readFileSync(filePath, 'utf-8'));
}

async function main() {
  const [, , command, ...args] = process.argv;

  if (!command) {
    usage();
    process.exit(2);
  }

  if (command === 'run') {
    const runId = args[0];
    if (!runId) throw new Error('run requires <runId>');
    await cmdRun(runId);
    return;
  }

  if (command === 'log') {
    const [runId, type, payloadJson] = args;
    if (!runId || !type || payloadJson === undefined) {
      throw new Error('log requires <runId> <type> <payload-json>');
    }
    await cmdLog(runId, type, payloadJson);
    return;
  }

  if (command === 'verify') {
    const runId = args[0];
    if (!runId) throw new Error('verify requires <runId>');
    cmdVerify(runId);
    return;
  }

  if (command === 'ls') {
    cmdLs();
    return;
  }

  if (command === 'export') {
    const runId = args[0];
    if (!runId) throw new Error('export requires <runId>');
    cmdExport(runId);
    return;
  }

  usage();
  process.exit(2);
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
