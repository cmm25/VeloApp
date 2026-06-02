import Groq from "groq-sdk";
import { z } from "zod";
import { config } from "../utils/config.js";
import { makeLogger } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";

const log = makeLogger("ai");

let _groqClient: Groq | null = null;

function getGroqClient(): Groq {
  if (!_groqClient) {
    if (!config.ai.groqApiKey) throw new Error("GROQ_API_KEY not set");
    _groqClient = new Groq({ apiKey: config.ai.groqApiKey });
  }
  return _groqClient;
}

/**
 * Call the configured AI model with a prompt, parse + validate the JSON
 * response against a Zod schema. Retries up to 3 times on parse failure.
 *
 * Currently supports: Groq (primary). OpenAI and Anthropic keys are
 * recognized via config but routed through Groq-compatible calls for now.
 * Swap the client implementation here when adding additional providers.
 */
export async function callAI<T>(
  prompt: string,
  schema: z.ZodType<T>,
  label: string
): Promise<T> {
  return withRetry(
    async () => {
      log.info(`Calling AI [${label}]…`, { model: config.ai.groqModel });
      const client = getGroqClient();

      const completion = await client.chat.completions.create({
        model: config.ai.groqModel,
        messages: [
          {
            role: "system",
            content:
              "You are a tennis biomechanics expert. Always respond with valid JSON only, no markdown formatting, no code blocks.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 2048,
        response_format: { type: "json_object" },
      });

      const raw = completion.choices[0]?.message?.content;
      if (!raw) throw new Error("AI returned empty response");

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`AI response is not valid JSON: ${raw.slice(0, 200)}`);
      }

      const result = schema.safeParse(parsed);
      if (!result.success) {
        log.warn("AI response failed schema validation", {
          errors: result.error.errors,
          raw: raw.slice(0, 500),
        });
        throw new Error(
          `AI schema validation failed: ${result.error.errors.map((e) => e.message).join(", ")}`
        );
      }

      log.info(`AI [${label}] succeeded`);
      return result.data;
    },
    {
      attempts: 3,
      delayMs: 1500,
      onError: (err, attempt) => {
        log.warn(`AI [${label}] attempt ${attempt} failed`, {
          error: err instanceof Error ? err.message : String(err),
        });
      },
    }
  );
}
