# Retired edge functions

Supabase caps how many edge functions a project may have, and this one reached it. These six were
deleted on 5 Oct 2026 to make room, after checking that nothing in the app and nothing in `cron.job`
calls any of them.

Their source is kept here because deleting an edge function destroys it — none of these was in the
repo. Any of them can be put back by deploying the code below under the same slug.

Four of the six were already one-line stubs: somebody had neutralised them when the investigation
they were written for finished, but left them deployed, so they went on occupying a slot each and
answering the door while doing nothing.

---

## gemini-test  (verify_jwt: true)

A quality check on Gemini's output, finished and switched off.

```ts
// Gemini quality check complete. Disabled.
Deno.serve(() => new Response('disabled', { status: 410 }));
```

## gemini-models  (verify_jwt: true)

Asked Google which models this project's key may actually use, after `gemini-2.5-flash` began
answering 404 "no longer available to new users" and failed 65 of 77 lost-call transcriptions.
**Its answer is the reason `transcription-sync` and `resume-ai` use the `-latest` aliases**, which
is the part worth remembering.

```ts
// Disabled. This was a temporary diagnostic used to find out which Gemini models this project's key
// may actually use, after gemini-2.5-flash started returning 404 "no longer available to new users"
// and failed 65 of 77 lost-call transcriptions. The answer is recorded in transcription-sync, which
// now defaults to gemini-flash-lite-latest.
//
// Left deployed rather than deleted so the slug and its history stay intact, but it does no work and
// requires a signed-in caller. Re-enable only for another model investigation.
Deno.serve(() =>
  new Response(JSON.stringify({ disabled: true }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
);
```

## qual-test  (verify_jwt: false)

```ts
Deno.serve(()=>new Response(JSON.stringify({disabled:true}),{status:403,headers:{'content-type':'application/json'}}))
```

## meeting-tr-test  (verify_jwt: false)

```ts
Deno.serve(()=>new Response(JSON.stringify({disabled:true}),{status:403,headers:{'content-type':'application/json'}}))
```

## sdk-import-probe  (verify_jwt: false)

```ts
// Neutralised. This was a one-off probe used to find a Supabase SDK import that bundles.
Deno.serve(()=>new Response(JSON.stringify({disabled:true}),{status:403,headers:{'Content-Type':'application/json'}}));
```

## openai-key-check  (verify_jwt: false)

The only one still doing anything: it checked whether `CHATGPT_API_KEY` was set and could reach
OpenAI. Nothing in JAIN-E uses OpenAI now.

```ts
const cors={'Access-Control-Allow-Origin':'*'};
const j=(o:any,s=200)=>new Response(JSON.stringify(o,null,2),{status:s,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  const KEY=Deno.env.get('CHATGPT_API_KEY');
  if(!KEY) return j({configured:false, message:'CHATGPT_API_KEY secret is not set in Supabase'});
  try{
    const r=await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+KEY},
      body:JSON.stringify({model:'gpt-4o-mini',temperature:0,messages:[{role:'user',content:'Reply with exactly the word: pong'}]})
    });
    const jr=await r.json();
    if(!r.ok) return j({configured:true, working:false, status:r.status, error:jr.error||jr});
    const text=jr.choices?.[0]?.message?.content||'';
    return j({configured:true, working:true, model:'gpt-4o-mini', reply:text});
  }catch(e){ return j({configured:true, working:false, error:String((e as any)?.message||e)}); }
});
```

---

## Still deployed and still dead

Twenty-one more unreferenced diagnostics remain deployed, each holding a slot: the `adlib-*`
probes, several `s3-*` probes, `whisper-probe`, `gemini-mime-probe`, `tr-parse-diag`,
`flow-noun-test`, `flow-noun-backfill`, `comp-media-diag`, `meta-metric-probe`,
`gads-budget-test`, `debug-meet-check`, `mis-bulk-sync`, `legal-import-temp`, `tr-bulk-retry`,
`mcp-refresh` and others. They were left alone rather than swept up unasked. The next time this
limit bites, they are where the room is.

---

## meta-metric-probe  (retired 6 Nov 2026 - replaced by a locked stub, source: `meta-metric-probe.index.ts.txt`)

A finished one-off diagnostic that tried Graph API metric names one at a time. It was deployed with the
login check OFF, so anyone on the internet could make it use the Meta page token (about ten Graph calls per hit).
Nothing in the app, no cron job and nothing in 24 h of edge logs called it.

## meta-insights  (source: `meta-insights.index.ts.txt`; stub NOT deployed yet)

Served the old Campaign Analytics page. Deployed with the login check OFF: it answers anyone with spend, reach and
cost per lead for seven ad accounts, and `?nocache=1` forces a live Meta call each time. Nothing calls it any more
(Our Brand reads `camp.ads_daily`). The stub that replaces it was refused by the auto-mode classifier on 6 Nov 2026,
so the open version is still live - deploy `Deno.serve(() => new Response('disabled', { status: 410 }));` under the
slug `meta-insights` with verify_jwt ON.
