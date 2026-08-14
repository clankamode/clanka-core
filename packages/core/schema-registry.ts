import { z } from 'zod';
import { EventTypeSchema } from './event';
import { StrictPayloadSchemas } from './types';

/**
 * Event types the registry may accept: EventLog enum plus `error.raised`
 * from the strict DAR schema in types.ts (see CONTRACT.md).
 */
export const RegistryEventTypeSchema = z.union([
  EventTypeSchema,
  z.literal('error.raised'),
]);

export type RegistryEventType = z.infer<typeof RegistryEventTypeSchema>;

const EventPayloadSchema = z.record(z.string(), z.unknown());

const LooseEventLogPayloadSchema = EventPayloadSchema;

export const EventEnvelopeSchema = z.object({
  v: z.number(),
  id: z.string(),
  runId: z.string(),
  seq: z.number(),
  type: RegistryEventTypeSchema,
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

  /**
   * EventLog contract: every `EventTypeSchema` value with an open object payload
   * (required payload keys: none — matches CONTRACT.md EventLog matrix).
   */
  public static forEventLog(): SchemaRegistry {
    const registry = new SchemaRegistry();
    for (const type of EventTypeSchema.options) {
      registry.register(type, LooseEventLogPayloadSchema);
    }
    return registry;
  }

  /**
   * Strict DAR contract: every types.ts / CONTRACT.md strict-matrix event type
   * with its required payload fields enforced.
   */
  public static forStrictContract(): SchemaRegistry {
    const registry = new SchemaRegistry();
    for (const type of Object.keys(StrictPayloadSchemas) as Array<keyof typeof StrictPayloadSchemas>) {
      registry.register(type, StrictPayloadSchemas[type]);
    }
    return registry;
  }

  public register(type: string, schema: z.ZodTypeAny): void {
    const parsedType = RegistryEventTypeSchema.parse(type);
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
