export const CONTRACT_VERSION = "jarvis.v1" as const;

export const CORE_TOOL_NAMES = [
  "jarvis_plan",
  "jarvis_run_job",
  "jarvis_get_job",
  "jarvis_list_artifacts",
  "jarvis_request_approval"
] as const;

export const CORE_COMMAND_NAMES = ["/approve"] as const;

export const JOBS_TOOL_NAMES = [
  "job_submit",
  "job_status",
  "job_cancel",
  "job_artifacts",
  "job_retry"
] as const;

export const DISPATCH_TOOL_NAMES = [
  "dispatch_to_session",
  "dispatch_followup",
  "dispatch_broadcast",
  "dispatch_notify_completion",
  "dispatch_spawn_worker_agent"
] as const;

export const DISPATCH_COMMAND_NAMES = [
  "/dispatch",
  "/followup",
  "/broadcast",
  "/sendto"
] as const;

export const FILES_TOOL_NAMES = [
  "files_inspect",
  "files_read",
  "files_search",
  "files_write",
  "files_patch",
  "files_copy",
  "files_move",
  "files_preview"
] as const;

export const FILES_COMMAND_NAMES = ["/files"] as const;

export const BROWSER_TOOL_NAMES = [
  "browser_run_task",
  "browser_extract",
  "browser_capture",
  "browser_download"
] as const;

export const BROWSER_COMMAND_NAMES = ["/browser"] as const;

export const OFFICE_TOOL_NAMES = [
  "office_inspect",
  "office_transform",
  "office_merge_excel",
  "office_fill_docx",
  "office_build_pptx",
  "office_extract_tables",
  "office_preview"
] as const;

export const OFFICE_COMMAND_NAMES = [
  "/excel",
  "/word",
  "/ppt",
  "/office-status"
] as const;

export const DEVICE_TOOL_NAMES = [
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
] as const;

export const DEVICE_COMMAND_NAMES = [
  "/device",
  "/windows",
  "/clipboard",
  "/notify"
] as const;

export const SYSTEM_TOOL_NAMES = [
  "system_monitor_cpu",
  "system_monitor_memory",
  "system_monitor_disk",
  "system_monitor_network",
  "system_monitor_battery",
  "system_list_processes",
  "system_kill_process",
  "system_hardware_info"
] as const;

export const SYSTEM_COMMAND_NAMES = ["/system", "/processes", "/hardware"] as const;

export const INFERENCE_TOOL_NAMES = [
  "inference_chat",
  "inference_embed",
  "inference_list_models",
  "inference_rag_index",
  "inference_rag_query",
  "inference_batch_submit",
  "inference_batch_status"
] as const;

export const INFERENCE_COMMAND_NAMES = ["/inference", "/models", "/rag"] as const;

export const SCHEDULER_TOOL_NAMES = [
  "scheduler_create_schedule",
  "scheduler_list_schedules",
  "scheduler_delete_schedule",
  "scheduler_create_alert",
  "scheduler_create_workflow",
  "scheduler_run_workflow",
  "scheduler_habit_track",
  "scheduler_habit_status"
] as const;

export const SCHEDULER_COMMAND_NAMES = ["/schedule", "/alerts"] as const;

export const INTERPRETER_TOOL_NAMES = [
  "interpreter_run_task",
  "interpreter_run_code",
  "interpreter_status"
] as const;

export const INTERPRETER_COMMAND_NAMES = ["/interpret", "/run-code"] as const;

export const VOICE_TOOL_NAMES = [
  "voice_listen",
  "voice_transcribe",
  "voice_speak",
  "voice_wake_word_start",
  "voice_wake_word_stop"
] as const;

export const VOICE_COMMAND_NAMES = ["/voice", "/listen", "/speak"] as const;

export const SECURITY_TOOL_NAMES = [
  "security_scan_processes",
  "security_whitelist_update",
  "security_network_audit",
  "security_file_integrity_check",
  "security_file_integrity_baseline",
  "security_firewall_rule",
  "security_lockdown"
] as const;

export const SECURITY_COMMAND_NAMES = ["/security", "/lockdown", "/audit"] as const;

export const AGENT_TOOL_NAMES = [
  "agent_start",
  "agent_step",
  "agent_status",
  "agent_pause",
  "agent_resume",
  "agent_configure",
] as const;

export const AGENT_COMMAND_NAMES = ["/agent", "/agents"] as const;

export const EMAIL_TOOL_NAMES = [
  "email_search",
  "email_read",
  "email_draft",
  "email_send",
  "email_label",
  "email_list_threads"
] as const;

export const EMAIL_COMMAND_NAMES = ["/email", "/inbox"] as const;

export const JOB_TYPE_NAMES = [
  "files.inspect",
  "files.read",
  "files.search",
  "files.write",
  "files.patch",
  "files.copy",
  "files.move",
  "files.preview",
  "office.inspect",
  "office.merge_excel",
  "office.transform_excel",
  "office.fill_docx",
  "office.build_pptx",
  "office.extract_tables",
  "office.preview",
  "browser.run_task",
  "browser.extract",
  "browser.capture",
  "browser.download",
  "python.run",
  "python.transform",
  "python.analyze",
  "python.report",
  "search.query",
  "search.fetch",
  "scrape.extract",
  "scrape.crawl",
  "device.snapshot",
  "device.list_windows",
  "device.open_app",
  "device.focus_window",
  "device.screenshot",
  "device.click",
  "device.type_text",
  "device.hotkey",
  "device.clipboard_get",
  "device.clipboard_set",
  "device.notify",
  "device.audio_get",
  "device.audio_set",
  "device.display_get",
  "device.display_set",
  "device.power_action",
  "device.network_status",
  "device.network_control",
  "device.window_layout",
  "device.virtual_desktop_list",
  "device.virtual_desktop_switch",
  "system.monitor_cpu",
  "system.monitor_memory",
  "system.monitor_disk",
  "system.monitor_network",
  "system.monitor_battery",
  "system.list_processes",
  "system.kill_process",
  "system.hardware_info",
  "inference.chat",
  "inference.vision_chat",
  "inference.embed",
  "inference.list_models",
  "inference.rag_index",
  "inference.rag_query",
  "inference.batch_submit",
  "inference.batch_status",
  "scheduler.create_schedule",
  "scheduler.list_schedules",
  "scheduler.delete_schedule",
  "scheduler.create_alert",
  "device.focus_mode",
  "device.app_usage",
  "scheduler.create_workflow",
  "scheduler.run_workflow",
  "scheduler.habit_track",
  "scheduler.habit_status",
  "interpreter.run_task",
  "interpreter.run_code",
  "interpreter.status",
  "voice.listen",
  "voice.transcribe",
  "voice.speak",
  "voice.wake_word_start",
  "voice.wake_word_stop",
  "security.scan_processes",
  "security.whitelist_update",
  "security.network_audit",
  "security.file_integrity_check",
  "security.file_integrity_baseline",
  "security.firewall_rule",
  "security.lockdown",
  "agent.start",
  "agent.step",
  "agent.status",
  "agent.pause",
  "agent.resume",
  "agent.configure",
  "calendar.list_events",
  "calendar.create_event",
  "calendar.update_event",
  "calendar.find_free",
  "calendar.brief",
  "email.search",
  "email.read",
  "email.draft",
  "email.send",
  "email.label",
  "email.list_threads",
  "web.search_news",
  "web.scrape_profile",
  "web.monitor_page",
  "web.enrich_contact",
  "web.track_jobs",
  "web.competitive_intel",
  "crm.add_contact",
  "crm.update_contact",
  "crm.list_pipeline",
  "crm.move_stage",
  "crm.add_note",
  "crm.search",
  "crm.digest",
  "document.ingest",
  "document.extract_clauses",
  "document.analyze_compliance",
  "document.compare",
  "document.generate_report",
  "browser.navigate",
  "browser.click",
  "browser.type",
  "browser.evaluate",
  "browser.wait_for",
  "social.like",
  "social.comment",
  "social.repost",
  "social.post",
  "social.follow",
  "social.scan_feed",
  "social.digest",
  "time.list_entries",
  "time.create_entry",
  "time.summary",
  "time.sync",
  "drive.list_files",
  "drive.download_file",
  "drive.watch_folder",
  "drive.sync_folder"
] as const;

export type JarvisJobType = (typeof JOB_TYPE_NAMES)[number];

export type JarvisPriority = "low" | "normal" | "high" | "urgent";
export type JarvisApprovalState =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled"
  | "not_required";
export type JarvisJobStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";
export type JarvisToolStatus =
  | "accepted"
  | "in_progress"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";
export type JarvisApprovalSeverity = "info" | "warning" | "critical";

export const JOB_TIMEOUT_SECONDS: Record<JarvisJobType, number> = {
  "files.inspect": 120,
  "files.read": 60,
  "files.search": 120,
  "files.write": 120,
  "files.patch": 120,
  "files.copy": 120,
  "files.move": 120,
  "files.preview": 60,
  "office.inspect": 300,
  "office.merge_excel": 900,
  "office.transform_excel": 900,
  "office.fill_docx": 600,
  "office.build_pptx": 900,
  "office.extract_tables": 600,
  "office.preview": 300,
  "browser.run_task": 900,
  "browser.extract": 600,
  "browser.capture": 300,
  "browser.download": 300,
  "python.run": 900,
  "python.transform": 900,
  "python.analyze": 900,
  "python.report": 600,
  "search.query": 120,
  "search.fetch": 300,
  "scrape.extract": 900,
  "scrape.crawl": 1800,
  "device.snapshot": 120,
  "device.list_windows": 60,
  "device.open_app": 180,
  "device.focus_window": 60,
  "device.screenshot": 120,
  "device.click": 60,
  "device.type_text": 60,
  "device.hotkey": 60,
  "device.clipboard_get": 60,
  "device.clipboard_set": 60,
  "device.notify": 30,
  "device.audio_get": 30,
  "device.audio_set": 30,
  "device.display_get": 30,
  "device.display_set": 60,
  "device.power_action": 30,
  "device.network_status": 60,
  "device.network_control": 60,
  "device.window_layout": 60,
  "device.virtual_desktop_list": 30,
  "device.virtual_desktop_switch": 30,
  "system.monitor_cpu": 30,
  "system.monitor_memory": 30,
  "system.monitor_disk": 60,
  "system.monitor_network": 60,
  "system.monitor_battery": 30,
  "system.list_processes": 60,
  "system.kill_process": 30,
  "system.hardware_info": 120,
  "inference.chat": 300,
  "inference.vision_chat": 300,
  "inference.embed": 120,
  "inference.list_models": 30,
  "inference.rag_index": 900,
  "inference.rag_query": 300,
  "inference.batch_submit": 60,
  "inference.batch_status": 30,
  "scheduler.create_schedule": 30,
  "scheduler.list_schedules": 30,
  "scheduler.delete_schedule": 30,
  "scheduler.create_alert": 60,
  "device.focus_mode": 30,
  "device.app_usage": 60,
  "scheduler.create_workflow": 60,
  "scheduler.run_workflow": 900,
  "scheduler.habit_track": 30,
  "scheduler.habit_status": 30,
  "voice.listen": 300,
  "voice.transcribe": 120,
  "voice.speak": 60,
  "voice.wake_word_start": 86400,
  "voice.wake_word_stop": 30,
  "security.scan_processes": 120,
  "security.whitelist_update": 30,
  "security.network_audit": 300,
  "security.file_integrity_check": 600,
  "security.file_integrity_baseline": 600,
  "security.firewall_rule": 60,
  "security.lockdown": 30,
  "interpreter.run_task": 900,
  "interpreter.run_code": 300,
  "interpreter.status": 30,
  "agent.start": 60,
  "agent.step": 300,
  "agent.status": 30,
  "agent.pause": 30,
  "agent.resume": 60,
  "agent.configure": 60,
  "calendar.list_events": 120,
  "calendar.create_event": 60,
  "calendar.update_event": 60,
  "calendar.find_free": 60,
  "calendar.brief": 300,
  "email.search": 120,
  "email.read": 60,
  "email.draft": 60,
  "email.send": 60,
  "email.label": 30,
  "email.list_threads": 120,
  "web.search_news": 300,
  "web.scrape_profile": 600,
  "web.monitor_page": 300,
  "web.enrich_contact": 300,
  "web.track_jobs": 600,
  "web.competitive_intel": 600,
  "crm.add_contact": 60,
  "crm.update_contact": 60,
  "crm.list_pipeline": 60,
  "crm.move_stage": 30,
  "crm.add_note": 30,
  "crm.search": 60,
  "crm.digest": 300,
  "document.ingest": 600,
  "document.extract_clauses": 300,
  "document.analyze_compliance": 600,
  "document.compare": 600,
  "document.generate_report": 900,
  "browser.navigate": 60,
  "browser.click": 60,
  "browser.type": 60,
  "browser.evaluate": 120,
  "browser.wait_for": 60,
  "social.like": 60,
  "social.comment": 120,
  "social.repost": 60,
  "social.post": 180,
  "social.follow": 60,
  "social.scan_feed": 300,
  "social.digest": 60,
  "time.list_entries": 120,
  "time.create_entry": 60,
  "time.summary": 120,
  "time.sync": 300,
  "drive.list_files": 120,
  "drive.download_file": 300,
  "drive.watch_folder": 60,
  "drive.sync_folder": 600
};

export const JOB_APPROVAL_REQUIREMENT: Record<
  JarvisJobType,
  "not_required" | "required" | "conditional"
> = {
  "files.inspect": "not_required",
  "files.read": "not_required",
  "files.search": "not_required",
  "files.write": "conditional",
  "files.patch": "conditional",
  "files.copy": "conditional",
  "files.move": "conditional",
  "files.preview": "not_required",
  "office.inspect": "not_required",
  "office.merge_excel": "not_required",
  "office.transform_excel": "not_required",
  "office.fill_docx": "not_required",
  "office.build_pptx": "not_required",
  "office.extract_tables": "not_required",
  "office.preview": "not_required",
  "browser.run_task": "conditional",
  "browser.extract": "not_required",
  "browser.capture": "not_required",
  "browser.download": "not_required",
  "python.run": "required",
  "python.transform": "required",
  "python.analyze": "not_required",
  "python.report": "not_required",
  "search.query": "not_required",
  "search.fetch": "not_required",
  "scrape.extract": "not_required",
  "scrape.crawl": "not_required",
  "device.snapshot": "not_required",
  "device.list_windows": "not_required",
  "device.open_app": "conditional",
  "device.focus_window": "conditional",
  "device.screenshot": "conditional",
  "device.click": "required",
  "device.type_text": "required",
  "device.hotkey": "required",
  "device.clipboard_get": "conditional",
  "device.clipboard_set": "required",
  "device.notify": "not_required",
  "device.audio_get": "not_required",
  "device.audio_set": "conditional",
  "device.display_get": "not_required",
  "device.display_set": "required",
  "device.power_action": "required",
  "device.network_status": "not_required",
  "device.network_control": "required",
  "device.window_layout": "conditional",
  "device.virtual_desktop_list": "not_required",
  "device.virtual_desktop_switch": "conditional",
  "system.monitor_cpu": "not_required",
  "system.monitor_memory": "not_required",
  "system.monitor_disk": "not_required",
  "system.monitor_network": "not_required",
  "system.monitor_battery": "not_required",
  "system.list_processes": "not_required",
  "system.kill_process": "required",
  "system.hardware_info": "not_required",
  "inference.chat": "not_required",
  "inference.vision_chat": "not_required",
  "inference.embed": "not_required",
  "inference.list_models": "not_required",
  "inference.rag_index": "conditional",
  "inference.rag_query": "not_required",
  "inference.batch_submit": "conditional",
  "inference.batch_status": "not_required",
  "scheduler.create_schedule": "conditional",
  "scheduler.list_schedules": "not_required",
  "scheduler.delete_schedule": "conditional",
  "scheduler.create_alert": "conditional",
  "device.focus_mode": "conditional",
  "device.app_usage": "not_required",
  "scheduler.create_workflow": "conditional",
  "scheduler.run_workflow": "conditional",
  "scheduler.habit_track": "not_required",
  "scheduler.habit_status": "not_required",
  "voice.listen": "conditional",
  "voice.transcribe": "not_required",
  "voice.speak": "not_required",
  "voice.wake_word_start": "conditional",
  "voice.wake_word_stop": "not_required",
  "security.scan_processes": "not_required",
  "security.whitelist_update": "required",
  "security.network_audit": "not_required",
  "security.file_integrity_check": "not_required",
  "security.file_integrity_baseline": "conditional",
  "security.firewall_rule": "required",
  "security.lockdown": "required",
  "interpreter.run_task": "required",
  "interpreter.run_code": "required",
  "interpreter.status": "not_required",
  "agent.start": "conditional",
  "agent.step": "not_required",
  "agent.status": "not_required",
  "agent.pause": "not_required",
  "agent.resume": "conditional",
  "agent.configure": "conditional",
  "calendar.list_events": "not_required",
  "calendar.create_event": "required",
  "calendar.update_event": "conditional",
  "calendar.find_free": "not_required",
  "calendar.brief": "not_required",
  "email.search": "not_required",
  "email.read": "not_required",
  "email.draft": "not_required",
  "email.send": "required",
  "email.label": "conditional",
  "email.list_threads": "not_required",
  "web.search_news": "not_required",
  "web.scrape_profile": "not_required",
  "web.monitor_page": "not_required",
  "web.enrich_contact": "not_required",
  "web.track_jobs": "not_required",
  "web.competitive_intel": "not_required",
  "crm.add_contact": "conditional",
  "crm.update_contact": "conditional",
  "crm.list_pipeline": "not_required",
  "crm.move_stage": "conditional",
  "crm.add_note": "not_required",
  "crm.search": "not_required",
  "crm.digest": "not_required",
  "document.ingest": "not_required",
  "document.extract_clauses": "not_required",
  "document.analyze_compliance": "not_required",
  "document.compare": "not_required",
  "document.generate_report": "conditional",
  "browser.navigate": "not_required",
  "browser.click": "not_required",
  "browser.type": "not_required",
  "browser.evaluate": "not_required",
  "browser.wait_for": "not_required",
  "social.like": "not_required",
  "social.comment": "not_required",
  "social.repost": "not_required",
  "social.post": "not_required",
  "social.follow": "not_required",
  "social.scan_feed": "not_required",
  "social.digest": "not_required",
  "time.list_entries": "not_required",
  "time.create_entry": "conditional",
  "time.summary": "not_required",
  "time.sync": "not_required",
  "drive.list_files": "not_required",
  "drive.download_file": "not_required",
  "drive.watch_folder": "not_required",
  "drive.sync_folder": "not_required"
};

export const KNOWN_DISPATCH_KINDS = new Set<string>([
  "dispatch_to_session",
  "dispatch_followup",
  "dispatch_broadcast",
  "dispatch_notify_completion",
  "dispatch_spawn_worker_agent"
]);

export const TOOLS_REQUIRING_MANUAL_APPROVAL = new Set<string>([
  "dispatch_to_session",
  "dispatch_broadcast",
  "dispatch_spawn_worker_agent",
  "files_write",
  "files_patch",
  "files_copy",
  "files_move"
]);

export const BUILT_IN_TOOLS_REQUIRING_HOOK_APPROVAL = new Set<string>([
  "exec",
  "apply_patch",
  "browser"
]);

export const CALENDAR_TOOL_NAMES = [
  "calendar_list_events",
  "calendar_create_event",
  "calendar_update_event",
  "calendar_find_free",
  "calendar_brief"
] as const;

export const CALENDAR_COMMAND_NAMES = ["/calendar", "/meetings"] as const;

export const WEB_TOOL_NAMES = [
  "web_search_news",
  "web_scrape_profile",
  "web_monitor_page",
  "web_enrich_contact",
  "web_track_jobs",
  "web_competitive_intel"
] as const;

export const WEB_COMMAND_NAMES = ["/web", "/intel"] as const;

export const CRM_TOOL_NAMES = [
  "crm_add_contact",
  "crm_update_contact",
  "crm_list_pipeline",
  "crm_move_stage",
  "crm_add_note",
  "crm_search",
  "crm_digest"
] as const;

export const CRM_COMMAND_NAMES = ["/crm", "/pipeline"] as const;

export const DOCUMENT_TOOL_NAMES = [
  "document_ingest", "document_extract_clauses", "document_analyze_compliance",
  "document_compare", "document_generate_report"
] as const;
export const DOCUMENT_COMMAND_NAMES = ["/document", "/analyze"] as const;

export const SOCIAL_TOOL_NAMES = [
  "social_like",
  "social_comment",
  "social_repost",
  "social_post",
  "social_follow",
  "social_scan_feed",
  "social_digest"
] as const;

export const SOCIAL_COMMAND_NAMES = ["/social", "/engage"] as const;

export const TIME_TOOL_NAMES = [
  "time_list_entries",
  "time_create_entry",
  "time_summary",
  "time_sync"
] as const;

export const TIME_COMMAND_NAMES = ["/time", "/timesheet"] as const;

export const DRIVE_TOOL_NAMES = [
  "drive_list_files",
  "drive_download_file",
  "drive_watch_folder",
  "drive_sync_folder"
] as const;

export const DRIVE_COMMAND_NAMES = ["/drive", "/gdrive"] as const;
