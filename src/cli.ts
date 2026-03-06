#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ClankaKernel } from './runtime/kernel.js';
import { diffRuns, formatDiffMarkdown } from './diff.js';

const RUNS_DIR = path.resolve(process.cwd(), 'runs');

function usage() {
  console.log('Usage: clanka-core <command> [args]');
  console.log('Commands:');
  console.log('  run <runId>');
  console.log('  log <runId> <type> <payload-json>');
  console.log('  replay <runId>');
  console.log('  verify <runId>');
  console.log('  ls');
  console.log('  export <runId> [--format json|markdown]');
  console.log('  diff <runId1> <runId2> [--json]');
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

export function cmdReplay(runId: string, writeLine: (line: string) => void = console.log) {
  const kernel = loadRun(runId);
  const events = kernel.getHistory().sort((a, b) => a.seq - b.seq);
  const firstTimestamp = events[0]?.timestamp ?? 0;

  for (const event of events) {
    const deltaMs = event.timestamp - firstTimestamp;
    const payloadPreview = JSON.stringify(event.payload).slice(0, 80);
    writeLine(`+${deltaMs}ms  [${event.seq}]  ${event.type}  ${payloadPreview}`);
  }
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

function cmdDiff(runId1: string, runId2: string, jsonOutput: boolean) {
  const kernel1 = loadRun(runId1);
  const kernel2 = loadRun(runId2);
  const result = diffRuns(runId1, kernel1.getHistory(), runId2, kernel2.getHistory());
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatDiffMarkdown(result));
  }
}

function formatExportMarkdown(runId: string, kernel: ClankaKernel): string {
  const events = kernel.getHistory().sort((a, b) => a.seq - b.seq);
  const lines = [`# Run Export: ${runId}`, '', `Total events: ${events.length}`, ''];

  for (const event of events) {
    lines.push(`- [${event.seq}] ${event.type} @ ${new Date(event.timestamp).toISOString()}`);
    lines.push(`  - actor: ${event.meta?.agentId ?? ''}`);
    lines.push(`  - payload: ${JSON.stringify(event.payload)}`);
  }

  return lines.join('\n') + '\n';
}

export function cmdExport(runId: string, format: 'json' | 'markdown' = 'json') {
  const kernel = loadRun(runId);

  if (format === 'markdown') {
    process.stdout.write(formatExportMarkdown(runId, kernel));
    return;
  }

  process.stdout.write(JSON.stringify(kernel.getHistory(), null, 2) + '\n');
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

  if (command === 'replay') {
    const runId = args[0];
    if (!runId) throw new Error('replay requires <runId>');
    cmdReplay(runId);
    return;
  }

  if (command === 'ls') {
    cmdLs();
    return;
  }

  if (command === 'export') {
    const runId = args[0];
    if (!runId) throw new Error('export requires <runId>');

    const formatFlag = args.find(arg => arg.startsWith('--format='));
    const formatValue = formatFlag ? formatFlag.split('=')[1] : undefined;
    const formatIndex = args.indexOf('--format');
    const formatArg = formatIndex >= 0 ? args[formatIndex + 1] : undefined;
    const requestedFormat = (formatValue ?? formatArg ?? 'json') as 'json' | 'markdown';

    if (requestedFormat !== 'json' && requestedFormat !== 'markdown') {
      throw new Error('export --format must be one of: json, markdown');
    }

    cmdExport(runId, requestedFormat);
    return;
  }

  if (command === 'diff') {
    const positional = args.filter(a => !a.startsWith('--'));
    const jsonOutput = args.includes('--json');
    const [runId1, runId2] = positional;
    if (!runId1 || !runId2) throw new Error('diff requires <runId1> <runId2>');
    cmdDiff(runId1, runId2, jsonOutput);
    return;
  }

  usage();
  process.exit(2);
}

if (process.env.CLANKA_CORE_CLI_TEST !== '1') {
  main().catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
