export {
  EventSchema,
  EventTypeSchema,
  canonicalJSON,
  contentDigest,
  createEvent,
} from './event.js';
export type { Event, EventType } from './event.js';

export {
  invariant_planBeforeAction,
} from './invariant.js';
export type {
  Invariant,
  InvariantContext,
  InvariantResult,
} from './invariant.js';

export { EventLogger } from './logger.js';
export type { LoggerConfig } from './logger.js';

export { SchemaRegistry, EventEnvelopeSchema } from './schema-registry.js';
export type { EventEnvelope } from './schema-registry.js';

export { EventStore } from './event-store.js';
export type { EventStoreQuery } from './event-store.js';

export { ReplayHarness } from './replay.js';
export type { MockModel, MockTool, ReplayConfig } from './replay.js';

// packages/core is NOT a workspace/npm package. Do not export ClankaKernel here —
// operators get that from src/runtime (@clankamode/core / @clankamode/core-runtime)
// and `clanka-core verify` uses runtime kernel.verify() (digest/seq/causes).
// EventLogKernel is the local EventLog-typed companion only.
export { EventLogKernel, toCanonical } from './kernel.js';
export type {
  EventLogKernelConfig,
  EventLogVerifyResult,
} from './kernel.js';

// EventLog file verifier (schema + fs replay). Not what `clanka-core verify` runs.
// packages/core/bin/clanka is a separate, unbuilt helper that requires dist/verify.js.
export { verifyRun } from './verify.js';

export { createLogger } from './structured-logger.js';
export type {
  LoggerContext,
  LogLevel,
  LogOutput,
  StructuredLogEntry,
  StructuredLogger,
  StructuredLoggerOptions,
} from './structured-logger.js';
