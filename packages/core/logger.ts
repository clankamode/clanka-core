import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Writable } from 'node:stream';
import { EventSchema, type Event } from './event';

/**
 * EventLogger: Append-only JSONL event persistence with optional blob mirrors
 * for large payloads, plus console helpers (`log` / `debug` / `info` / `warn` /
 * `error`) that write to `config.output` (default: stdout).
 *
 * Honesty notes:
 * - Console helpers always emit; `LogLevel` is a label, not a min-level filter.
 * - Console helpers and `append` use different sinks (stream vs JSONL/blobs).
 * - JSONL always stores the full event. Large payloads may also be mirrored
 *   under `blobsDir`; payload is never replaced with `{ _blobRef }` on write
 *   (that would break content-digest verification of the on-disk line).
 * - No secret redaction: context and payloads are written as provided (after
 *   JSON serialization). `Error` values are expanded to name/message/stack.
 */

export interface LoggerConfig {
  runsDir: string;
  blobsDir: string;
  /**
   * Byte size of `JSON.stringify(payload)` above which the payload is also
   * mirrored under `blobsDir`. The JSONL line always keeps the full event so
   * content digests remain verifiable.
   */
  maxPayloadSize: number;
  output?: Writable;
  cliArgs?: string[];
  structuredOutput?: boolean;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface RunIndex {
  runId: string;
  eventCount: number;
  /** Timestamp of the first event, when the log has events. */
  started?: number;
  /** Timestamp of the last event, when the log has events. */
  finished?: number;
}

function serializeLogValue(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...(value.cause !== undefined ? { cause: value.cause } : {}),
    };
  }
  return value;
}

export class EventLogger {
  private runId: string;
  private logPath: string;
  private blobsPath: string;
  private config: LoggerConfig;
  private output: Writable;
  private structuredOutput: boolean;
  private indexLoaded = false;
  private indexedCount = 0;
  private indexedStarted?: number;
  private indexedFinished?: number;

  constructor(runId: string, config: LoggerConfig) {
    this.runId = runId;
    this.config = config;
    
    // Create run-specific directories
    this.logPath = path.join(config.runsDir, `${runId}.jsonl`);
    this.blobsPath = path.join(config.blobsDir, runId);
    this.output = config.output || process.stdout;
    this.structuredOutput = config.structuredOutput ?? (config.cliArgs?.includes('--json') ?? false);
    
    fs.mkdirSync(config.runsDir, { recursive: true });
    fs.mkdirSync(this.blobsPath, { recursive: true });
  }

  private loadIndexFromDisk(): void {
    if (this.indexLoaded) {
      return;
    }
    this.indexLoaded = true;

    if (!fs.existsSync(this.logPath)) {
      return;
    }

    const events = fs.readFileSync(this.logPath, 'utf-8').trim().split('\n').filter(l => l);
    if (events.length === 0) {
      return;
    }

    this.indexedCount = events.length;
    this.indexedStarted = JSON.parse(events[0]).timestamp;
    this.indexedFinished = JSON.parse(events[events.length - 1]).timestamp;
  }

  private noteAppended(timestamp: number): void {
    // Caller must loadIndexFromDisk() before writing the new line.
    if (this.indexedCount === 0) {
      this.indexedStarted = timestamp;
    }
    this.indexedFinished = timestamp;
    this.indexedCount += 1;
  }

  public log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const payload = {
      timestamp: Date.now(),
      level,
      message,
      ...(context ? { context } : {}),
    };

    if (this.structuredOutput) {
      this.output.write(`${JSON.stringify(payload, serializeLogValue)}\n`);
      return;
    }

    const contextText = context ? ` ${JSON.stringify(context, serializeLogValue)}` : '';
    this.output.write(`[${level}] ${message}${contextText}\n`);
  }

  public debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  public info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  public error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  /**
   * Append an event to the JSONL log.
   * When the payload exceeds `maxPayloadSize`, a mirror is also written under
   * blobs/ named by event id. The JSONL line always contains the full event.
   * Legacy lines that already use `{ _blobRef }` are still hydrated by `readLog`.
   */
  public async append(event: Event): Promise<void> {
    const parsed = EventSchema.safeParse(event);
    if (!parsed.success) {
      throw new TypeError(`Invalid event: ${parsed.error.message}`);
    }

    const payloadSize = JSON.stringify(parsed.data.payload).length;
    const logEntry = { ...parsed.data };

    // Mirror large payloads; never rewrite the JSONL payload (digest integrity).
    if (payloadSize > this.config.maxPayloadSize) {
      const blobPath = path.join(this.blobsPath, `${parsed.data.id}.json`);
      fs.writeFileSync(blobPath, JSON.stringify(parsed.data.payload, null, 2));
    }

    this.loadIndexFromDisk();
    const line = JSON.stringify(logEntry) + '\n';
    fs.appendFileSync(this.logPath, line);
    this.noteAppended(parsed.data.timestamp);
  }

  /**
   * Read the entire log.
   * Hydrates legacy `{ _blobRef }` payloads when present. Throws if a blob
   * reference cannot be resolved from disk.
   */
  public async readLog(): Promise<Event[]> {
    if (!fs.existsSync(this.logPath)) {
      return [];
    }
    
    const content = fs.readFileSync(this.logPath, 'utf-8');
    return content
      .trim()
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => {
        const parsed = JSON.parse(line);
        // Hydrate legacy blob stubs if needed
        if (
          parsed.payload &&
          typeof parsed.payload === 'object' &&
          parsed.payload._blobRef &&
          Object.keys(parsed.payload).length === 1
        ) {
          const blobRef = String(parsed.payload._blobRef);
          const blobPath = path.join(this.blobsPath, `${blobRef}.json`);
          if (!fs.existsSync(blobPath)) {
            throw new Error(
              `Missing blob for event ${parsed.id ?? '(unknown)'}: ${blobRef}`,
            );
          }
          parsed.payload = JSON.parse(fs.readFileSync(blobPath, 'utf-8'));
        }
        return parsed as Event;
      });
  }

  /**
   * Return run metadata: event count and first/last timestamps.
   * Loaded once from the JSONL if needed, then updated on `append`.
   * This is not a seek index into the log file.
   */
  public getIndex(): RunIndex {
    this.loadIndexFromDisk();
    const index: RunIndex = {
      runId: this.runId,
      eventCount: this.indexedCount,
    };
    if (this.indexedStarted !== undefined) {
      index.started = this.indexedStarted;
    }
    if (this.indexedFinished !== undefined) {
      index.finished = this.indexedFinished;
    }
    return index;
  }
}
