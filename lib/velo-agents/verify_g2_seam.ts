/**
 * G2 — Engine→Agent seam check (no API keys, no chain).
 *
 * Feeds a REAL engine /analyze payload through the agent's own contract boundary:
 *   1. normalizeTelemetry(raw) must NOT throw  → the v2 engine↔agent seam holds.
 *   2. the v2 honesty signals must survive       → the honesty layer reaches the LLM.
 *   3. telemetryHash is DROPPED by normalize     → live proof of R2 (the gap the
 *      bytes32 migration closes). Reported as a FINDING, not a test failure.
 *
 * Run:  cd lib/velo-agents && npx tsx verify_g2_seam.ts /tmp/velo_engine_out.json
 */
import { readFileSync } from "node:fs";
import { TennisTelemetrySchema } from "./src/ai/schemas.js";
import { normalizeTelemetry } from "./src/ai/normalize-telemetry.js";

const path = process.argv[2] ?? "/tmp/velo_engine_out.json";
const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;

let fails = 0;
const ok = (name: string, cond: boolean, got: unknown) =>
  console.log(`  ${cond ? "✓" : "✗"} ${name}  (${String(got)})`) || (cond ? 0 : (fails++, 0));

console.log("G2 — engine→agent seam");
const rawHash: string | undefined = raw.telemetryHash;
ok("engine payload carried a telemetryHash", typeof rawHash === "string" && rawHash.startsWith("sha256:"), (rawHash ?? "MISSING").slice(0, 24) + "…");

let norm: any = null;
try {
  norm = normalizeTelemetry(raw);
  ok("normalizeTelemetry() did not throw → seam holds", true, "validated");
} catch (e) {
  ok("normalizeTelemetry() did not throw → seam holds", false, (e as Error).message.slice(0, 160));
}

if (norm) {
  // Direct Zod check on the normalized object too (belt + suspenders).
  ok("normalized object passes TennisTelemetrySchema", TennisTelemetrySchema.safeParse(norm).success, "zod ok");
  // Honesty signals that SHOULD flow through to the prompt:
  ok("honesty: velocityScaleSource survived", norm.velocityScaleSource != null, norm.velocityScaleSource);
  ok("honesty: timingGranularityMs survived", norm.timingGranularityMs != null, norm.timingGranularityMs);
  ok("honesty: normalizedCfr survived", norm.normalizedCfr != null, norm.normalizedCfr);
  ok("honesty: peakProximalToDistalGain present (nullable)", "peakProximalToDistalGain" in norm, norm.peakProximalToDistalGain);

  // R2 regression guard — the deterministic hash MUST survive the agent boundary now,
  // so it rides into the IPFS-pinned report and the on-chain summaryHash commits it
  // (no contract change). See docs/VELO-ONCHAIN-HASH-MIGRATION.md.
  ok(
    "R2 FIXED: telemetryHash survives normalize (commits via summaryHash, no contract change)",
    norm.telemetryHash != null && String(norm.telemetryHash) === String(rawHash),
    norm.telemetryHash ? String(norm.telemetryHash).slice(0, 24) + "…" : "DROPPED",
  );
}

if (fails) {
  console.log(`G2 FAIL — ${fails} assertion(s) failed (the seam is broken — real finding)`);
  process.exit(1);
}
console.log("G2 PASS — seam validates; honesty signals flow; telemetryHash now SURVIVES → R2 fix verified");
