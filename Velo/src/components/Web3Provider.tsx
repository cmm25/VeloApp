import { useEffect, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig, initAppKit } from "@/lib/web3/wagmi";

export function Web3Provider({ children }: { children: ReactNode }) {
  useEffect(() => {
    initAppKit();
  }, []);
  return <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>;
}
