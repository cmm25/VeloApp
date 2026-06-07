import type { TennisTelemetry } from "./schemas.js";
import type { FormReport } from "./schemas.js";
import type { ExternalModelOutput } from "./schemas.js";

export function buildFormAnalysisPrompt(telemetry: TennisTelemetry): string {
  const phases = telemetry.strokePhases
    .map(
      (p) =>
        `  ${p.phase} (frame ${p.frameIndex}): shoulder=${p.angles.shoulder.toFixed(1)}° elbow=${p.angles.elbow.toFixed(1)}° wrist=${p.angles.wrist.toFixed(1)}° hip=${p.angles.hip.toFixed(1)}° knee=${p.angles.knee.toFixed(1)}°`
    )
    .join("\n");

  return `You are a professional tennis biomechanics analyst. Analyze the following pose telemetry data from a tennis video and produce a structured form analysis report.

TELEMETRY DATA:
- Stroke type: ${telemetry.dominantStroke}
- Duration: ${(telemetry.durationMs / 1000).toFixed(1)}s
- Frames analyzed: ${telemetry.framesAnalyzed}
- Stroke count detected: ${telemetry.strokeCount}
- Symmetry score: ${(telemetry.symmetryScore * 100).toFixed(0)}% (100% = perfect)

Peak angles (degrees):
  Shoulder: ${telemetry.peakAngles.shoulder.toFixed(1)}°
  Elbow: ${telemetry.peakAngles.elbow.toFixed(1)}°
  Wrist: ${telemetry.peakAngles.wrist.toFixed(1)}°
  Hip: ${telemetry.peakAngles.hip.toFixed(1)}°
  Knee: ${telemetry.peakAngles.knee.toFixed(1)}°

Average angles (degrees):
  Shoulder: ${telemetry.avgAngles.shoulder.toFixed(1)}°
  Elbow: ${telemetry.avgAngles.elbow.toFixed(1)}°
  Wrist: ${telemetry.avgAngles.wrist.toFixed(1)}°
  Hip: ${telemetry.avgAngles.hip.toFixed(1)}°
  Knee: ${telemetry.avgAngles.knee.toFixed(1)}°

Stroke phase breakdown:
${phases}

${telemetry.analysisNotes ? `Vision engine notes: ${telemetry.analysisNotes}` : ""}

TASK:
Return a JSON object matching this schema exactly:
{
  "strokeType": "forehand" | "backhand" | "serve" | "volley" | "unknown",
  "overallScore": <number 0-10>,
  "issues": [
    {
      "area": "shoulder" | "elbow" | "wrist" | "hip" | "knee" | "footwork" | "balance" | "timing" | "symmetry",
      "severity": "critical" | "moderate" | "minor",
      "phase": "preparation" | "contact" | "follow_through" | "overall",
      "observation": "<what is wrong, max 300 chars>",
      "recommendation": "<what to fix, max 300 chars>"
    }
  ],
  "strengths": [
    { "area": "<area>", "observation": "<what is good, max 200 chars>" }
  ],
  "keyFindings": "<2-3 sentence clinical summary of the most important findings, max 500 chars>",
  "analysedAt": "${new Date().toISOString()}"
}

Rules:
- Maximum 5 issues, ordered by severity (critical first)
- Maximum 3 strengths
- overallScore: 8-10 = excellent, 6-7 = good, 4-5 = needs work, 0-3 = significant issues
- Be specific and measurable — reference actual angle values from the data
- keyFindings must be usable by a coach reading it on their phone

Respond with ONLY the JSON object, no markdown, no explanation.`;
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ⚠  THE SINGLE SPECIALIZATION POINT for the external analysis model.
 * ════════════════════════════════════════════════════════════════════════════
 * Everything else about the second model agent is generic and already wired:
 * the HTTP client (external-model.ts), the on-chain registration, the routing,
 * the Prescriber chaining, and the UI card all work for ANY tennis-aspect model.
 *
 * The model is still in training, so this prompt and `ExternalModelOutputSchema`
 * (schemas.ts) are deliberately GENERIC PLACEHOLDERS. They translate whatever the
 * model reports (aspect + metrics + observations) into the standard FormReport.
 *
 * WHEN THE REAL MODEL IS READY, finalize the integration in exactly three places:
 *   1. `ExternalModelOutputSchema` (schemas.ts) — tighten to the real output shape.
 *   2. This function — tailor the translation to the model's actual aspect/metrics.
 *   3. The skill name + label — `EXTERNAL_MODEL_SKILL` / `EXTERNAL_MODEL_NAME`
 *      (config) and the matching entry in the frontend's SKILL_NAMES catalog
 *      (Velo/src/lib/domain/agents.ts) so the picker shows a friendly name.
 * Until then, leave this as-is: it produces a valid report from generic input.
 * ════════════════════════════════════════════════════════════════════════════
 */
export function buildExternalModelPrompt(output: ExternalModelOutput): string {
  const s = output.summary;
  const gain = output.aggregate.peakProximalToDistalGain;

  return `You are a professional tennis biomechanics analyst. A YOLO11-pose vision model has analysed a tennis clip. Translate its measurements into a coaching form analysis report.

MODEL OUTPUT:
- Dominant stroke: ${s.dominantStroke} (${s.strokeCount} strokes)
- Duration: ${(s.durationMs / 1000).toFixed(1)}s, ${s.framesAnalyzed} frames analysed
- Consistency score: ${(output.aggregate.consistencyScore * 100).toFixed(0)}%
${gain != null ? `- Kinetic chain (proximal→distal gain): ${(gain * 100).toFixed(0)}% (100% = textbook)` : ""}
- Keypoint confidence: ${(output.quality.meanKeypointConfidence * 100).toFixed(0)}%
- Clip quality ok: ${output.quality.clipQualityOk}

Peak angles (degrees):
  Shoulder: ${s.peakAngles.shoulder.toFixed(1)}° | Elbow: ${s.peakAngles.elbow.toFixed(1)}° | Wrist: ${s.peakAngles.wrist.toFixed(1)}°
  Hip: ${s.peakAngles.hip.toFixed(1)}° | Knee: ${s.peakAngles.knee.toFixed(1)}°

Average angles (degrees):
  Shoulder: ${s.avgAngles.shoulder.toFixed(1)}° | Elbow: ${s.avgAngles.elbow.toFixed(1)}° | Wrist: ${s.avgAngles.wrist.toFixed(1)}°
  Hip: ${s.avgAngles.hip.toFixed(1)}° | Knee: ${s.avgAngles.knee.toFixed(1)}°

${s.analysisNotes ? `Engine notes: ${s.analysisNotes}` : ""}

TASK: Return a JSON object matching this schema exactly:
{
  "strokeType": "forehand"|"backhand"|"serve"|"volley"|"unknown",
  "overallScore": <0-10>,
  "issues": [{ "area": "shoulder"|"elbow"|"wrist"|"hip"|"knee"|"footwork"|"balance"|"timing"|"symmetry", "severity": "critical"|"moderate"|"minor", "phase": "preparation"|"contact"|"follow_through"|"overall", "observation": "<max 300 chars>", "recommendation": "<max 300 chars>" }],
  "strengths": [{ "area": "<area>", "observation": "<max 200 chars>" }],
  "keyFindings": "<2-3 sentence summary, max 500 chars>",
  "analysedAt": "${new Date().toISOString()}"
}

Rules:
- Reference actual angle values from the data
- Maximum 5 issues (critical first), 3 strengths
- overallScore: 8-10 excellent, 6-7 good, 4-5 needs work, 0-3 significant issues
- If kinetic chain gain < 60%, flag as a timing/sequencing issue
- Respond with ONLY the JSON object, no markdown`;
}
/**
 * Builds the extraction prompt for the LLM Parse Website agent — a search for one
 * real coaching tip targeting the diagnosed stroke fault.
 */
export function buildTechniqueQueryPrompt(formReport: FormReport): string {
  const primary = formReport.issues[0];
  const focus = primary
    ? `the ${formReport.strokeType} ${primary.area} during ${primary.phase} (${primary.observation})`
    : `the ${formReport.strokeType}`;
  return `Find one concise, actionable coaching tip to improve ${focus} in tennis. Respond with a single practical sentence an athlete can apply.`;
}

export function buildPrescriptionPrompt(
  formReport: FormReport,
  athleteContext?: string
): string {
  const issuesList = formReport.issues
    .map(
      (i) =>
        `  [${i.severity.toUpperCase()}] ${i.area} (${i.phase}): ${i.observation} → ${i.recommendation}`
    )
    .join("\n");

  const strengthsList = formReport.strengths
    .map((s) => `  ${s.area}: ${s.observation}`)
    .join("\n");

  return `You are a professional tennis coach. Based on the following biomechanical form analysis, create a targeted training prescription for the next practice session.

FORM ANALYSIS REPORT:
- Stroke: ${formReport.strokeType}
- Overall score: ${formReport.overallScore}/10
- Key findings: ${formReport.keyFindings}

Issues identified:
${issuesList || "  None critical"}

Strengths:
${strengthsList || "  None noted"}

${athleteContext ? `Athlete context: ${athleteContext}` : ""}

TASK:
Return a JSON object matching this schema exactly:
{
  "sessionGoal": "<one sentence goal for the next session, max 200 chars>",
  "priorityFocus": ["<area1>", "<area2>", "<area3>"],
  "drills": [
    {
      "name": "<drill name, max 80 chars>",
      "targetArea": "<body part or skill being trained>",
      "sets": <number, optional>,
      "reps": <number, optional>,
      "durationMinutes": <number, optional>,
      "instructions": "<step-by-step drill instructions, max 400 chars>",
      "rationale": "<why this drill addresses the identified issue, max 200 chars>"
    }
  ],
  "mentalCues": ["<short cue phrase>", "<short cue phrase>"],
  "progressionNote": "<when to move to the next level, what success looks like, max 300 chars>",
  "prescribedAt": "${new Date().toISOString()}",
  "basedOnFormScore": ${formReport.overallScore}
}

Rules:
- 2-5 drills, ordered by priority (most important first)
- Drills must directly target the critical and moderate issues from the form report
- Instructions must be clear enough for an athlete to do alone
- Mental cues: short, memorable phrases (e.g. "elbow up", "step through", "load the hip")
- Do NOT repeat drills that address the same issue

Respond with ONLY the JSON object, no markdown, no explanation.`;
}