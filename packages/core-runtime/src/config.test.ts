import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, test } from 'vitest';
import { z } from 'zod';
import { ConfigValidationError, loadConfig, parseEnvFile } from './index.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test('loadConfig merges config object, env vars, and .env files with typed output', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clanka-core-config-'));
  tempDirs.push(tempDir);
  fs.writeFileSync(
    path.join(tempDir, '.env'),
    [
      'APP_PORT=3000',
      'APP_DEBUG=true',
      'APP_SERVICE_NAME=from-dotenv',
      'APP_FEATURE_FLAGS=["search","replay"]',
      '',
    ].join('\n'),
    'utf-8',
  );

  const config = loadConfig({
    schema: z.object({
      port: z.number().int().positive(),
      debug: z.boolean().optional(),
      serviceName: z.string(),
      featureFlags: z.array(z.string()),
    }),
    cwd: tempDir,
    envPrefix: 'APP_',
    env: {
      APP_SERVICE_NAME: 'from-env',
    },
    config: {
      port: 8080,
    },
  });

  assert.deepEqual(config, {
    port: 8080,
    debug: true,
    serviceName: 'from-env',
    featureFlags: ['search', 'replay'],
  });
});

test('loadConfig reports invalid env vars with the config key and env var name', () => {
  assert.throws(
    () => loadConfig({
      schema: z.object({
        port: z.number().int().positive(),
      }),
      env: {
        PORT: 'not-a-number',
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigValidationError);
      assert.match(error.message, /Invalid configuration:/);
      assert.match(error.message, /Invalid config "port" from env var PORT:/);
      assert.match(error.message, /expected number/i);
      return true;
    },
  );
});

test('loadConfig reports missing required values and keeps optional fields optional', () => {
  assert.throws(
    () => loadConfig({
      schema: z.object({
        apiKey: z.string().min(1),
        debug: z.boolean().optional(),
      }),
      envPrefix: 'APP_',
      env: {},
    }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigValidationError);
      assert.match(error.message, /Missing required config "apiKey"/);
      assert.match(error.message, /config\.apiKey/);
      assert.match(error.message, /APP_API_KEY/);
      return true;
    },
  );
});

test('parseEnvFile supports quotes and inline comments', () => {
  const parsed = parseEnvFile([
    'APP_NAME="clanka core"',
    'APP_TOKEN=secret # comment',
    "APP_RAW='still-raw'",
    '',
  ].join('\n'));

  assert.deepEqual(parsed, {
    APP_NAME: 'clanka core',
    APP_TOKEN: 'secret',
    APP_RAW: 'still-raw',
  });
});
