import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

function json(body: any) {
  return new Response(JSON.stringify(body), { headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const PORTAL_KNOWLEDGE = `You are JAIN-E, the AI assistant for The Jain Group's internal operations portal. Answer concisely and helpfully. Format with HTML bold tags for emphasis where useful.

BUILT MODULES:
- Dashboard: KPIs overview — Active Projects (6: Dream Valley Ph-2, Jain Heights, Green Acres, Royal Enclave, Trade Centre, Siliguri), collections, outstanding dues, tasks.
- Accountability: Tasks (solo tasks → Home 'My Tasks'; shared tasks with members → Tasks tab for all members), Goals (personal = yours only; team = members see it in Team Goals; company = everyone), Delegation (Delegate a task → appears in 'I've Assigned' for you, 'I've Been Assigned' for recipient), Home widgets (My Tasks, Assigned To Me, I've Assigned, My Goals, Activity Feed, charts). Tasks can carry a Tag (departmental, e.g. Admin/Sales/CRM under Systems) or be personal Self-task tags.
- Document Library: Upload any file (PDF, Word, Excel, PowerPoint, images — up to 5 GB). Organised by department then category/folder. Search by file name, title, doc number from the top nav bar or Help Desk. OCR indexes PDFs and images for internal text. To re-index click 'Index All Files'.
- Legal Vault: Stores land records, title deeds, sale deeds, RERA docs, government approvals, NOCs, court case files, agreements. Organised by category. Upload and search same as Document Library.
- Procurement: 4 tabs — Indent (purchase requests), Quote Comp (upload/download/preview/delete quotation comparison sheets; select one card to Edit/rename), PO (purchase orders), GRN (goods received).
- Recruitment: Tests tab (read-only table of 8 assessment links — Common Attitude, Accounts, Legal, Post Sales Admin, HR, Sales, Tele Sales, Legal New). Descriptions tab (8 default Job Description PDFs: General Manager Commercial, Executive PR, GM Sales & Marketing, Human Resource, Executive Sales, Litigation Officer, Accountant, Compliance Officer; upload more anytime).
- Construction: 3 tabs — Towers & Units (units per tower, sold count, stage), Construction Stages (% complete, target date, on-track/delayed), Work Orders (contractor, scope, amount, status).
- Control Panel (Admin only): Lists all users. New signups show amber 'New · needs setup' badge with 0 tabs. Click user to assign department (multiple allowed), level, and module checkboxes grouped by category. Save access to apply.
- Help Desk: Assistant tab (you — ask anything), Find a Document tab (search all uploaded docs + JD PDFs by name), My Tickets tab (raise a support ticket with subject/department/description).
- Profile: Set on first login — name, designation, department, reporting manager, delegation settings. Edit anytime from Settings → Edit profile.
- Sign out: Click your avatar/name in the top-right corner → Sign out from the dropdown.
- Navigation: Left sidebar groups modules. Top nav bar search finds documents by name across all libraries. JAIN-E logo → Home/Dashboard.

UNDER CONSTRUCTION (say exactly: 'This module is currently under construction — no further details can be provided.'): GTD, CRM & Sales, Maintenance & Assets, Finance Vault, Renewals & Compliance, Training & Resources, Video Library, Campaign Analytics, Scaling Up, Playbook, Customer Portal, Supplier Portal, WhatsApp Bot, Naren's Mail.

Be direct. If something is not in the portal, say so. If a module is under construction, say so.`;

const SYSTEM = PORTAL_KNOWLEDGE + `

STATUS & REPORTING TOOLS:
You also have live read-only tools into JAIN-E's real Accountability data (tasks, tags, departments, goals). Use them whenever someone asks about status, progress, what's overdue, what's assigned to them or someone else, how a tag/department is doing, or goal progress — call a tool rather than guessing or making up numbers. You may call more than one tool for a single question and combine the results in your answer.

You are strictly READ-ONLY. You cannot create, edit, delete, complete, reassign, or approve anything, even if asked directly — say so plainly, and point the person to the right screen in JAIN-E, or suggest they raise a ticket from the Help Desk 'My Tickets' tab. Never claim to have performed an action.

Only report what a tool actually returns. If a tool returns zero rows or an error, say so plainly instead of inventing numbers.`;

const TOOLS = [
  {
    name: 'get_task_summary',
    description: 'Overall Accountability task-status snapshot for one person: counts of open tasks assigned to them, open tasks they delegated to others, open self tasks, overdue tasks, tasks awaiting their approval, and tasks completed this week. Best first call for "what\'s my/their status" questions.',
    input_schema: {
      type: 'object',
      properties: {
        for_email: { type: 'string', description: 'Email of the person to summarize. Omit to summarize the person asking.' }
      }
    }
  },
  {
    name: 'list_tasks',
    description: 'List individual Accountability tasks for one person filtered by scope, with due date, status, and tag.',
    input_schema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['assigned_to_me', 'delegated_by_me', 'self', 'overdue', 'awaiting_approval'],
          description: "assigned_to_me = tasks where this person is a member; delegated_by_me = tasks this person handed to others; self = solo self-tasks; overdue = past due date and not yet approved; awaiting_approval = tasks this person delegated that are waiting on their sign-off"
        },
        for_email: { type: 'string', description: 'Whose tasks. Omit for the person asking.' },
        limit: { type: 'integer', description: 'Max rows to return, default 15, max 50' }
      },
      required: ['scope']
    }
  },
  {
    name: 'get_tag_status',
    description: 'Status breakdown of every task filed under one Accountability tag (e.g. "Admin", "Sales", "CRM") — counts open / awaiting approval / approved / overdue, plus a short list of the open ones.',
    input_schema: {
      type: 'object',
      properties: { tag_name: { type: 'string' } },
      required: ['tag_name']
    }
  },
  {
    name: 'get_department_status',
    description: 'Status breakdown aggregated across every tag belonging to one department (e.g. "Systems", "Sales", "Marketing") — total/open/overdue/approved task counts.',
    input_schema: {
      type: 'object',
      properties: { department: { type: 'string' } },
      required: ['department']
    }
  },
  {
    name: 'get_goal_status',
    description: 'Company, team, or personal Accountability goals and their progress percentage.',
    input_schema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['company', 'team', 'personal'] },
        for_email: { type: 'string', description: 'Only used with scope=personal; whose goals. Omit for the person asking.' }
      },
      required: ['scope']
    }
  }
];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ answer: 'AI assistant is not configured yet. Please contact your administrator.' });

  let question = '';
  try { ({ question } = await req.json()); } catch { return new Response('Bad request', { status: 400, headers: CORS }); }
  if (!question) return json({ answer: 'Please ask a question.' });

  // Reuse the caller's own session (already forwarded by the front-end as a real
  // Bearer access token) so every query below runs AS that person: RLS-scoped tables
  // (goals, tickets, etc.) automatically show only what they're actually allowed to see.
  const authHeader = req.headers.get('Authorization') || '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') as string;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') as string;
  const sb = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });

  let callerEmail = '';
  try {
    const { data } = await sb.auth.getUser();
    callerEmail = (data?.user?.email || '').toLowerCase();
  } catch (_e) { /* fall through with empty caller */ }

  const todayISO = () => new Date().toISOString().slice(0, 10);
  const startOfWeekISO = () => {
    const d = new Date();
    const day = d.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  };
  const uniqById = (arr: any[]) => arr.filter((t, i) => arr.findIndex((x) => x.id === t.id) === i);

  async function tasksForEmail(email: string) {
    const [{ data: asgRows }, { data: delegRows }] = await Promise.all([
      sb.schema('acc').from('ptask_assignees').select('task_id').eq('email', email),
      sb.schema('acc').from('ptasks').select('id,title,due_date,status,approval_state,approved_at,project_id,delegator').eq('delegator', email)
    ]);
    const assignedIds = (asgRows || []).map((r: any) => r.task_id);
    const { data: assignedTasks } = assignedIds.length
      ? await sb.schema('acc').from('ptasks').select('id,title,due_date,status,approval_state,approved_at,project_id,delegator').in('id', assignedIds)
      : { data: [] as any[] };
    return { assignedTasks: assignedTasks || [], delegatedTasks: delegRows || [], assignedIds };
  }

  async function tagName(id: number | null) {
    if (!id) return null;
    const { data } = await sb.schema('acc').from('projects').select('name').eq('id', id).maybeSingle();
    return data?.name || null;
  }

  async function runTool(name: string, input: any): Promise<any> {
    if (name === 'get_task_summary') {
      const email = (input.for_email || callerEmail || '').toLowerCase();
      if (!email) return { error: 'No email available for this request.' };
      const { assignedTasks, delegatedTasks, assignedIds } = await tasksForEmail(email);
      const isSelf = (t: any) => t.delegator === email && assignedIds.includes(t.id);
      const today = todayISO();
      const openAssigned = assignedTasks.filter((t: any) => !isSelf(t) && t.approval_state !== 'approved');
      const openDelegated = delegatedTasks.filter((t: any) => !isSelf(t) && t.approval_state !== 'approved');
      const selfOpen = assignedTasks.filter((t: any) => isSelf(t) && t.approval_state !== 'approved');
      const overdue = uniqById([...assignedTasks, ...delegatedTasks]).filter((t: any) => t.due_date && t.due_date < today && t.approval_state !== 'approved');
      const awaitingApproval = delegatedTasks.filter((t: any) => t.approval_state === 'awaiting_approval');
      const wk = startOfWeekISO();
      const completedThisWeek = uniqById([...assignedTasks, ...delegatedTasks]).filter((t: any) => t.approval_state === 'approved' && t.approved_at && t.approved_at >= wk);
      return {
        email,
        open_assigned_to_me: openAssigned.length,
        open_i_delegated: openDelegated.length,
        open_self_tasks: selfOpen.length,
        overdue_count: overdue.length,
        overdue_titles: overdue.slice(0, 10).map((t: any) => ({ title: t.title, due_date: t.due_date })),
        awaiting_my_approval: awaitingApproval.length,
        completed_this_week: completedThisWeek.length
      };
    }

    if (name === 'list_tasks') {
      const email = (input.for_email || callerEmail || '').toLowerCase();
      if (!email) return { error: 'No email available for this request.' };
      const limit = Math.min(Math.max(parseInt(input.limit) || 15, 1), 50);
      const { assignedTasks, delegatedTasks, assignedIds } = await tasksForEmail(email);
      const isSelf = (t: any) => t.delegator === email && assignedIds.includes(t.id);
      const today = todayISO();
      let rows: any[] = [];
      switch (input.scope) {
        case 'assigned_to_me': rows = assignedTasks.filter((t: any) => !isSelf(t)); break;
        case 'delegated_by_me': rows = delegatedTasks.filter((t: any) => !isSelf(t)); break;
        case 'self': rows = assignedTasks.filter((t: any) => isSelf(t)); break;
        case 'overdue': rows = uniqById([...assignedTasks, ...delegatedTasks]).filter((t: any) => t.due_date && t.due_date < today && t.approval_state !== 'approved'); break;
        case 'awaiting_approval': rows = delegatedTasks.filter((t: any) => t.approval_state === 'awaiting_approval'); break;
        default: return { error: 'Unknown scope' };
      }
      rows = rows.slice(0, limit);
      const withTags = await Promise.all(rows.map(async (t: any) => ({
        title: t.title,
        due_date: t.due_date,
        status: t.approval_state === 'approved' ? 'approved' : (t.approval_state === 'awaiting_approval' ? 'awaiting_approval' : 'open'),
        tag: await tagName(t.project_id)
      })));
      return { count: withTags.length, tasks: withTags };
    }

    if (name === 'get_tag_status') {
      const { data: proj } = await sb.schema('acc').from('projects').select('id,name').ilike('name', input.tag_name).maybeSingle();
      if (!proj) return { error: `No tag found matching "${input.tag_name}"` };
      const { data: tasks } = await sb.schema('acc').from('ptasks').select('id,title,due_date,approval_state').eq('project_id', proj.id);
      const today = todayISO();
      const list = tasks || [];
      const open = list.filter((t: any) => t.approval_state !== 'approved');
      const overdue = open.filter((t: any) => t.due_date && t.due_date < today);
      const approved = list.filter((t: any) => t.approval_state === 'approved');
      return {
        tag: proj.name,
        total_tasks: list.length,
        open: open.length,
        overdue: overdue.length,
        approved: approved.length,
        open_titles: open.slice(0, 10).map((t: any) => ({ title: t.title, due_date: t.due_date }))
      };
    }

    if (name === 'get_department_status') {
      const { data: projs } = await sb.schema('acc').from('projects').select('id,name').contains('department', [input.department]);
      const ids = (projs || []).map((p: any) => p.id);
      if (!ids.length) return { error: `No tags found for department "${input.department}"` };
      const { data: tasks } = await sb.schema('acc').from('ptasks').select('id,project_id,due_date,approval_state').in('project_id', ids);
      const today = todayISO();
      const list = tasks || [];
      const open = list.filter((t: any) => t.approval_state !== 'approved');
      const overdue = open.filter((t: any) => t.due_date && t.due_date < today);
      const approved = list.filter((t: any) => t.approval_state === 'approved');
      return {
        department: input.department,
        tags: (projs || []).map((p: any) => p.name),
        total_tasks: list.length,
        open: open.length,
        overdue: overdue.length,
        approved: approved.length
      };
    }

    if (name === 'get_goal_status') {
      let q = sb.schema('acc').from('goals').select('name,scope,owner,progress,status,end_date');
      if (input.scope === 'personal') {
        const email = (input.for_email || callerEmail || '').toLowerCase();
        q = q.eq('scope', 'personal').eq('owner', email);
      } else {
        q = q.eq('scope', input.scope);
      }
      const { data, error } = await q.limit(30);
      if (error) return { error: error.message };
      return {
        scope: input.scope,
        goals: (data || []).map((g: any) => ({ name: g.name, owner: g.owner, progress: g.progress, status: g.status, end_date: g.end_date }))
      };
    }

    return { error: 'Unknown tool' };
  }

  const messages: any[] = [{ role: 'user', content: question }];
  let finalText = '';
  try {
    for (let round = 0; round < 4; round++) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 800, system: SYSTEM, tools: TOOLS, messages })
      });
      const data = await res.json();
      const blocks = data?.content || [];
      const textPart = blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
      if (textPart) finalText = textPart;
      const toolUses = blocks.filter((b: any) => b.type === 'tool_use');
      if (data.stop_reason !== 'tool_use' || !toolUses.length) break;

      messages.push({ role: 'assistant', content: blocks });
      const toolResults = [];
      for (const tu of toolUses) {
        let result;
        try { result = await runTool(tu.name, tu.input || {}); } catch (e) { result = { error: String(e) }; }
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });
      }
      messages.push({ role: 'user', content: toolResults });
    }
  } catch (_e) { /* fall through to whatever finalText we have */ }

  return json({ answer: finalText || 'Sorry, I could not generate an answer right now.' });
});
