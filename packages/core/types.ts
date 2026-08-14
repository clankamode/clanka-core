import { z } from 'zod';

/**
 * DAR Spec v1.1 - The Atomic Event Schema
 *
 * Strict payload contracts (see CONTRACT.md "Strict payload matrix").
 * Distinct from the looser EventLog schema in `event.ts`.
 */

export const FSSnapshotSchema = z.object({
  workspaceHash: z.string(),
  txId: z.string().optional(),
  files: z.array(z.object({
    path: z.string(),
    digest: z.string(),
    size: z.number()
  })).describe('Only includes files touched in current transaction or full baseline')
});

export const FSDiffSchema = z.object({
  txId: z.string(),
  path: z.string(),
  beforeDigest: z.string(),
  afterDigest: z.string(),
  patch: z.union([
    z.object({ kind: z.literal('unified'), text: z.string() }),
    z.object({ kind: z.literal('blob'), digest: z.string() })
  ])
});

export const ToolRequestSchema = z.object({
  callId: z.string(),
  txId: z.string(),
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  caps: z.object({
    fsRead: z.boolean().optional(),
    fsWrite: z.boolean().optional(),
    net: z.boolean().optional(),
  }).optional()
});

export const ToolResponseSchema = z.object({
  callId: z.string(),
  txId: z.string(),
  output: z.unknown(),
  error: z.object({
    code: z.string(),
    message: z.string()
  }).optional(),
  exitCode: z.number().optional()
});

export const RunStartedPayloadSchema = z.object({
  name: z.string(),
  version: z.string(),
});

export const RunFinishedPayloadSchema = z.object({
  status: z.enum(['success', 'failed', 'killed']),
  commitHash: z.string().optional(),
});

export const DecisionMadePayloadSchema = z.object({
  rationale: z.string(),
  plan: z.array(z.string()),
});

export const InvariantFailedPayloadSchema = z.object({
  invariant: z.string(),
  message: z.string(),
  severity: z.enum(['warn', 'error', 'fatal']),
});

export const ErrorRaisedPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
});

/** Payload schemas for every type in the CONTRACT.md strict matrix. */
export const StrictPayloadSchemas = {
  'run.started': RunStartedPayloadSchema,
  'run.finished': RunFinishedPayloadSchema,
  'decision.made': DecisionMadePayloadSchema,
  'tool.requested': ToolRequestSchema,
  'tool.responded': ToolResponseSchema,
  'fs.diff': FSDiffSchema,
  'fs.snapshot': FSSnapshotSchema,
  'invariant.failed': InvariantFailedPayloadSchema,
  'error.raised': ErrorRaisedPayloadSchema,
} as const;

export type StrictEventType = keyof typeof StrictPayloadSchemas;

export const StrictEventTypeSchema = z.enum(
  Object.keys(StrictPayloadSchemas) as [StrictEventType, ...StrictEventType[]],
);

export const EventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('run.started'), payload: RunStartedPayloadSchema }),
  z.object({ type: z.literal('run.finished'), payload: RunFinishedPayloadSchema }),
  z.object({ type: z.literal('decision.made'), payload: DecisionMadePayloadSchema }),
  z.object({ type: z.literal('tool.requested'), payload: ToolRequestSchema }),
  z.object({ type: z.literal('tool.responded'), payload: ToolResponseSchema }),
  z.object({ type: z.literal('fs.diff'), payload: FSDiffSchema }),
  z.object({ type: z.literal('fs.snapshot'), payload: FSSnapshotSchema }),
  z.object({ type: z.literal('invariant.failed'), payload: InvariantFailedPayloadSchema }),
  z.object({ type: z.literal('error.raised'), payload: ErrorRaisedPayloadSchema }),
]).and(z.object({
  v: z.literal(1.1),
  id: z.string(),               // The SHA256 Digest (Identity)
  runId: z.string(),
  seq: z.number(),              // Strict Ordering
  timestamp: z.number(),
  causes: z.array(z.string()),  // DAG Edges
  meta: z.object({
    agentId: z.string().optional(),
  }).optional()
}));

export type Event = z.infer<typeof EventSchema>;
