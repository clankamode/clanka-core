import { z } from 'zod';

/**
 * DAR Spec v1.1 - The Atomic Event Schema
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

export const EventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('run.started'), payload: z.object({ name: z.string(), version: z.string() }) }),
  z.object({ type: z.literal('run.finished'), payload: z.object({ status: z.enum(['success', 'failed', 'killed']), commitHash: z.string().optional() }) }),
  z.object({ type: z.literal('decision.made'), payload: z.object({ rationale: z.string(), plan: z.array(z.string()) }) }),
  z.object({ type: z.literal('tool.requested'), payload: ToolRequestSchema }),
  z.object({ type: z.literal('tool.responded'), payload: ToolResponseSchema }),
  z.object({ type: z.literal('fs.diff'), payload: FSDiffSchema }),
  z.object({ type: z.literal('fs.snapshot'), payload: FSSnapshotSchema }),
  z.object({ type: z.literal('invariant.failed'), payload: z.object({ invariant: z.string(), message: z.string(), severity: z.enum(['warn', 'error', 'fatal']) }) }),
  z.object({ type: z.literal('error.raised'), payload: z.object({ code: z.string(), message: z.string() }) }),
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
