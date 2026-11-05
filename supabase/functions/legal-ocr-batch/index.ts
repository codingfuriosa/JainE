// Internal batch job: clears the backlog of un-indexed Legal documents using the SAME
// Gemini OCR pipeline as `document-ocr`. verify_jwt:true at the gateway, so it can only be called
// with a valid Supabase-signed key - an admin/maintenance job, like tr-bulk-retry.
// POST { limit?, only?, notices?, noticeLimit? }
//   -> { processed, indexed, empty, skipped, tooBig, errors, remaining, notices:{...} }
//   only: 'litigation' | 'projects' | '' (both)
//
// WHY THE LITIGATION ARCHIVE HAD NEVER BEEN READ, AND WHY THE JOB COULD NOT FINISH.
//
// 1. FILE TYPE IS STORED IN TWO SHAPES. Portal uploads record a short extension ('pdf'); the
//    Litigation archive was bulk-imported and recorded a full MIME type ('application/pdf'). The
//    job matched only the short form, so all ~590 Litigation files were invisible to it.
//
// 2. THE CANDIDATE QUERY WAS CAPPED at PostgREST's 1000 rows while Legal holds ~1350 readable
//    documents, so the most recently added could never be reached.
//
// 3. WORKING OUT WHAT WAS LEFT KILLED THE WORKER - it read content_text for every row, a column
//    holding up to 400,000 characters each. That question now belongs to the database.
//
// 4. AND SO DID THE FILES. Anything under 18MB was base64'd into a JSON request, holding it in
//    memory about three times over. Only genuinely small files go inline now; the rest are
//    uploaded as raw bytes, BUFFERED on purpose: a resumable upload needs a Content-Length.
//
// 5. AND A FILE IT COULD NOT READ WAS RETRIED FOREVER. Failures are now counted against the
//    document, and the database stops offering it after three.
//
// ---------------------------------------------------------------------------------------------
// SECOND JOB: READING LEGAL NOTICES.
//
// A notice uploaded to Legal > Legal Notice needs four FIELDS pulled off it - who sent it, who it
// concerns, what about, customer or government - and a task raised for the Legal team. A different
// question from "give me every word", so it is a separate pass with its own prompt and queue.
//
// It lives inside THIS function rather than its own because the project is at Supabase's 100-
// function ceiling, and because the S3 signing, the resumable upload and the failure accounting
// were already here. The two passes share no state; either can fail without touching the other.
//
// It sends the FILE, not content_text, because three of the four fields are facts about LAYOUT:
// the sender is "the name in the largest type at the top left", the clients are a numbered block,
// the subject is the line between them. OCR text has thrown all of that away.
//
// ONLY THE FIRST THREE PAGES ARE SENT. Everything wanted is on them - the letterhead, the "My
// Clients" block and the Sub: line are all front matter, and the rest of a notice is the argument.
// A 16.9MB scan took 55 seconds end to end, nearly all of it shipping pages nobody reads. Trimming
// happens here rather than in the prompt because the cost is the UPLOAD, not the inference:
// telling the model to ignore pages 4-40 still sends pages 4-40.
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { readDocument, CreditsError, TimeUp, WORD_TYPES } from "./ocr-reader.ts";
// A run may last about 400s; new 10-page blocks stop being started after this, leaving time to save.
const DEADLINE_MS = 300 * 1000;

const cors = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS' };
const j = (o:any,s=200)=> new Response(JSON.stringify(o),{status:s,headers:{...cors,'Content-Type':'application/json'}});
const MODEL='gemini-flash-latest';

const INLINE_MAX = 2 * 1024 * 1024;      // base64 inline: small files only
const FILE_MAX   = 45 * 1024 * 1024;     // past this there is no safe way to hold it here
const MIN_TEXT   = 20;
const NOTICE_PAGES = 3;                  // front matter is all a notice extraction needs

const GEMINI_MIME:Record<string,string>={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',heic:'image/heic',heif:'image/heif'};
const MIME_OK=new Set(['application/pdf','image/png','image/jpeg','image/jpg','image/webp','image/heic','image/heif']);

function extOf(name:string){return String(name||'').split('.').pop()!.toLowerCase();}
function rawKey(k:string){return String(k||'').replace(/^s3:/,'').replace(/^\/+/,'');}

function mimeFor(fileType:string, fileName:string):string|null{
  const t=String(fileType||'').trim().toLowerCase();
  if(t.indexOf('/')!==-1) return MIME_OK.has(t) ? (t==='image/jpg'?'image/jpeg':t) : null;
  if(t && GEMINI_MIME[t]) return GEMINI_MIME[t];
  return GEMINI_MIME[extOf(fileName)] || null;
}

async function signGet(key:string):Promise<string|null>{
  const bucket=Deno.env.get('S3_BUCKET'),region=Deno.env.get('S3_REGION'),ak=Deno.env.get('AWS_ACCESS_KEY_ID'),sk=Deno.env.get('AWS_SECRET_ACCESS_KEY');
  if(!bucket||!region||!ak||!sk)return null;
  const aws=new AwsClient({accessKeyId:ak,secretAccessKey:sk,region,service:'s3'});
  const encKey=key.split('/').map(encodeURIComponent).join('/');
  const u=new URL('https://'+bucket+'.s3.'+region+'.amazonaws.com/'+encKey);
  u.searchParams.set('X-Amz-Expires','3600');
  const signed=await aws.sign(u.toString(),{method:'GET',aws:{signQuery:true}});
  return signed.url;
}

/* Keep the first N pages and throw the rest away before anything is sent anywhere.
   Anything that is not a readable PDF - an image, an encrypted file, a damaged scan - is returned
   untouched and handled exactly as before. A notice must never be lost because trimming failed. */
async function firstPages(bytes:Uint8Array, n:number):Promise<{bytes:Uint8Array, pages:number|null, kept:number|null}>{
  try{
    const src=await PDFDocument.load(bytes,{ignoreEncryption:true});
    const total=src.getPageCount();
    if(total<=n) return {bytes,pages:total,kept:total};
    const out=await PDFDocument.create();
    const copied=await out.copyPages(src, Array.from({length:n},(_,i)=>i));
    copied.forEach(p=>out.addPage(p));
    return {bytes:new Uint8Array(await out.save()), pages:total, kept:n};
  }catch(_e){
    return {bytes,pages:null,kept:null};
  }
}

const PROMPT=`You are a precise OCR / text-extraction engine for a real-estate company's LEGAL document archive (Jain Group, Kolkata). This file is often an UNCLEAR or low-quality SCAN and may contain English, Hindi (Devanagari) and/or Bengali, sometimes handwriting and stamps.\nExtract ALL readable text from the document, verbatim, in natural reading order.\nRULES:\n- Keep the ORIGINAL script: English in English, Hindi in Devanagari, Bengali in Bengali.\n- Preserve names, plot/khatian/dag numbers, dates, amounts and registration numbers EXACTLY as written.\n- Include text from stamps, seals, headers, footers and tables if legible.\n- Do NOT summarise, translate, explain or add commentary. Output ONLY the extracted text.\n- If a part is illegible, skip it silently (do not write placeholders).`;

const NOTICE_PROMPT=`You are reading a LEGAL NOTICE received by Jain Group, a real-estate company in Kolkata.
You are given only the FIRST FEW PAGES, which is where all of this appears.
The file is usually a SCAN, often of poor quality, and may contain English, Hindi (Devanagari) or Bengali.
Return ONLY the four fields described below, as JSON. Do not summarise or explain.

1. header - WHO THE NOTICE IS FROM.
   It is the name printed in the LARGEST type at the TOP, usually top-LEFT, of the FIRST page.
   It is an advocate, a law firm, a company, or a government department or officer.
   Copy it EXACTLY as printed, including capitals. Example: "ABU SIDDIQUE MALLIK".
   It is NOT the recipient, NOT "Jain Group", and NOT any name further down the page.
   If there is a letterhead, the header is that letterhead's main name.

2. notice_type - one of exactly: "Customer", "Government", "Other".
   "Customer"   - sent on behalf of private individuals or a private company, usually by an
                  advocate. These almost always contain a "My Client" / "My Clients" line.
   "Government" - from a government body, municipal corporation, fire services, police,
                  pollution board, tax authority, court or similar.
   "Other"      - anything clearly neither.

3. parties - WHO THE NOTICE IS ABOUT. An array of plain names.
   If notice_type is "Customer":
     Find the "My Client:" or "My Clients:" line, which may run over several lines.
     The clients are NUMBERED (1., 2., ...). Take the name of the PERSON after each number.
     Strip the title (Mr., Mrs., Ms., Smt., Sri, Shri, Dr.) and strip any relation that follows -
     "S/o", "W/o", "D/o", "son of", "wife of" and the name after it belong to somebody ELSE.
     Example input:  "My Clients: 1. Mr. Waqar Ahmed, S/o Mr. Zulfiquar Ahmed 2. Mrs. Mumtaz Jahan Bano w/o Mr. Zulfiquar Ahmed"
     Example output: ["Waqar Ahmed", "Mumtaz Jahan Bano"]
     If the client is a COMPANY rather than people, give the company name in full as printed,
     keeping "M/s" and the suffix. Example: ["M/s Novex Communications Pvt. Ltd."].
   If notice_type is "Government":
     Give who the notice is ADDRESSED TO - the name in the "To" block, normally a Jain Group
     company or project. Example: ["Dream Eco City"].
     Give the organisation or project name, not the job title and not the postal address.
   If you genuinely cannot find any, return an empty array.

4. subject - the "Sub:", "Subject:", "Re:" or "Ref:" line, copied as printed, without the label.
   One line. If it runs over several lines, join them with a single space.
   If there is no such line, return "".

If a field cannot be read, use "" (or [] for parties). Never invent a value, and never write a
placeholder such as "unknown" or "N/A".`;

const NOTICE_SCHEMA={
  type:'object',
  properties:{
    header:{type:'string'},
    notice_type:{type:'string',enum:['Customer','Government','Other']},
    parties:{type:'array',items:{type:'string'}},
    subject:{type:'string'}
  },
  required:['header','notice_type','parties','subject']
};

async function readJson(r:Response, what:string){
  const t=await r.text();
  try{ return JSON.parse(t); }
  catch(_e){ throw new Error(what+' returned '+r.status+': '+t.slice(0,120)); }
}

async function geminiUpload(bytes:Uint8Array, mime:string, KEY:string){
  const start=await fetch('https://generativelanguage.googleapis.com/upload/v1beta/files?key='+KEY,{
    method:'POST',
    headers:{'X-Goog-Upload-Protocol':'resumable','X-Goog-Upload-Command':'start',
             'X-Goog-Upload-Header-Content-Length':String(bytes.length),
             'X-Goog-Upload-Header-Content-Type':mime,'Content-Type':'application/json'},
    body:JSON.stringify({file:{display_name:'document'}})});
  const uploadUrl=start.headers.get('X-Goog-Upload-URL');
  if(!uploadUrl) throw new Error('gemini upload start failed '+start.status+' '+(await start.text()).slice(0,120));
  const up=await fetch(uploadUrl,{method:'POST',
    headers:{'X-Goog-Upload-Command':'upload, finalize','X-Goog-Upload-Offset':'0'},
    body:bytes});
  const uj=await readJson(up,'gemini upload');
  let file=uj.file;
  for(let i=0;i<60&&file&&file.state==='PROCESSING';i++){
    await new Promise(r=>setTimeout(r,2000));
    const s=await fetch('https://generativelanguage.googleapis.com/v1beta/'+file.name+'?key='+KEY);
    file=await readJson(s,'gemini file status');
  }
  if(!file||file.state!=='ACTIVE')throw new Error('gemini file not active: '+(file&&file.state));
  return file;
}

/* Thinking is switched OFF for OCR (5 Nov 2026). The model behind "flash-latest" thinks by default, and on
   a scan it could think for minutes and spend the whole output budget there - a 70KB letter took over 150s
   and came back with no text at all. Copying text off a page needs no reasoning. Why a call came back empty
   (finishReason, blocked, tokens used) is written to the function log. */
async function geminiAsk(part:any, KEY:string, docId?:number){
  const body={contents:[{parts:[{text:PROMPT},part]}],
    generationConfig:{temperature:0,maxOutputTokens:60000,thinkingConfig:{thinkingBudget:0}}};
  const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+MODEL+':generateContent?key='+KEY,
    {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const jr=await readJson(r,'gemini');
  if(!r.ok)throw new Error('gemini '+r.status+' '+JSON.stringify(jr).slice(0,200));
  const c=(jr.candidates||[])[0]||{};
  const text=String(((c.content||{}).parts||[]).map((p:any)=>p.text||'').join('')||'');
  console.log('[legal-ocr] doc '+docId+': model='+(jr.modelVersion||MODEL)+' finish='+c.finishReason+' chars='+text.length
    +' usage='+JSON.stringify(jr.usageMetadata||{})+(jr.promptFeedback?' feedback='+JSON.stringify(jr.promptFeedback):''));
  return text;
}

/* Same call, different question and a forced JSON shape. responseSchema is what stops the model
   answering in prose on a document it found confusing - the one failure mode that would otherwise
   land unparsed text in a task title. */
async function geminiAskNotice(part:any, KEY:string){
  const body={contents:[{parts:[{text:NOTICE_PROMPT},part]}],
    generationConfig:{temperature:0,maxOutputTokens:2048,
                      responseMimeType:'application/json',responseSchema:NOTICE_SCHEMA}};
  const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+MODEL+':generateContent?key='+KEY,
    {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const jr=await readJson(r,'gemini');
  if(!r.ok)throw new Error('gemini '+r.status+' '+JSON.stringify(jr).slice(0,200));
  const txt=String(((((jr.candidates||[])[0]||{}).content||{}).parts||[]).map((p:any)=>p.text||'').join('')||'');
  try{ return JSON.parse(txt); }
  catch(_e){ throw new Error('model did not return JSON: '+txt.slice(0,160)); }
}

/* A title left on the front of a name defeats matching it to a customer later. The model is told
   to strip them; this is the belt to that braces, applied to whatever actually comes back. */
function tidyParty(s:any):string{
  let v=String(s==null?'':s).replace(/\s+/g,' ').trim();
  v=v.replace(/^(?:\d+\s*[.)]\s*)/,'');
  v=v.replace(/^(?:mr|mrs|ms|miss|smt|sri|shri|dr|prof)\.?\s+/i,'');
  v=v.replace(/[,;]\s*(?:s\/o|w\/o|d\/o|son of|wife of|daughter of)\b.*$/i,'');
  v=v.replace(/\s*\b(?:s\/o|w\/o|d\/o)\b.*$/i,'');
  return v.replace(/[,;.\s]+$/,'').trim();
}

/* Shared by both passes: sign, fetch, and hand back the bytes with the mime Gemini should be told. */
async function fetchDoc(db:any, storagePath:string, fileType:string, fileName:string){
  const mime=mimeFor(fileType,fileName);
  if(!mime) throw new Error('unsupported file type: '+fileType);
  const sp=String(storagePath);
  let url:string|null=null;
  if(sp.indexOf('s3:')===0){ url=await signGet(rawKey(sp)); }
  else { const {data}=await db.storage.from('documents').createSignedUrl(sp,600); url=data&&data.signedUrl||null; }
  if(!url) throw new Error('could not sign file url');
  const ar=await fetch(url);
  if(!ar.ok) throw new Error('fetch failed ('+ar.status+')');
  const bytes=new Uint8Array(await ar.arrayBuffer());
  return {bytes,mime};
}

Deno.serve(async (req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return j({error:'method not allowed'},405);
  const SB=Deno.env.get('SUPABASE_URL')!,SRV=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,KEY=Deno.env.get('GEMINI_API_KEY');
  if(!KEY)return j({error:'GEMINI_API_KEY not configured in Secrets'},500);
  const db=createClient(SB,SRV);
  let body:any={};try{body=await req.json();}catch(_e){}
  const limit=Math.min(Number(body.limit)||0,5);
  const only=String(body.only||'').toLowerCase();
  const doNotices=body.notices!==false;
  const noticeLimit=Math.min(Number(body.noticeLimit)||2,5);

  const report:any={processed:0,indexed:0,empty:0,skipped:0,tooBig:0,errors:[] as string[]};
  // Every outcome goes to the function log too: the HTTP reply is lost whenever the caller times out.
  const _push=report.errors.push.bind(report.errors);
  report.errors.push=(m:string)=>{ console.error('[legal-ocr] '+m); return _push(m); };

  // -------------------------------------------------------------------------------------------
  // PASS 1 - OCR the Legal archive. Unchanged. Skipped entirely when limit is 0, which is what an
  // upload-triggered call sends: a notice arriving must not drag the whole backlog along with it.
  // -------------------------------------------------------------------------------------------
  if(limit>0){
    const {data:pending,error:qerr}=await db.schema('doc')
      .rpc('legal_ocr_pending',{p_only:only,p_limit:limit});
    if(qerr) return j({error:'query failed: '+qerr.message},500);
    const docs:any[]=[...(pending||[])];
    // Word files are not in the database's queue (it lists what Gemini can take); they are claimed here.
    if(docs.length<limit){
      const cutoff=new Date(Date.now()-15*60000).toISOString();
      const {data:words}=await db.schema('doc').from('documents').select('id,storage_path,file_type,file_name,content_text,ocr_claimed_at')
        .eq('department','Legal').not('storage_path','is',null).in('file_type',WORD_TYPES).lt('ocr_attempts',3).limit(50);
      const {data:words0}=await db.schema('doc').from('documents').select('id,storage_path,file_type,file_name,content_text,ocr_claimed_at')
        .eq('department','Legal').not('storage_path','is',null).in('file_type',WORD_TYPES).is('ocr_attempts',null).limit(50);
      for(const w of [...(words||[]),...(words0||[])]){
        if(docs.length>=limit) break;
        if(w.content_text&&String(w.content_text).trim().length>=MIN_TEXT) continue;
        if(w.ocr_claimed_at&&w.ocr_claimed_at>cutoff) continue;
        await db.schema('doc').from('documents').update({ocr_claimed_at:new Date().toISOString()}).eq('id',w.id);
        docs.push(w);
      }
    }
    const ids=docs.map((d:any)=>d.id);
    const sizes:Record<number,number>={};
    if(ids.length){ const {data:sz}=await db.schema('doc').from('documents').select('id,file_size').in('id',ids); (sz||[]).forEach((x:any)=>{ sizes[x.id]=Number(x.file_size)||0; }); }

    const noteFailure=async (id:number)=>{
      try{ await db.schema('doc').rpc('legal_ocr_note_failure',{p_id:id}); }catch(_e){}
    };
    const started=Date.now();
    const work=async ()=>{
      for(const doc of docs){
        if(Date.now()>started+DEADLINE_MS){   // no time left for this one: hand it back untouched
          await db.schema('doc').from('documents').update({ocr_claimed_at:null}).eq('id',doc.id); continue;
        }
        report.processed++;
        try{
          const sp=String(doc.storage_path);
          let url:string|null=null;
          if(sp.indexOf('s3:')===0){ url=await signGet(rawKey(sp)); }
          else { const {data}=await db.storage.from('documents').createSignedUrl(sp,3600); url=data&&data.signedUrl||null; }
          if(!url) throw new Error('could not sign file url');
          // Where a big document got to last time (see ocr-reader.ts, TimeUp).
          const ppath='_ocr-progress/'+doc.id+'.json';
          let progress:any={};
          try{ const {data:pf}=await db.storage.from('documents').download(ppath); if(pf) progress=JSON.parse(await pf.text())||{}; }catch(_e){}
          if(progress.pages===200) progress={};   // counted by the first build, which guessed 200 - start over
          const ctx={deadline:started+DEADLINE_MS,progress,save:async ()=>{
            try{ await db.storage.from('documents').upload(ppath,new Blob([JSON.stringify(progress)],{type:'application/json'}),{upsert:true,contentType:'application/json'}); }catch(_e){}
          }};
          let text=await readDocument(url,doc.file_type,doc.file_name,sizes[doc.id]||0,KEY,doc.id,ctx);
          try{ await db.storage.from('documents').remove([ppath]); }catch(_e){}
          text=text.replace(/(\d),(?=\d)/g,'$1').replace(/\s+/g,' ').trim().slice(0,400000);
          if(text.length < MIN_TEXT){ report.empty++; console.error('[legal-ocr] doc '+doc.id+': no text found'); await noteFailure(doc.id); continue; }
          await db.schema('doc').from('documents')
            .update({content_text:text,updated_at:new Date().toISOString()}).eq('id',doc.id);
          report.indexed++; console.log('[legal-ocr] doc '+doc.id+': read '+text.length+' chars');
        }catch(e){
          if(e instanceof TimeUp){
            // Out of time, not failed: free it so the next run picks it straight up and carries on.
            console.log('[legal-ocr] doc '+doc.id+': '+e.message);
            await db.schema('doc').from('documents').update({ocr_claimed_at:null}).eq('id',doc.id);
            report.continuing=(report.continuing||0)+1; continue;
          }
          if(e instanceof CreditsError){
            // Not the document's fault: leave it untouched for a later run and stop asking.
            report.errors.push('doc '+doc.id+': '+e.message+' - stopping, will retry later');
            report.credits=true; break;
          }
          report.errors.push('doc '+doc.id+': '+String((e as any)?.message||e));
          await noteFailure(doc.id);
        }
      }
    };
    /* A big scan takes minutes - longer than any caller waits (150s). So the reading carries on in the
       background after the reply; { wait:true } keeps the old behaviour for a manual run. */
    if(body.wait){ await work(); }
    else { report.background=ids; (globalThis as any).EdgeRuntime?.waitUntil ? (globalThis as any).EdgeRuntime.waitUntil(work()) : await work(); }

    const {data:left}=await db.schema('doc').rpc('legal_ocr_remaining',{p_only:only});
    report.remaining=(typeof left==='number')?left:null;
  } else {
    report.remaining=null;
  }

  // -------------------------------------------------------------------------------------------
  // PASS 2 - read the legal notices and raise their tasks.
  // Wrapped whole: a notice that cannot be read must never stop the OCR report being returned.
  // -------------------------------------------------------------------------------------------
  const nrep:any={processed:0,extracted:0,failed:0,trimmed:[] as string[],errors:[] as string[]};
  if(doNotices){
    try{
      const {data:np,error:nerr}=await db.schema('acc').rpc('legal_notice_pending',{p_limit:noticeLimit});
      if(nerr) throw new Error('queue: '+nerr.message);

      const noteNoticeFailure=async (id:number,msg:string)=>{
        try{ await db.schema('acc').rpc('legal_notice_note_failure',{p_id:id,p_error:msg.slice(0,300)}); }catch(_e){}
      };

      for(const row of (np||[])){
        nrep.processed++;
        try{
          let {bytes,mime}=await fetchDoc(db,String(row.storage_path),row.file_type,row.file_name);
          const wholeMb=(bytes.length/1048576).toFixed(1);

          // Trim to the front matter before anything leaves this worker.
          if(mime==='application/pdf'){
            const t=await firstPages(bytes,NOTICE_PAGES);
            if(t.kept!==null && t.pages!==null && t.kept<t.pages){
              nrep.trimmed.push('notice '+row.id+': '+wholeMb+'MB/'+t.pages+'pp -> '
                + (t.bytes.length/1048576).toFixed(1)+'MB/'+t.kept+'pp');
            }
            bytes=t.bytes;
          }

          if(bytes.length>FILE_MAX){
            nrep.failed++;
            await noteNoticeFailure(row.id,Math.round(bytes.length/1048576)+'MB is too large to read here');
            await noteNoticeFailure(row.id,'too large'); await noteNoticeFailure(row.id,'too large');
            continue;
          }

          let out:any;
          if(bytes.length<=INLINE_MAX){
            out=await geminiAskNotice({inline_data:{mime_type:mime,data:encodeBase64(bytes)}},KEY);
          } else {
            const f=await geminiUpload(bytes,mime,KEY);
            out=await geminiAskNotice({file_data:{mime_type:f.mimeType||mime,file_uri:f.uri}},KEY);
          }

          const parties=Array.from(new Set(
            (Array.isArray(out.parties)?out.parties:[]).map(tidyParty).filter((s:string)=>s.length>1)
          ));
          const header=String(out.header||'').replace(/\s+/g,' ').trim().slice(0,300);
          const subject=String(out.subject||'').replace(/\s+/g,' ').trim().slice(0,1000);
          const ntype=['Customer','Government','Other'].indexOf(String(out.notice_type||''))>=0
                        ? String(out.notice_type) : 'Other';

          const {error:serr}=await db.schema('acc').rpc('legal_notice_save',{
            p_id:row.id, p_type:ntype, p_header:header,
            p_parties:parties, p_subject:subject, p_raw:out
          });
          if(serr) throw new Error('save failed: '+serr.message);
          nrep.extracted++;
        }catch(e){
          nrep.failed++;
          const msg=String((e as any)?.message||e);
          nrep.errors.push('notice '+row.id+': '+msg);
          await noteNoticeFailure(row.id,msg);
        }
      }

      const {data:nleft}=await db.schema('acc').rpc('legal_notice_pending',{p_limit:10});
      nrep.remaining=Array.isArray(nleft)?nleft.length:null;
    }catch(e){
      nrep.errors.push('notices pass: '+String((e as any)?.message||e));
    }
  }

  return j({ok:true,...report,notices:nrep});
});
