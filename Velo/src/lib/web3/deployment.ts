import type { Address } from "viem";

export type VeloDeployment = {
  network: string;
  chainId: number;
  contracts: {
    veloOrchestrator: Address;
    athleteSBT: Address;
    agentRegistry: Address;
    coachRegistry?: Address;
    reputation?: Address;
    bountyExtension?: Address;
  };
  deployedAt?: string;
  deployer?: Address;
};

declare const __VELO_DEPLOYMENT__: VeloDeployment | null;

export const deployment: VeloDeployment | null =
  typeof __VELO_DEPLOYMENT__ !== "undefined" ? __VELO_DEPLOYMENT__ : null;

export function requireDeployment(): VeloDeployment {
  if (!deployment) {
    throw new Error(
      "No deployment found. Run `pnpm --filter @workspace/contracts deploy:somnia` first.",
    );
  }
  return deployment;
}
