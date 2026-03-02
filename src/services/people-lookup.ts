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
 * Real response format (verbose paragraph):
 *   "Morten Andre Nilsson is an Operations Specialist in the Emerging Technology
 *    department at Visma Software International AS. His work address is in Oslo,
 *    Norway, specifically at Karenslyst Allé 56. ..."
 *
 *   "Kennet Dahl Kusk ... works for Visma Software International AS. Their job
 *    title is Saas Optimization Executive in the Emerging Technology department.
 *    ... work address is in Copenhagen, Denmark."
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

  // Name: first sentence typically starts with the full name
  // "Morten Andre Nilsson is an ..." or "Kennet Dahl Kusk has the email..."
  const nameMatch = text.match(/^([A-Z][a-zA-Zéèëäöüß\s\-.]+?)(?:\s+is\s+|\s+has\s+|\s+works?\s+)/);
  if (nameMatch?.[1]) info.name = nameMatch[1].trim();

  // Organization: various patterns in order of specificity
  const orgPatterns = [
    /(?:works?\s+for|works?\s+at)\s+([A-Z][A-Za-z0-9\s&.,\-()]+?)(?:\.|,|\s+as\s+|\s+in\s+the\s+|\s+Their)/,
    /employed\s+by\s+([A-Z][A-Za-z0-9\s&.,\-()]+?)(?:\.|,)/,
    /department\s+at\s+([A-Z][A-Za-z0-9\s&.,\-()]+?)(?:\.|,)/,
    /hiring\s+legal\s+unit\s+is\s+([A-Z][A-Za-z0-9\s&.,\-()]+?)(?:\.|,)/,
    /\bis\s+(?:an?\s+)?[A-Z][A-Za-z\s&\-/]+?\s+at\s+([A-Z][A-Za-z0-9\s&.,\-()]+?)(?:\.|,)/,
  ];
  for (const pat of orgPatterns) {
    const m = text.match(pat);
    if (m?.[1]) { info.organization = m[1].trim(); break; }
  }

  // Job title: "is an <TITLE>" or "job title is <TITLE>" or "is a <TITLE>"
  const titlePatterns = [
    /job\s+title\s+is\s+([A-Za-z\s&\-/,]+?)(?:\s+(?:in|within)\s+the\s+|\.|,)/i,
    /\bis\s+(?:an?\s+)?([A-Z][A-Za-z\s&\-/]+?)\s+(?:in|within)\s+the\s+/,
    /\bis\s+(?:an?\s+)?([A-Z][A-Za-z\s&\-/]+?)\s+at\s+[A-Z]/,
  ];
  for (const pat of titlePatterns) {
    const m = text.match(pat);
    if (m?.[1]) { info.jobTitle = m[1].trim(); break; }
  }

  // Department: "in the <DEPT> department" or "within the <DEPT> department"
  const deptMatch = text.match(/(?:in|within)\s+the\s+([A-Za-z\s&\-]+?)\s+department/i);
  if (deptMatch?.[1]) info.department = deptMatch[1].trim();

  // Location + Country: "work address is in <City>, <Country>" or "work location is <details>"
  const addrPatterns = [
    /work\s+address\s+is\s+in\s+([A-Za-z\s\-]+?),\s+([A-Za-z\s\-]+?)(?:\.|,|\s+specifically)/,
    /work\s+location\s+is\s+[^,]*?,\s*([A-Za-z\s\-]+?),\s*([A-Z]{2})\./,
    /based\s+in\s+([A-Za-z\s\-]+?)(?:,\s*([A-Za-z\s\-]+?))?[.,]/,
  ];
  for (const pat of addrPatterns) {
    const m = text.match(pat);
    if (m?.[1]) {
      info.location = m[1].trim();
      if (m[2]) info.country = m[2].trim();
      break;
    }
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
