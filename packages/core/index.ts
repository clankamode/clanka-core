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

// Operator kernel: the runtime ClankaKernel (verify / serialize / fromJSONL).
// packages/core/kernel.ts is the EventLog-typed companion — do not export it
// under the same name; that fork previously lied about digest integrity and
// was missing verify/replay APIs that operators expect from ClankaKernel.
export { ClankaKernel, toCanonical } from '../../src/runtime/kernel.js';
export type {
  CognitiveEvent,
  VerifyResult,
} from '../../src/runtime/kernel.js';

export {
  ClankaKernel as EventLogKernel,
  toCanonical as eventLogToCanonical,
} from './kernel.js';
export type {
  KernelConfig as EventLogKernelConfig,
  VerifyResult as EventLogVerifyResult,
} from './kernel.js';

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
