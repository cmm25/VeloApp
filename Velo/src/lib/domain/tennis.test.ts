import { describe, it, expect } from "vitest";
import { toStrokeReport } from "./tennis";

describe("toStrokeReport", () => {
  it("reads the current nested { telemetry, formReport } payload", () => {
    const raw = {
      type: "form_report",
      formReport: {
        strokeType: "forehand",
        overallScore: 7.5,
        strengths: [
          { area: "preparation", observation: "early unit turn" },
          "relaxed grip",
        ],
        issues: [
          {
            area: "contact",
            observation: "meeting the ball late",
            recommendation: "step in earlier",
          },
        ],
      },
      telemetry: {
        dominantStroke: "forehand",
        symmetryScore: 0.82,
        strokeCount: 42,
        framesAnalyzed: 1200,
      },
    };

    const report = toStrokeReport(raw);

    expect(report.stroke).toBe("Forehand");
    expect(report.strengths).toEqual([
      "Preparation — early unit turn",
      "relaxed grip",
    ]);
    expect(report.faults).toEqual([
      { area: "Contact", detail: "meeting the ball late Fix: step in earlier" },
    ]);
  });

  it("extracts overallScore, symmetry %, strokeCount, and framesAnalyzed metrics", () => {
    const raw = {
      formReport: { strokeType: "forehand", overallScore: 7.5 },
      telemetry: {
        symmetryScore: 0.82,
        strokeCount: 42,
        framesAnalyzed: 1200,
      },
    };

    const report = toStrokeReport(raw);

    expect(report.metrics).toEqual([
      { label: "Overall Score", value: "7.50 / 10" },
      { label: "Symmetry", value: "82%" },
      { label: "Strokes", value: "42" },
      { label: "Frames Analyzed", value: "1200" },
    ]);
  });

  it("supports snake_case telemetry / form_report keys", () => {
    const raw = {
      form_report: { stroke_type: "serve", overall_score: 9 },
      telemetry: {
        symmetry_score: 0.5,
        stroke_count: 10,
        frames_analyzed: 300,
      },
    };

    const report = toStrokeReport(raw);

    expect(report.stroke).toBe("Serve");
    expect(report.metrics).toEqual([
      { label: "Overall Score", value: "9 / 10" },
      { label: "Symmetry", value: "50%" },
      { label: "Strokes", value: "10" },
      { label: "Frames Analyzed", value: "300" },
    ]);
  });

  it("reads a legacy flat payload (stroke + flat metrics object)", () => {
    const raw = {
      stroke: "backhand",
      strengths: ["consistent depth"],
      faults: ["wrist breaks down"],
      metrics: { contact_point: "late", racket_speed: 30 },
    };

    const report = toStrokeReport(raw);

    expect(report.stroke).toBe("Backhand");
    expect(report.strengths).toEqual(["consistent depth"]);
    expect(report.faults).toEqual([
      { area: "Technique", detail: "wrist breaks down" },
    ]);
    expect(report.metrics).toEqual([
      { label: "Contact Point", value: "late" },
      { label: "Racket Speed", value: "30" },
    ]);
  });

  it('maps an explicit "unknown" stroke to "Unknown stroke"', () => {
    expect(toStrokeReport({ stroke: "unknown" }).stroke).toBe("Unknown stroke");
  });

  it('maps a missing stroke to "Unknown stroke"', () => {
    expect(toStrokeReport({}).stroke).toBe("Unknown stroke");
  });

  it("falls back to defaults and a passed fallback summary on an empty payload", () => {
    const report = toStrokeReport({}, "Off-chain summary text");

    expect(report.stroke).toBe("Unknown stroke");
    expect(report.sessionGoal).toBe("Improve consistency under pressure.");
    expect(report.strengths).toEqual([]);
    expect(report.faults).toEqual([]);
    expect(report.metrics).toEqual([]);
    expect(report.rawNote).toBe("Off-chain summary text");
  });
});
