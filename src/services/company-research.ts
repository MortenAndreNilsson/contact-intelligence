/**
 * Company deep research via Gemini API.
 * Generates a rich company profile from web knowledge.
 */

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

export async function researchCompany(name: string, domain?: string | null): Promise<string | null> {
  const apiKey = Bun.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set in environment");
  }

  const domainHint = domain ? ` (website: ${domain})` : "";
  const prompt = `You are a business analyst. Provide a factual summary of the company "${name}"${domainHint}.

Include:
- What the company does (core business)
- Key products or services
- Headquarters location
- Approximate company size if known

Write 3-4 sentences. Be factual and concise. No hype, no superlatives. If you are not confident about the company, say so briefly rather than fabricating details.`;

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 300,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Gemini API error (${res.status}):`, body);
    return null;
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return text?.trim() || null;
}
