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

### 2. Check pending approvals (from runtime.db)
```bash
node -e "
const{DatabaseSync}=require('node:sqlite');
const{join}=require('path');
const home=require('os').homedir();
try{
  const db=new DatabaseSync(join(home,'.jarvis','runtime.db'));
  db.exec('PRAGMA journal_mode=WAL');
  const pending=db.prepare(\"SELECT approval_id, agent_id, action, severity, requested_at FROM approvals WHERE status='pending' ORDER BY requested_at DESC\").all();
  db.close();
  if(pending.length===0){console.log('0 pending approvals');}
  else{pending.forEach(a=>console.log('PENDING: ['+a.agent_id+'] '+a.action+' ('+a.severity+') — ID: '+a.approval_id.slice(0,8)));}
}catch(e){console.log('runtime.db not available: '+e.message);}
"
```

### 3. Check security posture
```bash
node -e "
const fs=require('fs');
const{join}=require('path');
const home=require('os').homedir();
const p=join(home,'.jarvis','config.json');
const checks=[];
if(!fs.existsSync(p)){checks.push('config: NOT FOUND');console.log(JSON.stringify(checks));process.exit(0);}
const c=JSON.parse(fs.readFileSync(p,'utf8'));
checks.push(c.telegram&&c.telegram.bot_token?'telegram: CONFIGURED':'telegram: MISSING');
checks.push(c.api_token||c.api_tokens?'api_auth: CONFIGURED':'api_auth: NOT SET — dashboard is read-only in dev mode');
checks.push(process.env.JARVIS_MODE==='production'?'mode: PRODUCTION':'mode: DEV');
console.log(JSON.stringify(checks));
"
```

### 4. Check daemon heartbeat
```bash
node -e "
const{DatabaseSync}=require('node:sqlite');
const{join}=require('path');
const home=require('os').homedir();
try{
  const db=new DatabaseSync(join(home,'.jarvis','runtime.db'));
  const row=db.prepare('SELECT status, last_seen_at FROM daemon_heartbeats ORDER BY last_seen_at DESC LIMIT 1').get();
  db.close();
  if(!row){console.log('NO HEARTBEAT FOUND');}
  else{const age=Math.round((Date.now()-new Date(row.last_seen_at).getTime())/1000);console.log(JSON.stringify({status:row.status,last_seen:row.last_seen_at,age_seconds:age,stale:age>120}));}
}catch(e){console.log('Cannot check heartbeat: '+e.message);}
"
```

### 5. Format and present results

After running the above, present a clean health summary in this format:

```
JARVIS HEALTH CHECK — [TODAY'S DATE]

DATABASES:
  crm.db        [ok/missing] [X] contacts total, [X] in active stages
  knowledge.db  [ok/missing] [X] documents, [X] playbooks, [X] decisions logged
  runtime.db    [ok/missing] daemon heartbeat: [age]s ago

CRM PIPELINE:
  [stage]: [count]  (for each stage that has contacts)

KNOWLEDGE COLLECTIONS:
  [collection]: [count] docs  (for each collection)

AGENT LAST RUNS:
  [agent-id]:  [date/time or "never"]

PENDING APPROVALS: [count]
  (list each pending approval if any)

SECURITY POSTURE:
  API auth:     [CONFIGURED / NOT SET]
  Telegram:     [CONFIGURED / NOT CONFIGURED]
  Mode:         [DEV / PRODUCTION]

DASHBOARD: http://localhost:4242
  (run: npm run dashboard)

SYSTEM OK / ISSUES FOUND
```

If any database is missing or returns errors, show:
```
  crm.db        NOT FOUND — run: npx tsx scripts/init-jarvis.ts
```
