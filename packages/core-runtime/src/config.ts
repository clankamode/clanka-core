import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';

type ConfigSchema = z.ZodObject<z.ZodRawShape>;
type ConfigKey<TSchema extends ConfigSchema> = Extract<keyof z.input<TSchema>, string>;
type EnvRecord = Record<string, string | undefined>;

export interface ConfigValidationIssue {
  key: string;
  path: string;
  message: string;
  source: 'config' | 'env' | 'envFile' | 'schema';
  envVar?: string;
}

export class ConfigValidationError extends TypeError {
  public readonly issues: ConfigValidationIssue[];

  constructor(issues: ConfigValidationIssue[]) {
    super(formatConfigIssues(issues));
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}

export interface LoadConfigOptions<TSchema extends ConfigSchema> {
  schema: TSchema;
  config?: Partial<z.input<TSchema>>;
  env?: EnvRecord;
  envFilePath?: string | string[];
  cwd?: string;
  envPrefix?: string;
  envMap?: Partial<Record<ConfigKey<TSchema>, string>>;
}

interface LoadedEnvSource {
  values: EnvRecord;
}

interface ResolvedValue {
  value: unknown;
  source: ConfigValidationIssue['source'];
  envVar?: string;
}

export function loadConfig<TSchema extends ConfigSchema>(
  options: LoadConfigOptions<TSchema>,
): z.output<TSchema> {
  const cwd = options.cwd ?? process.cwd();
  const envFile = loadEnvFiles(resolveEnvFilePaths(cwd, options.envFilePath));
  const env = options.env ?? process.env;
  const candidate: Record<string, unknown> = {};
  const resolvedValues = new Map<string, ResolvedValue>();

  for (const [key, fieldSchema] of Object.entries(options.schema.shape)) {
    const configValue = options.config?.[key as ConfigKey<TSchema>];
    if (configValue !== undefined) {
      candidate[key] = configValue;
      resolvedValues.set(key, { value: configValue, source: 'config' });
      continue;
    }

    const envVar = resolveEnvVarName(key, options.envPrefix, options.envMap);
    const directEnvValue = env[envVar];
    if (directEnvValue !== undefined) {
      const resolved = coerceEnvValue(directEnvValue, fieldSchema as z.ZodType<unknown>);
      candidate[key] = resolved;
      resolvedValues.set(key, { value: resolved, source: 'env', envVar });
      continue;
    }

    const envFileValue = envFile.values[envVar];
    if (envFileValue !== undefined) {
      const resolved = coerceEnvValue(envFileValue, fieldSchema as z.ZodType<unknown>);
      candidate[key] = resolved;
      resolvedValues.set(key, { value: resolved, source: 'envFile', envVar });
    }
  }

  const result = options.schema.safeParse(candidate);
  if (result.success) {
    return result.data;
  }

  throw new ConfigValidationError(
    buildValidationIssues(result.error, resolvedValues, options.schema, options.envPrefix, options.envMap),
  );
}

export function parseEnvFile(contents: string, sourceLabel = '.env'): Record<string, string> {
  const values: Record<string, string> = {};
  const lines = contents.split(/\r?\n/u);

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const normalizedLine = trimmed.startsWith('export ') ? trimmed.slice('export '.length) : rawLine;
    const match = normalizedLine.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u);
    if (!match) {
      throw new TypeError(`Invalid .env syntax in ${sourceLabel} at line ${index + 1}`);
    }

    const [, key, rawValue] = match;
    values[key] = parseEnvAssignmentValue(rawValue);
  }

  return values;
}

function resolveEnvFilePaths(cwd: string, envFilePath?: string | string[]): string[] {
  if (envFilePath === undefined) {
    return [path.resolve(cwd, '.env')];
  }

  const paths = Array.isArray(envFilePath) ? envFilePath : [envFilePath];
  return paths.map(filePath => path.resolve(cwd, filePath));
}

function loadEnvFiles(filePaths: string[]): LoadedEnvSource {
  const loaded: EnvRecord = {};

  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    Object.assign(loaded, parseEnvFile(content, filePath));
  }

  return { values: loaded };
}

function resolveEnvVarName<TSchema extends ConfigSchema>(
  key: string,
  envPrefix?: string,
  envMap?: Partial<Record<ConfigKey<TSchema>, string>>,
): string {
  const mapped = envMap?.[key as ConfigKey<TSchema>];
  if (mapped) {
    return mapped;
  }

  return `${envPrefix ?? ''}${toEnvKey(key)}`;
}

function toEnvKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replace(/[^A-Za-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .toUpperCase();
}

function coerceEnvValue(rawValue: string, schema: z.ZodType<unknown>): unknown {
  const candidates: unknown[] = [rawValue];
  const trimmed = rawValue.trim();

  if (trimmed === 'true' || trimmed === 'false') {
    candidates.push(trimmed === 'true');
  }

  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) {
    candidates.push(Number(trimmed));
  }

  if (looksLikeJson(trimmed)) {
    const parsedJson = safeJsonParse(trimmed);
    if (parsedJson !== undefined) {
      candidates.push(parsedJson);
    }
  }

  for (const candidate of candidates) {
    if (schema.safeParse(candidate).success) {
      return candidate;
    }
  }

  return rawValue;
}

function looksLikeJson(value: string): boolean {
  return (
    value.startsWith('{')
    || value.startsWith('[')
    || value === 'null'
    || value === 'true'
    || value === 'false'
    || (value.startsWith('"') && value.endsWith('"'))
  );
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseEnvAssignmentValue(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1)
      .replace(/\\n/gu, '\n')
      .replace(/\\r/gu, '\r')
      .replace(/\\t/gu, '\t')
      .replace(/\\"/gu, '"')
      .replace(/\\\\/gu, '\\');
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }

  return stripInlineComment(trimmed);
}

function stripInlineComment(value: string): string {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '#') {
      continue;
    }

    const previous = value[index - 1];
    if (index === 0 || previous === ' ' || previous === '\t') {
      return value.slice(0, index).trimEnd();
    }
  }

  return value;
}

function buildValidationIssues<TSchema extends ConfigSchema>(
  error: z.ZodError,
  resolvedValues: Map<string, ResolvedValue>,
  schema: TSchema,
  envPrefix?: string,
  envMap?: Partial<Record<ConfigKey<TSchema>, string>>,
): ConfigValidationIssue[] {
  return error.issues.map(issue => {
    const path = issue.path.map(segment => String(segment)).join('.');
    const key = typeof issue.path[0] === 'string' ? issue.path[0] : path || 'config';
    const resolved = resolvedValues.get(key);
    const envVar = resolveEnvVarName(key, envPrefix, envMap);
    const isMissing = !resolved && key in schema.shape;

    if (isMissing) {
      return {
        key,
        path: path || key,
        source: 'schema',
        envVar,
        message: `Missing required config "${key}". Provide config.${key} or env var ${envVar} (.env supported).`,
      };
    }

    const source = resolved?.source ?? 'schema';
    const sourceLabel = formatSourceLabel(source, resolved?.envVar);
    return {
      key,
      path: path || key,
      source,
      envVar: resolved?.envVar ?? envVar,
      message: `Invalid config "${path || key}" from ${sourceLabel}: ${issue.message}`,
    };
  });
}

function formatSourceLabel(source: ConfigValidationIssue['source'], envVar?: string): string {
  if (source === 'config') {
    return 'config object';
  }

  if (source === 'env' && envVar) {
    return `env var ${envVar}`;
  }

  if (source === 'envFile' && envVar) {
    return `.env value ${envVar}`;
  }

  return 'schema input';
}

function formatConfigIssues(issues: ConfigValidationIssue[]): string {
  return ['Invalid configuration:', ...issues.map(issue => `- ${issue.message}`)].join('\n');
}
