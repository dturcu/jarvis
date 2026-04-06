import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  JOB_APPROVAL_REQUIREMENT,
  JOB_TIMEOUT_SECONDS,
  JOB_TYPE_NAMES
} from "@jarvis/shared";
import {
  jarvisCoreCommandNames,
  jarvisCoreToolNames
} from "@jarvis/core";
import {
  jarvisJobsToolNames
} from "@jarvis/jobs";
import {
  jarvisDispatchCommandNames,
  jarvisDispatchToolNames
} from "@jarvis/dispatch";
import {
  officeCommandNames,
  officeToolNames
} from "@jarvis/office";
import {
  filesCommandNames,
  filesToolNames
} from "@jarvis/files";
import {
  browserCommandNames,
  browserToolNames
} from "@jarvis/browser";
import {
  jarvisDeviceCommandNames,
  jarvisDeviceToolNames
} from "@jarvis/device";

type PluginSurface = {
  plugins: Array<{
    id: string;
    tools: string[];
    commands: string[];
  }>;
};

type JobCatalog = {
  jobs: Array<{
    job_type: (typeof JOB_TYPE_NAMES)[number];
    default_timeout_seconds: number;
    approval_requirement: (typeof JOB_APPROVAL_REQUIREMENT)[(typeof JOB_TYPE_NAMES)[number]];
  }>;
};

function readJson<T>(relativePath: string): T {
  const fileUrl = new URL(`../${relativePath}`, import.meta.url);
  return JSON.parse(readFileSync(fileUrl, "utf8")) as T;
}

function findPlugin(surface: PluginSurface, id: string) {
  const plugin = surface.plugins.find((entry) => entry.id === id);
  expect(plugin).toBeDefined();
  return plugin!;
}

describe("Jarvis contract alignment", () => {
  it("matches the frozen plugin surface contract", () => {
    const surface = readJson<PluginSurface>(
      "contracts/jarvis/v1/plugin-surface.json",
    );

    expect(findPlugin(surface, "@jarvis/core").tools).toEqual(jarvisCoreToolNames);
    expect(findPlugin(surface, "@jarvis/core").commands).toEqual(jarvisCoreCommandNames);
    expect(findPlugin(surface, "@jarvis/jobs").tools).toEqual(jarvisJobsToolNames);
    expect(findPlugin(surface, "@jarvis/dispatch").tools).toEqual(jarvisDispatchToolNames);
    expect(findPlugin(surface, "@jarvis/dispatch").commands).toEqual(
      jarvisDispatchCommandNames,
    );
    expect(findPlugin(surface, "@jarvis/office").tools).toEqual(officeToolNames);
    expect(findPlugin(surface, "@jarvis/office").commands).toEqual(
      officeCommandNames,
    );
    expect(findPlugin(surface, "@jarvis/files").tools).toEqual(filesToolNames);
    expect(findPlugin(surface, "@jarvis/files").commands).toEqual(
      filesCommandNames,
    );
    expect(findPlugin(surface, "@jarvis/browser").tools).toEqual(browserToolNames);
    expect(findPlugin(surface, "@jarvis/browser").commands).toEqual(
      browserCommandNames,
    );
    expect(findPlugin(surface, "@jarvis/device").tools).toEqual(
      jarvisDeviceToolNames,
    );
    expect(findPlugin(surface, "@jarvis/device").commands).toEqual(
      jarvisDeviceCommandNames,
    );
  });

  it("matches the frozen job catalog for types, timeouts, and approvals", () => {
    const catalog = readJson<JobCatalog>("contracts/jarvis/v1/job-catalog.json");
    const catalogTypes = catalog.jobs.map((entry) => entry.job_type);

    expect(catalogTypes).toEqual([...JOB_TYPE_NAMES]);

    for (const entry of catalog.jobs) {
      expect(JOB_TIMEOUT_SECONDS[entry.job_type]).toBe(entry.default_timeout_seconds);
      expect(JOB_APPROVAL_REQUIREMENT[entry.job_type]).toBe(
        entry.approval_requirement,
      );
    }
  });
});
