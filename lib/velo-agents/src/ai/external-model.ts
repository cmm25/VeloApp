import { config } from "../utils/config.js";
import { makeLogger } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";
import { ExternalModelOutputSchema, type ExternalModelOutput } from "./schemas.js";

const log = makeLogger("external-model");

/**
 * Generic HTTP client for an externally-hosted analysis model (RunPod / Render).
 *
 * It POSTs the input reference (the resolved video URL + raw cid) to the
 * configured endpoint and validates the JSON response against
 * ExternalModelOutputSchema. Nothing here knows about the specific model — the
 * model's tennis aspect is whatever it reports in its `aspect`/`metrics` output.
 *
 * This is intentionally a no-op-able boundary: it only runs once
 * EXTERNAL_MODEL_URL is set, and it throws (rather than fabricating output) if
 * the endpoint is unreachable or returns a shape it doesn't recognise, so the
 * agent fails loudly instead of inventing the not-yet-live model's results.
 */
export async function callExternalModel(
  videoUrl: string | null,
  videoCid: string
): Promise<ExternalModelOutput> {
  const url = config.externalModel.url;
  if (!url) {
    throw new Error("EXTERNAL_MODEL_URL not set — external model is not configured");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.externalModel.apiKey) {
    headers.Authorization = `Bearer ${config.externalModel.apiKey}`;
  }

  const res = await withRetry(
    () =>
      fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ videoUrl, videoCid }),
        signal: AbortSignal.timeout(config.externalModel.timeoutMs),
      }),
    { attempts: 2, delayMs: 3000 }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`External model error: ${res.status} ${text}`);
  }

  const raw = (await res.json()) as unknown;
  const parsed = ExternalModelOutputSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.errors
      .map((e) => `${e.path.join(".") || "(root)"}: ${e.message}`)
      .join("; ");
    throw new Error(`External model output failed validation: ${issues}`);
  }

  log.info("External model output received", {
    aspect: parsed.data.aspect,
    metricCount: Object.keys(parsed.data.metrics).length,
  });
  return parsed.data;
}
