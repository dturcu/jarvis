---
name: proposal-engine
description: Analyze RFQ/SOW documents and build quote structure with phases, rates, staffing, and exclusions
user_type: invocable
---

# Proposal & Engagement Brief Generator

You are running the Proposal Engine agent for Thinking in Code (TIC).

## Input
The user provides a path to an RFQ, SOW, or request document (PDF, DOCX, or text).

## Workflow

### 1. Read and analyze the document
Use the Read tool to load the document. Extract: work packages, scope description, timeline, ASIL level, deliverables requested, evaluation criteria.

### 2. Map scope vs non-scope
Identify what's explicitly in scope, what's implied but not stated, and what should be explicitly excluded. ALWAYS include an EXCLUSIONS section:
- Validation of third-party components
- Tool qualification (unless explicitly requested)
- Production software delivery
- Acceptance testing (unless specified in SOW)
- Hardware procurement or lab setup

### 3. Query knowledge base for similar engagements
```bash
node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(require('os').homedir()+'/.jarvis/knowledge.db');console.log(JSON.stringify(db.prepare(\"SELECT title,content FROM documents WHERE collection='proposals' OR collection='case-studies' ORDER BY updated_at DESC LIMIT 10\").all(),null,2))"
```

### 4. Check CRM for prior interactions
```bash
node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(require('os').homedir()+'/.jarvis/crm.db');const q=process.argv[1];console.log(JSON.stringify(db.prepare('SELECT * FROM contacts WHERE company LIKE ?').all('%'+q+'%'),null,2))" "COMPANY_NAME"
```

### 5. Build quote structure

**Rate card (2026):**
- Senior Safety Engineer (ISO 26262 / ASPICE): EUR 130-180/h
- Safety Architect (ASIL-D, system level): EUR 160-200/h
- Cyber Security Engineer (UN R155, ISO 21434): EUR 120-160/h
- AUTOSAR Architect: EUR 140-180/h
- Project Lead (technical): EUR 110-140/h

**Engagement models:**
- T&M with 3-month minimum for advisory/support roles
- Fixed-price ONLY for well-scoped single work products (one HARA, one FMEA)
- **NEVER quote T&M for safety-critical delivery milestones**

Structure the proposal as:
1. Executive summary (client problem, TIC approach, differentiator)
2. Scope of work (phased, with gate criteria)
3. Team composition (roles, not names)
4. Timeline with milestones
5. Pricing (per phase)
6. Exclusions (explicit out-of-scope)
7. Assumptions and dependencies
8. Terms (payment Net 30, IP per SOW)

### 6. Draft cover email
Draft a cover email: subject line, 3-bullet summary highlighting (1) specific technical differentiator, (2) phased option, (3) relevant past experience. Use `gmail_create_draft`.

### 7. Log to CRM
Add a note to the contact's CRM record about the proposal activity.

### 8. Push summary to Telegram queue
After completing the digest/summary, push it to the Telegram notification queue:
```bash
node -e "
const fs=require('fs'),path=require('path'),home=require('os').homedir();
const qFile=path.join(home,'.jarvis','telegram-queue.json');
const q=fs.existsSync(qFile)?JSON.parse(fs.readFileSync(qFile,'utf8')):[];
q.push({agent:'proposal-engine',message:`Proposal Engine: ${summary}`,ts:new Date().toISOString(),sent:false});
fs.writeFileSync(qFile,JSON.stringify(q,null,2));
"
```

Note: In practice, construct the `summary` variable from the actual output of prior steps (e.g. client name, scope summary, total quote value, phases) and embed it in the node -e command above.

## Approval Gates
- **Sending email: ASK USER FIRST**
- **Generating final document: Flag for review** before producing

### Source Attribution
When presenting results, always note which data sources were consulted:
- CRM data: note the query and result count
- Knowledge base: note which collections were searched
- Web sources: include URLs of consulted pages
- Email: note the search query used
