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

/** Heuristic adapter — tolerant of the form agent's evolving zod schema. */
export function toStrokeReport(raw: unknown, fallbackSummary = ""): StrokeReport {
  const r = asObj(raw);
  const stroke = asStr(r.stroke ?? r.shot ?? r.shotType, "Forehand");
  const sessionGoal = asStr(
    r.session_goal ?? r.sessionGoal ?? r.goal,
    "Improve consistency under pressure.",
  );

  const strengths = asArr<unknown>(r.strengths ?? r.positives).map((s) =>
    asStr(s),
  ).filter(Boolean);

  const faults = asArr<unknown>(r.faults ?? r.issues ?? r.weaknesses).map(
    (f) => {
      const o = asObj(f);
      return {
        area: asStr(o.area ?? o.phase ?? o.label, "Technique"),
        detail: asStr(o.detail ?? o.description ?? o.note ?? f, ""),
      };
    },
  );

  const metricsRaw = asObj(r.metrics ?? r.measurements);
  const metrics = Object.entries(metricsRaw)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => ({
      label: prettify(k),
      value: typeof v === "number" ? formatNumber(v) : String(v),
    }));

  return {
    stroke,
    sessionGoal,
    strengths,
    faults,
    metrics,
    rawNote: fallbackSummary || asStr(r.notes ?? r.summary),
  };
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
