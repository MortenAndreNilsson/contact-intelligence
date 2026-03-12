/**
 * LLM provider abstraction.
 * Default: LM Studio (local, PII stays on machine).
 * Swappable via LLM_PROVIDER env var for cloud deployments.
 */

export interface LLMCallOptions {
  messages: { role: string; content: string }[];
  maxTokens?: number;
  temperature?: number;
  jsonSchema?: object;
  timeout?: number;
}

export interface LLMProvider {
  name: string;
  isAvailable(): Promise<boolean>;
  complete(options: LLMCallOptions): Promise<string | null>;
}

// --- Singleton provider ---

let provider: LLMProvider | null = null;

export function getProvider(): LLMProvider {
  if (!provider) {
    throw new Error("LLM provider not initialized. Call initProvider() first.");
  }
  return provider;
}

export function setProvider(p: LLMProvider): void {
  provider = p;
}

/** Initialize provider from env. Call once at startup. */
export async function initProvider(): Promise<void> {
  const providerName = Bun.env.LLM_PROVIDER || "lm-studio";

  switch (providerName) {
    case "lm-studio":
    default: {
      const { LMStudioProvider } = await import("./providers/lm-studio.ts");
      provider = new LMStudioProvider();
      break;
    }
  }
  console.log(`LLM provider: ${provider!.name}`);
}
