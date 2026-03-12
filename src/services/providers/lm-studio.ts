/**
 * LM Studio provider — local LLM via OpenAI-compatible API.
 * Privacy boundary: all PII processed locally, never hits external APIs.
 */

import type { LLMProvider, LLMCallOptions } from "../llm-provider.ts";

const baseUrl = Bun.env.LMSTUDIO_BASE_URL || "http://localhost:1234";
const defaultModel = Bun.env.LMSTUDIO_MODEL || "gemma-3-4b-it";

export class LMStudioProvider implements LLMProvider {
  name = "lm-studio";

  private availableCache: { value: boolean; expires: number } | null = null;

  async isAvailable(): Promise<boolean> {
    if (this.availableCache && Date.now() < this.availableCache.expires) {
      return this.availableCache.value;
    }
    try {
      const res = await fetch(`${baseUrl}/v1/models`, {
        signal: AbortSignal.timeout(1000),
      });
      const ok = res.ok;
      this.availableCache = { value: ok, expires: Date.now() + 30_000 };
      return ok;
    } catch {
      this.availableCache = { value: false, expires: Date.now() + 30_000 };
      return false;
    }
  }

  async complete(options: LLMCallOptions): Promise<string | null> {
    const {
      messages,
      maxTokens = 200,
      temperature = 0.1,
      jsonSchema,
      timeout = 10000,
    } = options;

    try {
      const body: Record<string, unknown> = {
        model: defaultModel,
        messages,
        temperature,
        max_tokens: maxTokens,
      };

      if (jsonSchema) {
        body.response_format = {
          type: "json_schema",
          json_schema: {
            name: "structured_output",
            strict: true,
            schema: jsonSchema,
          },
        };
      }

      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });

      if (!res.ok) {
        console.warn(`LM Studio error (${res.status})`);
        return null;
      }

      const data: any = await res.json();
      return data?.choices?.[0]?.message?.content?.trim() ?? null;
    } catch (err) {
      console.warn("LM Studio call failed:", (err as Error).message);
      return null;
    }
  }
}
