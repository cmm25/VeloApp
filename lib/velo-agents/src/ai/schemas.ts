import { z } from "zod";

// MediaPipe telemetry (from velo-engine)

export const JointAnglesSchema = z.object({
  shoulder: z.number().describe("Elbow-shoulder-hip angle in degrees"),
  elbow: z.number().describe("Wrist-elbow-shoulder angle in degrees"),
  wrist: z.number().describe("Index-wrist-elbow angle in degrees"),
  hip: z.number().describe("Shoulder-hip-knee angle in degrees"),
  knee: z.number().describe("Hip-knee-ankle angle in degrees"),
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
  symmetryScore: z.number().min(0).max(1).describe("0=asymmetric, 1=perfect symmetry"),
  dominantStroke: z.enum(["forehand", "backhand", "serve", "volley", "unknown"]),
  strokeCount: z.number(),
  analysisNotes: z.string().optional(),
  isMock: z.boolean().default(false),
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

// External model output (raw JSON returned by an independently-trained model
// hosted on RunPod / Render). The model is still in training, so this schema is
// deliberately generic: it validates the SHAPE of any tennis-aspect model's
// output (e.g. a serve-specific model) without prescribing the exact metrics.
// The external-model agent feeds this into an LLM to produce a standard
// FormReport, so the downstream Prescriber + UI consume it unchanged.
//
// ⚠ SPECIALIZATION POINT (1 of 3): when the real model's output is finalized,
// tighten this schema to its exact shape. See buildExternalModelPrompt() in
// prompts.ts for the full three-place checklist.

export const ExternalModelOutputSchema = z.object({
  // Which tennis aspect this model analysed (e.g. "serve", "rally", "footwork").
  aspect: z.string().min(1).max(64),
  // Named numeric measurements the model produced (keys are model-specific).
  metrics: z.record(z.string(), z.number()).default({}),
  // Free-text observations the model emitted about the clip.
  observations: z.array(z.string().max(500)).max(20).default([]),
  // Optional 0-1 confidence the model attaches to its analysis.
  confidence: z.number().min(0).max(1).nullish(),
  // Optional human-readable summary from the model itself.
  notes: z.string().max(1000).nullish(),
});

export type ExternalModelOutput = z.infer<typeof ExternalModelOutputSchema>;

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
