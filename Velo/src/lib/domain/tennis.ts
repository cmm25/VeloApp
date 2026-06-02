/**
 * Tennis presentation adapter. Maps raw agent JSON → view-models the UI
 * renders in tennis vocabulary. UI never imports the raw shape.
 */

export type StrokeReport = {
  stroke: string;
  sessionGoal: string;
  strengths: string[];
  faults: { area: string; detail: string }[];
  metrics: { label: string; value: string }[];
  rawNote?: string;
};

export type PrescriptionPlan = {
  headline: string;
  warmUp: string[];
  technicalFocus: { drill: string; cue: string; reps?: string }[];
  conditioning: string[];
  sessionGoal: string;
};

type Unknown = Record<string, unknown>;
const asObj = (v: unknown): Unknown =>
  v && typeof v === "object" ? (v as Unknown) : {};
const asStr = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;
const asArr = <T = unknown>(v: unknown): T[] =>
  Array.isArray(v) ? (v as T[]) : [];
const asNum = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Heuristic adapter — tolerant of the form agent's evolving zod schema.
 *
 * The form agent pins `{ type, jobId, telemetry, formReport, provenance }` to
 * IPFS, so the real data lives under `formReport` (stroke, strengths, issues)
 * and `telemetry` (dominant stroke, symmetry, counts). We dig into those, but
 * stay tolerant of older flat payloads so nothing regresses.
 */
export function toStrokeReport(raw: unknown, fallbackSummary = ""): StrokeReport {
  const root = asObj(raw);
  const form = asObj(root.formReport ?? root.form_report);
  const telemetry = asObj(root.telemetry);
  const fr = Object.keys(form).length ? form : root;

  const strokeRaw = asStr(
    fr.strokeType ??
      fr.stroke_type ??
      telemetry.dominantStroke ??
      telemetry.dominant_stroke ??
      root.stroke ??
      root.shot ??
      root.shotType,
    "",
  );
  const stroke = strokeRaw && strokeRaw !== "unknown" ? cap(strokeRaw) : "Unknown stroke";

  const sessionGoal = asStr(
    root.session_goal ?? root.sessionGoal ?? root.goal ?? fr.sessionGoal,
    "Improve consistency under pressure.",
  );

  const strengths = asArr<unknown>(fr.strengths ?? root.strengths ?? root.positives)
    .map((s) => {
      if (typeof s === "string") return s;
      const o = asObj(s);
      const obs = asStr(o.observation ?? o.detail ?? o.note ?? o.text);
      const area = asStr(o.area ?? o.label);
      if (obs && area) return `${cap(area)} — ${obs}`;
      return obs || area;
    })
    .filter(Boolean);

  const faults = asArr<unknown>(
    fr.issues ?? root.faults ?? root.issues ?? root.weaknesses,
  ).map((f) => {
    if (typeof f === "string") return { area: "Technique", detail: f };
    const o = asObj(f);
    const area = cap(asStr(o.area ?? o.phase ?? o.label, "Technique"));
    const observation = asStr(o.observation ?? o.detail ?? o.description ?? o.note);
    const recommendation = asStr(o.recommendation ?? o.fix ?? o.advice);
    const detail = [observation, recommendation && `Fix: ${recommendation}`]
      .filter(Boolean)
      .join(" ");
    return { area, detail };
  });

  return {
    stroke,
    sessionGoal,
    strengths,
    faults,
    metrics: buildMetrics(fr, telemetry, root),
    rawNote: fallbackSummary || asStr(root.notes ?? root.summary),
  };
}

/** Surface a few real, human-meaningful metrics from the report + telemetry. */
function buildMetrics(
  form: Unknown,
  telemetry: Unknown,
  root: Unknown,
): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];

  const overall = asNum(form.overallScore ?? form.overall_score);
  if (overall !== null) out.push({ label: "Overall Score", value: `${formatNumber(overall)} / 10` });

  const symmetry = asNum(telemetry.symmetryScore ?? telemetry.symmetry_score);
  if (symmetry !== null) out.push({ label: "Symmetry", value: `${Math.round(symmetry * 100)}%` });

  const strokeCount = asNum(telemetry.strokeCount ?? telemetry.stroke_count);
  if (strokeCount !== null) out.push({ label: "Strokes", value: formatNumber(strokeCount) });

  const frames = asNum(telemetry.framesAnalyzed ?? telemetry.frames_analyzed);
  if (frames !== null) out.push({ label: "Frames Analyzed", value: formatNumber(frames) });

  if (out.length) return out;

  // Fall back to any flat metrics object on older payloads.
  const metricsRaw = asObj(root.metrics ?? root.measurements);
  return Object.entries(metricsRaw)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => ({
      label: prettify(k),
      value: typeof v === "number" ? formatNumber(v) : String(v),
    }));
}

export function toPrescriptionPlan(
  raw: unknown,
  fallbackSummary = "",
): PrescriptionPlan {
  const r = asObj(raw);
  const headline =
    asStr(r.headline ?? r.title ?? fallbackSummary, "Today's plan");
  const sessionGoal = asStr(
    r.session_goal ?? r.sessionGoal ?? r.goal,
    "Translate the form fix into rally-ready habit.",
  );

  const warmUp = asArr<unknown>(r.warm_up ?? r.warmUp ?? r.warmup).map((x) =>
    typeof x === "string" ? x : asStr(asObj(x).text ?? asObj(x).drill),
  ).filter(Boolean);

  const techRaw = asArr<unknown>(
    r.technical_focus ?? r.technicalFocus ?? r.drills ?? r.fixes,
  );
  const technicalFocus = techRaw.map((t) => {
    const o = asObj(t);
    return {
      drill: asStr(o.drill ?? o.name ?? o.title ?? t, "Drill"),
      cue: asStr(o.cue ?? o.focus ?? o.detail ?? o.description, ""),
      reps: asStr(o.reps ?? o.dose ?? o.sets) || undefined,
    };
  });

  const conditioning = asArr<unknown>(
    r.conditioning ?? r.fitness ?? r.physical,
  ).map((x) => (typeof x === "string" ? x : asStr(asObj(x).text)));

  return {
    headline,
    warmUp: warmUp.length ? warmUp : ["Five minutes shadow swings, slow tempo."],
    technicalFocus: technicalFocus.length
      ? technicalFocus
      : [
          {
            drill: "Cross-court rally",
            cue: "Stay loaded through contact; brush up the back of the ball.",
          },
        ],
    conditioning: conditioning.length
      ? conditioning
      : ["Three sets of split-step ladder, 30s on / 30s off."],
    sessionGoal,
  };
}

function prettify(k: string) {
  return k
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function formatNumber(n: number) {
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(2);
}
