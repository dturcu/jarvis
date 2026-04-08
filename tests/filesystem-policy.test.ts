import { describe, it, expect } from "vitest";
import os from "node:os";
import { resolve, normalize, sep } from "node:path";
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

    it("falls back to process.cwd() when project root is omitted", () => {
      const policy = defaultFilesystemPolicy();
      // Should have ~/.jarvis, tmpdir, and cwd
      expect(policy.allowed_roots).toHaveLength(3);
      expect(policy.allowed_roots).toContain(resolve(process.cwd()));
    });

    it("sets max_read_bytes to 10 MB by default", () => {
      const policy = defaultFilesystemPolicy();
      expect(policy.max_read_bytes).toBe(10 * 1024 * 1024);
    });

    it("sets max_write_bytes to 5 MB by default", () => {
      const policy = defaultFilesystemPolicy();
      expect(policy.max_write_bytes).toBe(5 * 1024 * 1024);
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

    // ── Blocked paths ──────────────────────────────────────────────────────
    // These are denied regardless of allowed_roots.

    it("denies ~/.ssh even when explicitly allowed", () => {
      const sshDir = resolve(os.homedir(), ".ssh");
      const liberal = {
        ...policy,
        allowed_roots: [...policy.allowed_roots, os.homedir()],
      };
      const result = validatePath(resolve(sshDir, "id_rsa"), liberal);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("blocked");
    });

    it("denies ~/.aws credential directory", () => {
      const awsDir = resolve(os.homedir(), ".aws");
      const liberal = {
        ...policy,
        allowed_roots: [...policy.allowed_roots, os.homedir()],
      };
      const result = validatePath(resolve(awsDir, "credentials"), liberal);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("blocked");
    });

    it("denies ~/.gcp credential directory", () => {
      const gcpDir = resolve(os.homedir(), ".gcp");
      const liberal = {
        ...policy,
        allowed_roots: [...policy.allowed_roots, os.homedir()],
      };
      const result = validatePath(resolve(gcpDir, "key.json"), liberal);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("blocked");
    });

    it("denies ~/.azure credential directory", () => {
      const azureDir = resolve(os.homedir(), ".azure");
      const liberal = {
        ...policy,
        allowed_roots: [...policy.allowed_roots, os.homedir()],
      };
      const result = validatePath(resolve(azureDir, "config"), liberal);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("blocked");
    });

    it("denies system directories even if added to allowed_roots", () => {
      if (process.platform === "win32") {
        // On Windows, C:\Windows is blocked
        const liberal = {
          ...policy,
          allowed_roots: [...policy.allowed_roots, "C:\\"],
        };
        const result = validatePath("C:\\Windows\\System32\\config", liberal);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("blocked");
      } else {
        // On Unix, /etc and /var are blocked
        const liberal = {
          ...policy,
          allowed_roots: [...policy.allowed_roots, "/"],
        };
        const etcResult = validatePath("/etc/passwd", liberal);
        expect(etcResult.allowed).toBe(false);
        expect(etcResult.reason).toContain("blocked");

        const varResult = validatePath("/var/log/syslog", liberal);
        expect(varResult.allowed).toBe(false);
        expect(varResult.reason).toContain("blocked");
      }
    });

    it("denies paths containing Chrome/User Data substring", () => {
      const chromePath = resolve(os.homedir(), "AppData/Local/Google/Chrome/User Data/Default/Cookies");
      const liberal = {
        ...policy,
        allowed_roots: [...policy.allowed_roots, os.homedir()],
      };
      const result = validatePath(chromePath, liberal);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("browser-profile");
    });

    it("denies paths containing Firefox/Profiles substring", () => {
      const ffPath = resolve(os.homedir(), ".mozilla/Firefox/Profiles/abc123/cookies.sqlite");
      const liberal = {
        ...policy,
        allowed_roots: [...policy.allowed_roots, os.homedir()],
      };
      const result = validatePath(ffPath, liberal);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("browser-profile");
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
      expect(policy.max_read_bytes).toBe(10 * 1024 * 1024);
      expect(policy.max_write_bytes).toBe(5 * 1024 * 1024);
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

    it("overrides max_read_bytes from config", () => {
      const policy = loadFilesystemPolicy({
        filesystem_policy: {
          max_read_bytes: 20 * 1024 * 1024,
        },
      });
      expect(policy.max_read_bytes).toBe(20 * 1024 * 1024);
    });

    it("overrides max_write_bytes from config", () => {
      const policy = loadFilesystemPolicy({
        filesystem_policy: {
          max_write_bytes: 1 * 1024 * 1024,
        },
      });
      expect(policy.max_write_bytes).toBe(1 * 1024 * 1024);
    });
  });
});
