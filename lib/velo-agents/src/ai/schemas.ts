import { z } from "zod";

// ── MediaPipe telemetry (from velo-engine) ────────────────────────────────────

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
  wristVelocityPx: z.number().optional(),
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

// ── Form Analysis Report (output of FormAgent AI) ────────────────────────────

export const FormIssueSchema = z.object({
  area: z.enum(["shoulder", "elbow", "wrist", "hip", "knee", "footwork", "balance", "timing"]),
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

// ── Prescription Report (output of PrescriberAgent AI) ──────────────────────

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

// ── On-chain payload (what gets stored in Supabase + returned by API) ─────────

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
  }).nullable(),
});

export type StoredReceipt = z.infer<typeof StoredReceiptSchema>;
