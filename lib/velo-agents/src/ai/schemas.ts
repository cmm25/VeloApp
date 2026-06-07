import { z } from "zod";

// Tennis pose telemetry (from velo-engine). The engine emits the v2 nested
// object; form-agent.normalizeTelemetry flattens its `summary` block to this
// shape and grafts the optional v2 honesty signals below.

export const JointAnglesSchema = z.object({
  shoulder: z.number().describe("Elbow-shoulder-hip angle in degrees"),
  elbow: z.number().describe("Wrist-elbow-shoulder angle in degrees"),
  wrist: z.number().describe("Forearm-orientation PROXY vs image vertical (NOT anatomical wrist flexion)"),
  hip: z.number().describe("Shoulder-hip-knee angle in degrees"),
  knee: z.number().describe("Hip-knee-ankle angle in degrees"),
  // v2 honesty flags (optional; engine sets them, mock/v1 omit them).
  wristIsProxy: z.boolean().optional(),
  racketFaceDeg: z.number().nullish(),
});

export const StrokePhaseSchema = z.object({
  phase: z.enum(["preparation", "contact", "follow_through"]),
  frameIndex: z.number(),
  timestampMs: z.number(),
  angles: JointAnglesSchema,
  // The first analyzed frame has no prior frame to diff against, so the engine
  // emits `null` here (not absent). Accept null as well as undefined.
  wristVelocityPx: z.number().nullish(),
});

export const TennisTelemetrySchema = z.object({
  videoUrl: z.string(),
  durationMs: z.number(),
  framesAnalyzed: z.number(),
  fps: z.number(),
  strokePhases: z.array(StrokePhaseSchema),
  peakAngles: JointAnglesSchema,
  avgAngles: JointAnglesSchema,
  symmetryScore: z
    .number()
    .min(0)
    .max(1)
    .describe("Temporal repeatability of angles across strokes (NOT left/right symmetry). 0=variable, 1=consistent"),
  dominantStroke: z.enum(["forehand", "backhand", "serve", "volley", "unknown"]),
  strokeCount: z.number(),
  analysisNotes: z.string().optional(),
  isMock: z.boolean().default(false),

  // Deterministic engine commitment ("sha256:<64hex>"). Carried THROUGH to the IPFS-pinned
  // report so the on-chain summaryHash = keccak256(report) transitively commits it — no
  // contract change. Optional: absent on mock/v1 payloads. (Closes R2.)
  telemetryHash: z.string().nullish(),

  // ── v2 honesty signals (all OPTIONAL — grafted from engine.summary/aggregate/engine;
  // absent on mock/v1 payloads). Never make these required or the live path breaks. ──
  velocityScaleSource: z
    .enum(["torso_length", "court_homography", "pixels", "unknown"])
    .nullish()
    .describe("Scale basis for velocities. NOT court_homography ⇒ velocities are relative, NEVER mph/metric."),
  timingGranularityMs: z.number().nullish().describe("ms between analyzed frames; timing finer than this is unresolved"),
  normalizedCfr: z.boolean().nullish(),
  kinematicSequenceValid: z
    .boolean()
    .nullish()
    .describe("True if a resolvable, textbook proximal→distal sequence was found (null ⇒ not resolvable at this fps)"),
  sequenceCoherenceScore: z.number().min(0).max(1).nullish().describe("Coarse peak-order agreement (ordinal, ties common)"),
  peakProximalToDistalGain: z
    .number()
    .min(0)
    .max(1)
    .nullish()
    .describe("Did peak speed increase hips→trunk→arm (PRIMARY, ball-speed-correlated signal). 1.0=textbook chain"),
});

export type TennisTelemetry = z.infer<typeof TennisTelemetrySchema>;

// Form Analysis Report (output of FormAgent AI)

export const FormIssueSchema = z.object({
  area: z.enum([
    "shoulder",
    "elbow",
    "wrist",
    "hip",
    "knee",
    "footwork",
    "balance",
    "timing",
    "symmetry",
  ]),
  severity: z.enum(["critical", "moderate", "minor"]),
  phase: z.enum(["preparation", "contact", "follow_through", "overall"]),
  observation: z.string().max(300),
  recommendation: z.string().max(300),
});

export const FormStrengthSchema = z.object({
  area: z.string(),
  observation: z.string().max(200),
});

export const FormReportSchema = z.object({
  strokeType: z.enum(["forehand", "backhand", "serve", "volley", "unknown"]),
  overallScore: z.number().min(0).max(10).describe("Biomechanical quality score 0-10"),
  issues: z.array(FormIssueSchema).max(5),
  strengths: z.array(FormStrengthSchema).max(3),
  keyFindings: z.string().max(500).describe("2-3 sentence clinical summary"),
  analysedAt: z.string().describe("ISO timestamp"),
});

export type FormReport = z.infer<typeof FormReportSchema>;

// Prescription Report (output of PrescriberAgent AI)

export const DrillSchema = z.object({
  name: z.string().max(80),
  targetArea: z.string(),
  sets: z.number().optional(),
  reps: z.number().optional(),
  durationMinutes: z.number().optional(),
  instructions: z.string().max(400),
  rationale: z.string().max(200),
});

export const PrescriptionReportSchema = z.object({
  sessionGoal: z.string().max(200),
  priorityFocus: z.array(z.string()).max(3),
  drills: z.array(DrillSchema).min(2).max(5),
  mentalCues: z.array(z.string()).max(3),
  progressionNote: z.string().max(300),
  prescribedAt: z.string().describe("ISO timestamp"),
  basedOnFormScore: z.number(),
});

export type PrescriptionReport = z.infer<typeof PrescriptionReportSchema>;

// AI provenance (how each reasoning step was produced)
// Records whether a verdict came from Somnia's native consensus agent or the
// Groq fallback, plus the on-chain request/receipt reference when native.

export const SomniaAgentReceiptSchema = z.object({
  requestId: z.string(),
  agentId: z.string(),
  txHash: z.string(),
  consensusStatus: z.string(),
  receipt: z.string().nullable(),
  receiptUrl: z.string(),
});

export const AiProvenanceSchema = z.object({
  path: z.enum(["native", "fallback"]),
  agentType: z.literal("llm-inference"),
  somnia: SomniaAgentReceiptSchema.optional(),
  fallbackReason: z.string().optional(),
});

export type AiProvenance = z.infer<typeof AiProvenanceSchema>;

// On-chain payload (what gets stored in Supabase + returned by API)

export const StoredReceiptSchema = z.object({
  jobId: z.string(),
  orchestrator: z.string(),
  chainId: z.number(),
  form: z.object({
    receipt: z.object({
      jobId: z.string(),
      agent: z.string(),
      ipfsCid: z.string(),
      summaryHash: z.string(),
      summary: z.string(),
      nonce: z.string(),
      deadline: z.string(),
      priorReceiptHash: z.string(),
    }),
    signature: z.string(),
    txHash: z.string(),
    blockNumber: z.string(),
    report: FormReportSchema.optional(),
    provenance: AiProvenanceSchema.optional(),
  }).nullable(),
  prescription: z.object({
    receipt: z.object({
      jobId: z.string(),
      agent: z.string(),
      ipfsCid: z.string(),
      summaryHash: z.string(),
      summary: z.string(),
      nonce: z.string(),
      deadline: z.string(),
      priorReceiptHash: z.string(),
    }),
    signature: z.string(),
    txHash: z.string(),
    blockNumber: z.string(),
    report: PrescriptionReportSchema.optional(),
    provenance: AiProvenanceSchema.optional(),
  }).nullable(),
});

export type StoredReceipt = z.infer<typeof StoredReceiptSchema>;
