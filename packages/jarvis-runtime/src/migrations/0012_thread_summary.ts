import type { Migration } from "./runner.js";

export const migration0012: Migration = {
  id: "0012",
  name: "thread_summary",
  sql: `
ALTER TABLE channel_threads ADD COLUMN summary TEXT;
`,
};
