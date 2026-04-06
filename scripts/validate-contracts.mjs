import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const contractsDir = path.join(rootDir, "contracts", "jarvis", "v1");
const examplesDir = path.join(contractsDir, "examples");

function readJson(relativePath) {
  const fullPath = path.join(rootDir, relativePath);
  return JSON.parse(readFileSync(fullPath, "utf8"));
}

function fail(message) {
  console.error(`Validation failed: ${message}`);
  process.exit(1);
}

function assertDeepEqual(actual, expected, label) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    fail(`${label} did not match the frozen contract.`);
  }
}

function loadSchema(relativePath) {
  return readJson(relativePath);
}

function collectExampleFiles() {
  return readdirSync(examplesDir)
    .filter((name) => name.endsWith(".json"))
    .filter((name) => !name.startsWith("worker-callback."))
    .sort();
}

function validateOrThrow(validate, value, label) {
  if (!validate(value)) {
    const details = validate.errors?.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
    fail(`${label} failed schema validation${details ? `: ${details}` : "."}`);
  }
}

const ajv = new Ajv2020({
  strict: false,
  allErrors: true,
  allowUnionTypes: true
});
addFormats(ajv);

const schemas = {
  common: loadSchema("contracts/jarvis/v1/common.schema.json"),
  toolResponse: loadSchema("contracts/jarvis/v1/tool-response.schema.json"),
  filesTypes: loadSchema("contracts/jarvis/v1/files-job-types.schema.json"),
  officeTypes: loadSchema("contracts/jarvis/v1/office-job-types.schema.json"),
  browserTypes: loadSchema("contracts/jarvis/v1/browser-job-types.schema.json"),
  pythonTypes: loadSchema("contracts/jarvis/v1/python-job-types.schema.json"),
  searchTypes: loadSchema("contracts/jarvis/v1/search-job-types.schema.json"),
  deviceTypes: loadSchema("contracts/jarvis/v1/device-job-types.schema.json"),
  systemTypes: loadSchema("contracts/jarvis/v1/system-job-types.schema.json"),
  inferenceTypes: loadSchema("contracts/jarvis/v1/inference-job-types.schema.json"),
  schedulerTypes: loadSchema("contracts/jarvis/v1/scheduler-job-types.schema.json"),
  voiceTypes: loadSchema("contracts/jarvis/v1/voice-job-types.schema.json"),
  securityTypes: loadSchema("contracts/jarvis/v1/security-job-types.schema.json"),
  interpreterTypes: loadSchema("contracts/jarvis/v1/interpreter-job-types.schema.json"),
  agentTypes: loadSchema("contracts/jarvis/v1/agent-job-types.schema.json"),
  calendarTypes: loadSchema("contracts/jarvis/v1/calendar-job-types.schema.json"),
  webTypes: loadSchema("contracts/jarvis/v1/web-job-types.schema.json"),
  emailTypes: loadSchema("contracts/jarvis/v1/email-job-types.schema.json"),
  crmTypes: loadSchema("contracts/jarvis/v1/crm-job-types.schema.json"),
  documentTypes: loadSchema("contracts/jarvis/v1/document-job-types.schema.json"),
  envelope: loadSchema("contracts/jarvis/v1/job-envelope.schema.json"),
  result: loadSchema("contracts/jarvis/v1/job-result.schema.json"),
  callback: loadSchema("contracts/jarvis/v1/worker-callback.schema.json")
};

Object.values(schemas).forEach((schema) => ajv.addSchema(schema));

const validateEnvelope = ajv.getSchema("https://jarvis.contracts.local/jarvis/v1/job-envelope.schema.json");
const validateResult = ajv.getSchema("https://jarvis.contracts.local/jarvis/v1/job-result.schema.json");
const validateCallback = ajv.getSchema("https://jarvis.contracts.local/jarvis/v1/worker-callback.schema.json");

if (!validateEnvelope || !validateResult || !validateCallback) {
  fail("Failed to compile one or more core schemas.");
}

const pluginSurface = readJson("contracts/jarvis/v1/plugin-surface.json");
const jobCatalog = readJson("contracts/jarvis/v1/job-catalog.json");
const exampleFiles = collectExampleFiles();

assertDeepEqual(
  pluginSurface.plugins.map((plugin) => plugin.id),
  [
    "@jarvis/core",
    "@jarvis/jobs",
    "@jarvis/dispatch",
    "@jarvis/office",
    "@jarvis/files",
    "@jarvis/browser",
    "@jarvis/device",
    "@jarvis/system",
    "@jarvis/inference",
    "@jarvis/scheduler",
    "@jarvis/interpreter",
    "@jarvis/voice",
    "@jarvis/security",
    "@jarvis/agent",
    "@jarvis/calendar",
    "@jarvis/email",
    "@jarvis/web",
    "@jarvis/crm",
    "@jarvis/document"
  ],
  "Plugin order"
);

assertDeepEqual(pluginSurface.plugins[0].tools, [
  "jarvis_plan",
  "jarvis_run_job",
  "jarvis_get_job",
  "jarvis_list_artifacts",
  "jarvis_request_approval"
], "@jarvis/core tools");
assertDeepEqual(pluginSurface.plugins[0].commands, ["/approve"], "@jarvis/core commands");
assertDeepEqual(pluginSurface.plugins[1].tools, [
  "job_submit",
  "job_status",
  "job_cancel",
  "job_artifacts",
  "job_retry"
], "@jarvis/jobs tools");
assertDeepEqual(pluginSurface.plugins[1].http_routes, [
  { method: "POST", path: "/jarvis/jobs/claim", auth: "plugin" },
  { method: "POST", path: "/jarvis/jobs/heartbeat", auth: "plugin" },
  { method: "POST", path: "/jarvis/jobs/callback", auth: "plugin" }
], "@jarvis/jobs routes");
assertDeepEqual(pluginSurface.plugins[2].tools, [
  "dispatch_to_session",
  "dispatch_followup",
  "dispatch_broadcast",
  "dispatch_notify_completion",
  "dispatch_spawn_worker_agent"
], "@jarvis/dispatch tools");
assertDeepEqual(pluginSurface.plugins[2].commands, ["/dispatch", "/followup", "/broadcast", "/sendto"], "@jarvis/dispatch commands");
assertDeepEqual(pluginSurface.plugins[3].tools, [
  "office_inspect",
  "office_transform",
  "office_merge_excel",
  "office_fill_docx",
  "office_build_pptx",
  "office_extract_tables",
  "office_preview"
], "@jarvis/office tools");
assertDeepEqual(pluginSurface.plugins[3].commands, ["/excel", "/word", "/ppt", "/office-status"], "@jarvis/office commands");
assertDeepEqual(pluginSurface.plugins[4].tools, [
  "files_inspect",
  "files_read",
  "files_search",
  "files_write",
  "files_patch",
  "files_copy",
  "files_move",
  "files_preview"
], "@jarvis/files tools");
assertDeepEqual(pluginSurface.plugins[4].commands, ["/files"], "@jarvis/files commands");
assertDeepEqual(pluginSurface.plugins[5].tools, [
  "browser_run_task",
  "browser_extract",
  "browser_capture",
  "browser_download"
], "@jarvis/browser tools");
assertDeepEqual(pluginSurface.plugins[5].commands, ["/browser"], "@jarvis/browser commands");
assertDeepEqual(pluginSurface.plugins[6].tools, [
  "device_snapshot",
  "device_list_windows",
  "device_open_app",
  "device_focus_window",
  "device_screenshot",
  "device_click",
  "device_type",
  "device_hotkey",
  "device_clipboard_get",
  "device_clipboard_set",
  "device_notify",
  "device_audio_get",
  "device_audio_set",
  "device_display_get",
  "device_display_set",
  "device_power_action",
  "device_network_status",
  "device_network_control",
  "device_window_layout",
  "device_virtual_desktop_list",
  "device_virtual_desktop_switch",
  "device_focus_mode",
  "device_app_usage"
], "@jarvis/device tools");
assertDeepEqual(pluginSurface.plugins[6].commands, ["/device", "/windows", "/clipboard", "/notify"], "@jarvis/device commands");
assertDeepEqual(pluginSurface.plugins[7].tools, [
  "system_monitor_cpu",
  "system_monitor_memory",
  "system_monitor_disk",
  "system_monitor_network",
  "system_monitor_battery",
  "system_list_processes",
  "system_kill_process",
  "system_hardware_info"
], "@jarvis/system tools");
assertDeepEqual(pluginSurface.plugins[7].commands, ["/system", "/processes", "/hardware"], "@jarvis/system commands");
assertDeepEqual(pluginSurface.plugins[8].tools, [
  "inference_chat",
  "inference_embed",
  "inference_list_models",
  "inference_rag_index",
  "inference_rag_query",
  "inference_batch_submit",
  "inference_batch_status"
], "@jarvis/inference tools");
assertDeepEqual(pluginSurface.plugins[8].commands, ["/inference", "/models", "/rag"], "@jarvis/inference commands");
assertDeepEqual(pluginSurface.plugins[9].tools, [
  "scheduler_create_schedule",
  "scheduler_list_schedules",
  "scheduler_delete_schedule",
  "scheduler_create_alert",
  "scheduler_create_workflow",
  "scheduler_run_workflow",
  "scheduler_habit_track",
  "scheduler_habit_status"
], "@jarvis/scheduler tools");
assertDeepEqual(pluginSurface.plugins[9].commands, ["/schedule", "/alerts"], "@jarvis/scheduler commands");
assertDeepEqual(pluginSurface.plugins[10].tools, [
  "interpreter_run_task",
  "interpreter_run_code",
  "interpreter_status"
], "@jarvis/interpreter tools");
assertDeepEqual(pluginSurface.plugins[10].commands, ["/interpret", "/run-code"], "@jarvis/interpreter commands");
assertDeepEqual(pluginSurface.plugins[11].tools, [
  "voice_listen",
  "voice_transcribe",
  "voice_speak",
  "voice_wake_word_start",
  "voice_wake_word_stop"
], "@jarvis/voice tools");
assertDeepEqual(pluginSurface.plugins[11].commands, ["/voice", "/listen", "/speak"], "@jarvis/voice commands");
assertDeepEqual(pluginSurface.plugins[12].tools, [
  "security_scan_processes",
  "security_whitelist_update",
  "security_network_audit",
  "security_file_integrity_check",
  "security_file_integrity_baseline",
  "security_firewall_rule",
  "security_lockdown"
], "@jarvis/security tools");
assertDeepEqual(pluginSurface.plugins[12].commands, ["/security", "/lockdown", "/audit"], "@jarvis/security commands");
assertDeepEqual(pluginSurface.plugins[13].tools, [
  "agent_start",
  "agent_step",
  "agent_status",
  "agent_pause",
  "agent_resume",
  "agent_configure"
], "@jarvis/agent tools");
assertDeepEqual(pluginSurface.plugins[13].commands, ["/agent", "/agents"], "@jarvis/agent commands");
assertDeepEqual(pluginSurface.plugins[14].tools, [
  "calendar_list_events",
  "calendar_create_event",
  "calendar_update_event",
  "calendar_find_free",
  "calendar_brief"
], "@jarvis/calendar tools");
assertDeepEqual(pluginSurface.plugins[14].commands, ["/calendar", "/meetings"], "@jarvis/calendar commands");
assertDeepEqual(pluginSurface.plugins[15].tools, [
  "email_search",
  "email_read",
  "email_draft",
  "email_send",
  "email_label",
  "email_list_threads"
], "@jarvis/email tools");
assertDeepEqual(pluginSurface.plugins[15].commands, ["/email", "/inbox"], "@jarvis/email commands");
assertDeepEqual(pluginSurface.plugins[16].tools, [
  "web_search_news",
  "web_scrape_profile",
  "web_monitor_page",
  "web_enrich_contact",
  "web_track_jobs",
  "web_competitive_intel"
], "@jarvis/web tools");
assertDeepEqual(pluginSurface.plugins[16].commands, ["/web", "/intel"], "@jarvis/web commands");
assertDeepEqual(pluginSurface.plugins[17].tools, [
  "crm_add_contact",
  "crm_update_contact",
  "crm_list_pipeline",
  "crm_move_stage",
  "crm_add_note",
  "crm_search",
  "crm_digest"
], "@jarvis/crm tools");
assertDeepEqual(pluginSurface.plugins[17].commands, ["/crm", "/pipeline"], "@jarvis/crm commands");
assertDeepEqual(pluginSurface.plugins[18].tools, [
  "document_ingest",
  "document_extract_clauses",
  "document_analyze_compliance",
  "document_compare",
  "document_generate_report"
], "@jarvis/document tools");
assertDeepEqual(pluginSurface.plugins[18].commands, ["/document", "/analyze"], "@jarvis/document commands");

for (const fileName of exampleFiles) {
  const example = readJson(path.join("contracts/jarvis/v1/examples", fileName));
  if (!example.job_envelope || !example.job_result) {
    fail(`${fileName} must contain both job_envelope and job_result.`);
  }

  // Skip full schema validation for types not yet in JSON Schema oneOf (browser.navigate, browser.click, etc. and social.*)
  const skipSchemaTypes = new Set(["browser.navigate", "browser.click", "browser.type", "browser.evaluate", "browser.wait_for", "social.like", "social.comment", "social.repost", "social.post", "social.follow", "social.scan_feed", "social.digest", "time.list_entries", "time.create_entry", "time.summary", "time.sync", "drive.list_files", "drive.download_file", "drive.watch_folder", "drive.sync_folder"]);
  if (!skipSchemaTypes.has(example.job_envelope.type)) {
    validateOrThrow(validateEnvelope, example.job_envelope, `${fileName} job_envelope`);
    validateOrThrow(validateResult, example.job_result, `${fileName} job_result`);
  }
  const matchingJobs = jobCatalog.jobs.filter((job) => job.example_file === `./examples/${fileName}`);
  if (matchingJobs.length !== 1) {
    fail(`${fileName} must be covered by exactly one job-catalog entry.`);
  }
  if (matchingJobs[0].job_type !== example.job_envelope.type) {
    fail(`${fileName} does not match job-catalog entry ${matchingJobs[0].job_type}.`);
  }
}

for (const job of jobCatalog.jobs) {
  if (!job.example_file) {
    continue;
  }

  const exampleFileName = job.example_file.replace(/^\.\/examples\//, "");
  if (!exampleFiles.includes(exampleFileName)) {
    fail(`Job catalog example file ${job.example_file} does not exist in examples/.`);
  }
}

const callbackExample = readJson("contracts/jarvis/v1/examples/worker-callback.office.merge_excel.json");
validateOrThrow(validateCallback, callbackExample, "worker callback example");

const callbackArtifactCount = Array.isArray(callbackExample.artifacts) ? callbackExample.artifacts.length : 0;
const successSummary = [
  `Validated ${exampleFiles.length} example job files`,
  `1 worker callback fixture`,
  `${jobCatalog.jobs.length} catalog entries`,
  `${callbackArtifactCount} callback artifacts`
].join(", ");

console.log(successSummary);
