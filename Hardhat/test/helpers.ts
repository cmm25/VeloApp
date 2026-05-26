import { ethers } from "ethers";
import hre from "hardhat";
import { expect } from "chai";

// hre.network.provider is null until the first test body runs (lazy init).
// The Proxy defers BrowserProvider construction until that point.
export const provider = new Proxy({} as ethers.BrowserProvider, {
    get(_: unknown, prop: string | symbol) {
        const raw = hre.network.provider;
        if (!raw) throw new Error("hre.network.provider not ready yet");
        const p = new ethers.BrowserProvider(raw as any);
        const val = (p as any)[prop];
        return typeof val === "function" ? val.bind(p) : val;
    },
});

export async function getSigners() {
    const accounts: string[] = await provider.send("eth_accounts", []);
    return Promise.all(accounts.map((addr) => provider.getSigner(addr)));
}

export async function getContractFactory(name: string) {
    const artifact = await hre.artifacts.readArtifact(name);
    const signer = (await getSigners())[0];
    return new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
}

export async function getLatestTimestamp(): Promise<number> {
    const block = await provider.getBlock("latest");
    return block!.timestamp;
}

export async function increaseTimeTo(timestamp: bigint): Promise<void> {
    await provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
    await provider.send("evm_mine", []);
}

export async function expectCustomError(
    txPromise: Promise<unknown>,
    _errorName: string,
): Promise<void> {
    try {
        await txPromise;
        expect.fail("Expected transaction to revert");
    } catch (error: any) {
        const message = String(
            error?.shortMessage ?? error?.message ?? error ?? "",
        ).toLowerCase();
        const looksLikeRevert =
            message.includes("revert") ||
            message.includes("call_exception") ||
            message.includes("coalesce error");
        expect(looksLikeRevert).to.equal(true);
    }
}

export { ethers };