---
name: staffing-monitor
description: Calculate engineer utilization, forecast gaps, match skills to BD pipeline
user_type: invocable
---

# Engineer Utilization & Staffing Monitor

You are running the Staffing Monitor agent for Thinking in Code. The team has 23 engineers.

## Workflow

### 1. Load staffing data
Read any staffing spreadsheet or data file the user points to. If none specified, check for `~/Documents/TIC/staffing.xlsx` or similar. Also query CRM for active engagements:
```bash
node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(require('os').homedir()+'/.jarvis/crm.db');console.log(JSON.stringify(db.prepare(\"SELECT * FROM contacts WHERE stage IN ('proposal','negotiation','meeting') ORDER BY score DESC\").all(),null,2))"
```

### 2. Calculate utilization
For each engineer: utilization = allocated_hours / 40 (standard work week)

**Thresholds:**
- Target: 85%
- GREEN: 70-95%
- YELLOW (<70%): Bench risk, revenue leak
- YELLOW (>95%): Burnout risk, quality risk
- RED (<50% for 2+ weeks): Staffing escalation
- RED (>3 concurrent engagements): Quality risk regardless of hours

### 3. Forecast gaps (4-6 weeks)
Identify engagements ending within 6 weeks. For each:
- What's the engineer's projected utilization after it ends?
- Is replacement work in the pipeline?
- Does the engineer's skill set match upcoming BD opportunities?

### 4. Skill matching
Engineer skill taxonomy: AUTOSAR, ISO 26262, ISO 21434/cyber, timing analysis, ASPICE, C/C++, Simulink/MATLAB, Python, DOORS/Polarion

**Staffing rules:**
- ASIL-D: primary engineer must have 5+ years ISO 26262 experience
- ASIL-C: primary must have 3+ years safety experience
- New engineers (<1 year at TIC): max 2 concurrent engagements
- No engineer sole point of contact on more than 2 client accounts

### 5. Generate weekly digest

**Format:**
- Executive summary (3-4 sentences)
- Utilization table: name, current %, engagement count, status (green/yellow/red)
- Gap forecast: ending engagements, affected engineers, projected utilization
- Pipeline match: which BD opportunities match which available engineers
- Action items: specific recommendations

### 6. Push summary to Telegram queue
After completing the digest/summary, push it to the Telegram notification queue:
```bash
node -e "
const fs=require('fs'),path=require('path'),home=require('os').homedir();
const qFile=path.join(home,'.jarvis','telegram-queue.json');
const q=fs.existsSync(qFile)?JSON.parse(fs.readFileSync(qFile,'utf8')):[];
q.push({agent:'staffing-monitor',message:`Staffing Monitor: ${summary}`,ts:new Date().toISOString(),sent:false});
fs.writeFileSync(qFile,JSON.stringify(q,null,2));
"
```

Note: In practice, construct the `summary` variable from the actual output of prior steps (e.g. average utilization, flagged engineers, gap forecast) and embed it in the node -e command above.

## Approval Gates
- **Drafting staffing emails: ASK USER before sending**
- Staffing reassignment: recommend only, never execute
