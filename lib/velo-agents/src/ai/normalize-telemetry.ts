import { TennisTelemetrySchema, type TennisTelemetry } from "./schemas.js";

/**
 * Single source of truth for turning a raw velo-engine `/analyze` response into a
 * validated `TennisTelemetry`. Imported by EVERY telemetry ingester (form-agent,
 * bounty-agent) so the engine↔agent contract can never drift between paths again.
 *
 * The v2 engine emits a NESTED object (camelCase via Pydantic by_alias) whose flat
 * coaching fields live under `summary`, with extra honesty signals under `aggregate`
 * and `engine`. The v1 engine emitted those flat fields at the top level. We support
 * both: read `summary` when present (v2), else the root (v1), then graft the optional
 * v2 signals. `snakeToCamelDeep` is a harmless no-op on already-camelCase payloads but
 * keeps us safe if engine by_alias serialization is ever disabled.
 */
export function normalizeTelemetry(raw: unknown): TennisTelemetry {
  const camel = snakeToCamelDeep(raw) as Record<string, unknown>;
  const summary = (camel.summary ?? camel) as Record<string, unknown>;
  const aggregate = (camel.aggregate ?? {}) as Record<string, unknown>;
  const engine = (camel.engine ?? {}) as Record<string, unknown>;

  const flat: Record<string, unknown> = {
    ...summary,
    isMock: camel.isMock ?? summary.isMock ?? false,
    // Deterministic engine commitment — kept (NOT dropped) so it rides into the IPFS-pinned
    // report and the on-chain summaryHash commits it. Top-level on the engine payload. (R2 fix.)
    telemetryHash: camel.telemetryHash,
    // Grafted v2 honesty signals (schema marks each optional/nullish).
    velocityScaleSource: engine.velocityScaleSource,
    timingGranularityMs: engine.timingGranularityMs,
    normalizedCfr: engine.normalizedCfr,
    kinematicSequenceValid: aggregate.kinematicSequenceValid,
    sequenceCoherenceScore: aggregate.sequenceCoherenceScore,
    peakProximalToDistalGain: aggregate.peakProximalToDistalGain,
  };

  const result = TennisTelemetrySchema.safeParse(flat);
  if (!result.success) {
    const issues = result.error.errors
      .map((e) => `${e.path.join(".") || "(root)"}: ${e.message}`)
      .join("; ");
    throw new Error(`Vision engine telemetry failed validation: ${issues}`);
  }
  return result.data;
}

/** Recursively convert snake_case object keys to camelCase (values untouched). */
export function snakeToCamelDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeToCamelDeep);
  if (value && typeof value === "object") {
    // null prototype so hostile keys like "__proto__" can't pollute prototypes
    const out: Record<string, unknown> = Object.create(null);
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const camelKey = k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
      out[camelKey] = snakeToCamelDeep(v);
    }
    return out;
  }
  return value;
}
