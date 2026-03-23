/**
 * Company deep research via Gemini API.
 * Generates a rich company profile with structured metadata from web knowledge.
 */

import { embedContent } from "./embeddings.ts";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

export interface CompanyResearchResult {
  description: string;
  industry: string | null;
  country: string | null;
  size_bucket: string | null;
  tags: string[];
}

export async function researchCompany(name: string, domain?: string | null): Promise<CompanyResearchResult | null> {
  const apiKey = Bun.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set in environment");
  }

  const domainHint = domain ? ` (website: ${domain})` : "";
  const prompt = `You are a business analyst. Research the company "${name}"${domainHint} and return a JSON object with these fields:

{
  "description": "3-4 sentence factual summary of what the company does, key products/services, and market position",
  "industry": "One of: Software, IT Services, Consulting, Financial Services, Manufacturing, Healthcare, Education, Government, Retail, Media, Energy, Telecommunications, Real Estate, Transportation, Agriculture, or Other",
  "country": "Country where headquarters is located, e.g. 'Norway', 'Denmark', 'Sweden', 'Finland', 'Netherlands', 'Germany', 'United Kingdom', etc.",
  "size_bucket": "One of: 1-10, 11-50, 51-200, 201-1000, 1001-5000, 5001-10000, 10000+",
  "tags": ["3-5 short lowercase tags describing the company's domain, products, or market, e.g. 'erp', 'payroll', 'saas', 'nordic', 'fintech', 'accounting', 'hr-tech', 'logistics'"]
}

Rules:
- Be factual and concise. No hype, no superlatives.
- If you are not confident about a field, set it to null rather than guessing.
- Tags should be specific and useful for filtering/grouping. Use lowercase, hyphenate multi-word tags.
- For Visma subsidiaries, the country should be where THAT subsidiary operates, not Visma HQ.
- Return ONLY the JSON object, no markdown fences, no explanation.`;

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 500,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Gemini API error (${res.status}):`, body);
    return null;
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    const result: CompanyResearchResult = {
      description: parsed.description || null,
      industry: parsed.industry || null,
      country: parsed.country || null,
      size_bucket: parsed.size_bucket || null,
      tags: Array.isArray(parsed.tags) ? parsed.tags.map((t: string) => String(t).toLowerCase().trim()).filter(Boolean) : [],
    };

    // Embed research description for semantic search (fire-and-forget)
    if (result.description) {
      embedContent("research", `company:${name}`, result.description, {
        company_name: name,
        domain: domain || undefined,
        industry: result.industry,
      }).catch((err) => console.warn("Failed to embed research:", err.message));
    }

    return result;
  } catch {
    // Fallback: if JSON parse fails, treat entire text as description
    console.warn("Gemini returned non-JSON response, using as description only");
    return {
      description: text,
      industry: null,
      country: null,
      size_bucket: null,
      tags: [],
    };
  }
}
