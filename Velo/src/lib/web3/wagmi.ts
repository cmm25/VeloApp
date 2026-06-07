import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { somniaTestnet } from "@/lib/web3/chain";

export const WALLETCONNECT_PROJECT_ID =
  (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) ?? "";

export const isWalletConnectConfigured = WALLETCONNECT_PROJECT_ID.length > 0;

const projectIdForAdapter = isWalletConnectConfigured
  ? WALLETCONNECT_PROJECT_ID
  : "00000000000000000000000000000000";

export const wagmiAdapter = new WagmiAdapter({
  networks: [somniaTestnet],
  projectId: projectIdForAdapter,
  ssr: false,
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;

let appKitInitPromise: Promise<void> | null = null;

export function initAppKit(): Promise<void> {
  if (appKitInitPromise) return appKitInitPromise;
  appKitInitPromise = (async () => {
    try {
      const { createAppKit } = await import("@reown/appkit/react");
      createAppKit({
        adapters: [wagmiAdapter],
        networks: [somniaTestnet],
        defaultNetwork: somniaTestnet,
        projectId: WALLETCONNECT_PROJECT_ID,
        metadata: {
          name: "Velo",
          description: "Velo on Somnia",
          url:
            typeof window !== "undefined"
              ? window.location.origin
              : "https://velo.app",
          icons: [],
        },
        features: {
          analytics: false,
          email: false,
          socials: false,
          swaps: false,
          onramp: false,
        },
        themeMode: "dark",
        themeVariables: {
          "--w3m-accent": "#f5b14b",
          "--w3m-color-mix": "#0a0a0a",
          "--w3m-color-mix-strength": 12,
          "--w3m-border-radius-master": "2px",
          "--w3m-font-family":
            "'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        },
      });
    } catch (err) {
      // Don't let a wallet-modal init failure become an unhandled rejection or
      // a permanently poisoned singleton; log it and allow a later retry.
      console.error("[velo] AppKit init failed:", err);
      appKitInitPromise = null;
    }
  })();
  return appKitInitPromise;
}
