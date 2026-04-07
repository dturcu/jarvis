import { describe, it, expect } from "vitest";
import os from "node:os";
import { resolve, sep } from "node:path";
import {
  defaultFilesystemPolicy,
  validatePath,
  loadFilesystemPolicy,
} from "@jarvis/runtime";

const JARVIS_DIR = resolve(os.homedir(), ".jarvis");

describe("FilesystemPolicy", () => {
  // ─── defaultFilesystemPolicy ─────────────────────────────────────────────

  describe("defaultFilesystemPolicy", () => {
    it("includes ~/.jarvis and os.tmpdir()", () => {
      const policy = defaultFilesystemPolicy();
      expect(policy.allowed_roots).toContain(JARVIS_DIR);
      expect(policy.allowed_roots).toContain(os.tmpdir());
    });

    it("includes project root when provided", () => {
      const projectRoot = "/home/user/my-project";
      const policy = defaultFilesystemPolicy(projectRoot);
      expect(policy.allowed_roots).toContain(resolve(projectRoot));
    });

    it("does not include project root when omitted", () => {
      const policy = defaultFilesystemPolicy();
      // Should only have ~/.jarvis and tmpdir
      expect(policy.allowed_roots).toHaveLength(2);
    });
  });

  // ─── validatePath ────────────────────────────────────────────────────────

  describe("validatePath", () => {
    const policy = defaultFilesystemPolicy();

    it("allows paths under allowed roots", () => {
      const result = validatePath(
        resolve(JARVIS_DIR, "runtime.db"),
        policy,
      );
      expect(result.allowed).toBe(true);
    });

    it("allows paths under tmpdir", () => {
      const result = validatePath(
        resolve(os.tmpdir(), "jarvis-temp-file.txt"),
        policy,
      );
      expect(result.allowed).toBe(true);
    });

    it("denies paths outside all allowed roots", () => {
      const result = validatePath("/etc/passwd", policy);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("outside all allowed roots");
    });

    it("denies paths matching .env pattern", () => {
      const result = validatePath(
        resolve(JARVIS_DIR, ".env"),
        policy,
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain(".env");
    });

    it("denies paths matching credentials pattern", () => {
      const result = validatePath(
        resolve(JARVIS_DIR, "credentials.json"),
        policy,
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("credentials");
    });

    it("denies paths matching .pem pattern", () => {
      const result = validatePath(
        resolve(JARVIS_DIR, "server.pem"),
        policy,
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain(".pem");
    });

    it("denies paths matching .key pattern", () => {
      const result = validatePath(
        resolve(JARVIS_DIR, "private.key"),
        policy,
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain(".key");
    });

    it("denied patterns are case-insensitive", () => {
      const upper = validatePath(
        resolve(JARVIS_DIR, ".ENV"),
        policy,
      );
      expect(upper.allowed).toBe(false);

      const mixed = validatePath(
        resolve(JARVIS_DIR, "Credentials.JSON"),
        policy,
      );
      expect(mixed.allowed).toBe(false);
    });

    it("handles Windows-style paths with backslash separators", () => {
      // Use a path under an allowed root but constructed with backslashes
      const winPath = JARVIS_DIR + "\\subdir\\data.json";
      const result = validatePath(winPath, policy);
      // Should not fail due to separator mismatch -- the path is under ~/.jarvis
      expect(result.allowed).toBe(true);
    });
  });

  // ─── loadFilesystemPolicy ───────────────────────────────────────────────

  describe("loadFilesystemPolicy", () => {
    it("without config overrides returns the default policy", () => {
      const policy = loadFilesystemPolicy({});
      expect(policy.allowed_roots).toContain(JARVIS_DIR);
      expect(policy.allowed_roots).toContain(os.tmpdir());
      expect(policy.denied_patterns).toContain(".env");
      expect(policy.max_file_size_bytes).toBe(50 * 1024 * 1024);
    });

    it("merges additional roots from config", () => {
      const policy = loadFilesystemPolicy({
        filesystem_policy: {
          additional_roots: ["/opt/data", "/mnt/share"],
        },
      });
      expect(policy.allowed_roots).toContain(resolve("/opt/data"));
      expect(policy.allowed_roots).toContain(resolve("/mnt/share"));
      // Still has the defaults
      expect(policy.allowed_roots).toContain(JARVIS_DIR);
    });

    it("merges additional denied patterns from config", () => {
      const policy = loadFilesystemPolicy({
        filesystem_policy: {
          additional_denied_patterns: [".secret", "token.json"],
        },
      });
      // Has defaults
      expect(policy.denied_patterns).toContain(".env");
      expect(policy.denied_patterns).toContain(".pem");
      // Has additions
      expect(policy.denied_patterns).toContain(".secret");
      expect(policy.denied_patterns).toContain("token.json");
    });

    it("overrides max_file_size_bytes from config", () => {
      const policy = loadFilesystemPolicy({
        filesystem_policy: {
          max_file_size_bytes: 100 * 1024 * 1024,
        },
      });
      expect(policy.max_file_size_bytes).toBe(100 * 1024 * 1024);
    });

    it("includes project_root when provided", () => {
      const policy = loadFilesystemPolicy({
        project_root: "/home/user/project",
      });
      expect(policy.allowed_roots).toContain(resolve("/home/user/project"));
    });
  });
});
