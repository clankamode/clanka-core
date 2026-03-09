export { ClankaKernel, toCanonical } from './runtime/kernel.js';
export type {
  CognitiveEvent,
  Invariant,
  RuntimeState,
  VerifyResult,
} from './runtime/kernel.js';

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

export { retry } from './retry.js';
export type {
  RetryJitterOptions,
  RetryOperation,
  RetryOptions,
} from './retry.js';
