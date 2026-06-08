import { Activity, Cpu, Eye, Layers, Zap } from "lucide-react";
import { useIpfsJson } from "@/lib/web3/ipfs";

interface JointAngles {
  shoulder: number;
  elbow: number;
  wrist: number;
  hip: number;
  knee: number;
}

interface StrokePhase {
  phase: "preparation" | "contact" | "follow_through";
  frameIndex: number;
  timestampMs: number;
  angles: JointAngles;
  wristVelocityPx?: number | null;
}

interface TennisTelemetry {
  videoUrl?: string;
  durationMs: number;
  framesAnalyzed: number;
  fps: number;
  strokePhases: StrokePhase[];
  peakAngles: JointAngles;
  avgAngles: JointAngles;
  symmetryScore: number;
  dominantStroke: string;
  strokeCount: number;
  analysisNotes?: string;
  isMock?: boolean;
}

interface VeloFormReport {
  type?: string;
  telemetry?: TennisTelemetry;
}

const JOINTS: { key: keyof JointAngles; label: string }[] = [
  { key: "shoulder", label: "Shoulder" },
  { key: "elbow", label: "Elbow" },
  { key: "wrist", label: "Wrist" },
  { key: "hip", label: "Hip" },
  { key: "knee", label: "Knee" },
];

const PHASE_LABELS: Record<string, string> = {
  preparation: "Preparation",
  contact: "Contact",
  follow_through: "Follow-through",
};

const PHASE_COLORS: Record<string, string> = {
  preparation: "bg-amber/40",
  contact: "bg-amber",
  follow_through: "bg-amber/60",
};

function SymmetryGauge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    score >= 0.7 ? "text-amber" : score >= 0.45 ? "text-amber/70" : "text-muted-foreground";

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className={`font-mono text-2xl font-bold tabular-nums ${color}`}>{pct}%</div>
      <div className="w-full h-2 bg-border/60 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-amber transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold">
        Symmetry
      </div>
    </div>
  );
}

function AngleBar({
  label,
  peak,
  avg,
}: {
  label: string;
  peak: number;
  avg: number;
}) {
  const maxDeg = 220;
  const peakPct = Math.min((peak / maxDeg) * 100, 100);
  const avgPct = Math.min((avg / maxDeg) * 100, 100);

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
          {label}
        </span>
        <span className="font-mono text-[11px] text-chalk/80">
          {peak.toFixed(0)}°{" "}
          <span className="text-muted-foreground text-[10px]">avg {avg.toFixed(0)}°</span>
        </span>
      </div>
      <div className="relative h-2 bg-border/40 rounded-full overflow-hidden">
        <div
          className="absolute h-full bg-amber/25 rounded-full"
          style={{ width: `${avgPct}%` }}
        />
        <div
          className="absolute h-full bg-amber rounded-full"
          style={{ width: `${peakPct}%` }}
        />
      </div>
    </div>
  );
}

function PhaseTimeline({ phases }: { phases: StrokePhase[] }) {
  if (phases.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
        Stroke Phases
      </div>
      <div className="flex items-start gap-0">
        {phases.map((p, i) => (
          <div key={p.phase} className="flex-1 relative">
            <div className="flex flex-col items-center">
              <div
                className={`w-3 h-3 rounded-full ${PHASE_COLORS[p.phase] ?? "bg-border"} z-10 relative`}
              />
              {i < phases.length - 1 && (
                <div className="absolute top-1.5 left-1/2 w-full h-0.5 bg-border/60" />
              )}
            </div>
            <div className="mt-2 text-center">
              <div className="text-[9px] font-bold uppercase tracking-widest text-chalk/70">
                {PHASE_LABELS[p.phase] ?? p.phase}
              </div>
              <div className="font-mono text-[10px] text-muted-foreground mt-0.5">
                +{(p.timestampMs / 1000).toFixed(2)}s
              </div>
              <div className="font-mono text-[10px] text-muted-foreground">f{p.frameIndex}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-background border border-border/50 rounded-sm px-3 py-2 text-center">
      <div className="font-mono text-sm font-bold text-chalk tabular-nums">{value}</div>
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold mt-0.5">
        {label}
      </div>
    </div>
  );
}

export function TelemetryPreview({ ipfsCid }: { ipfsCid: string }) {
  const { data, isLoading, isError } = useIpfsJson(ipfsCid);

  const report = data as VeloFormReport | null;
  const telemetry = report?.telemetry;

  if (isLoading) {
    return (
      <div className="p-5 bg-card/20 border border-dashed border-border/40 rounded-sm">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <div className="w-3 h-3 rounded-full bg-border animate-pulse" />
          Loading vision analysis…
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-5 bg-card/20 border border-dashed border-border/40 rounded-sm flex items-center gap-2 text-sm text-muted-foreground">
        <Eye className="w-4 h-4 shrink-0" />
        Vision analysis preview unavailable — the IPFS gateway didn't respond.
      </div>
    );
  }

  if (!telemetry) return null;

  const durationSec = (telemetry.durationMs / 1000).toFixed(1);
  const strokeLabel =
    telemetry.dominantStroke.charAt(0).toUpperCase() + telemetry.dominantStroke.slice(1);

  return (
    <div className="rounded-sm border border-border/50 bg-card/20 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/40 bg-card/40">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-amber" />
          <span className="text-[10px] uppercase tracking-widest font-bold text-chalk/80">
            Vision Analysis
          </span>
          <span className="text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded-sm border border-amber/30 bg-amber/10 text-amber">
            MediaPipe
          </span>
          {telemetry.isMock && (
            <span className="text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded-sm border border-border/60 bg-card text-muted-foreground">
              Mock
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
          <Cpu className="w-3 h-3" />
          CPU · XNNPACK
        </div>
      </div>

      <div className="p-5 space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatChip label="Frames" value={telemetry.framesAnalyzed} />
          <StatChip label="FPS" value={telemetry.fps} />
          <StatChip label="Duration" value={`${durationSec}s`} />
          <StatChip label="Strokes" value={telemetry.strokeCount} />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber/10 border border-amber/30 rounded-sm">
            <Activity className="w-3.5 h-3.5 text-amber" />
            <span className="text-xs font-bold text-amber">{strokeLabel}</span>
          </div>
          <span className="text-xs text-muted-foreground">dominant stroke detected</span>
        </div>

        {telemetry.strokePhases.length > 0 && (
          <PhaseTimeline phases={telemetry.strokePhases} />
        )}

        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-3 flex items-center gap-1.5">
            <Layers className="w-3 h-3" /> Joint Angles · Peak / Avg
          </div>
          <div className="space-y-3">
            {JOINTS.map(({ key, label }) => (
              <AngleBar
                key={key}
                label={label}
                peak={telemetry.peakAngles[key]}
                avg={telemetry.avgAngles[key]}
              />
            ))}
          </div>
          <div className="flex items-center gap-4 mt-3 text-[9px] text-muted-foreground font-mono">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-1.5 rounded-full bg-amber inline-block" />
              Peak
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-1.5 rounded-full bg-amber/25 inline-block" />
              Avg
            </span>
          </div>
        </div>

        <div className="max-w-[140px]">
          <SymmetryGauge score={telemetry.symmetryScore} />
        </div>

        {telemetry.analysisNotes && !telemetry.analysisNotes.includes("Mock") && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground border-t border-border/40 pt-4">
            <Zap className="w-3.5 h-3.5 text-amber shrink-0 mt-0.5" />
            <span className="leading-relaxed">{telemetry.analysisNotes}</span>
          </div>
        )}
      </div>
    </div>
  );
}
