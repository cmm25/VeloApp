import { ethers } from "ethers";
import { z } from "zod";
import { config } from "../utils/config.js";
import { makeLogger } from "../utils/logger.js";
import { callAI } from "./groq.js";
import {
  runLlmInference,
  nativeAgentsConfigured,
  signerHasOperatorRole,
  SomniaAgentsUnavailable,
  type SomniaAgentReceipt,
} from "./somnia-agents.js";

const log = makeLogger("ai-dispatch");

// Warn at most once per signer about a missing OPERATOR_ROLE — every job would
// otherwise log the same actionable message and drown the runner output.
const _warnedNoOperator = new Set<string>();

/**
 * Provenance attached to every reasoning result so the product can show
 * (and the SBT can record) exactly how each verdict was produced.
 */
export interface AiProvenance {
  path: "native" | "fallback";
  agentType: "llm-inference";
  somnia?: SomniaAgentReceipt;
  // When fallback, why the native path was skipped/failed.
  fallbackReason?: string;
}

export interface ReasonResult<T> {
  data: T;
  provenance: AiProvenance;
}

const SYSTEM_PROMPT =
  "You are a tennis biomechanics expert. Always respond with valid JSON only, no markdown formatting, no code blocks.";

/**
 * Single reasoning entry point used by the Form and Prescriber agents.
 *
 * Attempts Somnia's native LLM Inference agent first (consensus-verified, with
 * an on-chain receipt) and falls back to the off-chain Groq path on timeout,
 * unavailability, insufficient runners, or schema-validation failure. The same
 * Zod schema validation is applied regardless of which path produced the JSON.
 */
export async function reason<T>(opts: {
  prompt: string;
  schema: z.ZodType<T>;
  label: string;
  signer: ethers.Wallet;
}): Promise<ReasonResult<T>> {
  const { prompt, schema, label, signer } = opts;

  if (nativeAgentsConfigured()) {
    // Preflight: the relay's request() is OPERATOR_ROLE-gated. Without the role
    // every native call reverts AccessControlUnauthorizedAccount, so skip
    // straight to Groq with one clear, actionable warning (cached per signer).
    if (!(await signerHasOperatorRole(signer))) {
      const reasonMsg =
        `signer ${signer.address} lacks OPERATOR_ROLE on the relay — using Groq. ` +
        `Grant it with Hardhat/scripts/grant-operator-role.ts to enable the native path.`;
      if (!_warnedNoOperator.has(signer.address)) {
        _warnedNoOperator.add(signer.address);
        log.warn(`Native path unavailable [${label}] — falling back to Groq`, { reason: reasonMsg });
      }
      const data = await callAI(prompt, schema, label);
      return {
        data,
        provenance: { path: "fallback", agentType: "llm-inference", fallbackReason: reasonMsg },
      };
    }
    try {
      log.info(`Reasoning via Somnia native agent [${label}]…`);
      const native = await runLlmInference(SYSTEM_PROMPT, prompt, signer);
      const data = parseAndValidate(native.output, schema, label);
      log.info(`Native consensus result accepted [${label}]`, {
        requestId: native.receipt.requestId,
      });
      return {
        data,
        provenance: {
          path: "native",
          agentType: "llm-inference",
          somnia: native.receipt,
        },
      };
    } catch (err) {
      const reasonMsg = err instanceof Error ? err.message : String(err);
      if (err instanceof SomniaAgentsUnavailable) {
        log.warn(`Somnia native agent unavailable [${label}] — falling back to Groq`, {
          reason: reasonMsg,
        });
      } else {
        log.warn(`Native agent result rejected [${label}] — falling back to Groq`, {
          reason: reasonMsg,
        });
      }
      const data = await callAI(prompt, schema, label);
      return {
        data,
        provenance: { path: "fallback", agentType: "llm-inference", fallbackReason: reasonMsg },
      };
    }
  }

  // Native path disabled or not configured.
  const reasonMsg = !config.somniaAgents.enabled
    ? "Somnia native agents disabled"
    : !config.somniaAgents.relayAddress
    ? "SOMNIA_AGENT_RELAY_ADDRESS not set (native on-chain result requires the deployed relay)"
    : "SOMNIA_LLM_AGENT_ID not configured";
  log.info(`Reasoning via Groq fallback [${label}]`, { reason: reasonMsg });
  const data = await callAI(prompt, schema, label);
  return {
    data,
    provenance: { path: "fallback", agentType: "llm-inference", fallbackReason: reasonMsg },
  };
}

function parseAndValidate<T>(raw: string, schema: z.ZodType<T>, label: string): T {
  let text = raw.trim();
  // Native LLM may wrap JSON in a code fence — strip it defensively.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Native agent [${label}] returned non-JSON: ${text.slice(0, 200)}`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Native agent [${label}] schema validation failed: ${result.error.errors
        .map((e) => e.message)
        .join(", ")}`
    );
  }
  return result.data;
}
