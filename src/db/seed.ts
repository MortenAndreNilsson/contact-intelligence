import { getDb } from "./client.ts";
import { createCompany } from "../services/companies.ts";
import { createContact } from "../services/contacts.ts";
import { createActivity } from "../services/activities.ts";

// Clear existing data
const db = getDb();
db.exec("DELETE FROM activities");
db.exec("DELETE FROM contacts");
db.exec("DELETE FROM companies");

console.log("Seeding database...");

// Companies
const acme = createCompany("Acme Corp", "acme.com", "Technology", "51-200", "Norway");
const visma = createCompany("Visma Enterprise", "visma.com", "Software", "200+", "Norway");
const techcorp = createCompany("TechCorp NL", "techcorp.nl", "Consulting", "11-50", "Netherlands");
const nordic = createCompany("Nordic Digital", "nordicdigital.se", "Digital Services", "11-50", "Sweden");

// Contacts — Acme
const anna = createContact("anna.larsen@acme.com", "Anna Larsen", acme.id, "CTO", "survey");
const bob = createContact("bob.nilsen@acme.com", "Bob Nilsen", acme.id, "Developer", "survey");
const clara = createContact("clara.vik@acme.com", "Clara Vik", acme.id, "HR Manager", "survey");

// Contacts — Visma
const erik = createContact("erik.berg@visma.com", "Erik Berg", visma.id, "VP Engineering", "survey");
const frida = createContact("frida.holm@visma.com", "Frida Holm", visma.id, "Product Manager", "survey");
const gunnar = createContact("gunnar.strand@visma.com", "Gunnar Strand", visma.id, "Data Scientist", "manual");
const hanna = createContact("hanna.lund@visma.com", "Hanna Lund", visma.id, "AI Lead", "survey");
const ingrid = createContact("ingrid.dahl@visma.com", "Ingrid Dahl", visma.id, "Developer", "survey");

// Contacts — TechCorp
const jan = createContact("jan.de.vries@techcorp.nl", "Jan de Vries", techcorp.id, "Managing Director", "survey");
const karin = createContact("karin.bakker@techcorp.nl", "Karin Bakker", techcorp.id, "AI Consultant", "survey");
const lars = createContact("lars.jansen@techcorp.nl", "Lars Jansen", techcorp.id, "Senior Developer", "survey");

// Contacts — Nordic Digital
const magnus = createContact("magnus.svensson@nordicdigital.se", "Magnus Svensson", nordic.id, "CEO", "manual");

// Activities — Surveys with scores
function surveyDetail(avgScore: number, dimensions: Record<string, number>) {
  return JSON.stringify({ avgScore, dimensions });
}

const now = new Date();
function daysAgo(n: number) {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

createActivity(anna.id, acme.id, "survey_completed", "survey_studio", "survey-acme-anna-1",
  "AI Maturity Survey completed", surveyDetail(3.8, { "Data Strategy": 4.2, "Daily AI Use": 3.9, "Impact Tracking": 3.5, "AI Governance": 3.6 }), daysAgo(2));

createActivity(bob.id, acme.id, "survey_completed", "survey_studio", "survey-acme-bob-1",
  "AI Maturity Survey completed", surveyDetail(2.6, { "Data Strategy": 3.0, "Daily AI Use": 2.8, "Impact Tracking": 2.2, "AI Governance": 2.4 }), daysAgo(5));

createActivity(clara.id, acme.id, "survey_completed", "survey_studio", "survey-acme-clara-1",
  "AI Maturity Survey completed", surveyDetail(3.1, { "Data Strategy": 3.5, "Daily AI Use": 2.8, "Impact Tracking": 3.2, "AI Governance": 2.9 }), daysAgo(7));

createActivity(erik.id, visma.id, "survey_completed", "survey_studio", "survey-visma-erik-1",
  "AI Maturity Survey completed", surveyDetail(3.4, { "Data Strategy": 4.0, "Daily AI Use": 3.5, "Impact Tracking": 3.0, "AI Governance": 3.1 }), daysAgo(3));

createActivity(frida.id, visma.id, "survey_completed", "survey_studio", "survey-visma-frida-1",
  "AI Maturity Survey completed", surveyDetail(2.9, { "Data Strategy": 3.2, "Daily AI Use": 2.7, "Impact Tracking": 2.8, "AI Governance": 2.9 }), daysAgo(4));

createActivity(hanna.id, visma.id, "survey_completed", "survey_studio", "survey-visma-hanna-1",
  "AI Maturity Survey completed", surveyDetail(4.1, { "Data Strategy": 4.5, "Daily AI Use": 4.2, "Impact Tracking": 3.8, "AI Governance": 3.9 }), daysAgo(6));

createActivity(ingrid.id, visma.id, "survey_completed", "survey_studio", "survey-visma-ingrid-1",
  "AI Maturity Survey completed", surveyDetail(2.5, { "Data Strategy": 2.8, "Daily AI Use": 2.3, "Impact Tracking": 2.5, "AI Governance": 2.4 }), daysAgo(8));

createActivity(jan.id, techcorp.id, "survey_completed", "survey_studio", "survey-tc-jan-1",
  "AI Maturity Survey completed", surveyDetail(3.5, { "Data Strategy": 3.8, "Daily AI Use": 3.6, "Impact Tracking": 3.2, "AI Governance": 3.4 }), daysAgo(1));

createActivity(karin.id, techcorp.id, "survey_completed", "survey_studio", "survey-tc-karin-1",
  "AI Maturity Survey completed", surveyDetail(4.0, { "Data Strategy": 4.2, "Daily AI Use": 4.1, "Impact Tracking": 3.8, "AI Governance": 3.9 }), daysAgo(3));

createActivity(lars.id, techcorp.id, "survey_completed", "survey_studio", "survey-tc-lars-1",
  "AI Maturity Survey completed", surveyDetail(3.1, { "Data Strategy": 3.0, "Daily AI Use": 3.4, "Impact Tracking": 2.9, "AI Governance": 3.1 }), daysAgo(5));

// Some note activities
createActivity(null, acme.id, "note_added", "manual", null,
  "Met with leadership team to discuss AI roadmap", null, daysAgo(1));

createActivity(gunnar.id, visma.id, "note_added", "manual", null,
  "Interested in AI Fluency Workshop for team of 15", null, daysAgo(2));

createActivity(magnus.id, nordic.id, "note_added", "manual", null,
  "Initial call — exploring AI maturity assessment for Q2", null, daysAgo(3));

// Article view activities
createActivity(anna.id, acme.id, "article_view", "cms", "cms-article-ai-governance",
  "Viewed: AI Governance Framework for Mid-Size Companies", null, daysAgo(1));

createActivity(erik.id, visma.id, "article_view", "cms", "cms-article-data-strategy",
  "Viewed: Building a Data Strategy That Actually Works", null, daysAgo(2));

console.log("Seed complete:");
console.log("  4 companies");
console.log("  12 contacts");
console.log("  15 activities");
