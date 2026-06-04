import type { TennisTelemetry } from "./schemas.js";
import type { FormReport } from "./schemas.js";

export function buildFormAnalysisPrompt(telemetry: TennisTelemetry): string {
  const phases = telemetry.strokePhases
    .map(
      (p) =>
        `  ${p.phase} (frame ${p.frameIndex}): shoulder=${p.angles.shoulder.toFixed(1)}° elbow=${p.angles.elbow.toFixed(1)}° wrist=${p.angles.wrist.toFixed(1)}° hip=${p.angles.hip.toFixed(1)}° knee=${p.angles.knee.toFixed(1)}°`
    )
    .join("\n");

  const pct = (v?: number | null) => (v == null ? "n/a" : `${(v * 100).toFixed(0)}%`);

  const kineticSection =
    telemetry.peakProximalToDistalGain != null
      ? `
Kinematic sequence (proximal→distal energy transfer):
- Proximal→distal speed gain: ${pct(telemetry.peakProximalToDistalGain)} (PRIMARY signal — did peak speed rise hips→trunk→arm; 100% = textbook chain)
- Peak-timing order: ${
          telemetry.kinematicSequenceValid == null
            ? "NOT RESOLVABLE at this frame rate — do NOT comment on sequence timing or order"
            : telemetry.kinematicSequenceValid
              ? `valid — hips lead the arm (coherence ${pct(telemetry.sequenceCoherenceScore)})`
              : "checked but not textbook — hips did not clearly lead the arm"
        }`
      : "";

  const caveats = `
MEASUREMENT CAVEATS — you MUST obey these (the data cannot support violating them):
- "Wrist" is a FOREARM-ORIENTATION proxy, NOT anatomical wrist flexion — never diagnose wrist snap/flexion.
- The consistency score (${(telemetry.symmetryScore * 100).toFixed(0)}%) is temporal REPEATABILITY across strokes, NOT left/right symmetry.
- Velocities are scaled by "${telemetry.velocityScaleSource ?? "unknown"}" — relative within this clip only. NEVER convert to mph/kph/m·s or any real-world speed.${
    telemetry.timingGranularityMs
      ? `\n- Frame granularity ≈${telemetry.timingGranularityMs.toFixed(0)}ms; never claim timing precision finer than this.`
      : ""
  }
- Only discuss kinematic-sequence order if it is marked resolvable above; otherwise stay silent on timing.`;

  return `You are a professional tennis biomechanics analyst. Analyze the following pose telemetry data from a tennis video and produce a structured form analysis report.

TELEMETRY DATA:
- Stroke type: ${telemetry.dominantStroke}
- Duration: ${(telemetry.durationMs / 1000).toFixed(1)}s
- Frames analyzed: ${telemetry.framesAnalyzed}
- Stroke count detected: ${telemetry.strokeCount}
- Consistency (temporal repeatability across strokes, NOT symmetry): ${(telemetry.symmetryScore * 100).toFixed(0)}%

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
${kineticSection}
${telemetry.analysisNotes ? `Vision engine notes: ${telemetry.analysisNotes}` : ""}
${caveats}

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
