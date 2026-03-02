/**
 * People Lookup via Google Discovery Engine.
 *
 * Resolves email addresses to structured person info (name, org, title, etc.)
 * using a people-search app in the test-disco-cm GCP project.
 */

import type { PersonInfo } from "../types/index.ts";

const DISCOVERY_ENGINE_ENDPOINT =
  "https://eu-discoveryengine.googleapis.com/v1alpha/projects/881765721010/locations/eu/collections/default_collection/engines/peoplesearch_1772444284005/servingConfigs/default_search:answer";

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
 * Parse the free-text answerText from Discovery Engine into structured fields.
 *
 * The answer typically contains lines like:
 *   "Norbert van Haaster works at Idella BV as a Senior AI Specialist
 *    in the Technology department, based in Amsterdam, Netherlands."
 */
function parseAnswerText(text: string): PersonInfo {
  const info: PersonInfo = {
    name: null,
    organization: null,
    jobTitle: null,
    department: null,
    location: null,
    country: null,
  };

  if (!text) return info;

  // Name: usually the first proper noun phrase before "works at" or "is"
  const nameMatch = text.match(/^([A-Z][a-zA-Zéèëäöüß\s\-.]+?)(?:\s+works?\s+at|\s+is\s+)/);
  if (nameMatch?.[1]) info.name = nameMatch[1].trim();

  // Organization: "works at <ORG>" or "at <ORG>"
  const orgMatch = text.match(/(?:works?\s+at|at)\s+([A-Z][A-Za-z0-9\s&.,\-()]+?)(?:\s+as\s+|\s+in\s+the\s+|[.,]|\s+based)/);
  if (orgMatch?.[1]) info.organization = orgMatch[1].trim();

  // Job title: "as a <TITLE>" or "as <TITLE>"
  const titleMatch = text.match(/as\s+(?:a\s+|an\s+)?([A-Z][A-Za-z\s&\-/,]+?)(?:\s+in\s+the\s+|\s+at\s+|[.,]|\s+based)/);
  if (titleMatch?.[1]) info.jobTitle = titleMatch[1].trim();

  // Department: "in the <DEPT> department"
  const deptMatch = text.match(/in\s+the\s+([A-Za-z\s&\-]+?)\s+department/i);
  if (deptMatch?.[1]) info.department = deptMatch[1].trim();

  // Location: "based in <LOCATION>"
  const locMatch = text.match(/based\s+in\s+([A-Za-z\s\-]+?)(?:,\s*([A-Za-z\s\-]+?))?[.,]?\s*$/);
  if (locMatch?.[1]) {
    info.location = locMatch[1].trim();
    if (locMatch[2]) info.country = locMatch[2].trim();
  }

  // Country: standalone "Country: <X>" pattern or last comma-separated value
  if (!info.country) {
    const countryMatch = text.match(/(?:country|located\s+in)[:\s]+([A-Za-z\s\-]+)/i);
    if (countryMatch?.[1]) info.country = countryMatch[1].trim();
  }

  return info;
}

/**
 * Look up a person by email using Discovery Engine.
 * Returns structured PersonInfo or null if not found / API error.
 */
export async function lookupPerson(email: string, token?: string): Promise<PersonInfo | null> {
  const accessToken = token ?? await getAccessToken();

  const body = {
    query: { text: `who is ${email}` },
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
  const answerText: string | undefined = data?.answer?.answerText;

  if (!answerText || answerText.includes("don't have") || answerText.includes("no information")) {
    return null;
  }

  const info = parseAnswerText(answerText);

  // If we couldn't extract anything useful, treat as not found
  if (!info.name && !info.organization && !info.jobTitle) {
    return null;
  }

  return info;
}
