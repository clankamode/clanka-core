#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ClankaKernel, diffRuns, formatDiffMarkdown } from '@clankamode/core-runtime';

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
  writeLine('Notes:');
  writeLine('  verify/ls PASS|FAIL = digest, seq, causes, v, runId, timestamps');
  writeLine('  (not EventLog schema, fs snapshot, or workspaceHash checks)');
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
    process.exitCode = 1;
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
    process.exitCode = 1;
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

function eventsBySeq(kernel: ClankaKernel) {
  return kernel.getHistory().sort((a, b) => a.seq - b.seq);
}

function formatExportMarkdown(runId: string, events: ReturnType<ClankaKernel['getHistory']>): string {
  const lines = [`# Run Export: ${runId}`, '', `Total events: ${events.length}`, ''];

  for (const event of events) {
    lines.push(`- [${event.seq}] ${event.type} @ ${new Date(event.timestamp).toISOString()}`);
    lines.push(`  - actor: ${event.meta?.agentId ?? 'unknown'}`);
    lines.push(`  - payload: ${JSON.stringify(event.payload)}`);
  }

  return lines.join('\n') + '\n';
}

export function cmdExport(
  runId: string,
  format: 'json' | 'markdown' = 'json',
  write: (chunk: string) => void = chunk => {
    process.stdout.write(chunk);
  },
) {
  const kernel = loadRun(runId);
  const events = eventsBySeq(kernel);

  if (format === 'markdown') {
    write(formatExportMarkdown(runId, events));
    return;
  }

  write(JSON.stringify(events, null, 2) + '\n');
}

function isOption(arg: string): boolean {
  return arg.startsWith('-');
}

function unknownOptionError(command: string, option: string): Error {
  return new Error(`${command}: unknown option ${option}`);
}

function parseExactPositionals(
  command: string,
  args: string[],
  count: number,
  usageHint: string,
): string[] {
  const positionals: string[] = [];
  for (const arg of args) {
    if (isOption(arg)) {
      throw unknownOptionError(command, arg);
    }
    positionals.push(arg);
  }
  if (positionals.length < count) {
    throw new Error(`${command} requires ${usageHint}`);
  }
  if (positionals.length > count) {
    throw new Error(`${command} accepts only ${usageHint}`);
  }
  return positionals;
}

export function parseExportArgs(args: string[]): {
  runId: string;
  format: 'json' | 'markdown';
} {
  const positionals: string[] = [];
  let format: 'json' | 'markdown' = 'json';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--format' || arg.startsWith('--format=')) {
      let value: string | undefined;
      if (arg.startsWith('--format=')) {
        value = arg.slice('--format='.length);
      } else {
        const next = args[i + 1];
        if (next === undefined || isOption(next)) {
          throw new Error('export --format requires a value (json or markdown)');
        }
        value = next;
        i += 1;
      }

      if (value !== 'json' && value !== 'markdown') {
        throw new Error('export --format must be one of: json, markdown');
      }
      format = value;
      continue;
    }

    if (isOption(arg)) {
      throw unknownOptionError('export', arg);
    }

    positionals.push(arg);
  }

  if (positionals.length === 0) {
    throw new Error('export requires <runId>');
  }
  if (positionals.length > 1) {
    throw new Error('export accepts only <runId> and optional --format');
  }

  return { runId: positionals[0], format };
}

export function parseDiffArgs(args: string[]): {
  runId1: string;
  runId2: string;
  jsonOutput: boolean;
} {
  const positionals: string[] = [];
  let jsonOutput = false;

  for (const arg of args) {
    if (arg === '--json') {
      jsonOutput = true;
      continue;
    }
    if (isOption(arg)) {
      throw unknownOptionError('diff', arg);
    }
    positionals.push(arg);
  }

  if (positionals.length < 2) {
    throw new Error('diff requires <runId1> <runId2>');
  }
  if (positionals.length > 2) {
    throw new Error('diff accepts only <runId1> <runId2> and optional --json');
  }

  return { runId1: positionals[0], runId2: positionals[1], jsonOutput };
}

export function parseRunArgs(args: string[]): { runId: string; force: boolean } {
  const positionals: string[] = [];
  let force = false;

  for (const arg of args) {
    if (arg === '--force') {
      force = true;
      continue;
    }
    if (isOption(arg)) {
      throw unknownOptionError('run', arg);
    }
    positionals.push(arg);
  }

  if (positionals.length === 0) {
    throw new Error('run requires <runId>');
  }
  if (positionals.length > 1) {
    throw new Error('run accepts only <runId> and optional --force');
  }

  return { runId: positionals[0], force };
}

/** Dispatch argv (command + args). Used by the bin entry and tests. */
export async function runCli(argv: string[]): Promise<void> {
  const [command, ...args] = argv;

  if (!command) {
    usage();
    process.exitCode = 2;
    return;
  }

  if (isHelpCommand(command)) {
    usage();
    return;
  }

  if (command === 'run') {
    const { runId, force } = parseRunArgs(args);
    await cmdRun(runId, { force });
    return;
  }

  if (command === 'log') {
    const [runId, type, payloadJson] = parseExactPositionals(
      'log',
      args,
      3,
      '<runId> <type> <payload-json>',
    );
    await cmdLog(runId, type, payloadJson);
    return;
  }

  if (command === 'verify') {
    const [runId] = parseExactPositionals('verify', args, 1, '<runId>');
    cmdVerify(runId);
    return;
  }

  if (command === 'replay') {
    const [runId] = parseExactPositionals('replay', args, 1, '<runId>');
    cmdReplay(runId);
    return;
  }

  if (command === 'ls') {
    if (args.length > 0) {
      if (isOption(args[0])) {
        throw unknownOptionError('ls', args[0]);
      }
      throw new Error('ls accepts no arguments');
    }
    cmdLs();
    return;
  }

  if (command === 'export') {
    const { runId, format } = parseExportArgs(args);
    cmdExport(runId, format);
    return;
  }

  if (command === 'diff') {
    const { runId1, runId2, jsonOutput } = parseDiffArgs(args);
    cmdDiff(runId1, runId2, jsonOutput);
    return;
  }

  usage();
  process.exitCode = 2;
}

async function main() {
  await runCli(process.argv.slice(2));
}

if (process.env.CLANKA_CORE_CLI_TEST !== '1') {
  main().catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
