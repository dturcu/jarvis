import { describe, expect, it } from "vitest";
import type {
  ArtifactProvenance,
  ArtifactSourceRef,
  ArtifactRecord,
} from "@jarvis/shared";

/* ------------------------------------------------------------------ */
/*  Y2-Q5 Provenance Artifacts                                        */
/* ------------------------------------------------------------------ */

describe("ArtifactProvenance type shape", () => {
  it("ArtifactRecord with provenance has source_agent_id and source_run_id", () => {
    const record: ArtifactRecord = {
      artifact_id: "art-001",
      kind: "report",
      name: "Gap Analysis Report",
      provenance: {
        source_agent_id: "evidence-auditor",
        source_run_id: "run-20260407-001",
      },
    };

    expect(record.provenance).toBeDefined();
    expect(record.provenance!.source_agent_id).toBe("evidence-auditor");
    expect(record.provenance!.source_run_id).toBe("run-20260407-001");
  });

  it("ArtifactSourceRef supports ref_type, label, location, excerpt", () => {
    const ref: ArtifactSourceRef = {
      ref_type: "rfq_excerpt",
      label: "RFQ Section 3.2 - Safety Requirements",
      location: "rfq/2026-04-acme.pdf#section-3.2",
      excerpt: "The supplier shall demonstrate ASIL-D compliance.",
    };

    expect(ref.ref_type).toBe("rfq_excerpt");
    expect(ref.label).toBe("RFQ Section 3.2 - Safety Requirements");
    expect(ref.location).toBe("rfq/2026-04-acme.pdf#section-3.2");
    expect(ref.excerpt).toBe(
      "The supplier shall demonstrate ASIL-D compliance.",
    );
  });

  it("Provenance supports optional source_refs and assumptions arrays", () => {
    const provenance: ArtifactProvenance = {
      source_agent_id: "proposal-engine",
      source_run_id: "run-20260407-002",
      step_no: 3,
      action: "generate_proposal",
      source_refs: [
        {
          ref_type: "clause",
          label: "MSA Clause 7 - IP Rights",
          location: "contracts/msa-acme-2026.pdf#clause-7",
        },
      ],
      assumptions: [
        "Client requires ASIL-D for all safety-relevant functions",
        "Timeline assumes 2 FTE allocation",
      ],
    };

    expect(provenance.source_refs).toHaveLength(1);
    expect(provenance.assumptions).toHaveLength(2);
    expect(provenance.step_no).toBe(3);
    expect(provenance.action).toBe("generate_proposal");
  });

  it("ArtifactRecord without provenance is still valid (backward compat)", () => {
    const record: ArtifactRecord = {
      artifact_id: "art-legacy-001",
      kind: "document",
      name: "Legacy Report",
      path: "/reports/legacy.pdf",
      size_bytes: 102400,
    };

    expect(record.provenance).toBeUndefined();
    expect(record.artifact_id).toBe("art-legacy-001");
    expect(record.kind).toBe("document");
  });
});

describe("provenance attachment", () => {
  it("Provenance can be attached to any ArtifactRecord kind (report, document, image)", () => {
    const kinds = ["report", "document", "image"] as const;
    const records: ArtifactRecord[] = kinds.map((kind, i) => ({
      artifact_id: `art-${kind}-${i}`,
      kind,
      name: `Test ${kind}`,
      provenance: {
        source_agent_id: "content-engine",
        source_run_id: `run-${kind}-001`,
      },
    }));

    for (const record of records) {
      expect(record.provenance).toBeDefined();
      expect(record.provenance!.source_agent_id).toBe("content-engine");
    }
    expect(records.map((r) => r.kind)).toEqual([
      "report",
      "document",
      "image",
    ]);
  });

  it("Source refs can reference RFQ excerpts, clauses, case studies, documents, work products", () => {
    const refs: ArtifactSourceRef[] = [
      {
        ref_type: "rfq_excerpt",
        label: "RFQ Safety Section",
        location: "rfq/acme-2026.pdf#s3",
        excerpt: "ASIL-D required for braking ECU",
      },
      {
        ref_type: "clause",
        label: "MSA Liability Clause",
        location: "contracts/msa.pdf#clause-12",
      },
      {
        ref_type: "case_study",
        label: "OEM-Alpha ADAS Project",
        location: "knowledge/case-studies/oem-alpha-adas.md",
      },
      {
        ref_type: "document",
        label: "ISO 26262 Part 6 Reference",
        location: "standards/iso-26262-6.pdf",
      },
      {
        ref_type: "work_product",
        label: "Safety Plan WP-01",
        location: "projects/acme/wp-01-safety-plan.docx",
      },
    ];

    const expectedTypes = [
      "rfq_excerpt",
      "clause",
      "case_study",
      "document",
      "work_product",
    ];
    expect(refs.map((r) => r.ref_type)).toEqual(expectedTypes);

    for (const ref of refs) {
      expect(ref.label).toBeTruthy();
      expect(ref.ref_type).toBeTruthy();
    }
  });

  it("Multiple source_refs per provenance are supported", () => {
    const provenance: ArtifactProvenance = {
      source_agent_id: "evidence-auditor",
      source_run_id: "run-multi-ref-001",
      source_refs: [
        { ref_type: "document", label: "Safety Plan" },
        { ref_type: "document", label: "HARA Report" },
        { ref_type: "rfq_excerpt", label: "RFQ Scope" },
        { ref_type: "work_product", label: "TSC Minutes" },
      ],
    };

    expect(provenance.source_refs).toHaveLength(4);
    expect(provenance.source_refs![0].label).toBe("Safety Plan");
    expect(provenance.source_refs![3].label).toBe("TSC Minutes");
  });

  it("Assumptions array captures generation assumptions", () => {
    const provenance: ArtifactProvenance = {
      source_agent_id: "proposal-engine",
      source_run_id: "run-assumptions-001",
      assumptions: [
        "Project duration is 18 months",
        "Client has existing AUTOSAR Classic stack",
        "Cybersecurity scope limited to ISO 21434 gap analysis",
      ],
    };

    expect(provenance.assumptions).toHaveLength(3);
    expect(provenance.assumptions![0]).toBe("Project duration is 18 months");
    expect(provenance.assumptions![2]).toContain("ISO 21434");
  });
});

describe("provenance integrity", () => {
  it("Provenance preserves through JSON serialization/deserialization", () => {
    const original: ArtifactRecord = {
      artifact_id: "art-serial-001",
      kind: "report",
      name: "Serialization Test Report",
      mime_type: "application/pdf",
      provenance: {
        source_agent_id: "evidence-auditor",
        source_run_id: "run-serial-001",
        step_no: 5,
        action: "compile_gap_matrix",
        source_refs: [
          {
            ref_type: "work_product",
            label: "Safety Case v2",
            location: "projects/beta/safety-case-v2.pdf",
            excerpt: "Verified against ISO 26262-4 clause 7",
          },
        ],
        assumptions: [
          "All work products dated after 2025-01-01 are in scope",
        ],
      },
    };

    const serialized = JSON.stringify(original);
    const deserialized: ArtifactRecord = JSON.parse(serialized);

    expect(deserialized).toEqual(original);
    expect(deserialized.provenance!.source_agent_id).toBe("evidence-auditor");
    expect(deserialized.provenance!.step_no).toBe(5);
    expect(deserialized.provenance!.source_refs).toHaveLength(1);
    expect(deserialized.provenance!.source_refs![0].excerpt).toBe(
      "Verified against ISO 26262-4 clause 7",
    );
    expect(deserialized.provenance!.assumptions).toHaveLength(1);
  });

  it("Empty source_refs array is valid", () => {
    const provenance: ArtifactProvenance = {
      source_agent_id: "content-engine",
      source_run_id: "run-empty-refs-001",
      source_refs: [],
    };

    expect(provenance.source_refs).toEqual([]);
    expect(provenance.source_refs).toHaveLength(0);
  });

  it("Empty assumptions array is valid", () => {
    const provenance: ArtifactProvenance = {
      source_agent_id: "garden-calendar",
      source_run_id: "run-empty-assumptions-001",
      assumptions: [],
    };

    expect(provenance.assumptions).toEqual([]);
    expect(provenance.assumptions).toHaveLength(0);
  });

  it("Provenance without optional fields (step_no, action, source_refs, assumptions) is valid", () => {
    const provenance: ArtifactProvenance = {
      source_agent_id: "drive-watcher",
      source_run_id: "run-minimal-001",
    };

    expect(provenance.source_agent_id).toBe("drive-watcher");
    expect(provenance.source_run_id).toBe("run-minimal-001");
    expect(provenance.step_no).toBeUndefined();
    expect(provenance.action).toBeUndefined();
    expect(provenance.source_refs).toBeUndefined();
    expect(provenance.assumptions).toBeUndefined();
  });
});
