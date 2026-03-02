/**
 * People Lookup via Google Discovery Engine (search endpoint).
 *
 * Uses the structured :search endpoint (not :answer) to avoid
 * LLM-synthesized text and get direct field access. Only extracts
 * the fields we need — no phone numbers, IDs, or photos stored.
 */

import type { PersonInfo } from "../types/index.ts";

const DISCOVERY_ENGINE_ENDPOINT =
  "https://eu-discoveryengine.googleapis.com/v1alpha/projects/881765721010/locations/eu/collections/default_collection/engines/peoplesearch_1772444284005/servingConfigs/default_search:search";

async function getAccessToken(): Promise<string> {
  const proc = Bun.spawn(["gcloud.cmd", "auth", "print-access-token"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  if (!text.trim()) {
    throw new Error(`Failed to get access token: ${err}`);
  }
  return text.trim();
}

/**
 * Extract PersonInfo from a structured Discovery Engine search result.
 * Only reads the fields we need — ignores phones, IDs, photos.
 */
function extractFromResult(data: any): PersonInfo {
  const org = data.organizations?.[0];
  const addr = data.addresses?.[0];

  return {
    name: data.name?.displayName ?? null,
    organization: org?.name ?? null,
    jobTitle: org?.jobTitle ?? null,
    department: org?.department ?? null,
    location: addr?.locality ?? org?.location ?? null,
    country: addr?.country ?? null,
  };
}

/**
 * Find the correct person from search results by matching email.
 * Returns the derivedStructData of the matching result, or null.
 */
function findByEmail(results: any[], email: string): any | null {
  const lower = email.toLowerCase();

  for (const result of results) {
    const data = result.document?.derivedStructData;
    if (!data?.emails) continue;

    const match = data.emails.some(
      (e: any) => e.value?.toLowerCase() === lower
    );
    if (match) return data;
  }

  return null;
}

/**
 * Look up a person by email using Discovery Engine :search endpoint.
 * Returns structured PersonInfo or null if not found.
 */
export async function lookupPerson(email: string, token?: string): Promise<PersonInfo | null> {
  const accessToken = token ?? await getAccessToken();

  const body = {
    query: `who is ${email}`,
    pageSize: 1,
  };

  const res = await fetch(DISCOVERY_ENGINE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error(`Discovery Engine error for ${email}: ${res.status} ${res.statusText}`);
    return null;
  }

  const data: any = await res.json();

  // Search results are in oneBoxResults[0].searchResults (people-type results)
  const searchResults = data?.oneBoxResults?.[0]?.searchResults;
  if (!searchResults || searchResults.length === 0) return null;

  // Match by email to find the exact person
  const matched = findByEmail(searchResults, email);
  if (!matched) return null;

  const info = extractFromResult(matched);

  // If we couldn't extract anything useful, treat as not found
  if (!info.name && !info.organization && !info.jobTitle) {
    return null;
  }

  return info;
}
