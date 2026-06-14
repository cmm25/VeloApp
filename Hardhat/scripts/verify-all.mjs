import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { AbiCoder } from "ethers";

const EXPLORER_API = "https://shannon-explorer.somnia.network/api";

// ── deployment constants ──────────────────────────────────────────────────────

const DEPLOYER = "0xCD33c9E88539B58ED1854c54B7887d60190d7F8c";
const AGENT_REGISTRY = "0x935aABC7Ed1D2a56d036831Db02aE30c28739EBB";
const ATHLETE_SBT = "0x738550ebb0E9fE77E45a123617d165e4FE52C723";
const REPUTATION = "0x0ED0ba94702CddB70eE315F2384CEaE34b37E7BB";
const MIN_BOUNTY_FEE = "1000000000000000";

const CONTRACTS = [
    { name: "AgentRegistry", address: "0x935aABC7Ed1D2a56d036831Db02aE30c28739EBB" },
    { name: "AthleteSBT", address: "0x738550ebb0E9fE77E45a123617d165e4FE52C723" },
    { name: "CoachRegistry", address: "0x0a2d089908c58085FCCa307672Bc25922df184f7" },
    { name: "VeloOrchestrator", address: "0x2A0B15157313E81035D1f58e54da2dacd6Cfdf49" },
    { name: "Reputation", address: "0x0ED0ba94702CddB70eE315F2384CEaE34b37E7BB" },
    { name: "BountyExtension", address: "0x34fFBd7a6CdB7c087CFe2321cfd5830810628080" },
    { name: "VeloAgentRelay", address: "0x7b26cb56f9260432D079045CfA61A569936d862a" },
];

// ── constructor args (ABI-encoded, no 0x prefix) ──────────────────────────────

const abi = AbiCoder.defaultAbiCoder();
const CONSTRUCTOR_ARGS = {
    Reputation: abi.encode(["address"], [DEPLOYER]).slice(2),
    BountyExtension: abi.encode(
        ["address", "address", "uint256", "address"], [
            AGENT_REGISTRY, // agentRegistry
            REPUTATION, // reputation
            MIN_BOUNTY_FEE, // minBountyFee
            ATHLETE_SBT, // athleteSbt
        ]
    ).slice(2),
};

// ── build-info loading (Hardhat v2 + v3) ─────────────────────────────────────

function getAllBuildInfos() {
    const dir = "./artifacts-hh/build-info";
    let files;
    try { files = readdirSync(dir); } catch { throw new Error("Build info missing — run: npm run compile"); }

    const inputs = files
        .filter(f => f.endsWith(".json") && !f.endsWith(".output.json"))
        .sort()
        .reverse(); // newest first

    if (!inputs.length) throw new Error("No build-info JSON found.");

    return inputs.map(f => {
        const data = JSON.parse(readFileSync(join(dir, f), "utf8"));
        return {
            file: f,
            version: "v" + data.solcLongVersion,
            sourceCode: JSON.stringify(data.input), // standard JSON input for the verifier
        };
    });
}

// ── helpers ───────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function checkAlreadyVerified(address) {
    try {
        const res = await fetch(`${EXPLORER_API}?module=contract&action=getsourcecode&address=${address}`);
        const data = await res.json();
        var src = (data && data.result && data.result[0] && data.result[0].SourceCode) ? data.result[0].SourceCode : "";
        return data.status === "1" && src !== "";
    } catch { return null; }
}

async function pollStatus(guid, label) {
    for (let i = 1; i <= 12; i++) {
        await sleep(5000);
        const res = await fetch(`${EXPLORER_API}?module=contract&action=checkverifystatus&guid=${guid}`);
        const data = await res.json();
        console.log(`    [${label}] poll ${i}/12 → ${data.result}`);
        const lower = (data.result || "").toLowerCase();
        if (!lower.includes("pending")) return data;
    }
    return null;
}

// Returns { success, reason, canRetry }
// canRetry=true  → bytecode mismatch; worth trying a different build-info
// canRetry=false → definitive error; no point retrying (e.g. not indexed yet)
async function trySubmit(address, contractName, sourceCode, compilerVersion) {
    const body = new URLSearchParams({
        apikey: "placeholder",
        module: "contract",
        action: "verifysourcecode",
        contractaddress: address,
        codeformat: "solidity-standard-json-input",
        sourceCode,
        contractname: contractName,
        compilerversion: compilerVersion,
    });

    const ctorArgs = CONSTRUCTOR_ARGS[contractName];
    if (ctorArgs) {
        body.append("constructorArguements", ctorArgs); // intentional Etherscan misspelling
        console.log(`    Constructor args: ${ctorArgs.slice(0, 40)}...`);
    }

    const res = await fetch(
        `${EXPLORER_API}?module=contract&action=verifysourcecode`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() },
    );
    const data = await res.json();
    const msg = (data.result || JSON.stringify(data)).toLowerCase();
    console.log(`    Submit: ${JSON.stringify(data).slice(0, 180)}`);

    if (msg.includes("already verified") || msg.includes("already been verified")) {
        return { success: true, reason: "Already verified", canRetry: false };
    }

    if (data.status !== "1") {
        if (msg.includes("not a smart-contract") || msg.includes("not a contract")) {
            return {
                success: false,
                reason: "Contract not indexed yet — wait a few minutes and retry",
                canRetry: false,
            };
        }
        // Any other rejection — might be bytecode mismatch from wrong build-info
        return { success: false, reason: data.result || JSON.stringify(data), canRetry: true };
    }

    // Submitted — poll for result
    console.log(`    GUID: ${data.result}`);
    const result = await pollStatus(data.result, contractName);
    if (!result) return { success: false, reason: "Timed out — check explorer manually", canRetry: false };

    const lower = (result.result || "").toLowerCase();
    if (lower.includes("already verified")) return { success: true, reason: "Already verified", canRetry: false };

    const success = lower.includes("pass") && !lower.includes("fail");
    // If bytecode didn't match, worth trying the other build-info
    const canRetry = !success && (lower.includes("fail") || lower.includes("unable"));
    return { success, reason: result.result || "", canRetry };
}

// ── per-contract verification: tries ALL build-infos ─────────────────────────

async function verifyOne(address, contractName, buildInfos) {
    console.log("  Pre-check ...");
    if (await checkAlreadyVerified(address)) {
        return { success: true, reason: "Already verified (skipped resubmission)" };
    }

    for (const { file, version, sourceCode }
        of buildInfos) {
        console.log(`  Build-info: ${file}  (${version})`);
        const outcome = await trySubmit(address, contractName, sourceCode, version);
        if (outcome.success) return outcome;

        if (!outcome.canRetry) return outcome; // definitive failure, stop here

        await sleep(3000);

        // Async verification might have landed while we were sleeping
        if (await checkAlreadyVerified(address)) {
            return { success: true, reason: "Verified (async)" };
        }
        // else: canRetry=true → loop to next build-info
    }

    return { success: false, reason: `Failed with all ${buildInfos.length} build-info file(s)` };
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
    const buildInfos = getAllBuildInfos();

    console.log(`Build-info files : ${buildInfos.length}`);
    buildInfos.forEach((b, i) => console.log(`  [${i}] ${b.file}  —  ${b.version}`));
    console.log("\nChain    : 50312 (Somnia Testnet)");
    console.log("Explorer :", EXPLORER_API);
    console.log("────────────────────────────────────────────────────────────");

    const results = [];
    for (const c of CONTRACTS) {
        console.log(`\n> ${c.name}\n  ${c.address}`);
        const outcome = await verifyOne(c.address, c.name, buildInfos);
        console.log(`  [${outcome.success ? "OK  " : "FAIL"}] ${outcome.reason}`);
        results.push({...c, ...outcome });
        await sleep(2000);
    }

    console.log("\n════════════════════════════════════════════════════════════");
    console.log("VERIFICATION SUMMARY");
    console.log("════════════════════════════════════════════════════════════");
    for (const r of results) {
        console.log(`${r.success ? "[OK]  " : "[FAIL]"} ${r.name.padEnd(20)} ${r.address}`);
        if (!r.success) console.log(`       Reason: ${r.reason}`);
    }
    const passed = results.filter(r => r.success).length;
    console.log(`\n${passed}/${results.length} contracts verified`);

    if (passed < results.length) {
        console.log("\nFor failed contracts run: node scripts/diagnose-bounty.mjs");
    }
}

main().catch(err => {
    console.error(err.message);
    process.exit(1);
});