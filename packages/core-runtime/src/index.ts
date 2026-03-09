export { ClankaKernel, toCanonical } from './runtime/kernel.js';
export type {
  CognitiveEvent,
  Invariant,
  RuntimeState,
  VerifyResult,
} from './runtime/kernel.js';

export { ConfigValidationError, loadConfig, parseEnvFile } from './config.js';
export type { ConfigValidationIssue, LoadConfigOptions } from './config.js';

export {
  diffRuns,
  formatDiffMarkdown,
  diffLines,
  formatLineDiff,
  truncateDiffLines,
  summarizePayload,
} from './diff.js';
export type {
  FieldDiff,
  ModifiedEvent,
  RunDiffResult,
  LineDiffOptions,
  FormatLineDiffOptions,
  FormatLineDiffDeps,
} from './diff.js';
