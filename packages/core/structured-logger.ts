export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerContext {
  module?: string;
  requestId?: string;
  traceId?: string;
  [key: string]: unknown;
}

export interface LogOutput {
  write(chunk: string): void;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context: LoggerContext;
}

export interface StructuredLoggerOptions {
  level?: LogLevel;
  silent?: boolean;
  output?: LogOutput;
  context?: LoggerContext;
  module?: string;
  requestId?: string;
  traceId?: string;
  now?: () => string;
}

export interface StructuredLogger {
  debug(message: string, context?: LoggerContext): void;
  info(message: string, context?: LoggerContext): void;
  warn(message: string, context?: LoggerContext): void;
  error(message: string, context?: LoggerContext): void;
  child(context?: LoggerContext): StructuredLogger;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function compactContext(context: LoggerContext): LoggerContext {
  const normalized: LoggerContext = {};

  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined) {
      normalized[key] = value;
    }
  }

  return normalized;
}

function mergeContext(baseContext: LoggerContext, nextContext?: LoggerContext): LoggerContext {
  if (nextContext === undefined) {
    return compactContext(baseContext);
  }

  return compactContext({
    ...baseContext,
    ...nextContext,
  });
}

function buildBaseContext(options: StructuredLoggerOptions): LoggerContext {
  const baseContext = compactContext(options.context ?? {});

  if (options.requestId !== undefined) {
    baseContext.requestId = options.requestId;
  }

  if (options.traceId !== undefined) {
    baseContext.traceId = options.traceId;
  }

  if (options.module !== undefined) {
    baseContext.module = options.module;
  }

  return baseContext;
}

export function createLogger(options: StructuredLoggerOptions = {}): StructuredLogger {
  const level = options.level ?? 'info';
  const silent = options.silent ?? false;
  const output = options.output ?? process.stdout;
  const now = options.now ?? (() => new Date().toISOString());
  const baseContext = buildBaseContext(options);

  function write(levelToWrite: LogLevel, message: string, context?: LoggerContext): void {
    if (silent) {
      return;
    }

    if (LOG_LEVEL_PRIORITY[levelToWrite] < LOG_LEVEL_PRIORITY[level]) {
      return;
    }

    const entry: StructuredLogEntry = {
      timestamp: now(),
      level: levelToWrite,
      message,
      context: mergeContext(baseContext, context),
    };

    output.write(`${JSON.stringify(entry)}\n`);
  }

  return {
    debug(message: string, context?: LoggerContext): void {
      write('debug', message, context);
    },
    info(message: string, context?: LoggerContext): void {
      write('info', message, context);
    },
    warn(message: string, context?: LoggerContext): void {
      write('warn', message, context);
    },
    error(message: string, context?: LoggerContext): void {
      write('error', message, context);
    },
    child(context: LoggerContext = {}): StructuredLogger {
      return createLogger({
        level,
        silent,
        output,
        now,
        context: mergeContext(baseContext, context),
      });
    },
  };
}
