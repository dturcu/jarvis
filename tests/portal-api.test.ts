import { describe, expect, it } from "vitest";
import {
  portalDocumentMatchesClient,
  sanitizePortalFilePath,
} from "../packages/jarvis-dashboard/src/api/portal.ts";

const client = {
  client_id: "acme-001",
  company: "Acme",
  contact_name: "Alex",
  email: "alex@acme.test",
} as const;

describe("Portal API helpers", () => {
  it("matches documents only on exact client tags or collection keys", () => {
    expect(portalDocumentMatchesClient({
      tags: JSON.stringify(["client:acme-001", "company:acme"]),
      collection: "deliverables",
    }, client)).toBe(true);

    expect(portalDocumentMatchesClient({
      tags: JSON.stringify(["company:acme-holdings"]),
      collection: "deliverables",
    }, client)).toBe(false);
  });

  it("redacts raw host paths down to a basename", () => {
    expect(sanitizePortalFilePath("/srv/private/contracts/acme-sow.pdf", "Acme SOW", "doc-1")).toBe("acme-sow.pdf");
    expect(sanitizePortalFilePath("C:\\Jarvis\\private\\contracts\\acme-sow.pdf", "Acme SOW", "doc-1")).toBe("acme-sow.pdf");
  });
});
