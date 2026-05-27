import { WalletButton } from "./WalletButton";
import { Link, useLocation } from "wouter";
import { useIsDeployed } from "@/hooks/useVeloContracts";
import { isWalletConnectConfigured } from "@/lib/web3/wagmi";
import { AlertCircle } from "lucide-react";

export function TopBar() {
  const isDeployed = useIsDeployed();
  const showBanner = !isDeployed || !isWalletConnectConfigured;
  const [location] = useLocation();

  const navLinks: { href: string; label: string; match: (l: string) => boolean }[] = [
    { href: "/agents", label: "Agents", match: (l) => l.startsWith("/agents") || l.startsWith("/a/") },
    { href: "/bounties", label: "Bounties", match: (l) => l.startsWith("/bounties") },
  ];

  return (
    <div className="flex flex-col">
      {showBanner && (
        <div className="bg-amber/10 text-amber px-4 py-2 text-xs font-medium flex items-center justify-center gap-2 border-b border-amber/20">
          <AlertCircle className="w-4 h-4" />
          <span>Demo mode — contracts not yet deployed on this preview. Connect a wallet to see the flow.</span>
        </div>
      )}
      <header className="px-6 py-4 flex items-center justify-between border-b border-border/50">
        <div className="flex items-center gap-8">
          <Link href="/" className="group flex items-baseline gap-1 focus:outline-none">
            <span className="font-serif-display text-2xl tracking-tight text-chalk group-hover:text-amber transition-colors">
              Velo
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-amber inline-block"></span>
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            {navLinks.map((n) => {
              const active = n.match(location);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`text-[11px] font-bold uppercase tracking-widest transition-colors ${
                    active ? "text-amber" : "text-muted-foreground hover:text-chalk"
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <WalletButton />
        </div>
      </header>
    </div>
  );
}
