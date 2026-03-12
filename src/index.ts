import app from "./web/app.tsx";
import { initProvider } from "./services/llm-provider.ts";

// Initialize LLM provider (default: LM Studio)
await initProvider();

export default {
  port: 3002,
  fetch: app.fetch,
};
