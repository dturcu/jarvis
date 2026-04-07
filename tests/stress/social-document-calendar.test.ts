/**
 * Stress: Social, Document, Calendar Workers
 *
 * Tests social media operations (post, like, comment, feed scan),
 * document processing (ingest, compliance, clauses, reports),
 * and calendar operations (events, scheduling, briefs).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MockSocialAdapter, executeSocialJob } from "@jarvis/social-worker";
import { MockDocumentAdapter, executeDocumentJob } from "@jarvis/document-worker";
import { MockCalendarAdapter, executeCalendarJob } from "@jarvis/calendar-worker";
import type { JobEnvelope } from "@jarvis/shared";

function envelope(type: string, input: Record<string, unknown>): JobEnvelope {
  return {
    contract_version: "1.0.0",
    job_id: randomUUID(),
    type: type as any,
    input,
    attempt: 1,
    metadata: { agent_id: "stress-multi", run_id: randomUUID() },
  };
}

// ── Social Worker ───────────────────────────────────────────────────────────

describe("Social Worker Workflows", () => {
  let social: MockSocialAdapter;

  beforeEach(() => {
    social = new MockSocialAdapter();
  });

  it("full engagement cycle: scan → like → comment → post", async () => {
    // 1. Scan feed
    const scan = await executeSocialJob(
      envelope("social.scan_feed", { platform: "linkedin", max_posts: 10 }),
      social,
    );
    expect(scan.status).toBe("completed");

    // 2. Like a post
    const like = await executeSocialJob(
      envelope("social.like", { platform: "linkedin", post_url: "https://linkedin.com/post/post-001" }),
      social,
    );
    expect(like.status).toBe("completed");
    expect(like.structured_output?.liked).toBe(true);

    // 3. Comment on a post
    const comment = await executeSocialJob(
      envelope("social.comment", {
        platform: "linkedin",
        post_url: "https://linkedin.com/post/post-001",
        text: "Great insights on AUTOSAR migration challenges!",
      }),
      social,
    );
    expect(comment.status).toBe("completed");

    // 4. Create a post
    const post = await executeSocialJob(
      envelope("social.post", {
        platform: "linkedin",
        text: "ISO 26262 compliance is not just about documentation — it's about building a safety culture.",
        hashtags: ["ISO26262", "AutomotiveSafety", "FunctionalSafety"],
      }),
      social,
    );
    expect(post.status).toBe("completed");
    expect(post.structured_output?.post_url).toBeTruthy();

    expect(social.getActionCount()).toBe(4);
  });

  it("repost and follow operations", async () => {
    const repost = await executeSocialJob(
      envelope("social.repost", { platform: "linkedin", post_url: "https://linkedin.com/post/post-002" }),
      social,
    );
    expect(repost.status).toBe("completed");

    const follow = await executeSocialJob(
      envelope("social.follow", { platform: "linkedin", profile_url: "https://linkedin.com/in/user-123" }),
      social,
    );
    expect(follow.status).toBe("completed");
  });

  it("digest summarizes engagement", async () => {
    // Perform some actions first
    await executeSocialJob(envelope("social.like", { platform: "linkedin", post_url: "https://linkedin.com/post/p1" }), social);
    await executeSocialJob(envelope("social.comment", { platform: "linkedin", post_url: "https://linkedin.com/post/p2", text: "Great post!" }), social);

    const digest = await executeSocialJob(
      envelope("social.digest", { platform: "linkedin", period: "7d" }),
      social,
    );
    expect(digest.status).toBe("completed");
  });

  it("10 concurrent social operations", async () => {
    const results = await Promise.all([
      ...Array.from({ length: 3 }, (_, i) => executeSocialJob(envelope("social.like", { platform: "linkedin", post_url: `https://linkedin.com/post/p-${i}` }), social)),
      ...Array.from({ length: 3 }, (_, i) => executeSocialJob(envelope("social.comment", { platform: "linkedin", post_url: `https://linkedin.com/post/p-${i}`, text: `Comment ${i}` }), social)),
      ...Array.from({ length: 2 }, () => executeSocialJob(envelope("social.scan_feed", { platform: "linkedin", max_posts: 5 }), social)),
      ...Array.from({ length: 2 }, () => executeSocialJob(envelope("social.digest", { platform: "linkedin" }), social)),
    ]);

    expect(results.every(r => r.status === "completed")).toBe(true);
    // like(3) + comment(3) + scanFeed(2) = 8 recorded actions (digest does not record)
    expect(social.getActionCount()).toBe(8);
  });
});

// ── Document Worker ─────────────────────────────────────────────────────────

describe("Document Worker Workflows", () => {
  let doc: MockDocumentAdapter;

  beforeEach(() => {
    doc = new MockDocumentAdapter();
  });

  it("full document pipeline: ingest → extract clauses → analyze compliance → report", async () => {
    // 1. Ingest NDA
    const ingest = await executeDocumentJob(
      envelope("document.ingest", {
        file_path: "/tmp/test-nda.pdf",
      }),
      doc,
    );
    expect(ingest.status).toBe("completed");
    expect(doc.getIngestedFiles()).toContain("/tmp/test-nda.pdf");

    // 2. Extract clauses
    const clauses = await executeDocumentJob(
      envelope("document.extract_clauses", {
        file_path: "/tmp/test-nda.pdf",
        clause_types: ["confidentiality", "ip_ownership", "termination", "non_compete"],
      }),
      doc,
    );
    expect(clauses.status).toBe("completed");

    // 3. Analyze compliance
    const compliance = await executeDocumentJob(
      envelope("document.analyze_compliance", {
        file_path: "/tmp/test-nda.pdf",
        framework: "iso_26262",
      }),
      doc,
    );
    expect(compliance.status).toBe("completed");

    // 4. Generate report
    const report = await executeDocumentJob(
      envelope("document.generate_report", {
        title: "NDA Review: Bertrandt AG",
        template: "nda_analysis",
        data: { compliance_score: 85, issues: 2 },
        output_format: "pdf",
        output_path: "/tmp/nda-review-bertrandt",
      }),
      doc,
    );
    expect(report.status).toBe("completed");
    expect(doc.getGeneratedReports().length).toBeGreaterThan(0);
  });

  it("document comparison between two files", async () => {
    const result = await executeDocumentJob(
      envelope("document.compare", {
        file_path_a: "/contracts/nda-v1.pdf",
        file_path_b: "/contracts/nda-v2.pdf",
      }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("concurrent document operations", async () => {
    const results = await Promise.all([
      ...Array.from({ length: 3 }, (_, i) => executeDocumentJob(envelope("document.ingest", { file_path: `/tmp/test-doc-${i}.pdf` }), doc)),
      ...Array.from({ length: 3 }, (_, i) => executeDocumentJob(envelope("document.extract_clauses", { file_path: `/tmp/test-doc-${i}.pdf` }), doc)),
      ...Array.from({ length: 2 }, () => executeDocumentJob(envelope("document.analyze_compliance", { file_path: "/tmp/test-doc-0.pdf", framework: "aspice" }), doc)),
      ...Array.from({ length: 2 }, (_, i) => executeDocumentJob(envelope("document.generate_report", { title: `Report ${i}`, template: "custom", data: {}, output_format: "pdf", output_path: `/tmp/report-${i}` }), doc)),
    ]);

    expect(results.every(r => r.status === "completed")).toBe(true);
    expect(doc.getIngestedFiles()).toHaveLength(3);
    expect(doc.getGeneratedReports()).toHaveLength(2);
  });
});

// ── Calendar Worker ─────────────────────────────────────────────────────────

describe("Calendar Worker Workflows", () => {
  let cal: MockCalendarAdapter;

  beforeEach(() => {
    cal = new MockCalendarAdapter();
  });

  it("full calendar workflow: list → create → update → brief", async () => {
    // 1. List events
    const list = await executeCalendarJob(
      envelope("calendar.list_events", {
        start_date: "2026-04-07",
        end_date: "2026-04-14",
      }),
      cal,
    );
    expect(list.status).toBe("completed");

    // 2. Create event
    const create = await executeCalendarJob(
      envelope("calendar.create_event", {
        title: "ISO 26262 Gap Analysis — Bertrandt",
        start: "2026-04-10T10:00:00",
        end: "2026-04-10T12:00:00",
        attendees: ["f.sagnely@bertrandt.com", "daniel@thinkingincode.com"],
        description: "Review current work products against ISO 26262 Part 6 requirements",
      }),
      cal,
    );
    expect(create.status).toBe("completed");
    const eventId = create.structured_output?.event_id;
    expect(eventId).toBeTruthy();

    // 3. Update event
    const update = await executeCalendarJob(
      envelope("calendar.update_event", {
        event_id: eventId,
        title: "ISO 26262 Gap Analysis — Bertrandt AG (Updated)",
      }),
      cal,
    );
    expect(update.status).toBe("completed");

    // 4. Brief
    const brief = await executeCalendarJob(
      envelope("calendar.brief", { event_id: eventId }),
      cal,
    );
    expect(brief.status).toBe("completed");
  });

  it("find free slots", async () => {
    const result = await executeCalendarJob(
      envelope("calendar.find_free", {
        attendees: ["consultant@jarvis.local", "test@example.com"],
        start_search: "2026-04-07T08:00:00.000Z",
        end_search: "2026-04-11T18:00:00.000Z",
        duration_minutes: 60,
      }),
      cal,
    );

    expect(result.status).toBe("completed");
    const slots = result.structured_output?.slots as any[];
    expect(slots).toBeDefined();
  });

  it("concurrent calendar operations", async () => {
    const results = await Promise.all([
      ...Array.from({ length: 3 }, (_, i) =>
        executeCalendarJob(envelope("calendar.create_event", {
          title: `Meeting ${i}`,
          start: `2026-04-${10 + i}T09:00:00`,
          end: `2026-04-${10 + i}T10:00:00`,
        }), cal),
      ),
      ...Array.from({ length: 3 }, () =>
        executeCalendarJob(envelope("calendar.list_events", { start_date: "2026-04-07", end_date: "2026-04-14" }), cal),
      ),
      ...Array.from({ length: 2 }, () =>
        executeCalendarJob(envelope("calendar.brief", { event_id: "evt-autosar-001" }), cal),
      ),
    ]);

    expect(results.every(r => r.status === "completed")).toBe(true);
    expect(cal.getEventCount()).toBeGreaterThanOrEqual(3);
  });
});
