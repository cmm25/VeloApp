import { Link } from "wouter";
import { Compass } from "lucide-react";
import { TopBar } from "@/components/TopBar";

export default function NotFound() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <TopBar />
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-6">
          <div className="w-14 h-14 bg-card border border-border/50 rounded-full flex items-center justify-center mx-auto">
            <Compass className="w-5 h-5 text-amber" />
          </div>
          <div className="space-y-3">
            <div className="font-mono text-[11px] uppercase tracking-widest text-amber">
              404
            </div>
            <h1 className="font-serif-display text-4xl md:text-5xl text-chalk tracking-tight">
              Page not found
            </h1>
            <p className="text-sm text-chalk/70 font-light leading-relaxed">
              This route doesn't exist on Velo. The link may be stale, or the
              page moved.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-chalk/80 hover:text-amber transition-colors"
          >
            Back home <span className="opacity-60">→</span>
          </Link>
        </div>
      </main>
    </div>
  );
}
