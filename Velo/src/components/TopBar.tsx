import { WalletButton } from "./WalletButton";
import { Link, useLocation } from "wouter";
import { useAccount } from "wagmi";
import { useIsDeployed } from "@/hooks/useVeloContracts";
import { useMyOnChainRole } from "@/lib/domain/onchainRole";
import { isWalletConnectConfigured } from "@/lib/web3/wagmi";
import { AlertCircle } from "lucide-react";

type NavLink = { href: string; label: string; match: (l: string) => boolean };

// Warm the lazy route chunk on hover/focus so the click-to-render feels instant.
// Vite dedupes these specifiers with the `lazy()` imports in App.tsx, so this
// only triggers the network fetch early — it doesn't double-load.
const ROUTE_PREFETCH: Record<string, () => void> = {
  "/coach": () => void import("@/pages/coach/CoachHome"),
  "/athlete": () => void import("@/pages/athlete/AthleteHome"),
  "/agents": () => void import("@/pages/agents/AgentsDirectory"),
  "/bounties": () => void import("@/pages/bounties/BountiesBoard"),
};

function prefetchRoute(href: string) {
  ROUTE_PREFETCH[href]?.();
}

export function TopBar() {
  const isDeployed = useIsDeployed();
  const showBanner = !isDeployed || !isWalletConnectConfigured;
  const [location] = useLocation();

  const { isConnected } = useAccount();
  const { role } = useMyOnChainRole();

  // "Inside the app" = wallet connected AND an on-chain role resolved. Only then
  // do the in-app sections (Home / Agents / Bounties) belong in the nav.
  const isLoggedIn = isConnected && !!role;
  const homeHref = role === "coach" ? "/coach" : role === "athlete" ? "/athlete" : "/";

  const navLinks: NavLink[] = isLoggedIn
    ? [
        {
          href: homeHref,
          label: "Home",
          match: (l) => l === homeHref || l.startsWith(`${homeHref}/`),
        },
        {
          href: "/agents",
          label: "Agents",
          match: (l) => l.startsWith("/agents") || l.startsWith("/a/"),
        },
        {
          href: "/bounties",
          label: "Bounties",
          match: (l) => l.startsWith("/bounties"),
        },
      ]
    : [];

  // The brand should never strand a logged-in user on the marketing page.
  const brandHref = isLoggedIn ? homeHref : "/";

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
          <Link
            href={brandHref}
            aria-label={isLoggedIn ? "Go to your dashboard" : "Go to home"}
            className="group flex items-baseline gap-1 focus:outline-none"
          >
            <span className="font-serif-display text-2xl tracking-tight text-chalk group-hover:text-amber transition-colors">
              Velo
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-amber inline-block"></span>
          </Link>
          {navLinks.length > 0 && (
            <nav className="hidden md:flex items-center gap-6">
              {navLinks.map((n) => {
                const active = n.match(location);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    onMouseEnter={() => prefetchRoute(n.href)}
                    onFocus={() => prefetchRoute(n.href)}
                    className={`relative text-[11px] font-bold uppercase tracking-widest transition-colors ${
                      active ? "text-amber" : "text-muted-foreground hover:text-chalk"
                    }`}
                  >
                    {n.label}
                    {active && (
                      <span className="absolute -bottom-[7px] left-0 right-0 h-px bg-amber" />
                    )}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>
        <div className="flex items-center gap-4">
          <WalletButton />
        </div>
      </header>
    </div>
  );
}
