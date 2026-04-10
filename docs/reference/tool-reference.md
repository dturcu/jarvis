# Jarvis Tool Reference

> Complete parameter documentation for all 100+ tools across 19 plugins.
> Generated from source: 2026-04-10 | Contract version: `jarvis.v1`

---

## @jarvis/core

### jarvis_plan

Summarize the recommended Jarvis execution path for a goal.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `goal` | string | yes | -- | Goal to plan for (min length 1) |
| `preferredCapabilities` | string[] | no | -- | Preferred capabilities |
| `mustUseApprovals` | boolean | no | -- | Whether approvals are mandatory |

**Approval:** No

### jarvis_run_job

Queue a typed Jarvis worker job against the shared broker.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `type` | string (job type literal) | yes | -- | e.g., `"email.send"`, `"system.monitor_cpu"` |
| `input` | Record<string, unknown> | yes | -- | Job input payload |
| `artifactIds` | string[] | no | -- | Input artifact IDs |
| `priority` | `"low"` \| `"normal"` \| `"high"` \| `"urgent"` | no | `"normal"` | Job priority |
| `approvalId` | string | no | -- | Associated approval ID |

**Approval:** Conditional (if approvalId present)

### jarvis_get_job

Return a Jarvis job summary and current state.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `jobId` | string (UUID) | yes | -- | Job ID to query |

**Approval:** No

### jarvis_list_artifacts

List artifacts for a job or across all tracked jobs.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `jobId` | string (UUID) | no | -- | Filter by job ID |

**Approval:** No

### jarvis_request_approval

Create a Jarvis-managed approval request.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `title` | string | yes | -- | Approval title (min length 1) |
| `description` | string | yes | -- | Approval description (min length 1) |
| `severity` | `"info"` \| `"warning"` \| `"critical"` | no | `"warning"` | Severity level |
| `scopes` | string[] | no | -- | Approval scope tags |

**Approval:** No

---

## @jarvis/jobs

### job_submit

Submit a Jarvis worker job into the shared broker.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `type` | string (job type literal) | yes | -- | Job type |
| `input` | Record<string, unknown> | yes | -- | Job input data |
| `artifactIds` | string[] | no | -- | Input artifact IDs |
| `artifactsIn` | ArtifactRef[] | no | -- | Full artifact objects (`{artifact_id, name?, kind?, path?, path_context?, path_style?, checksum_sha256?, size_bytes?}`) |
| `priority` | `"low"` \| `"normal"` \| `"high"` \| `"urgent"` | no | `"normal"` | Priority |
| `approvalId` | string | no | -- | Associated approval |
| `requestedCommand` | string | no | -- | Specific command route |
| `capabilityRoute` | string | no | -- | Capability route hint |

**Approval:** Conditional

### job_status

Fetch current state for a queued or completed job.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `jobId` | string (UUID) | yes | -- | Job ID |

**Approval:** No

### job_cancel

Cancel a job that is still in flight.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `jobId` | string (UUID) | yes | -- | Job ID |
| `reason` | string | no | -- | Cancellation reason |

**Approval:** No

### job_artifacts

List artifacts for a specific job or all tracked jobs.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `jobId` | string (UUID) | no | -- | Filter by job |

**Approval:** No

### job_retry

Retry a completed, failed, or cancelled job.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `jobId` | string (UUID) | yes | -- | Job to retry |
| `approvalId` | string | no | -- | Associated approval |

**Approval:** Conditional

---

## @jarvis/dispatch

### dispatch_to_session

Send message to a single OpenClaw session.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `session_key` | string | yes | -- | Target session key |
| `text` | string | yes | -- | Message content |
| `job_id` | string | no | -- | Associated job |

**Approval:** Yes

### dispatch_followup

Send follow-up message tied to an existing job.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `job_id` | string | yes | -- | Job to follow up on |
| `text` | string | yes | -- | Follow-up content |

**Approval:** No

### dispatch_broadcast

Broadcast message to multiple sessions.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `session_keys` | string[] | yes | -- | Target sessions |
| `text` | string | yes | -- | Broadcast content |

**Approval:** Yes

### dispatch_notify_completion

Auto-notify session when job completes.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `job_id` | string | yes | -- | Job to watch |
| `session_key` | string | yes | -- | Session to notify |

**Approval:** No

### dispatch_spawn_worker_agent

Spawn a subagent in a target session.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `session_key` | string | yes | -- | Target session |
| `worker_type` | string | yes | -- | Worker type to spawn |
| `goal` | string | yes | -- | Agent goal |

**Approval:** Yes

---

## @jarvis/email

### email_search

Search inbox using Gmail query syntax.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | yes | -- | Gmail search syntax (from:, subject:, label:, etc.) |
| `max_results` | integer | no | 20 | 1-500 |
| `page_token` | string | no | -- | Pagination token |

**Approval:** No

### email_read

Read a specific email message by ID.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `message_id` | string | yes | -- | Message ID |
| `include_raw` | boolean | no | false | Include raw MIME source |

**Approval:** No

### email_draft

Create a new draft email without sending.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `to` | string[] | yes | -- | Recipients (min 1) |
| `subject` | string | yes | -- | Subject line |
| `body` | string | yes | -- | Plain-text body |
| `cc` | string[] | no | -- | CC recipients |
| `reply_to_message_id` | string | no | -- | Reply-to message ID |

**Approval:** No

### email_send

Send an existing draft or compose and send a new email.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `draft_id` | string | no | -- | Draft ID to send |
| `to` | string[] | no | -- | Recipients for inline compose |
| `subject` | string | no | -- | Subject for inline compose |
| `body` | string | no | -- | Body for inline compose |
| `cc` | string[] | no | -- | CC recipients |
| `reply_to_message_id` | string | no | -- | Reply-to message ID |

**Approval:** Yes (always)

### email_label

Apply or remove Gmail labels from a message.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `message_id` | string | yes | -- | Message ID |
| `action` | `"add"` \| `"remove"` | yes | -- | Label action |
| `labels` | string[] | yes | -- | Label names (min 1) |

**Approval:** No

### email_list_threads

List email threads, optionally filtered.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | no | -- | Filter query |
| `max_results` | integer | no | 20 | 1-500 |

**Approval:** No

---

## @jarvis/calendar

### calendar_list_events

List events in a date range with optional search.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `calendar_id` | string | no | `"primary"` | Calendar ID |
| `start_date` | string (ISO) | yes | -- | Range start |
| `end_date` | string (ISO) | yes | -- | Range end |
| `max_results` | integer | no | 50 | 1-500 |
| `query` | string | no | -- | Text search filter |

**Approval:** No

### calendar_create_event

Create a new calendar event.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `title` | string | yes | -- | Event title |
| `start` | string (ISO) | yes | -- | Start time |
| `end` | string (ISO) | yes | -- | End time |
| `description` | string | no | -- | Description/agenda |
| `location` | string | no | -- | Location or meeting link |
| `attendees` | string[] | no | -- | Attendee emails |
| `calendar_id` | string | no | `"primary"` | Target calendar |
| `send_invites` | boolean | no | -- | Send invites |

**Approval:** Yes (if sending invites)

### calendar_update_event

Modify an existing calendar event.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `event_id` | string | yes | -- | Event ID |
| `calendar_id` | string | no | -- | Calendar ID |
| `title` | string | no | -- | New title |
| `start` | string (ISO) | no | -- | New start |
| `end` | string (ISO) | no | -- | New end |
| `description` | string | no | -- | New description |
| `location` | string | no | -- | New location |
| `send_updates` | boolean | no | -- | Notify attendees |

**Approval:** Conditional

### calendar_find_free

Find available meeting slots for all attendees.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `attendees` | string[] | yes | -- | Attendee emails |
| `duration_minutes` | integer | yes | -- | Slot duration (min 5) |
| `start_search` | string (ISO) | yes | -- | Search window start |
| `end_search` | string (ISO) | yes | -- | Search window end |
| `working_hours_only` | boolean | no | -- | Restrict to 9am-6pm |

**Approval:** No

### calendar_brief

Generate a meeting preparation brief.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `event_id` | string | yes | -- | Event to brief |
| `calendar_id` | string | no | -- | Calendar ID |
| `include_history` | boolean | no | -- | Past interaction history |

**Approval:** No

---

## @jarvis/crm

### crm_add_contact

Add a new contact to the CRM pipeline.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | string | yes | -- | Full name |
| `company` | string | yes | -- | Company |
| `role` | string | no | -- | Job role/title |
| `email` | string | no | -- | Email address |
| `linkedin_url` | string | no | -- | LinkedIn URL |
| `source` | string | no | -- | Contact source (linkedin_scrape, web_intel, referral, direct) |
| `tags` | string[] | no | -- | Categorization tags |
| `notes` | string | no | -- | Initial notes |
| `stage` | enum | no | `"prospect"` | Pipeline stage |

**Approval:** No

### crm_update_contact

Update fields on an existing CRM contact.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `contact_id` | string | yes | -- | Contact ID |
| `name` | string | no | -- | New name |
| `company` | string | no | -- | New company |
| `role` | string | no | -- | New role |
| `email` | string | no | -- | New email |
| `tags` | string[] | no | -- | New tags |
| `score` | integer | no | -- | Engagement score (0-100) |
| `last_contact_at` | string (ISO) | no | -- | Last contact date |

**Approval:** No

### crm_list_pipeline

List contacts filtered by stage, tags, or score.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `stage` | enum | no | -- | Stage filter |
| `tags` | string[] | no | -- | Tag filters |
| `min_score` | integer | no | -- | Minimum score (0-100) |
| `limit` | integer | no | -- | Max results |

**Approval:** No

### crm_move_stage

Move a contact to a different pipeline stage.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `contact_id` | string | yes | -- | Contact ID |
| `new_stage` | enum | yes | -- | Target stage |
| `reason` | string | no | -- | Move reason |

**Approval:** No

### crm_add_note

Add an interaction note to a contact.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `contact_id` | string | yes | -- | Contact ID |
| `content` | string | yes | -- | Note content |
| `note_type` | `"call"` \| `"email"` \| `"meeting"` \| `"observation"` \| `"proposal"` \| `"general"` | no | `"general"` | Note type |

**Approval:** No

### crm_search

Full-text search across CRM contacts.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | yes | -- | Search query |
| `fields` | (`"name"` \| `"company"` \| `"notes"` \| `"tags"`)[] | no | all | Fields to search |
| `stage` | enum | no | -- | Stage filter |

**Approval:** No

### crm_digest

Generate a summary digest of the CRM pipeline.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `include_parked` | boolean | no | false | Include parked contacts |
| `days_since_contact` | integer | no | -- | Flag stale contacts (days) |

**Approval:** No

---

## @jarvis/web

### web_search_news

Search news and web for a company or topic.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | yes | -- | Search query |
| `max_results` | integer | no | 10 | 1-100 |
| `date_from` | string (ISO date) | no | -- | Filter by publish date |
| `sources` | string[] | no | -- | Preferred sources |

**Approval:** No

### web_scrape_profile

Extract profile data from a URL.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | yes | -- | URL to scrape |
| `profile_type` | `"company"` \| `"person"` \| `"job_posting"` | yes | -- | Profile type |
| `extract_fields` | string[] | no | -- | Specific fields |

**Approval:** No

### web_monitor_page

Check a web page for changes since last run.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | yes | -- | URL to monitor |
| `page_id` | string | yes | -- | Stable tracking ID |
| `selector` | string | no | -- | CSS selector to limit scope |

**Approval:** No

### web_enrich_contact

Enrich a contact record with web data.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | string | yes | -- | Full name |
| `company` | string | no | -- | Company |
| `email` | string | no | -- | Email |
| `linkedin_url` | string | no | -- | LinkedIn URL |

**Approval:** No

### web_track_jobs

Monitor job postings at target companies.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `company_names` | string[] | yes | -- | Companies to monitor (min 1) |
| `keywords` | string[] | yes | -- | Match keywords (min 1) |
| `max_per_company` | integer | no | -- | Max per company |

**Approval:** No

### web_competitive_intel

Gather competitive intelligence on a company.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `company_name` | string | yes | -- | Company to research |
| `aspects` | (`"products"` \| `"pricing"` \| `"team"` \| `"news"` \| `"customers"`)[] | no | all | Aspects to research |

**Approval:** No

---

## @jarvis/document

### document_ingest

Parse PDF, DOCX, TXT, or MD files and extract text.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file_path` | string | yes | -- | Path to document |
| `extract_structure` | boolean | no | false | Extract headings/sections |
| `extract_tables` | boolean | no | false | Extract tables |
| `max_pages` | integer | no | -- | Max pages to process |

**Approval:** No

### document_extract_clauses

Extract and classify clauses from contracts.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file_path` | string | no | -- | Path to document |
| `text` | string | no | -- | Raw text (requires file_path OR text) |
| `document_type` | `"nda"` \| `"msa"` \| `"sow"` \| `"contract"` \| `"agreement"` | no | -- | Document type |

**Approval:** No

### document_analyze_compliance

Analyze document compliance against safety standards.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file_path` | string | no | -- | Path to document |
| `text` | string | no | -- | Raw text (requires file_path OR text) |
| `framework` | `"iso_26262"` \| `"aspice"` \| `"iec_61508"` \| `"iso_21434"` | yes | -- | Compliance framework |
| `project_asil` | `"A"` \| `"B"` \| `"C"` \| `"D"` | no | -- | ASIL level |
| `work_product_type` | string | no | -- | e.g., "software_plan", "dv_report", "tsr", "dia" |

**Approval:** No

### document_compare

Compare two document versions.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file_path_a` | string | yes | -- | First document |
| `file_path_b` | string | yes | -- | Second document |
| `compare_mode` | `"full"` \| `"sections"` \| `"clauses"` | no | `"full"` | Comparison mode |

**Approval:** No

### document_generate_report

Generate a structured report from a template.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `template` | `"proposal"` \| `"evidence_gap"` \| `"compliance_summary"` \| `"nda_analysis"` \| `"custom"` | yes | -- | Template type |
| `data` | Record<string, unknown> | yes | -- | Template data |
| `output_format` | `"docx"` \| `"pdf"` \| `"markdown"` | yes | -- | Output format |
| `output_path` | string | yes | -- | Output file path |
| `title` | string | no | -- | Report title |

**Approval:** No

---

## @jarvis/device

### device_snapshot

Capture structured snapshot of current device state.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `includeWindows` | boolean | no | -- | Include window list |
| `includeDisplays` | boolean | no | -- | Include display info |
| `includeClipboard` | boolean | no | -- | Include clipboard |
| `includeActiveWindow` | boolean | no | -- | Include active window detail |
| `captureScreenshot` | boolean | no | -- | Take screenshot |
| `outputName` | string | no | -- | Screenshot artifact name |

**Approval:** No

### device_list_windows

List visible desktop windows.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `includeMinimized` | boolean | no | false | Include minimized |
| `titleContains` | string | no | -- | Title filter |
| `appId` | string | no | -- | App ID filter |

**Approval:** No

### device_open_app

Launch a desktop application.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `appId` | string | no | -- | App identifier |
| `executable` | string | no | -- | Executable path |
| `displayName` | string | no | -- | Display name |
| `arguments` | string[] | no | -- | Launch arguments |
| `waitForWindow` | boolean | no | -- | Wait for window to appear |

**Approval:** No

### device_focus_window

Bring a window to foreground.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `windowId` | string | no | -- | Window ID |
| `titleContains` | string | no | -- | Title match |
| `appId` | string | no | -- | App ID match |
| `strictMatch` | boolean | no | false | Exact match |

**Approval:** No

### device_screenshot

Capture screenshot.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `target` | `"desktop"` \| `"active_window"` \| `"window"` \| `"display"` \| `"region"` | no | `"desktop"` | Capture target |
| `windowId` | string | no | -- | Window to capture |
| `displayId` | string | no | -- | Display to capture |
| `region` | `{x, y, width, height}` | no | -- | Pixel region |
| `format` | `"png"` \| `"jpeg"` | no | `"png"` | Image format |
| `outputName` | string | yes | -- | Artifact name |

**Approval:** No

### device_click

Inject mouse click at coordinates.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `x` | number | yes | -- | X coordinate |
| `y` | number | yes | -- | Y coordinate |
| `coordinateSpace` | `"screen"` \| `"window"` | no | `"screen"` | Coordinate space |
| `windowId` | string | no | -- | Target window |
| `button` | `"left"` \| `"right"` \| `"middle"` | no | `"left"` | Mouse button |
| `clickCount` | integer | no | 1 | Click count (1-5) |

**Approval:** No

### device_type

Type text into current device.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `text` | string | yes | -- | Text to type |
| `mode` | `"insert"` \| `"replace"` \| `"paste"` | no | `"insert"` | Input mode |
| `submit` | boolean | no | false | Auto-submit (Enter) |
| `windowId` | string | no | -- | Target window |

**Approval:** No

### device_hotkey

Send keyboard shortcut.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `keys` | string[] | yes | -- | Key sequence (min 1) |
| `windowId` | string | no | -- | Target window |

**Approval:** No

### device_clipboard_get

Read current clipboard.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `format` | `"text"` \| `"html"` \| `"files"` \| `"image"` | no | `"text"` | Clipboard format |

**Approval:** No

### device_clipboard_set

Write to device clipboard.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `text` | string | no | -- | Text content |
| `artifactIds` | string[] | no | -- | Artifact references |
| `mode` | `"replace"` | no | `"replace"` | Write mode |

**Approval:** No

### device_notify

Send desktop notification.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `title` | string | yes | -- | Notification title |
| `body` | string | yes | -- | Notification body |
| `urgency` | `"low"` \| `"normal"` \| `"high"` | no | `"normal"` | Urgency level |

**Approval:** No

---

## @jarvis/files

### files_inspect

Inspect files or directories under an approved root.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `rootPath` | string | no | config root | Approved root |
| `paths` | string[] | yes | -- | Paths to inspect (min 1) |
| `recursive` | boolean | no | false | Recurse directories |
| `includeStats` | boolean | no | false | Include file stats |
| `previewLines` | integer | no | -- | Preview first N lines (1-100) |

**Approval:** No

### files_read

Read a file under an approved root.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `rootPath` | string | no | config root | Approved root |
| `path` | string | yes | -- | File path |
| `encoding` | `"utf8"` \| `"base64"` | no | `"utf8"` | Encoding |

**Approval:** No

### files_search

Search file names and content.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `rootPath` | string | no | config root | Approved root |
| `query` | string | yes | -- | Search query |
| `caseSensitive` | boolean | no | false | Case sensitive |
| `includeContents` | boolean | no | false | Search file contents |
| `maxResults` | integer | no | -- | Max results (1-500) |

**Approval:** No

### files_write

Write a file under an approved root.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `rootPath` | string | no | config root | Approved root |
| `path` | string | yes | -- | File path |
| `content` | string | yes | -- | File content |
| `encoding` | `"utf8"` \| `"base64"` | no | `"utf8"` | Encoding |
| `createDirectories` | boolean | no | false | Auto-create parent dirs |
| `overwrite` | boolean | no | false | Overwrite existing |
| `approvalId` | string | no | -- | Required approval ID |

**Approval:** Yes

### files_patch

Apply text replacements to a file.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `rootPath` | string | no | config root | Approved root |
| `path` | string | yes | -- | File path |
| `operations` | `{find, replace, all?}[]` | yes | -- | Replacement ops (min 1) |
| `encoding` | `"utf8"` \| `"base64"` | no | `"utf8"` | Encoding |
| `createDirectories` | boolean | no | false | Auto-create dirs |
| `approvalId` | string | no | -- | Required approval ID |

**Approval:** Yes

### files_copy

Copy a file within an approved root.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `rootPath` | string | no | config root | Approved root |
| `sourcePath` | string | yes | -- | Source path |
| `destinationPath` | string | yes | -- | Destination path |
| `createDirectories` | boolean | no | false | Auto-create dirs |
| `approvalId` | string | no | -- | Required approval ID |

**Approval:** Yes

### files_move

Move a file within an approved root.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `rootPath` | string | no | config root | Approved root |
| `sourcePath` | string | yes | -- | Source path |
| `destinationPath` | string | yes | -- | Destination path |
| `createDirectories` | boolean | no | false | Auto-create dirs |
| `approvalId` | string | no | -- | Required approval ID |

**Approval:** Yes

### files_preview

Preview first N lines of a file.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `rootPath` | string | no | config root | Approved root |
| `path` | string | yes | -- | File path |
| `lines` | integer | no | 12 | Lines to preview (max 200) |

**Approval:** No

---

## @jarvis/office

### office_inspect

Analyze Excel, Word, or PowerPoint file.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file_path` | string | yes | -- | Path to office file |
| `output_format` | `"summary"` \| `"json"` | no | `"summary"` | Output format |

**Approval:** No

### office_transform

Normalize spreadsheet (column select, rename, sheet).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file_path` | string | yes | -- | Input file |
| `output_path` | string | yes | -- | Output file |
| `sheet` | string \| integer | no | -- | Sheet name or index |
| `columns` | string[] | no | -- | Column selection |
| `rename` | Record<string, string> | no | -- | Column renames |
| `approvalId` | string | no | -- | Required approval |

**Approval:** Yes

### office_merge_excel

Combine multiple Excel files.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file_paths` | string[] | yes | -- | Files to merge (min 2) |
| `output_path` | string | yes | -- | Output file |
| `mode` | `"union"` \| `"append"` \| `"by_sheet"` | no | `"union"` | Merge mode |
| `deduplicate` | boolean | no | false | Remove duplicates |
| `approvalId` | string | no | -- | Required approval |

**Approval:** Yes

### office_fill_docx

Template substitution in Word document.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `template_path` | string | yes | -- | Template file |
| `output_path` | string | yes | -- | Output file |
| `variables` | Record<string, string> | yes | -- | Substitution variables |
| `strict` | boolean | no | true | Error on missing variables |
| `approvalId` | string | no | -- | Required approval |

**Approval:** Yes

### office_build_pptx

Generate PowerPoint presentation.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `output_path` | string | yes | -- | Output file |
| `title` | string | yes | -- | Presentation title |
| `slides` | SlideSpec[] | yes | -- | Slide specifications |
| `theme` | `"corporate_clean"` \| `"minimal_light"` \| `"minimal_dark"` \| `"executive_brief"` | no | `"corporate_clean"` | Visual theme |
| `approvalId` | string | no | -- | Required approval |

**Approval:** Yes

### office_extract_tables

Export tables from office files.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file_path` | string | yes | -- | Input file |
| `output_format` | `"json"` \| `"csv"` \| `"xlsx"` | no | `"json"` | Output format |
| `output_path` | string | no | -- | Output file (if csv/xlsx) |
| `sheet` | string \| integer | no | -- | Sheet selector |

**Approval:** No

### office_preview

Render preview of office file.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file_path` | string | yes | -- | Input file |
| `format` | `"png"` \| `"pdf"` \| `"html"` \| `"text"` | no | `"text"` | Preview format |
| `output_path` | string | no | -- | Output file |

**Approval:** No

---

## @jarvis/system

### system_monitor_cpu

Current CPU utilization.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `per_core` | boolean | no | false | Per-core breakdown |

**Approval:** No

### system_monitor_memory

Memory usage and top consumers.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `top_n` | integer | no | 10 | Top N consumers |

**Approval:** No

### system_monitor_disk

Disk usage by path or all volumes.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | string | no | -- | Specific path to check |

**Approval:** No

### system_monitor_network

Network interface statistics.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| (none) | | | | Returns all interfaces |

**Approval:** No

### system_monitor_battery

Battery status, charge, and time remaining.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| (none) | | | | Returns battery info |

**Approval:** No

### system_list_processes

List running processes.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `sort_by` | `"cpu"` \| `"memory"` \| `"name"` | no | `"cpu"` | Sort order |
| `filter` | string | no | -- | Name filter |
| `top_n` | integer | no | -- | Limit results |

**Approval:** No

### system_kill_process

Kill a running process.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `pid` | integer | no | -- | Process ID |
| `name` | string | no | -- | Process name (requires pid OR name) |
| `force` | boolean | no | false | Force kill |

**Approval:** Yes

### system_hardware_info

Full hardware information.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| (none) | | | | Returns CPU, GPU, memory, disk, network, display, battery |

**Approval:** No

---

## @jarvis/inference

### inference_chat

Route-based chat completion.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `messages` | `{role, content}[]` | yes | -- | Chat messages |
| `model` | string | no | config default | Model ID |
| `temperature` | number | no | -- | Sampling temperature |
| `maxTokens` | integer | no | -- | Max output tokens |

**Approval:** No

### inference_embed

Vector embeddings for text.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `texts` | string[] | yes | -- | Texts to embed |
| `model` | string | no | -- | Embedding model |

**Approval:** No

### inference_list_models

List available models across runtimes.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| (none) | | | | Probes LM Studio + Ollama |

**Approval:** No

### inference_rag_index

Index documents into a RAG collection.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `paths` | string[] | yes | -- | File paths to index |
| `collection` | string | yes | -- | Collection name |

**Approval:** No

### inference_rag_query

Retrieve top-K chunks from a RAG collection.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | yes | -- | Search query |
| `collection` | string | no | -- | Collection filter |
| `topK` | integer | no | 5 | Results to return |

**Approval:** No

### inference_batch_submit

Submit async batch job.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `jobs` | BatchJob[] | yes | -- | Batch job specifications |

**Approval:** No

### inference_batch_status

Query batch completion.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `batch_id` | string | yes | -- | Batch ID |

**Approval:** No

---

## @jarvis/scheduler

### scheduler_create_schedule

Create a recurring job on a cron expression or fixed interval.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `job_type` | string | yes | -- | Job type to schedule |
| `input` | Record<string, unknown> | yes | -- | Job input |
| `cron_expression` | string | no | -- | 5-field cron (minute hour dom month dow) |
| `interval_seconds` | integer | no | -- | Fixed interval (requires cron OR interval) |
| `scope_group` | string | no | -- | Schedule group |
| `label` | string | no | -- | Human label |

**Approval:** No

### scheduler_list_schedules

List schedules with optional filters.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `scope_group` | string | no | -- | Filter by group |
| `enabled` | boolean | no | -- | Filter by enabled state |

**Approval:** No

### scheduler_delete_schedule

Delete a schedule.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `schedule_id` | string | yes | -- | Schedule ID |

**Approval:** No

### scheduler_create_alert

Create threshold-based alert on job metrics.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `job_type` | string | yes | -- | Job type to monitor |
| `metric_path` | string | yes | -- | Dot-path metric (e.g., "cpu_percent") |
| `operator` | `"gt"` \| `"lt"` \| `"eq"` \| `"gte"` \| `"lte"` | yes | -- | Comparison |
| `threshold` | number | yes | -- | Threshold value |
| `label` | string | no | -- | Alert label |

**Approval:** No

### scheduler_create_workflow

Create multi-step job automation.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | string | yes | -- | Workflow name |
| `steps` | WorkflowStep[] | yes | -- | Step definitions |
| `label` | string | no | -- | Description |

**Approval:** No

### scheduler_run_workflow

Execute a workflow.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `workflow_id` | string | yes | -- | Workflow ID |

**Approval:** No

### scheduler_habit_track

Create, log, or delete habit entries.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `action` | `"create"` \| `"log"` \| `"delete"` | yes | -- | Habit action |
| `habit_id` | string | no | -- | Habit ID (required for log/delete) |
| `name` | string | no | -- | Habit name (required for create) |
| `frequency` | string | no | -- | Frequency (e.g., "daily") |

**Approval:** No

### scheduler_habit_status

Get habit completion stats.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `habit_id` | string | no | -- | Filter by habit |
| `days` | integer | no | 30 | Lookback window |

**Approval:** No

---

## @jarvis/security

### security_scan_processes

Scan running processes against whitelist.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| (none) | | | | Scans all processes |

**Approval:** No

### security_whitelist_update

Update process whitelist.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `action` | `"add"` \| `"remove"` | yes | -- | Whitelist action |
| `entries` | string[] | yes | -- | Process names or SHA-256 hashes |

**Approval:** No

### security_network_audit

Audit network connections.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| (none) | | | | Audits listening + established connections |

**Approval:** No

### security_file_integrity_check

Verify file hashes against baseline.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `paths` | string[] | yes | -- | Files to check |

**Approval:** No

### security_file_integrity_baseline

Record current file hashes as baseline.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `paths` | string[] | yes | -- | Files to baseline |

**Approval:** No

### security_firewall_rule

Manage Windows Firewall rules.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `action` | `"add"` \| `"remove"` \| `"list"` | yes | -- | Rule action |
| `name` | string | no | -- | Rule name (required for add/remove) |
| `direction` | `"inbound"` \| `"outbound"` | no | -- | Traffic direction |
| `protocol` | `"tcp"` \| `"udp"` | no | -- | Protocol |
| `port` | integer | no | -- | Port number |
| `action_type` | `"allow"` \| `"block"` | no | -- | Rule action type |

**Approval:** No

### security_lockdown

Emergency lockdown mode.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `level` | `"standard"` \| `"maximum"` | no | `"standard"` | Lockdown level |

**Approval:** Yes

---

## @jarvis/voice

### voice_listen

Capture microphone audio.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `duration_seconds` | integer | yes | -- | Duration (1-300) |
| `device` | string | no | -- | Audio device |

**Approval:** No

### voice_transcribe

Speech-to-text via Whisper.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `artifact_id` | string | yes | -- | Audio artifact |
| `language` | string | no | auto-detect | Language code |
| `model` | string | no | -- | Whisper model |

**Approval:** No

### voice_speak

Text-to-speech via Piper or SAPI.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `text` | string | yes | -- | Text to speak |
| `voice` | string | no | -- | Voice model |
| `speed` | number | no | 1.0 | Speed (0.5-3.0) |

**Approval:** No

### voice_wake_word_start

Start wake word detection.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `keyword` | string | yes | -- | Wake word |
| `sensitivity` | number | no | 0.5 | Detection sensitivity (0-1) |

**Approval:** No

### voice_wake_word_stop

Stop active wake word session.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| (none) | | | | Stops current session |

**Approval:** No

---

## @jarvis/browser

### browser_run_task

Execute Playwright automation task on target URL.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | yes | -- | Target URL |
| `task` | string | yes | -- | Task description |
| `approvalId` | string | no | -- | Approval ID |

**Approval:** Conditional

### browser_extract

Extract content from web page.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | yes | -- | Target URL |
| `format` | `"json"` \| `"markdown"` \| `"text"` \| `"html"` | no | `"text"` | Output format |
| `selector` | string | no | -- | CSS selector |
| `approvalId` | string | no | -- | Approval ID |

**Approval:** Conditional

### browser_capture

Screenshot or PDF of web page.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | yes | -- | Target URL |
| `format` | `"png"` \| `"pdf"` | no | `"png"` | Capture format |
| `fullPage` | boolean | no | false | Full page capture |
| `approvalId` | string | no | -- | Approval ID |

**Approval:** Conditional

### browser_download

Download file from URL.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | yes | -- | Download URL |
| `outputPath` | string | no | -- | Save location |

**Approval:** No

---

## @jarvis/interpreter

### interpreter_run_task

High-level multi-step automation via Open Interpreter.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `task` | string | yes | -- | Task description |

**Approval:** No

### interpreter_run_code

Execute code with timeout.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `language` | `"python"` \| `"javascript"` \| `"shell"` | yes | -- | Language |
| `code` | string | yes | -- | Code to execute |
| `timeout_seconds` | integer | no | 30 | Execution timeout |

**Approval:** No

### interpreter_status

List active sessions.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| (none) | | | | Returns active sessions |

**Approval:** No

---

## @jarvis/agent

### agent_start

Start an agent run.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `agent_id` | string | yes | -- | Agent to start |
| `goal` | string | no | -- | Optional goal override |
| `trigger` | string | no | `"manual"` | Trigger type |

**Approval:** No

### agent_step

Advance agent by one step.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `run_id` | string | yes | -- | Run to advance |

**Approval:** No

### agent_status

Get agent run status.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `run_id` | string | no | -- | Specific run |
| `agent_id` | string | no | -- | Filter by agent |

**Approval:** No

### agent_pause

Pause an executing agent.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `run_id` | string | yes | -- | Run to pause |

**Approval:** No

### agent_resume

Resume a paused agent.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `run_id` | string | yes | -- | Run to resume |

**Approval:** No

### agent_configure

Update agent runtime configuration.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `agent_id` | string | yes | -- | Agent to configure |
| `max_steps` | integer | no | -- | New max steps |
| `planner_mode` | `"single"` \| `"critic"` \| `"multi"` | no | -- | Planner mode |

**Approval:** No
