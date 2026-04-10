# Jarvis State Machines & Workflows Reference

> All state transitions and workflow definitions.
> Generated from source: 2026-04-10

---

## 1. Run State Machine

**Enforced by:** `RunStore` in `packages/jarvis-runtime/src/run-store.ts`
**Table:** `runs` in `runtime.db`

```
                    +-----------+
                    |  queued   |
                    +-----+-----+
                          |
                    +-----v-----+
              +---->| planning  |<----+
              |     +-----+-----+    |
              |           |          |
              |     +-----v--------+ |
              |     | executing    |-+
              |     +-----+--------+
              |           |
              |     +-----v-----------+
              +---->|awaiting_approval|
                    +-----+-----------+
                          |
                +---------+---------+
                |         |         |
          +-----v-+ +----v---+ +---v------+
          |completed| | failed | |cancelled |
          +--------+ +--------+ +----------+
```

### Valid Transitions

| From | To | Trigger |
|------|----|---------|
| `queued` | `planning` | Agent dequeued, planner starts |
| `queued` | `cancelled` | Manual cancel before start |
| `planning` | `executing` | Plan approved or auto-approved |
| `planning` | `awaiting_approval` | Plan requires operator approval |
| `planning` | `failed` | Planner error |
| `planning` | `cancelled` | Manual cancel |
| `executing` | `awaiting_approval` | Step requires approval |
| `executing` | `completed` | All steps finished |
| `executing` | `failed` | Step error, no retries |
| `executing` | `cancelled` | Manual cancel |
| `awaiting_approval` | `executing` | Approval granted |
| `awaiting_approval` | `failed` | Approval rejected or timeout |
| `awaiting_approval` | `cancelled` | Manual cancel |

**Terminal states:** `completed`, `failed`, `cancelled`

### Run Events Emitted

Each transition writes to `run_events` table:
- `run.queued` -- Run created
- `run.planning_started` -- Planner invoked
- `run.plan_ready` -- Plan generated
- `run.step_started` -- Step execution begins
- `run.step_completed` -- Step finished
- `run.approval_requested` -- Waiting for approval
- `run.approval_resolved` -- Approval received
- `run.completed` -- All steps done
- `run.failed` -- Error occurred
- `run.cancelled` -- Manual cancellation

---

## 2. Approval State Machine

**Enforced by:** approval logic in `packages/jarvis-runtime/src/`
**Table:** `approvals` in `runtime.db`

```
              +----------+
              |  pending |
              +----+-----+
                   |
          +--------+--------+
          |        |        |
    +-----v--+ +---v----+ +-v-------+
    |approved | |rejected| |expired  |
    +---------+ +--------+ +---------+
```

### Valid Transitions

| From | To | Trigger |
|------|----|---------|
| `pending` | `approved` | Operator approves via Telegram, Dashboard, or API |
| `pending` | `rejected` | Operator rejects |
| `pending` | `expired` | Timeout reached (default 4h, configurable per hook) |

**Terminal states:** `approved`, `rejected`, `expired`

### Operations

| Operation | Function | Description |
|-----------|----------|-------------|
| Request | `requestApproval()` | Creates approval in `pending` state |
| Resolve | `resolveApproval(id, status, resolvedBy)` | Transitions to approved/rejected/expired |
| Delegate | `delegateApproval(id, assignee, delegatedBy, note)` | Assigns to different operator |
| Wait | `waitForApproval(id, timeoutMs)` | Polls until resolved or timeout |

### Timeout Behavior

| Hook | Timeout | On Expire |
|------|---------|-----------|
| Built-in approval (exec, apply_patch, browser) | 300s (5m) | deny |
| Domain approval (email_send, crm_move_stage) | 600s (10m) | deny |
| Dashboard approvals | 14400s (4h) | fail run immediately |

### Approval Metrics

`getApprovalMetrics()` returns:
- `total`, `approved`, `rejected`, `expired`, `pending` counts
- `rejection_rate` -- percentage of rejections
- `avg_latency_ms` -- average time to resolve
- `by_action` -- rejection rate per action type
- `by_severity` -- breakdown by severity level

---

## 3. Job Status Machine

**Table:** `jobs` in `runtime.db` (migration 0011)

```
           +--------+
           | queued |
           +---+----+
               |
           +---v-----+
           | running  |
           +---+------+
               |
     +---------+----------+
     |         |          |
+----v----+ +--v------+ +-v-----------+
|completed| | failed  | |awaiting_    |
+---------+ +---------+ |approval     |
                         +------+------+
                                |
                      +---------+--------+
                      |         |        |
                +-----v-+ +----v---+ +--v-------+
                |completed| | failed | |cancelled |
                +---------+ +--------+ +----------+
```

### Valid Transitions

| From | To | Trigger |
|------|----|---------|
| `queued` | `running` | Worker claims job |
| `queued` | `completed` | Instant completion (mock) |
| `queued` | `failed` | Claim error |
| `queued` | `cancelled` | Manual cancel |
| `running` | `completed` | Worker callback (success) |
| `running` | `failed` | Worker callback (error) |
| `running` | `cancelled` | Manual cancel |
| `running` | `awaiting_approval` | Action needs approval |
| `awaiting_approval` | `completed` | Approved + executed |
| `awaiting_approval` | `failed` | Rejected |
| `awaiting_approval` | `cancelled` | Cancel |

**Terminal states:** `completed`, `failed`, `cancelled`

---

## 4. Command Status Machine

**Table:** `agent_commands` in `runtime.db`

```
         +--------+
         | queued |
         +---+----+
             |
         +---v-----+
         | claimed  |
         +---+------+
             |
     +-------+-------+
     |               |
+----v-----+   +----v---+
| completed|   | failed |
+----------+   +--------+
```

### Valid Transitions

| From | To | Trigger |
|------|----|---------|
| `queued` | `claimed` | Daemon picks up command |
| `queued` | `cancelled` | Manual cancel |
| `claimed` | `completed` | Run finished |
| `claimed` | `failed` | Run error |

**Terminal states:** `completed`, `failed`, `cancelled`

---

## 5. SubGoal State Machine (Orchestrator DAG)

**Defined in:** `packages/jarvis-runtime/src/orchestration-types.ts`

```
         +---------+
         | pending |
         +----+----+
              |
     +--------+--------+
     |                  |
+----v----+       +----v----+
| running |       | skipped |
+----+----+       +---------+
     |
+----+--------+
|             |
+--v------+ +-v------+
|completed| | failed |
+---------+ +--------+
```

### Valid Transitions

| From | To | Trigger |
|------|----|---------|
| `pending` | `running` | All dependencies completed |
| `pending` | `skipped` | Dependency failed (cascade) |
| `running` | `completed` | Agent run succeeded |
| `running` | `failed` | Agent run failed |

**Terminal states:** `completed`, `failed`, `skipped`

**JobGraph status:** `planning` -> `executing` -> `completed` | `failed`

---

## 6. Notification Status Machine

```
+--------+     +------+
| pending | --> | sent |
+----+----+     +------+
     |
+----v----+
| failed  |
+---------+
```

---

## 7. Channel Thread Lifecycle

```
+--------+     +----------+     +----------+
| active | --> | resolved | --> | archived |
+--------+     +----------+     +----------+
```

---

## 8. Plugin Lifecycle

```
+--------+  <-->  +----------+
| active |        | disabled |
+---+----+        +----+-----+
    |                  |
    +------+  +--------+
           |  |
      +----v--v-+     +-------------+
      | failed  |     | uninstalled |
      +---------+     +-------------+
```

---

## 9. V1 Workflow Definitions

**Source:** `packages/jarvis-runtime/src/workflows.ts`

### contract-review

- **Agents:** contract-reviewer
- **Inputs:** document (file), jurisdiction (select: EU|US|UK|Other)
- **Outputs:** recommendation, risks (list), clause_analysis (table), next_actions (list)
- **Safety:** outbound_default=draft, preview_recommended=true, retry_safe=true

### rfq-analysis

- **Agents:** evidence-auditor, proposal-engine
- **Inputs:** document (file), scope (select: Full audit|Gap analysis only|Quote only)
- **Outputs:** summary, gap_matrix (table), recommendations (list)
- **Safety:** outbound_default=draft, preview_recommended=true, retry_safe=true

### staffing-check

- **Agents:** staffing-monitor
- **Inputs:** period (select: This week|Next 2 weeks|This month|This quarter)
- **Outputs:** utilization, gaps (list)
- **Safety:** outbound_default=blocked, retry_safe=true

### weekly-report

- **Agents:** evidence-auditor, staffing-monitor, regulatory-watch
- **Inputs:** week (date, defaults to current week)
- **Outputs:** summary, action_items (list)
- **Safety:** outbound_default=draft, retry_safe=true

### meeting-ingestion

- **Agents:** knowledge-curator
- **Inputs:** recording (file), engagement (text, optional)
- **Outputs:** minutes (document), action_items (list), attendees (list)
- **Safety:** outbound_default=blocked, retry_safe=true

### invoice-generation

- **Agents:** proposal-engine
- **Inputs:** engagement (text), milestone (text, optional)
- **Outputs:** invoice (document), cover_email (text)
- **Safety:** outbound_default=draft, preview_recommended=true, retry_safe=true

### document-ingestion

- **Agents:** knowledge-curator
- **Inputs:** document (file), collection (select: proposals|case-studies|contracts|playbooks|iso26262|regulatory|meetings)
- **Outputs:** ingestion_log, entities (list, optional)
- **Safety:** outbound_default=blocked, retry_safe=true

### regulatory-scan

- **Agents:** regulatory-watch
- **Inputs:** standards (text, optional, defaults to all)
- **Outputs:** findings (list), digest (document, optional)
- **Safety:** outbound_default=blocked, retry_safe=true

### self-review

- **Agents:** self-reflection
- **Inputs:** period_days (text, defaults to "7")
- **Outputs:** health_score (0-100), proposals (list), report (document)
- **Safety:** outbound_default=blocked, retry_safe=true

### Workflow Safety Rules

| Field | Type | Description |
|-------|------|-------------|
| `outbound_default` | `"draft"` \| `"blocked"` | Default outbound action |
| `preview_recommended` | boolean | Show preview before delivery |
| `retry_safe` | boolean | Safe to retry without side effects |
| `retry_requires_approval` | boolean | Re-run needs approval |
