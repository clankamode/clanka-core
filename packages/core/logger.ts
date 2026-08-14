import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Writable } from 'node:stream';
import { EventSchema, type Event } from './event';

/**
 * EventLogger: Append-only JSONL event persistence with blob offload for large
 * payloads, plus optional console helpers (`log` / `debug` / `info` / `warn` /
 * `error`) that write to `config.output` (default: stdout).
 *
 * Honesty notes:
 * - Console helpers always emit; `LogLevel` is a label, not a min-level filter.
 * - Console helpers and `append` use different sinks (stream vs JSONL/blobs).
 * - No secret redaction: context and payloads are written as provided (after
 *   JSON serialization). `Error` values are expanded to name/message/stack.
 */

export interface LoggerConfig {
  runsDir: string;
  blobsDir: string;
  maxPayloadSize: number; // Bytes; larger payloads go to blob storage
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
   * Large payloads are stored under blobs/ and referenced by event id
   * (content digest). Missing blobs later cause `readLog` to throw.
   */
  public async append(event: Event): Promise<void> {
    const parsed = EventSchema.safeParse(event);
    if (!parsed.success) {
      throw new TypeError(`Invalid event: ${parsed.error.message}`);
    }

    const payloadSize = JSON.stringify(parsed.data.payload).length;
    
    let logEntry = { ...parsed.data };
    
    // If payload is too large, store as blob
    if (payloadSize > this.config.maxPayloadSize) {
      const blobPath = path.join(this.blobsPath, `${parsed.data.id}.json`);
      fs.writeFileSync(blobPath, JSON.stringify(parsed.data.payload, null, 2));
      
      logEntry = {
        ...parsed.data,
        payload: { _blobRef: parsed.data.id },
      };
    }
    
    // Append to JSONL
    const line = JSON.stringify(logEntry) + '\n';
    fs.appendFileSync(this.logPath, line);
  }

  /**
   * Read the entire log, hydrating blob-backed payloads.
   * Throws if a `_blobRef` cannot be resolved from disk.
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
        // Hydrate blobs if needed
        if (parsed.payload && parsed.payload._blobRef) {
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
   * Get the run index (metadata for fast seeking).
   * Returns eventCount 0 with no timestamps when the JSONL file is absent or empty.
   */
  public getIndex(): RunIndex {
    if (!fs.existsSync(this.logPath)) {
      return {
        runId: this.runId,
        eventCount: 0,
      };
    }

    const events = fs.readFileSync(this.logPath, 'utf-8').trim().split('\n').filter(l => l);
    if (events.length === 0) {
      return {
        runId: this.runId,
        eventCount: 0,
      };
    }

    const first = JSON.parse(events[0]);
    const last = JSON.parse(events[events.length - 1]);
    
    return {
      runId: this.runId,
      eventCount: events.length,
      started: first.timestamp,
      finished: last.timestamp,
    };
  }
}
