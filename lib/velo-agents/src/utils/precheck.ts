/**
 * Pre-flight checklist — run before deploying to catch missing config.
 * Usage: npm run precheck
 */
import "dotenv/config";
import { config } from "./config.js";
import { ethers } from "ethers";

const OK = "✓";
const FAIL = "✗";
const WARN = "⚠";

type CheckResult = { label: string; ok: boolean; warn?: boolean; detail?: string };
const results: CheckResult[] = [];

function check(label: string, ok: boolean, detail?: string): void {
  results.push({ label, ok, detail });
}
function warn(label: string, detail?: string): void {
  results.push({ label, ok: true, warn: true, detail });
}

// ── Config checks ─────────────────────────────────────────────────────────────
check("ORCHESTRATOR_ADDRESS set", !!config.contracts.orchestrator, config.contracts.orchestrator || "MISSING");
check("AGENT_FORM_PRIVATE_KEY set", !!config.agents.formPrivateKey);
check("AGENT_PRESCRIBER_PRIVATE_KEY set", !!config.agents.prescriberPrivateKey);
check("GROQ_API_KEY set", !!config.ai.groqApiKey || !!config.ai.openaiApiKey);

if (!config.ipfs.pinataJwt) {
  warn("PINATA_JWT not set — will use local CID (demo mode)");
} else {
  check("PINATA_JWT set", true);
}

if (!config.somnia.wsUrl) {
  warn("SOMNIA_WS_URL not set — will use HTTP polling fallback");
} else {
  check("SOMNIA_WS_URL set", true, config.somnia.wsUrl);
}

// ── Chain connectivity ────────────────────────────────────────────────────────
async function checkChain() {
  try {
    const provider = new ethers.JsonRpcProvider(config.somnia.rpcUrl, {
      chainId: config.somnia.chainId,
      name: "somniaTestnet",
    });
    const block = await provider.getBlockNumber();
    check("Somnia RPC reachable", true, `block ${block}`);

    const orch = new ethers.Contract(
      config.contracts.orchestrator,
      ["function minJobFee() view returns (uint256)"],
      provider
    );
    const minFee = await orch.minJobFee();
    check("VeloOrchestrator reachable", true, `minFee=${ethers.formatEther(minFee)} STT`);
  } catch (err) {
    check("Somnia RPC reachable", false, err instanceof Error ? err.message : String(err));
  }
}

// ── Agent wallet balances ─────────────────────────────────────────────────────
async function checkBalances() {
  const provider = new ethers.JsonRpcProvider(config.somnia.rpcUrl, {
    chainId: config.somnia.chainId,
    name: "somniaTestnet",
  });

  for (const [name, key] of [
    ["Form Agent", config.agents.formPrivateKey],
    ["Prescriber", config.agents.prescriberPrivateKey],
  ] as const) {
    if (!key) continue;
    try {
      const wallet = new ethers.Wallet(key, provider);
      const balance = await provider.getBalance(wallet.address);
      const eth = parseFloat(ethers.formatEther(balance));
      const ok = eth > 0.01;
      check(
        `${name} balance (${wallet.address.slice(0, 8)}…)`,
        ok,
        `${eth.toFixed(4)} STT — ${ok ? "ok" : "LOW — fund at https://testnet.somnia.network/"}`
      );
    } catch (err) {
      check(`${name} balance`, false, err instanceof Error ? err.message : String(err));
    }
  }
}

// ── Vision engine ─────────────────────────────────────────────────────────────
async function checkVisionEngine() {
  if (config.vision.mode === "mock") {
    warn("Vision engine in mock mode — MediaPipe not used");
    return;
  }
  try {
    const res = await fetch(`${config.vision.engineUrl}/healthz`, {
      signal: AbortSignal.timeout(5000),
    });
    check("Vision engine reachable", res.ok, config.vision.engineUrl);
  } catch {
    warn(`Vision engine not reachable at ${config.vision.engineUrl} — will use mock telemetry`);
  }
}

async function run() {
  await Promise.all([checkChain(), checkBalances(), checkVisionEngine()]);

  console.log("\nVelo Agent Runner — Pre-flight Check\n");
  let allOk = true;
  for (const r of results) {
    const icon = r.warn ? WARN : r.ok ? OK : FAIL;
    const line = r.detail ? `${icon}  ${r.label}: ${r.detail}` : `${icon}  ${r.label}`;
    console.log(line);
    if (!r.ok && !r.warn) allOk = false;
  }
  console.log("");

  if (allOk) {
    console.log("All checks passed — ready to start.\n");
    process.exit(0);
  } else {
    console.log("Some checks failed. Fix the issues above before starting.\n");
    process.exit(1);
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
