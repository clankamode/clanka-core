import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Writable } from 'node:stream';
import { EventSchema, type Event } from './event';

/**
 * EventLogger: Append-only JSONL with blob storage for large payloads.
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
      this.output.write(`${JSON.stringify(payload)}\n`);
      return;
    }

    const contextText = context ? ` ${JSON.stringify(context)}` : '';
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
   * Append an event to the log.
   * Large payloads are stored in blobs/ and referenced by digest.
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
   * Read the entire log.
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
        if (parsed.payload._blobRef) {
          const blobPath = path.join(this.blobsPath, `${parsed.payload._blobRef}.json`);
          if (fs.existsSync(blobPath)) {
            parsed.payload = JSON.parse(fs.readFileSync(blobPath, 'utf-8'));
          }
        }
        return parsed as Event;
      });
  }

  /**
   * Get the run index (metadata for fast seeking).
   */
  public getIndex(): { runId: string; eventCount: number; started: number; finished?: number } {
    const events = fs.readFileSync(this.logPath, 'utf-8').trim().split('\n').filter(l => l);
    const first = events[0] ? JSON.parse(events[0]) : null;
    const last = events[events.length - 1] ? JSON.parse(events[events.length - 1]) : null;
    
    return {
      runId: this.runId,
      eventCount: events.length,
      started: first?.timestamp,
      finished: last?.timestamp,
    };
  }
}
