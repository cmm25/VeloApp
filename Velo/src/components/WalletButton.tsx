import { useEffect, useRef, useState } from "react";
import { useAppKit, useAppKitNetwork } from "@reown/appkit/react";
import { useAccount, useSwitchChain, useDisconnect } from "wagmi";
import { useLocation } from "wouter";
import { useMyOnChainRole } from "@/lib/domain/onchainRole";
import { ROLE_LABELS } from "@/lib/domain/roles";
import { shortAddr } from "@/lib/format";
import { somniaTestnet } from "@/lib/web3/chain";
import {
  ChevronDown,
  Wallet,
  LogOut,
  RefreshCw,
  Droplet,
  ExternalLink,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SOMNIA_FAUCET_URL } from "@/lib/web3/chain";

export function WalletButton() {
  const { open } = useAppKit();
  const { address, isConnected } = useAccount();
  const { chainId } = useAppKitNetwork();
  const { switchChain } = useSwitchChain();
  const { disconnect } = useDisconnect();
  const { role } = useMyOnChainRole();
  const [, setLocation] = useLocation();
  const [openMenu, setOpenMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenMenu(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (!isConnected || !address) {
    return (
      <Button
        onClick={() => open()}
        className="bg-amber hover:bg-amber-soft text-ink font-semibold rounded-sm tracking-wide"
      >
        <Wallet className="w-4 h-4 mr-2" />
        Connect wallet
      </Button>
    );
  }

  if (Number(chainId) !== somniaTestnet.id) {
    return (
      <Button
        variant="outline"
        className="border-destructive text-destructive hover:bg-destructive/10 rounded-sm font-semibold"
        onClick={() => switchChain({ chainId: somniaTestnet.id })}
      >
        Switch network
      </Button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpenMenu((v) => !v)}
        className="flex items-center gap-2 pl-2 pr-2.5 py-1.5 bg-card hover:bg-border/60 transition-colors rounded-sm cursor-pointer border border-border/60"
        title="Wallet menu"
      >
        {role && (
          <span className="text-[10px] uppercase tracking-widest font-bold text-amber bg-amber/10 px-1.5 py-0.5 rounded-sm">
            {ROLE_LABELS[role]}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm border border-amber/30 bg-amber/5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber inline-block" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-amber/90">
            On chain
          </span>
        </span>
        <span className="text-sm font-mono text-chalk/90">{shortAddr(address)}</span>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
      </button>

      {openMenu && (
        <div className="absolute right-0 mt-2 w-60 bg-card border border-border rounded-sm shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-border/60">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
              Wallet
            </div>
            <div className="font-mono text-xs text-chalk/80 break-all">{address}</div>
          </div>

          <div className="px-3 py-2 border-b border-border/60">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-1">
              Role
            </div>
            <div className="text-xs text-chalk/90">
              {role ? (
                <>
                  Registered as <span className="text-amber font-bold">{ROLE_LABELS[role]}</span>
                </>
              ) : (
                <span className="text-muted-foreground">Not registered</span>
              )}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground leading-snug">
              Role is on-chain. To switch, delete account and re-register.
            </p>
          </div>

          <div className="px-3 py-2 border-b border-border/60">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-1">
              Network
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs text-chalk/90">
                <span className="w-1.5 h-1.5 rounded-full bg-amber inline-block" />
                Connected
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                id {somniaTestnet.id}
              </span>
            </div>
          </div>

          <a
            href={SOMNIA_FAUCET_URL}
            target="_blank"
            rel="noreferrer"
            className="w-full text-left px-3 py-2 text-sm text-chalk/80 hover:bg-border flex items-center gap-2"
            onClick={() => setOpenMenu(false)}
          >
            <Droplet className="w-3.5 h-3.5 text-amber" />
            Get STT from faucet
            <ExternalLink className="w-3 h-3 ml-auto text-muted-foreground" />
          </a>
          <button
            onClick={() => {
              open();
              setOpenMenu(false);
            }}
            className="w-full text-left px-3 py-2 text-sm text-chalk/80 hover:bg-border flex items-center gap-2 border-t border-border/60"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Manage wallet
          </button>
          {role && (
            <button
              onClick={() => {
                setOpenMenu(false);
                setLocation("/account/delete");
              }}
              className="w-full text-left px-3 py-2 text-sm text-destructive hover:bg-destructive/10 flex items-center gap-2 border-t border-border/60"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete account & switch role
            </button>
          )}
          <button
            onClick={() => {
              disconnect();
              setOpenMenu(false);
              setLocation("/");
            }}
            className="w-full text-left px-3 py-2 text-sm text-destructive hover:bg-destructive/10 flex items-center gap-2 border-t border-border/60"
          >
            <LogOut className="w-3.5 h-3.5" />
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
