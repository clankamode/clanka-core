import { z } from 'zod';

const EventTypeSchema = z.string().min(1, 'Event type must be a non-empty string');
const EventPayloadSchema = z.record(z.string(), z.unknown());

export const EventEnvelopeSchema = z.object({
  v: z.number(),
  id: z.string(),
  runId: z.string(),
  seq: z.number(),
  type: EventTypeSchema,
  timestamp: z.number(),
  causes: z.array(z.string()).optional(),
  payload: EventPayloadSchema,
  meta: z.object({
    agentId: z.string().optional(),
    tool: z.string().optional(),
    model: z.string().optional(),
  }).optional(),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

export class SchemaRegistry {
  private schemas = new Map<string, z.ZodTypeAny>();

  public register(type: string, schema: z.ZodTypeAny): void {
    const parsedType = EventTypeSchema.parse(type);
    this.schemas.set(parsedType, schema);
  }

  public validate(event: unknown): EventEnvelope {
    const envelopeResult = EventEnvelopeSchema.safeParse(event);
    if (!envelopeResult.success) {
      throw new TypeError(`Invalid event: ${envelopeResult.error.message}`);
    }

    const eventType = envelopeResult.data.type;
    const payloadSchema = this.schemas.get(eventType);
    if (!payloadSchema) {
      throw new TypeError(`No schema registered for event type "${eventType}"`);
    }

    const payloadResult = payloadSchema.safeParse(envelopeResult.data.payload);
    if (!payloadResult.success) {
      throw new TypeError(`Invalid payload for event type "${eventType}": ${payloadResult.error.message}`);
    }

    const normalizedPayloadResult = EventPayloadSchema.safeParse(payloadResult.data);
    if (!normalizedPayloadResult.success) {
      throw new TypeError(`Invalid payload for event type "${eventType}": payload must be an object`);
    }

    return {
      ...envelopeResult.data,
      payload: normalizedPayloadResult.data,
    };
  }

  public listTypes(): string[] {
    return Array.from(this.schemas.keys()).sort();
  }
}
