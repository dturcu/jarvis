---
name: health
description: Show Jarvis system health — databases, agent last-run times, pending approvals
user_type: invocable
---

# Jarvis Health Check

You are running a quick health check on the Jarvis system.

## Workflow

### 1. Check databases

Run this to check CRM database:
```bash
node -e "
const{DatabaseSync}=require('node:sqlite');
const{join}=require('path');
const home=require('os').homedir();
const db=new DatabaseSync(join(home,'.jarvis','crm.db'));
const contacts=(db.prepare('SELECT COUNT(*) as n FROM contacts').get()).n;
const active=(db.prepare(\"SELECT COUNT(*) as n FROM contacts WHERE stage NOT IN ('won','lost','parked')\").get()).n;
const stages=db.prepare('SELECT stage, COUNT(*) as n FROM contacts GROUP BY stage ORDER BY n DESC').all();
db.close();
console.log(JSON.stringify({contacts,active,stages}));
"
```

Run this to check knowledge database:
```bash
node -e "
const{DatabaseSync}=require('node:sqlite');
const{join}=require('path');
const home=require('os').homedir();
const kb=new DatabaseSync(join(home,'.jarvis','knowledge.db'));
const docs=(kb.prepare('SELECT COUNT(*) as n FROM documents').get()).n;
const playbooks=(kb.prepare('SELECT COUNT(*) as n FROM playbooks').get()).n;
const decisions=(kb.prepare('SELECT COUNT(*) as n FROM decisions').get()).n;
const collections=kb.prepare('SELECT collection, COUNT(*) as n FROM documents GROUP BY collection ORDER BY n DESC').all();
const agentStats=kb.prepare('SELECT agent_id, MAX(created_at) as last_run FROM decisions GROUP BY agent_id ORDER BY last_run DESC').all();
kb.close();
console.log(JSON.stringify({docs,playbooks,decisions,collections,agentStats}));
"
```

### 2. Check pending approvals
```bash
node -e "
const fs=require('fs');
const{join}=require('path');
const home=require('os').homedir();
const p=join(home,'.jarvis','approvals.json');
if(!fs.existsSync(p)){console.log('0 pending approvals');process.exit(0);}
const approvals=JSON.parse(fs.readFileSync(p,'utf8'));
const pending=approvals.filter(a=>a.status==='pending');
if(pending.length===0){console.log('0 pending approvals');}
else{pending.forEach(a=>console.log(\`PENDING: [\${a.agent}] \${a.action} — ID: \${a.id.slice(0,8)}\`));}
"
```

### 3. Check Telegram config
```bash
node -e "
const fs=require('fs');
const{join}=require('path');
const home=require('os').homedir();
const p=join(home,'.jarvis','config.json');
if(!fs.existsSync(p)){console.log('NOT CONFIGURED');}
else{const c=JSON.parse(fs.readFileSync(p,'utf8'));console.log(c.telegram&&c.telegram.bot_token?'CONFIGURED':'MISSING bot_token');}
"
```

### 4. Format and present results

After running the above, present a clean health summary in this format:

```
JARVIS HEALTH CHECK — [TODAY'S DATE]

DATABASES:
  crm.db        ✓ [X] contacts total, [X] in active stages
  knowledge.db  ✓ [X] documents, [X] playbooks, [X] decisions logged

CRM PIPELINE:
  [stage]: [count]  (for each stage that has contacts)

KNOWLEDGE COLLECTIONS:
  [collection]: [count] docs  (for each collection)

AGENT LAST RUNS:
  [agent-id]:  [date/time or "never"]
  (show all 8 agents)

PENDING APPROVALS: [count]
  (list each pending approval if any)

TELEGRAM BOT: [CONFIGURED / NOT CONFIGURED]
  (if not configured: "Create ~/.jarvis/config.json with bot_token and chat_id")

DASHBOARD: http://localhost:4242
  (run: npm run dashboard)

SYSTEM OK ✓
```

If any database is missing or returns errors, show:
```
  crm.db        ✗ NOT FOUND — run: npx tsx scripts/init-jarvis.ts
```
