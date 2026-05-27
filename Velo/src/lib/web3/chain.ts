import { defineChain } from "viem";

export const somniaTestnet = defineChain({
  id: 50312,
  name: "Somnia Testnet",
  nativeCurrency: { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: ["https://dream-rpc.somnia.network"] } },
  blockExplorers: {
    default: { name: "Somnia Explorer", url: "https://explorer.somnia.network" },
  },
  testnet: true,
});

export const SOMNIA_FAUCET_URL = "https://faucet.somnia.network";
