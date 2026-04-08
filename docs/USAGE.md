# Jarvis — Usage Guide

Jarvis is an autonomous agent system for Thinking in Code. It runs 8 production agents: orchestrator, self-reflection, regulatory-watch, knowledge-curator, proposal-engine, evidence-auditor, contract-reviewer, and staffing-monitor.

Claude Code is the interactive runtime. Jarvis provides domain knowledge, state persistence (SQLite), and agent definitions (skill files). For autonomous execution, Jarvis also runs as an OpenClaw plugin pack with a full job queue and worker pool.

---

## Prerequisites

- **Node.js 22+** — Required for `node:sqlite` built-in. Check: `node --version`
- **npm 10+** — Check: `npm --version`
- **Claude Code CLI** — Installed and authenticated: `claude --version`
- **Gmail MCP** (optional) — For email-enabled agents (orchestrator, staffing-monitor)
- **Chrome MCP** (optional) — For browser-enabled agents (orchestrator, regulatory-watch)

---

## First-Time Setup

```bash
# 1. Install dependencies
npm install

# 2. Initialize databases (~/.jarvis/crm.db + ~/.jarvis/knowledge.db)
npx tsx scripts/init-jarvis.ts

# 3. Verify everything works
npm run check     # 1159 tests, 0 errors

# 4. Check system health
/health           # (in Claude Code session)
```

The init script creates:
- `~/.jarvis/crm.db` — CRM pipeline with 5 seed contacts
- `~/.jarvis/knowledge.db` — Knowledge base with domain documents and playbooks

---

## Running Agents (Slash Commands)

Open Claude Code in this directory, then use these slash commands:

### `/orchestrator` — Workflow Orchestrator
Coordinates multi-step workflows across agents, including BD pipeline activities.

**What it does:**
1. Receives high-level workflow requests (BD outreach, content planning, etc.)
2. Decomposes into sub-tasks and delegates to appropriate agents
3. Manages cross-agent state and handoffs
4. Aggregates results into unified digests
5. Handles approval routing for delegated actions

**Approval gate:** Inherits approval gates from delegated sub-tasks.

**Run time:** Varies by workflow complexity

---

### `/self-reflection` — Self-Reflection & Improvement
Reviews past agent runs and extracts improvement opportunities.

**What it does:**
1. Analyzes recent run logs for patterns (failures, slow steps, low-quality outputs)
2. Identifies recurring issues and root causes
3. Suggests prompt or workflow improvements
4. Updates agent memory with lessons learned
5. Generates a weekly improvement report

**No approval gate** — this agent is analysis only.

---

### `/regulatory-watch` — Regulatory & Standards Watch
Monitors automotive safety standards and regulatory developments.

**What it does:**
1. Scans regulatory bodies for new publications (ISO, SAE, UNECE)
2. Tracks updates to ISO 26262, ISO 21434, ASPICE, AUTOSAR standards
3. Monitors industry news for regulatory changes affecting clients
4. Classifies findings by impact level and relevance to active engagements
5. Generates a regulatory intelligence digest

**No approval gate** — this agent is analysis only.

---

### `/knowledge-curator` — Knowledge Base Curator
Maintains and enriches the knowledge base with curated content.

**What it does:**
1. Reviews recent agent outputs for knowledge-worthy content
2. Deduplicates and merges related knowledge entries
3. Updates entity graph with new relationships
4. Validates knowledge base consistency and freshness
5. Archives stale entries and flags gaps

**No approval gate** — this agent is analysis only.

---

### `/proposal-engine` — Proposal & Quote Generator
Analyzes an RFQ/SOW and builds a structured proposal.

**Usage:** Have the RFQ/SOW file path ready before running.

**What it does:**
1. Reads the RFQ/SOW document (PDF or DOCX)
2. Extracts work packages, maps in-scope vs out-of-scope items
3. Searches past proposals for similar engagements
4. Builds a quote structure with phases, rates, and delivery gates
5. Drafts a cover email with the proposal attached
6. Logs the proposal activity to the CRM

**Rate card reference:**
- Senior Safety Engineer: €130-180/h
- Safety Architect: €160-200/h
- Cyber Security Engineer: €120-160/h
- AUTOSAR Engineer: €140-180/h

**Approval gate:** Will ask for approval before sending the proposal email.

---

### `/evidence-auditor` — ISO 26262 Evidence Auditor
Scans a project directory for work products and checks compliance.

**Usage:** Have the project directory path ready.

**What it does:**
1. Scans the directory for work products (plans, specs, test reports, reviews)
2. Checks each against the ISO 26262 Part 6 checklist by ASIL level
3. Checks traceability: requirements → specs → tests → results
4. Produces a gap matrix (PRESENT/PARTIAL/MISSING/NOT_REQUIRED)
5. Generates a gate-readiness summary with severity ratings

**Output:** Gap matrix with CRITICAL/HIGH/MEDIUM/LOW severity ratings

---

### `/contract-reviewer` — NDA & Contract Reviewer
Analyzes an NDA, MSA, or SOW against Daniel's baseline terms.

**Usage:** Have the contract file path ready (PDF or DOCX).

**What it does:**
1. Reads the contract document
2. Extracts 12 clause categories (jurisdiction, IP, liability, non-compete, etc.)
3. Rates each clause GREEN/YELLOW/RED against baseline
4. Produces a SIGN/NEGOTIATE/ESCALATE recommendation
5. Suggests specific redline language for YELLOW/RED clauses

**Key baselines:**
- Jurisdiction: Romania or EU member state (US jurisdiction = RED)
- Confidentiality: Max 3 years post-engagement
- IP: Only specific SOW deliverables (broad IP assignment = RED)
- Liability cap: Total fees paid, preceding 3 months
- Payment: Net 30 from invoice

**No approval gate** — this agent is analysis only.

---

### `/staffing-monitor` — Engineer Utilization Monitor
Calculates team utilization and forecasts staffing gaps.

**What it does:**
1. Reads the staffing spreadsheet
2. Calculates utilization % per engineer (target: 85%)
3. Identifies engineers at risk: <70% (bench), >95% (burnout), <50% (escalate)
4. Forecasts gaps 4-6 weeks out based on engagements ending
5. Matches engineer skills to upcoming BD opportunities
6. Drafts a weekly utilization digest

**Approval gate:** Will ask for approval before sending the digest email.

**Staffing rules:**
- ASIL-D: primary engineer must have 5+ years ISO 26262 experience
- New engineers (<1 year): max 2 concurrent engagements
- No engineer sole point of contact on >2 client accounts

---

### `/health` — System Health Check
Quick overview of all systems.

Shows: database status, CRM pipeline counts, agent last-run times, pending approvals, Telegram config status.

---

## Viewing the Dashboard

Start the dashboard to get a visual interface:

```bash
# Production (serves on http://localhost:4242)
npm run dashboard

# Development (API on :4242, UI hot-reload on :4243)
npm run dashboard:dev
```

Open `http://localhost:4242` in your browser.

**Dashboard pages:**
- **Home** — 8 agent cards with status and "Run Now" buttons
- **CRM Pipeline** — Kanban board across all 7 stages
- **Knowledge Base** — Search and browse all stored documents
- **Decisions** — Audit trail of all agent actions
- **Schedule** — All 9 scheduled tasks with next-fire times

---

## Telegram Bot Setup

Get agent updates and approve actions from your phone.

### Step 1: Create your bot
1. Open Telegram → message `@BotFather`
2. Send `/newbot` → follow prompts → copy the bot token

### Step 2: Get your Chat ID
1. Start a conversation with your new bot (send it any message)
2. Open in browser: `https://api.telegram.org/bot{YOUR_TOKEN}/getUpdates`
3. Find `"chat": { "id": YOUR_CHAT_ID }` in the response

### Step 3: Create config file
```bash
mkdir -p ~/.jarvis
cat > ~/.jarvis/config.json << 'EOF'
{
  "telegram": {
    "bot_token": "123456:ABC-your-token-here",
    "chat_id": "987654321"
  }
}
EOF
```

### Step 4: Start the bot
```bash
npm run telegram-bot
```

### Available commands (from Telegram)
- `/status` — All agent last-run times + pending approvals
- `/crm` — Top 5 pipeline contacts by score
- `/orchestrator` — Trigger orchestrator
- `/regulatory` — Trigger regulatory watch
- `/proposal` — Trigger proposal engine
- `/knowledge` — Trigger knowledge curator
- `/approve <id>` — Approve a gated action
- `/reject <id>` — Reject a gated action
- `/help` — Command list

### How push notifications work
After each agent run, a digest is queued in the `notifications` table in `~/.jarvis/runtime.db`. The bot process sends it to your Telegram chat within 30 seconds. (Older skill files may still reference the deprecated `~/.jarvis/telegram-queue.json` path -- this is a legacy mechanism superseded by the DB-backed queue.)

### How approvals work via Telegram
For scheduled agents (those running automatically at 8am etc.), when they hit an approval gate, the bot sends:
```
⚠️ APPROVAL NEEDED
Agent: orchestrator
Action: email.send

[post preview...]

Reply:
/approve abc123
/reject abc123
```
Send `/approve abc123` to proceed, `/reject abc123` to skip.

For manually-run agents (you typing `/orchestrator` in Claude Code), the approval is handled interactively in the Claude Code session.

---

## Scheduled Automation

These agents run automatically without you doing anything:

| Agent | Schedule | What it does |
|---|---|---|
| evidence-auditor | Mondays 9:00 AM | Scan project for ISO 26262 gaps |
| staffing-monitor | Mondays 9:00 AM | Calculate team utilization |
| regulatory-watch | Mon/Thu 7:00 AM | Scan for standards and regulatory updates |
| knowledge-curator | Weekdays 6:00 AM | Curate and maintain knowledge base |
| self-reflection | Sundays 6:00 AM | Review past runs and extract improvements |

The scheduled-tasks MCP fires Claude Code sessions at these times. Results are pushed to Telegram if the bot is running.

**To check scheduled tasks:** Run `/health` — it shows task status.

**To disable a task temporarily:** You can pause it via the Claude Code scheduled-tasks MCP, or simply stop the scheduled task runner.

---

## CRM Usage

The CRM pipeline has 7 stages: prospect → qualified → contacted → meeting → proposal → negotiation → won/lost/parked

### Automatic updates
The `orchestrator` agent automatically:
- Adds new contacts when it finds trigger signals
- Updates scores when new signals appear
- Moves contacts to the next stage when appropriate (with approval)
- Logs notes after each interaction

### Manual operations
In a Claude Code session:
- "Add a contact: John Smith, Bosch, Head of Safety, john@bosch.com, source: LinkedIn"
- "Move Lindström to proposal stage with note: sent SOW draft"
- "Show me all contacts in the meeting stage"
- "Search CRM for Volvo"

### Via dashboard
Open `http://localhost:4242/crm` — drag cards between columns, click for detail panel, add notes inline.

---

## Knowledge Base

The knowledge base stores lessons, playbooks, and reference documents across collections.

### What gets stored automatically
- **lessons**: Key learnings after each BD pipeline and proposal run
- **case-studies**: Project fragments from evidence auditor runs
- **contracts**: Reviewed contract summaries from contract-reviewer
- **regulatory**: Standards and regulatory intelligence from regulatory-watch

### Manual search (Claude Code)
- "Search knowledge base for ASIL-D staffing rules"
- "Show me all playbooks"
- "What did we learn from the Volvo engagement?"

### Via dashboard
Open `http://localhost:4242/knowledge` — search bar + collection tabs.

### Direct SQL query
```bash
node -e "
const{DatabaseSync}=require('node:sqlite');
const{join}=require('path');
const kb=new DatabaseSync(join(require('os').homedir(),'.jarvis','knowledge.db'));
const results=kb.prepare(\"SELECT title, collection FROM documents WHERE content LIKE ? LIMIT 10\").all('%ASIL-D%');
console.log(JSON.stringify(results,null,2));
kb.close();
"
```

---

## Troubleshooting

**Database missing or corrupted:**
```bash
rm ~/.jarvis/crm.db ~/.jarvis/knowledge.db
npx tsx scripts/init-jarvis.ts
```

**Skill not found (Unknown skill: xxx):**
- Ensure the file exists: `ls .claude/skills/`
- Check the frontmatter has `user_type: invocable`
- Restart Claude Code if you just added the file

**Gmail MCP not connected:**
- Open Claude Code Settings → MCP → verify Gmail integration is listed and enabled
- For orchestrator and staffing-monitor, the agent will skip Gmail steps if not connected

**Scheduled task not firing:**
- Run `/health` to check scheduled task status
- The scheduled-tasks MCP must be connected and running

**Telegram bot not responding:**
- Check `~/.jarvis/config.json` exists and has correct format
- Verify bot token: `curl https://api.telegram.org/bot{TOKEN}/getMe`
- Ensure you messaged the bot first (Telegram requires a user message before the bot can message you)

**`npm run check` fails:**
```bash
npm run build         # See TypeScript errors
npm test -- --reporter=verbose  # See test failures
npm run validate:contracts      # See schema errors
```

**Port 4242 already in use:**
```bash
PORT=4243 npm run dashboard
```
