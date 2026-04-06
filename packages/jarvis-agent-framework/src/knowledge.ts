import { randomUUID } from "node:crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type KnowledgeCollection =
  | "lessons"
  | "playbooks"
  | "case-studies"
  | "contracts"
  | "proposals"
  | "iso26262"
  | "garden";

export type KnowledgeDocument = {
  doc_id: string;
  collection: KnowledgeCollection;
  title: string;
  content: string;
  tags: string[];
  source_agent_id?: string;
  source_run_id?: string;
  created_at: string;
  updated_at: string;
};

export type PlaybookEntry = {
  playbook_id: string;
  title: string;
  category: "proposal" | "objection" | "delivery" | "sales" | "engagement";
  body: string;
  tags: string[];
  use_count: number;
  last_used_at?: string;
  created_at: string;
};

export type KnowledgeSearchResult = {
  doc: KnowledgeDocument;
  score: number;
};

// ─── KnowledgeStore ──────────────────────────────────────────────────────────

/**
 * In-memory knowledge store that all agents share.
 * In production this would be backed by a vector DB or SQLite FTS table.
 * The store is pre-seeded with domain knowledge from Thinking in Code.
 */
export class KnowledgeStore {
  private documents = new Map<string, KnowledgeDocument>();
  private playbooks = new Map<string, PlaybookEntry>();

  constructor() {
    this._seed();
  }

  // ─── Document API ───────────────────────────────────────────────────────────

  addDocument(params: Omit<KnowledgeDocument, "doc_id" | "created_at" | "updated_at">): KnowledgeDocument {
    const now = new Date().toISOString();
    const doc: KnowledgeDocument = {
      ...params,
      doc_id: randomUUID(),
      created_at: now,
      updated_at: now,
    };
    this.documents.set(doc.doc_id, doc);
    return doc;
  }

  updateDocument(docId: string, updates: Partial<Pick<KnowledgeDocument, "content" | "tags" | "title">>): KnowledgeDocument {
    const existing = this.documents.get(docId);
    if (!existing) throw new Error(`Knowledge document not found: ${docId}`);
    const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };
    this.documents.set(docId, updated);
    return updated;
  }

  getDocument(docId: string): KnowledgeDocument | undefined {
    return this.documents.get(docId);
  }

  listCollection(collection: KnowledgeCollection): KnowledgeDocument[] {
    return [...this.documents.values()].filter(d => d.collection === collection);
  }

  /**
   * Keyword search across content + title + tags.
   * Returns scored results sorted by relevance descending.
   * Production would use vector similarity here.
   */
  search(query: string, options?: { collection?: KnowledgeCollection; limit?: number }): KnowledgeSearchResult[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const limit = options?.limit ?? 10;

    const results: KnowledgeSearchResult[] = [];

    for (const doc of this.documents.values()) {
      if (options?.collection && doc.collection !== options.collection) continue;

      const haystack = `${doc.title} ${doc.content} ${doc.tags.join(" ")}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        // Title matches are worth double
        if (doc.title.toLowerCase().includes(term)) score += 2;
        // Content matches
        const count = (haystack.match(new RegExp(term, "g")) ?? []).length;
        score += count;
      }
      if (score > 0) results.push({ doc, score });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  deleteDocument(docId: string): boolean {
    return this.documents.delete(docId);
  }

  getStats(): { document_count: number; playbook_count: number; collections: Record<string, number> } {
    const collections: Record<string, number> = {};
    for (const doc of this.documents.values()) {
      collections[doc.collection] = (collections[doc.collection] ?? 0) + 1;
    }
    return {
      document_count: this.documents.size,
      playbook_count: this.playbooks.size,
      collections,
    };
  }

  // ─── Playbook API ───────────────────────────────────────────────────────────

  addPlaybook(params: Omit<PlaybookEntry, "playbook_id" | "use_count" | "created_at">): PlaybookEntry {
    const entry: PlaybookEntry = {
      ...params,
      playbook_id: randomUUID(),
      use_count: 0,
      created_at: new Date().toISOString(),
    };
    this.playbooks.set(entry.playbook_id, entry);
    return entry;
  }

  getPlaybook(playbookId: string): PlaybookEntry | undefined {
    return this.playbooks.get(playbookId);
  }

  listPlaybooks(category?: PlaybookEntry["category"]): PlaybookEntry[] {
    const all = [...this.playbooks.values()];
    return category ? all.filter(p => p.category === category) : all;
  }

  touchPlaybook(playbookId: string): PlaybookEntry {
    const existing = this.playbooks.get(playbookId);
    if (!existing) throw new Error(`Playbook not found: ${playbookId}`);
    const updated = {
      ...existing,
      use_count: existing.use_count + 1,
      last_used_at: new Date().toISOString(),
    };
    this.playbooks.set(playbookId, updated);
    return updated;
  }

  // ─── Seed Data ──────────────────────────────────────────────────────────────

  private _seed(): void {
    const now = new Date().toISOString();

    const docs: Array<Omit<KnowledgeDocument, "doc_id" | "created_at" | "updated_at">> = [
      {
        collection: "lessons",
        title: "Early signal: automotive Tier-1s post AUTOSAR safety roles 4-6 weeks before RFQ",
        content:
          "Hiring signals on LinkedIn (AUTOSAR, ISO 26262, Cyber Security roles) at Tier-1 suppliers reliably precede formal RFQs by 4-6 weeks. Monitor job boards weekly. When a supplier posts 2+ safety-critical openings simultaneously, treat as strong intent signal and move to immediate outreach.",
        tags: ["bd", "signal", "autosar", "rfq", "tier1"],
        source_agent_id: "bd-pipeline",
      },
      {
        collection: "lessons",
        title: "Proposals without explicit exclusion scope are renegotiated at delivery",
        content:
          "Every proposal that omitted explicit out-of-scope statements led to scope creep disputes. Include a dedicated EXCLUSIONS section listing at minimum: validation of third-party components, tool qualification, production software delivery, and acceptance testing unless specified. Use ISO 26262 scope boundary language.",
        tags: ["proposal", "scope", "exclusions", "risk"],
        source_agent_id: "proposal-engine",
      },
      {
        collection: "lessons",
        title: "ASPICE SWE.1 gaps are the most common blocker at supplier gate reviews",
        content:
          "Across 14 gate reviews audited, SWE.1 (Software Requirements Analysis) work product completeness was the most common gap causing gate delays. Prioritize: traceability matrix from HSR to SSR, review records with stakeholder sign-off, change management log. Clients underestimate SWE.1 depth required for ASPICE Level 2.",
        tags: ["aspice", "swe1", "gate-review", "requirements", "traceability"],
        source_agent_id: "evidence-auditor",
      },
      {
        collection: "case-studies",
        title: "Volvo: ASIL-D E/E architecture safety analysis — 12-week engagement",
        content:
          "Scope: HARA + FSC + TSR for full vehicle E/E architecture. Team: 2 senior safety engineers. Deliverables: HARA report, FSC, TSR document set, DIA with 3 Tier-1s. Key challenges: late requirement changes from powertrain team, conflicting ASIL decomposition between domains. Resolution: weekly alignment calls with system architect, formal change request process with traceability tags.",
        tags: ["volvo", "asil-d", "hara", "fsc", "tsr", "case-study"],
        source_agent_id: "evidence-auditor",
      },
      {
        collection: "proposals",
        title: "Standard rate card — Thinking in Code 2026",
        content:
          "Senior Safety Engineer (ISO 26262 / ASPICE): €130-180/h. Safety Architect (ASIL-D, system level): €160-200/h. Cyber Security Engineer (UN R155, ISO 21434): €120-160/h. AUTOSAR Architect: €140-180/h. Project Lead (technical): €110-140/h. Standard engagement: T&M with 3-month minimum. Fixed-price only for well-scoped work products (e.g., single HARA, single FMEA). Never T&M for safety-critical delivery milestones.",
        tags: ["rate-card", "pricing", "engagement-model"],
        source_agent_id: "proposal-engine",
      },
      {
        collection: "iso26262",
        title: "ISO 26262 Part 6 — Required work products by ASIL level",
        content:
          "ASIL A/B: Software safety plan (6-5), software design specification (6-8), unit implementation (6-9), unit verification (6-10). ASIL C adds: formal review of unit tests, MC/DC coverage evidence. ASIL D adds: independent review, structural coverage 100% statement + branch + MC/DC, formal inspection records. All ASILs: software requirements spec (6-7), integration test spec+report (6-11), software safety validation report (6-12), configuration management records.",
        tags: ["iso26262", "part6", "asil", "work-products", "checklist"],
        source_agent_id: "evidence-auditor",
      },
      {
        collection: "contracts",
        title: "NDA baseline — Thinking in Code preferred terms",
        content:
          "Jurisdiction: Romania or EU member state (not US/UK). Confidentiality term: 3 years post-engagement (not indefinite). IP: assign only specific deliverables explicitly listed in SOW, not background IP. Liability cap: total fees paid in preceding 3 months. Indemnity: mutual and symmetric. Non-compete: geographic scope limited to direct competitors, max 12 months. Payment: Net 30 from invoice date. Governing language: English.",
        tags: ["nda", "contract", "terms", "ip", "liability", "jurisdiction"],
        source_agent_id: "contract-reviewer",
      },
      {
        collection: "playbooks",
        title: "AUTOSAR migration outreach wedge",
        content:
          "Use when target is posting AUTOSAR Classic→Adaptive migration roles. Opening line: 'Saw you're expanding into Adaptive AUTOSAR — we've led 3 ARA migrations from scratch at Tier-1 level, including timing analysis and service-oriented communication for safety domains. Happy to share what derailed the first two and how we stabilized them.' Follow with 1 specific technical challenge they'll face. Offer: 30-minute architecture call, no pitch.",
        tags: ["outreach", "autosar", "adaptive", "wedge", "bd"],
        source_agent_id: "bd-pipeline",
      },
      {
        collection: "garden",
        title: "Iași zone 6b — historical frost dates and growing season",
        content:
          "Last spring frost: April 15 (average), safe transplant after April 20. First fall frost: October 15 (average). Growing season: ~178 days. Risk dates: late frost risk until May 1, early frost risk from October 1. Warm season crops (tomatoes, peppers, cucumbers): transplant after May 1 for safety. Cool season crops (lettuce, spinach, kale): direct sow March-April, again August-September.",
        tags: ["zone6b", "iasi", "frost", "growing-season", "planting"],
        source_agent_id: "garden-calendar",
      },
    ];

    for (const d of docs) {
      this.documents.set(
        randomUUID(),
        { ...d, doc_id: randomUUID(), created_at: now, updated_at: now }
      );
    }

    const playbooks: Array<Omit<PlaybookEntry, "playbook_id" | "use_count" | "created_at">> = [
      {
        title: "ASIL-D senior-only staffing rule",
        category: "delivery",
        body: "Never assign engineers with <5 years ISO 26262 experience as primary on ASIL-D work products. ASIL-D gate reviews require independently verifiable records; junior mistakes are expensive to correct and delay client programs.",
        tags: ["asil-d", "staffing", "quality"],
      },
      {
        title: "Fixed-price proposal trigger conditions",
        category: "proposal",
        body: "Offer fixed-price only when: (1) scope is a single bounded work product, (2) client provides complete input artifacts upfront, (3) no external dependency blockers exist, (4) 20% buffer built into estimate. Otherwise use T&M with monthly cap.",
        tags: ["fixed-price", "proposal", "risk"],
      },
      {
        title: "Handling 'we have internal safety team' objection",
        category: "objection",
        body: "Acknowledge strength of internal team. Pivot to: 'We typically work alongside internal teams — we bring independence (required by ISO 26262 for ASIL-C/D), plus we've done this specific type of analysis across 8 OEM programs so we front-load the learning curve.' Ask: what's the ASIL level and what's the gate date?",
        tags: ["objection", "internal-team", "independence", "asil"],
      },
      {
        title: "Delivery gate discipline playbook",
        category: "delivery",
        body: "Never slip a gate without a signed change request. Gate slip triggers: (1) notify PM within 24h, (2) root cause in writing, (3) revised plan with buffer analysis, (4) formal re-baseline if >2 weeks. Clients who experience one slipped gate without formal process lose confidence permanently.",
        tags: ["gate", "delivery", "change-management", "process"],
      },
      {
        title: "Proposal cover email template — RFQ response",
        category: "sales",
        body: "Subject: [Company] × Thinking in Code — Response to [RFQ Title]\n\nHi [Name],\n\nAttached is our response to your RFQ for [scope area].\n\nThree things worth noting:\n1. [Specific technical differentiator for their context]\n2. We've included a phased option so you can validate approach before committing to full scope.\n3. [Specific team member / past project relevance]\n\nHappy to walk through the approach on a call — what does your schedule look like this week?\n\nDaniel",
        tags: ["email", "rfq", "template", "cover-letter"],
      },
    ];

    for (const p of playbooks) {
      this.playbooks.set(
        randomUUID(),
        { ...p, playbook_id: randomUUID(), use_count: 0, created_at: now }
      );
    }
  }
}
