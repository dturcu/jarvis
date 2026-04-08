# Lifecycle Diagrams

Visual state machines for core Jarvis concepts. All diagrams use [Mermaid](https://mermaid.js.org/) syntax.

## Run State Machine

A run is a single execution of an agent, from creation to terminal state.

```mermaid
stateDiagram-v2
    [*] --> queued : command received
    queued --> planning : scheduler picks up
    planning --> executing : plan approved / no gate
    planning --> awaiting_approval : plan requires approval
    awaiting_approval --> executing : operator approves
    awaiting_approval --> cancelled : operator rejects
    awaiting_approval --> failed : approval expires
    executing --> completed : all jobs succeed
    executing --> failed : unrecoverable error
    executing --> awaiting_approval : mid-run approval needed
    executing --> cancelled : operator cancels
    completed --> [*]
    failed --> [*]
    cancelled --> [*]
```

**Terminal states**: `completed`, `failed`, `cancelled`. All run state transitions are recorded in the `run_events` table for audit.

## High-Stakes Action Lifecycle

End-to-end flow from operator request through artifact delivery.

```mermaid
sequenceDiagram
    participant Operator
    participant Channel as Channel (Telegram / Dashboard)
    participant Kernel as Runtime Kernel
    participant Agent
    participant Queue as Job Queue
    participant Worker
    participant Delivery as Channel Delivery

    Operator->>Channel: /proposal-engine (command)
    Channel->>Kernel: command record
    Kernel->>Agent: create run (queued)
    Agent->>Agent: planning phase
    Agent->>Queue: submitJob(email.send, payload)
    Queue->>Kernel: approval required
    Kernel->>Channel: approval request
    Channel->>Operator: "Approve email send to X?"
    Operator->>Channel: /approve <id>
    Channel->>Kernel: approval granted
    Kernel->>Queue: release job
    Queue->>Worker: POST /jarvis/jobs/claim
    Worker->>Worker: execute job
    Worker->>Queue: POST /jarvis/jobs/callback (result)
    Queue->>Agent: job completed
    Agent->>Delivery: artifact (report, draft)
    Delivery->>Operator: result via channel
```

## Approval Flow

State machine for a single approval decision.

```mermaid
stateDiagram-v2
    [*] --> pending : approval created
    pending --> approved : operator approves
    pending --> rejected : operator rejects
    pending --> expired : TTL exceeded
    pending --> cancelled : run cancelled
    approved --> [*]
    rejected --> [*]
    expired --> [*]
    cancelled --> [*]
```

**Rules**:
- Approvals in `pending` state block the associated job from executing.
- Stale approvals do not auto-approve; they remain pending until explicitly resolved or expired.
- 17 job types always create approvals. 33 create approvals conditionally based on agent maturity and policy.
- Operators can resolve approvals via the dashboard API or Telegram bot (`/approve`, `/reject`).

## Job Lifecycle

State machine for a single job in the queue.

```mermaid
stateDiagram-v2
    [*] --> queued : submitJob()
    queued --> running : worker claims via POST /claim
    running --> running : heartbeat renews lease
    running --> completed : worker posts success callback
    running --> failed : worker posts failure callback
    running --> queued : lease expires (no heartbeat)
    completed --> [*]
    failed --> [*]
```

**Lease model**: Workers must send heartbeats to maintain their claim. If a worker crashes without sending a failure callback, the lease expires and the job returns to `queued` for another worker to claim.
