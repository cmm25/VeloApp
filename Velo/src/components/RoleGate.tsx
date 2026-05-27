import { useAccount } from "wagmi";
import { Redirect, useLocation } from "wouter";
import { useMyOnChainRole } from "@/lib/domain/onchainRole";
import type { Role } from "@/lib/domain/roles";
import type { ReactNode } from "react";

export function RequireWallet({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();
  if (!isConnected || !address) return <Redirect to="/" />;
  return <>{children}</>;
}

function FullPageSpinner({ label }: { label: string }) {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background">
      <div className="text-center space-y-3">
        <div className="w-8 h-8 border-2 border-amber/30 border-t-amber rounded-full animate-spin mx-auto" />
        <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
      </div>
    </div>
  );
}

export function RequireRole({
  role,
  children,
}: {
  role: Role;
  children: ReactNode;
}) {
  const { address, isConnected } = useAccount();
  const [, setLocation] = useLocation();
  const { role: current, isLoading, error } = useMyOnChainRole();
  if (!isConnected || !address) {
    setLocation("/");
    return null;
  }
  if (isLoading) return <FullPageSpinner label="Reading on-chain role…" />;
  if (error) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background p-6">
        <div className="max-w-md text-center space-y-3">
          <h2 className="font-serif-display text-2xl text-chalk">
            Could not verify role
          </h2>
          <p className="text-sm text-chalk/70">
            The RPC call to the role contracts failed. Check the Somnia RPC is
            reachable and the deployment file is present.
          </p>
          <pre className="text-[10px] text-destructive/80 font-mono whitespace-pre-wrap">
            {error.message}
          </pre>
        </div>
      </div>
    );
  }
  if (!current) return <Redirect to="/choose-role" />;
  if (current !== role) {
    return <Redirect to={current === "coach" ? "/coach" : "/athlete"} />;
  }
  return <>{children}</>;
}
