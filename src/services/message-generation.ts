import { getProvider } from "./llm-provider.ts";
import type { Message, MessageChannel, ContentReference } from "../types/index.ts";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

const CHANNEL_RULES: Record<MessageChannel, { format: string; length: string }> = {
  email: {
    format: `Write a professional email with:
- Subject line on the first line, prefixed with "Subject: "
- Greeting (use recipient's first name if available)
- Body with clear structure
- One clear call to action
- Professional sign-off with "Morten"`,
    length: "150-300 words (excluding subject and sign-off)",
  },
  slack: {
    format: `Write a Slack message:
- No greeting or sign-off for channel posts
- For direct messages, use a brief greeting
- Use *bold* for emphasis, bullet points where helpful
- Keep it concise and scannable`,
    length: "50-150 words",
  },
  linkedin: {
    format: `Write a LinkedIn message:
- Brief, connection-oriented opener
- Reference shared context or mutual interest
- One clear ask or next step
- Warm but professional close`,
    length: "50-200 words",
  },
};

export function buildMessagePrompt(msg: Message): string {
  const channel = CHANNEL_RULES[msg.channel];
  const refs = formatReferences(msg.content_references);

  return `ROLE:
You are a message writer for a Nordic technology consultant.
Write in a ${msg.tone || "professional"} tone. No hype, no superlatives, no exclamation marks.
Depth over soundbites. Substance over bold claims.

CONTEXT:
Recipient: ${msg.recipient_name || "Unknown"}
${msg.recipient_context || "No additional context available."}
${refs ? `\nContent references:\n${refs}` : ""}
${msg.additional_context ? `\nAdditional notes:\n${msg.additional_context}` : ""}

INSTRUCTION:
Write a ${msg.channel} message.
${msg.objective ? `Objective: ${msg.objective}` : ""}
${channel.format}

CONSTRAINTS:
- Length: ${channel.length}
- No exclamation marks
- Professional Nordic tone — understated, substantive
- One clear call to action
- Write in English unless the context clearly indicates another language

OUTPUT:
Return only the message text, ready to copy-paste. No explanations or meta-commentary.`;
}

function formatReferences(refs: ContentReference[]): string {
  if (!refs || refs.length === 0) return "";
  return refs
    .map((r) => {
      const parts = [];
      if (r.url) parts.push(r.url);
      if (r.title) parts.push(`"${r.title}"`);
      if (r.snippet) parts.push(`— ${r.snippet}`);
      return `- ${parts.join(" ")}`;
    })
    .join("\n");
}

async function generateWithLMStudio(prompt: string): Promise<string | null> {
  const provider = getProvider();
  const available = await provider.isAvailable();
  if (!available) return null;

  return provider.complete({
    messages: [{ role: "user", content: prompt }],
    maxTokens: 1000,
    temperature: 0.7,
    timeout: 30000,
  });
}

async function generateWithGemini(prompt: string): Promise<string | null> {
  const apiKey = Bun.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set in environment");
  }

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1000,
      },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Gemini API error (${res.status}):`, body);
    return null;
  }

  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
}

export async function generateMessage(
  msg: Message,
  customPrompt?: string,
): Promise<{ content: string; subjectLine?: string } | null> {
  const prompt = customPrompt || buildMessagePrompt(msg);
  const provider = msg.provider || "lmstudio";

  let raw: string | null = null;

  if (provider === "gemini") {
    raw = await generateWithGemini(prompt);
  } else {
    raw = await generateWithLMStudio(prompt);
  }

  if (!raw) return null;

  if (msg.channel === "email") {
    const subjectMatch = raw.match(/^Subject:\s*(.+)\n/i);
    if (subjectMatch) {
      return {
        content: raw.replace(/^Subject:\s*.+\n\s*/i, "").trim(),
        subjectLine: subjectMatch[1].trim(),
      };
    }
  }

  return { content: raw };
}
