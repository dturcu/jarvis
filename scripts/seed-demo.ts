/**
 * Jarvis demo data seeder.
 *
 * Populates the CRM and Knowledge databases with sample contacts, documents,
 * and playbooks for development and demonstration purposes.
 *
 * Idempotent — checks row counts before inserting to avoid duplicates.
 * Requires databases to exist first (run `npx tsx scripts/init-jarvis.ts`).
 *
 * Usage:
 *   npx tsx scripts/seed-demo.ts
 *   npm run seed:demo
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// ─── Paths ──────────────────────────────────────────────────────────────────

const JARVIS_DIR = join(homedir(), ".jarvis");
const CRM_DB_PATH = join(JARVIS_DIR, "crm.db");
const KNOWLEDGE_DB_PATH = join(JARVIS_DIR, "knowledge.db");

function now(): string {
  return new Date().toISOString();
}

// ─── CRM Demo Data ─────────────────────────────────────────────────────────

function seedCrmData(db: DatabaseSync): void {
  const existing = db.prepare("SELECT COUNT(*) as n FROM contacts").get() as { n: number };
  if (existing.n > 0) {
    console.log(`  [skip] CRM already has ${existing.n} contacts — skipping seed`);
    return;
  }

  const ts = now();
  const contacts = [
    {
      id: randomUUID(),
      name: "François Sagnely",
      company: "Bertrandt",
      role: "AUTOSAR Architect",
      email: "f.sagnely@bertrandt.com",
      linkedin_url: "https://linkedin.com/in/francois-sagnely",
      source: "linkedin_scrape",
      score: 75,
      stage: "qualified",
      tags: JSON.stringify(["autosar", "tier1", "germany"]),
    },
    {
      id: randomUUID(),
      name: "Anna Lindström",
      company: "Volvo Cars",
      role: "Safety Lead",
      email: "anna.lindstrom@volvocars.com",
      linkedin_url: "https://linkedin.com/in/anna-lindstrom-safety",
      source: "referral",
      score: 90,
      stage: "proposal",
      tags: JSON.stringify(["iso26262", "oem", "sweden", "asil-d"]),
    },
    {
      id: randomUUID(),
      name: "Thomas Keller",
      company: "EDAG Engineering",
      role: "Project Manager",
      email: "t.keller@edag.com",
      linkedin_url: "https://linkedin.com/in/thomas-keller-edag",
      source: "web_intel",
      score: 55,
      stage: "prospect",
      tags: JSON.stringify(["aspice", "tier1", "germany"]),
    },
    {
      id: randomUUID(),
      name: "Radu Ionescu",
      company: "Continental",
      role: "SW Team Lead",
      email: "radu.ionescu@continental.com",
      linkedin_url: "https://linkedin.com/in/radu-ionescu-conti",
      source: "linkedin_scrape",
      score: 40,
      stage: "contacted",
      tags: JSON.stringify(["autosar", "tier1", "romania"]),
    },
    {
      id: randomUUID(),
      name: "Marie Chen",
      company: "Garrett Motion",
      role: "Safety Manager",
      email: "marie.chen@garrettmotion.com",
      linkedin_url: "https://linkedin.com/in/marie-chen-garrett",
      source: "direct",
      score: 65,
      stage: "meeting",
      tags: JSON.stringify(["iso26262", "cybersecurity", "france"]),
    },
  ];

  const insertContact = db.prepare(`
    INSERT INTO contacts (id, name, company, role, email, linkedin_url, source, score, stage, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const c of contacts) {
    insertContact.run(
      c.id, c.name, c.company, c.role, c.email, c.linkedin_url,
      c.source, c.score, c.stage, c.tags, ts, ts,
    );
  }

  console.log(`  [seeded] ${contacts.length} contacts into CRM`);
}

// ─── Knowledge Demo Data ───────────────────────────────────────────────────

function seedKnowledgeData(db: DatabaseSync): void {
  const existingDocs = db.prepare("SELECT COUNT(*) as n FROM documents").get() as { n: number };
  const existingPlaybooks = db.prepare("SELECT COUNT(*) as n FROM playbooks").get() as { n: number };

  if (existingDocs.n > 0 && existingPlaybooks.n > 0) {
    console.log(`  [skip] Knowledge already has ${existingDocs.n} documents and ${existingPlaybooks.n} playbooks — skipping seed`);
    return;
  }

  const ts = now();

  if (existingDocs.n === 0) {
    const docs = [
      {
        collection: "lessons",
        title: "Early signal: automotive Tier-1s post AUTOSAR safety roles 4-6 weeks before RFQ",
        content:
          "Hiring signals on LinkedIn (AUTOSAR, ISO 26262, Cyber Security roles) at Tier-1 suppliers reliably precede formal RFQs by 4-6 weeks. Monitor job boards weekly. When a supplier posts 2+ safety-critical openings simultaneously, treat as strong intent signal and move to immediate outreach.",
        tags: JSON.stringify(["bd", "signal", "autosar", "rfq", "tier1"]),
        source_agent_id: "bd-pipeline",
      },
      {
        collection: "lessons",
        title: "Proposals without explicit exclusion scope are renegotiated at delivery",
        content:
          "Every proposal that omitted explicit out-of-scope statements led to scope creep disputes. Include a dedicated EXCLUSIONS section listing at minimum: validation of third-party components, tool qualification, production software delivery, and acceptance testing unless specified. Use ISO 26262 scope boundary language.",
        tags: JSON.stringify(["proposal", "scope", "exclusions", "risk"]),
        source_agent_id: "proposal-engine",
      },
      {
        collection: "lessons",
        title: "ASPICE SWE.1 gaps are the most common blocker at supplier gate reviews",
        content:
          "Across 14 gate reviews audited, SWE.1 (Software Requirements Analysis) work product completeness was the most common gap causing gate delays. Prioritize: traceability matrix from HSR to SSR, review records with stakeholder sign-off, change management log. Clients underestimate SWE.1 depth required for ASPICE Level 2.",
        tags: JSON.stringify(["aspice", "swe1", "gate-review", "requirements", "traceability"]),
        source_agent_id: "evidence-auditor",
      },
      {
        collection: "case-studies",
        title: "Volvo: ASIL-D E/E architecture safety analysis — 12-week engagement",
        content:
          "Scope: HARA + FSC + TSR for full vehicle E/E architecture. Team: 2 senior safety engineers. Deliverables: HARA report, FSC, TSR document set, DIA with 3 Tier-1s. Key challenges: late requirement changes from powertrain team, conflicting ASIL decomposition between domains. Resolution: weekly alignment calls with system architect, formal change request process with traceability tags.",
        tags: JSON.stringify(["volvo", "asil-d", "hara", "fsc", "tsr", "case-study"]),
        source_agent_id: "evidence-auditor",
      },
      {
        collection: "proposals",
        title: "Standard rate card — Thinking in Code 2026",
        content:
          "Senior Safety Engineer (ISO 26262 / ASPICE): \u20AC130-180/h. Safety Architect (ASIL-D, system level): \u20AC160-200/h. Cyber Security Engineer (UN R155, ISO 21434): \u20AC120-160/h. AUTOSAR Architect: \u20AC140-180/h. Project Lead (technical): \u20AC110-140/h. Standard engagement: T&M with 3-month minimum. Fixed-price only for well-scoped work products (e.g., single HARA, single FMEA). Never T&M for safety-critical delivery milestones.",
        tags: JSON.stringify(["rate-card", "pricing", "engagement-model"]),
        source_agent_id: "proposal-engine",
      },
      {
        collection: "iso26262",
        title: "ISO 26262 Part 6 — Required work products by ASIL level",
        content:
          "ASIL A/B: Software safety plan (6-5), software design specification (6-8), unit implementation (6-9), unit verification (6-10). ASIL C adds: formal review of unit tests, MC/DC coverage evidence. ASIL D adds: independent review, structural coverage 100% statement + branch + MC/DC, formal inspection records. All ASILs: software requirements spec (6-7), integration test spec+report (6-11), software safety validation report (6-12), configuration management records.",
        tags: JSON.stringify(["iso26262", "part6", "asil", "work-products", "checklist"]),
        source_agent_id: "evidence-auditor",
      },
      {
        collection: "contracts",
        title: "NDA baseline — Thinking in Code preferred terms",
        content:
          "Jurisdiction: Romania or EU member state (not US/UK). Confidentiality term: 3 years post-engagement (not indefinite). IP: assign only specific deliverables explicitly listed in SOW, not background IP. Liability cap: total fees paid in preceding 3 months. Indemnity: mutual and symmetric. Non-compete: geographic scope limited to direct competitors, max 12 months. Payment: Net 30 from invoice date. Governing language: English.",
        tags: JSON.stringify(["nda", "contract", "terms", "ip", "liability", "jurisdiction"]),
        source_agent_id: "contract-reviewer",
      },
      {
        collection: "playbooks",
        title: "AUTOSAR migration outreach wedge",
        content:
          "Use when target is posting AUTOSAR Classic\u2192Adaptive migration roles. Opening line: 'Saw you\u2019re expanding into Adaptive AUTOSAR \u2014 we\u2019ve led 3 ARA migrations from scratch at Tier-1 level, including timing analysis and service-oriented communication for safety domains. Happy to share what derailed the first two and how we stabilized them.' Follow with 1 specific technical challenge they\u2019ll face. Offer: 30-minute architecture call, no pitch.",
        tags: JSON.stringify(["outreach", "autosar", "adaptive", "wedge", "bd"]),
        source_agent_id: "bd-pipeline",
      },
      {
        collection: "garden",
        title: "Ia\u0219i zone 6b — historical frost dates and growing season",
        content:
          "Last spring frost: April 15 (average), safe transplant after April 20. First fall frost: October 15 (average). Growing season: ~178 days. Risk dates: late frost risk until May 1, early frost risk from October 1. Warm season crops (tomatoes, peppers, cucumbers): transplant after May 1 for safety. Cool season crops (lettuce, spinach, kale): direct sow March-April, again August-September.",
        tags: JSON.stringify(["zone6b", "iasi", "frost", "growing-season", "planting"]),
        source_agent_id: "garden-calendar",
      },
    ];

    const insertDoc = db.prepare(`
      INSERT INTO documents (doc_id, collection, title, content, tags, source_agent_id, source_run_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const d of docs) {
      insertDoc.run(
        randomUUID(), d.collection, d.title, d.content, d.tags,
        d.source_agent_id ?? null, null, ts, ts,
      );
    }

    console.log(`  [seeded] ${docs.length} documents into Knowledge`);
  }

  if (existingPlaybooks.n === 0) {
    const playbooks = [
      {
        title: "ASIL-D senior-only staffing rule",
        category: "delivery",
        body: "Never assign engineers with <5 years ISO 26262 experience as primary on ASIL-D work products. ASIL-D gate reviews require independently verifiable records; junior mistakes are expensive to correct and delay client programs.",
        tags: JSON.stringify(["asil-d", "staffing", "quality"]),
      },
      {
        title: "Fixed-price proposal trigger conditions",
        category: "proposal",
        body: "Offer fixed-price only when: (1) scope is a single bounded work product, (2) client provides complete input artifacts upfront, (3) no external dependency blockers exist, (4) 20% buffer built into estimate. Otherwise use T&M with monthly cap.",
        tags: JSON.stringify(["fixed-price", "proposal", "risk"]),
      },
      {
        title: "Handling 'we have internal safety team' objection",
        category: "objection",
        body: "Acknowledge strength of internal team. Pivot to: 'We typically work alongside internal teams \u2014 we bring independence (required by ISO 26262 for ASIL-C/D), plus we\u2019ve done this specific type of analysis across 8 OEM programs so we front-load the learning curve.' Ask: what\u2019s the ASIL level and what\u2019s the gate date?",
        tags: JSON.stringify(["objection", "internal-team", "independence", "asil"]),
      },
      {
        title: "Delivery gate discipline playbook",
        category: "delivery",
        body: "Never slip a gate without a signed change request. Gate slip triggers: (1) notify PM within 24h, (2) root cause in writing, (3) revised plan with buffer analysis, (4) formal re-baseline if >2 weeks. Clients who experience one slipped gate without formal process lose confidence permanently.",
        tags: JSON.stringify(["gate", "delivery", "change-management", "process"]),
      },
      {
        title: "Proposal cover email template — RFQ response",
        category: "sales",
        body: "Subject: [Company] \u00d7 Thinking in Code \u2014 Response to [RFQ Title]\n\nHi [Name],\n\nAttached is our response to your RFQ for [scope area].\n\nThree things worth noting:\n1. [Specific technical differentiator for their context]\n2. We\u2019ve included a phased option so you can validate approach before committing to full scope.\n3. [Specific team member / past project relevance]\n\nHappy to walk through the approach on a call \u2014 what does your schedule look like this week?\n\nDaniel",
        tags: JSON.stringify(["email", "rfq", "template", "cover-letter"]),
      },
    ];

    const insertPlaybook = db.prepare(`
      INSERT INTO playbooks (playbook_id, title, category, body, tags, use_count, last_used_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const p of playbooks) {
      insertPlaybook.run(
        randomUUID(), p.title, p.category, p.body, p.tags, 0, null, ts,
      );
    }

    console.log(`  [seeded] ${playbooks.length} playbooks into Knowledge`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  console.log("Jarvis demo data seeder");
  console.log("=======================\n");

  // Check databases exist
  if (!existsSync(CRM_DB_PATH)) {
    console.error(`  [error] CRM database not found at ${CRM_DB_PATH}`);
    console.error("  Run 'npx tsx scripts/init-jarvis.ts' first to create databases.\n");
    process.exit(1);
  }
  if (!existsSync(KNOWLEDGE_DB_PATH)) {
    console.error(`  [error] Knowledge database not found at ${KNOWLEDGE_DB_PATH}`);
    console.error("  Run 'npx tsx scripts/init-jarvis.ts' first to create databases.\n");
    process.exit(1);
  }

  // Seed CRM
  const crmDb = new DatabaseSync(CRM_DB_PATH);
  try {
    crmDb.exec("PRAGMA journal_mode = WAL;");
    crmDb.exec("PRAGMA foreign_keys = ON;");
    seedCrmData(crmDb);
  } finally {
    crmDb.close();
  }

  // Seed Knowledge
  const knowledgeDb = new DatabaseSync(KNOWLEDGE_DB_PATH);
  try {
    knowledgeDb.exec("PRAGMA journal_mode = WAL;");
    knowledgeDb.exec("PRAGMA foreign_keys = ON;");
    seedKnowledgeData(knowledgeDb);
  } finally {
    knowledgeDb.close();
  }

  console.log("\n  Demo data seeding complete.\n");
}

main();
