import { ethers } from "ethers";
import { z } from "zod";
import { config } from "../utils/config.js";
import { makeLogger } from "../utils/logger.js";
import { callAI } from "./groq.js";
import {
  runLlmInference,
  nativeAgentsConfigured,
  SomniaAgentsUnavailable,
  type SomniaAgentReceipt,
} from "./somnia-agents.js";

const log = makeLogger("ai-dispatch");

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
  const reasonMsg = config.somniaAgents.enabled
    ? "SOMNIA_LLM_AGENT_ID not configured"
    : "Somnia native agents disabled";
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
