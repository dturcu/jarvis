import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@jarvis/shared": `${rootDir}packages/jarvis-shared/src/index.ts`,
      "@jarvis/core": `${rootDir}packages/jarvis-core/src/index.ts`,
      "@jarvis/jobs": `${rootDir}packages/jarvis-jobs/src/index.ts`,
      "@jarvis/dispatch": `${rootDir}packages/jarvis-dispatch/src/index.ts`,
      "@jarvis/office": `${rootDir}packages/jarvis-office/src/index.ts`,
      "@jarvis/files": `${rootDir}packages/jarvis-files/src/index.ts`,
      "@jarvis/browser": `${rootDir}packages/jarvis-browser/src/index.ts`,
      "@jarvis/device": `${rootDir}packages/jarvis-device/src/index.ts`,
      "@jarvis/desktop-host-worker": `${rootDir}packages/jarvis-desktop-host-worker/src/index.ts`,
      "@jarvis/supervisor": `${rootDir}packages/jarvis-supervisor/src/index.ts`,
      "@jarvis/system": `${rootDir}packages/jarvis-system/src/index.ts`,
      "@jarvis/system-worker": `${rootDir}packages/jarvis-system-worker/src/index.ts`,
      "@jarvis/inference": `${rootDir}packages/jarvis-inference/src/index.ts`,
      "@jarvis/inference-worker": `${rootDir}packages/jarvis-inference-worker/src/index.ts`,
      "@jarvis/scheduler": `${rootDir}packages/jarvis-scheduler/src/index.ts`,
      "@jarvis/voice": `${rootDir}packages/jarvis-voice/src/index.ts`,
      "@jarvis/voice-worker": `${rootDir}packages/jarvis-voice-worker/src/index.ts`,
      "@jarvis/interpreter": `${rootDir}packages/jarvis-interpreter/src/index.ts`,
      "@jarvis/interpreter-worker": `${rootDir}packages/jarvis-interpreter-worker/src/index.ts`,
      "@jarvis/security": `${rootDir}packages/jarvis-security/src/index.ts`,
      "@jarvis/security-worker": `${rootDir}packages/jarvis-security-worker/src/index.ts`,
      "@jarvis/agent-framework": `${rootDir}packages/jarvis-agent-framework/src/index.ts`,
      "@jarvis/agent": `${rootDir}packages/jarvis-agent-plugin/src/index.ts`,
      "@jarvis/agent-worker": `${rootDir}packages/jarvis-agent-worker/src/index.ts`,
      "@jarvis/calendar-worker": `${rootDir}packages/jarvis-calendar-worker/src/index.ts`,
      "@jarvis/calendar": `${rootDir}packages/jarvis-calendar-plugin/src/index.ts`,
      "@jarvis/email-worker": `${rootDir}packages/jarvis-email-worker/src/index.ts`,
      "@jarvis/email": `${rootDir}packages/jarvis-email-plugin/src/index.ts`,
      "@jarvis/crm-worker": `${rootDir}packages/jarvis-crm-worker/src/index.ts`,
      "@jarvis/crm": `${rootDir}packages/jarvis-crm-plugin/src/index.ts`,
      "@jarvis/web-worker": `${rootDir}packages/jarvis-web-worker/src/index.ts`,
      "@jarvis/web": `${rootDir}packages/jarvis-web-plugin/src/index.ts`,
      "@jarvis/agents": `${rootDir}packages/jarvis-agents/src/index.ts`,
      "@jarvis/document-worker": `${rootDir}packages/jarvis-document-worker/src/index.ts`,
      "@jarvis/document": `${rootDir}packages/jarvis-document-plugin/src/index.ts`,
      "@jarvis/office-worker": `${rootDir}packages/jarvis-office-worker/src/index.ts`,
      "@jarvis/browser-worker": `${rootDir}packages/jarvis-browser-worker/src/index.ts`,
      "@jarvis/social-worker": `${rootDir}packages/jarvis-social-worker/src/index.ts`,
      "@jarvis/runtime": `${rootDir}packages/jarvis-runtime/src/index.ts`
    }
  },
  test: {
    environment: "node",
    include: ["tests/stress/**/*.test.ts"],
    testTimeout: 120_000,
    pool: "forks",
    maxConcurrency: 1
  }
});
