#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ClankaKernel } from './runtime/kernel.js';
import { diffRuns, formatDiffMarkdown } from './diff.js';

const RUNS_DIR = path.resolve(process.cwd(), 'runs');

export function usage(writeLine: (line: string) => void = console.log) {
  writeLine('Usage: clanka-core <command> [args]');
  writeLine('Commands:');
  writeLine('  run <runId> [--force]');
  writeLine('  log <runId> <type> <payload-json>');
  writeLine('  replay <runId>');
  writeLine('  verify <runId>');
  writeLine('  ls');
  writeLine('  export <runId> [--format json|markdown]');
  writeLine('  diff <runId1> <runId2> [--json]');
  writeLine('  help | --help | -h');
}

export function isHelpCommand(command: string | undefined): boolean {
  return command === 'help' || command === '--help' || command === '-h';
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

export async function cmdRun(
  runId: string,
  options: { force?: boolean } = {},
  writeLine: (line: string) => void = console.log,
) {
  if (!options.force && fs.existsSync(runPath(runId))) {
    throw new Error(
      `Run already exists: ${runId}. Re-run with --force to overwrite.`,
    );
  }

  const kernel = new ClankaKernel(runId);
  const start = await kernel.log('run.start', 'cli', {}, []);
  await kernel.log('run.commit', 'cli', {}, [start.id]);
  saveRun(runId, kernel);
  writeLine(`${runId} ${kernel.getHistory().length}`);
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

export function cmdReplay(
  runId: string,
  writeLine: (line: string) => void = console.log,
  writeError: (line: string) => void = console.error,
) {
  const kernel = loadRun(runId);
  const events = kernel.getHistory().sort((a, b) => a.seq - b.seq);

  if (events.length === 0) {
    writeError(`No events in run ${runId}`);
    return;
  }

  const firstTimestamp = events[0].timestamp;

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
    console.error(`FAIL ${runId} ${message}`);
    process.exitCode = 1;
  }
}

export function cmdLs(
  writeLine: (line: string) => void = console.log,
  writeError: (line: string) => void = console.error,
) {
  ensureRunsDir();
  const files = fs.readdirSync(RUNS_DIR).filter(name => name.endsWith('.jsonl')).sort();

  if (files.length === 0) {
    writeError('No runs found in runs/');
    return;
  }

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
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        status = `FAIL (${message})`;
      }

      writeLine(`${runId}\t${eventCount}\t${lastTs}\t${status}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeLine(`${runId}\t0\t0\tFAIL (${message})`);
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
    lines.push(`  - actor: ${event.meta?.agentId ?? 'unknown'}`);
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

  if (isHelpCommand(command)) {
    usage();
    process.exit(0);
  }

  if (command === 'run') {
    const force = args.includes('--force');
    const positional = args.filter(arg => arg !== '--force');
    const runId = positional[0];
    if (!runId) throw new Error('run requires <runId>');
    if (positional.length > 1) {
      throw new Error('run accepts only <runId> and optional --force');
    }
    await cmdRun(runId, { force });
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
