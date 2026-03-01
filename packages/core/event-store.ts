import { z } from 'zod';
import { SchemaRegistry, type EventEnvelope } from './schema-registry';

const EventStoreQuerySchema = z.object({
  since: z.number().optional(),
  type: z.string().min(1).optional(),
  limit: z.number().int().nonnegative().optional(),
}).strict();

export type EventStoreQuery = z.infer<typeof EventStoreQuerySchema>;

export class EventStore {
  private events: EventEnvelope[] = [];
  private registry: SchemaRegistry;

  constructor(registry: SchemaRegistry = new SchemaRegistry()) {
    this.registry = registry;
  }

  public append(event: unknown): EventEnvelope {
    const parsed = this.registry.validate(event);
    const stored = structuredClone(parsed);
    this.events.push(stored);
    return structuredClone(stored);
  }

  public query(query: EventStoreQuery = {}): EventEnvelope[] {
    const parsedQuery = EventStoreQuerySchema.parse(query);

    const filtered = this.events.filter(event => {
      if (parsedQuery.since !== undefined && event.timestamp < parsedQuery.since) {
        return false;
      }
      if (parsedQuery.type !== undefined && event.type !== parsedQuery.type) {
        return false;
      }
      return true;
    });

    const limited = parsedQuery.limit === undefined
      ? filtered
      : filtered.slice(0, parsedQuery.limit);

    return structuredClone(limited);
  }

  public clear(): void {
    this.events = [];
  }
}
