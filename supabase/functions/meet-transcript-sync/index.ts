// Brings ONLINE (live Google Meet) meetings onto the same Gemini transcription pipeline that
// OFFLINE recordings already use (transcribe-pending). Two source artifacts, checked in order:
//   1) Google Meet's own "Transcript" artifact (conferenceRecords/*/transcripts) — text Google
//      already generated during the call. If present, Gemini's job is just cleanup/translation/
//      summary — same treatment offline transcripts get, applied to text instead of audio.
//   2) Google Meet's "Recording" artifact (conferenceRecords/*/recordings) — an actual video file
//      saved to the organizer's Google Drive. Downloaded and sent through the SAME multimodal
//      Gemini prompt transcribe-pending uses for offline audio.
// IMPORTANT CAVEAT: neither artifact exists unless someone clicked "Record" or "Transcript" inside
// Google Meet during the call — there is no API to force-start either for a live meeting. Verified
// live (2026-08-04) against 3 real completed online meetings: the API calls succeed (200), but all
// three came back with zero transcripts and zero recordings, because nobody turned them on. This
// function will do nothing until that changes for at least one meeting — recommend running one
// test call with Transcript (or Record) turned on to confirm the pipeline end-to-end.
// Runs on the same acc.meeting_logs table + transcript_status/transcript/transcript_en/summary
// columns as the offline flow — the two flows are otherwise independent.
//
// SOURCE SAVED INTO THE REPO 6 Nov 2026 (it was deployed only). ONE CHANGE from the deployed v23: giving up
// after 7 days used to write transcript_status 'no_artifact', which meeting_logs_transcript_status_check
// refuses (allowed: unavailable, pending, processing, transcribing, ready, failed, none). The error was never
// read, so the same five test logs were retried every 15 minutes forever. It now writes 'none', which is
// allowed and is not picked up again.
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const j=(o:any,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{...cors,'Content-Type':'application/json'}});
const MODEL='gemini-flash-latest';
const DEFAULT_TERMS='FarVision (a software; never "Fire Vision" or "for vision"), JAIN-E, Jain Group, CRM, RERA';
function fixName(s:any){return String(s||'').replace(/\b(gems?|jems?|gemms?)\s+group\b/gi,'Jain Group');}

async function ensureFreshToken(sb:any, tokRow:any, CLIENT_ID:string, CLIENT_SECRET:string){
  const expiry=tokRow.expiry?new Date(tokRow.expiry).getTime():0;
  if(expiry-Date.now()>60000) return tokRow.access_token;
  if(!tokRow.refresh_token) return null;
  const res=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:CLIENT_ID,client_secret:CLIENT_SECRET,refresh_token:tokRow.refresh_token,grant_type:'refresh_token'})});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||!data.access_token) return null;
  const newExpiry=new Date(Date.now()+(data.expires_in||3600)*1000).toISOString();
  await sb.schema('acc').from('google_tokens').update({access_token:data.access_token,expiry:newExpiry}).eq('email',tokRow.email);
  return data.access_token;
}
async function gget(url:string,tok:string){ const r=await fetch(url,{headers:{Authorization:'Bearer '+tok}}); const b=await r.json().catch(()=>({})); return {status:r.status, ok:r.ok, body:b}; }

const SCHEMA={type:'object',properties:{
  transcript_original:{type:'string'},transcript_en:{type:'string'},summary:{type:'string'},
  languages:{type:'array',items:{type:'string'}},num_speakers:{type:'integer'},key_points:{type:'array',items:{type:'string'}}
},required:['transcript_original','transcript_en','summary','num_speakers']};

function promptCommonRules(terms:string){
  return 'RULES: never loop or repeat — if someone repeats a phrase, write it at most once or twice as actually spoken; do NOT output the same sentence many times. Spell these terms exactly, correcting misheard variants: '+terms+'. The company is "Jain Group" — if you hear "Gems Group" or similar that is a mishearing.\n\n'
    +'Then fill: "summary" = 4-7 short bullet lines (each starting with "- ") covering what was discussed, decisions taken, and action items with owners, written in plain English; "key_points" = up to 6 very short phrases naming the topics/decisions; "languages" = the subset of en/hi/bn actually spoken; "num_speakers" = how many distinct people speak.';
}
// Path 1: Google already produced a text transcript during the call — Gemini's job is cleanup only.
function promptFromText(terms:string, raw:string){
  return 'Below is a RAW transcript that Google Meet automatically generated during an internal JAIN-E / Jain Group company meeting (sales, marketing, legal, CRM, real estate). It may be messy (misheard words, no punctuation) and may mix English, Hindi and Bengali.\n\n'
    +'RAW TRANSCRIPT:\n'+raw+'\n\n'
    +'Produce TWO complete cleaned-up versions, speaker-labelled ("Speaker 1:", "Speaker 2:", ...):\n'
    +'1) "transcript_original" — the SAME languages as spoken (Bengali in Bengali script, Hindi in Devanagari, English in English), just cleaned up (punctuation, obvious mis-transcriptions fixed), not translated.\n'
    +'2) "transcript_en" — a clean, natural ENGLISH translation of the entire conversation.\n\n'
    +promptCommonRules(terms);
}
// Path 2: an actual recording — same multimodal prompt transcribe-pending already uses for offline audio.
function promptFromAudio(terms:string){
  return 'This is a recording of an internal JAIN-E / Jain Group company meeting (sales, marketing, legal, CRM, real estate). The speech may mix English, Hindi and Bengali.\n\n'
    +'Produce TWO complete versions of the WHOLE conversation. Label every turn with a speaker ("Speaker 1:", "Speaker 2:", ...), one turn per line, and keep the same speaker numbering in both versions:\n'
    +'1) "transcript_original" — a faithful VERBATIM transcription in the languages actually spoken: Bengali in Bengali script, Hindi in Devanagari, English in English, exactly as it was code-switched. Do NOT translate anything here.\n'
    +'2) "transcript_en" — a clean, natural ENGLISH translation of the entire conversation.\n\n'
    +promptCommonRules(terms);
}
async function geminiCall(body:any,KEY:string){
  const url='https://generativelanguage.googleapis.com/v1beta/models/'+MODEL+':generateContent?key='+KEY;
  const delays=[0,4000,12000];
  let lastErr='gemini failed';
  for(let i=0;i<delays.length;i++){
    if(delays[i])await new Promise(r=>setTimeout(r,delays[i]));
    let rr:Response;
    try{ rr=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); }
    catch(e){ lastErr='network '+String((e as any)?.message||e); continue; }
    if(rr.ok) return await rr.json();
    const et=await rr.text().catch(()=>'');
    lastErr='gemini '+rr.status+' '+et.slice(0,160);
    if(rr.status===503||rr.status===429||rr.status>=500||/overloaded|high demand|unavailable/i.test(et)) continue;
    throw new Error(lastErr);
  }
  throw new Error(lastErr+' (still overloaded after retries)');
}
function extractResult(jr:any){
  const text=((((jr.candidates||[])[0]||{}).content||{}).parts||[]).map((p:any)=>p.text||'').join('');
  let p:any=null; try{ p=JSON.parse(text); }catch(_e){ const m=text.match(/\{[\s\S]*\}/); if(m){ try{ p=JSON.parse(m[0]); }catch(_e2){} } }
  return p;
}
async function saveResult(sb:any, logId:number, p:any){
  const orig=fixName(p.transcript_original).trim();
  const en=fixName(p.transcript_en).trim();
  let summary=fixName(p.summary).trim();
  if(Array.isArray(p.key_points)&&p.key_points.length){
    const kp=p.key_points.map((k:any)=>String(k||'').trim()).filter(Boolean);
    if(kp.length) summary=summary+'\n\nTopics: '+kp.join(' · ');
  }
  await sb.schema('acc').from('meeting_logs').update({
    transcript:en||orig, transcript_en:en||null, transcript_bn:orig||null, summary:summary||null,
    languages:Array.isArray(p.languages)?p.languages:null,
    num_speakers:(typeof p.num_speakers==='number'&&p.num_speakers>0)?p.num_speakers:null,
    transcript_status:'ready'
  }).eq('id',logId);
}

Deno.serve(async (req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  const SB=Deno.env.get('SUPABASE_URL')!,SRV=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const CLIENT_ID=Deno.env.get('GOOGLE_CLIENT_ID')!,CLIENT_SECRET=Deno.env.get('GOOGLE_CLIENT_SECRET')!;
  const KEY=Deno.env.get('GEMINI_API_KEY');
  if(!KEY)return j({ok:true,skipped:'GEMINI_API_KEY not set',processed:0});
  const terms=Deno.env.get('GROQ_TERMS')||DEFAULT_TERMS;
  const sb=createClient(SB,SRV);
  let limit=5; try{ const b=await req.json(); if(b&&b.limit)limit=Math.min(10,Math.max(1,Number(b.limit))); }catch(_e){}

  // 'unavailable' is the pre-existing sentinel this codebase already used for "online meeting,
  // no transcript" before this pipeline existed — treated the same as never-attempted (null) so
  // those rows get a real shot now instead of staying permanently stuck on the old assumption.
  const {data:rows}=await sb.schema('acc').from('meeting_logs')
    .select('id,google_conference_record,organizer_email,occurrence_date')
    .eq('mode','online').eq('attendance_status','fetched')
    .or('transcript_status.is.null,transcript_status.eq.unavailable')
    .not('google_conference_record','is',null)
    .order('occurrence_date',{ascending:true}).limit(limit);

  const results:any[]=[];
  for(const row of (rows||[])){
    try{
      const {data:tokRow}=await sb.schema('acc').from('google_tokens').select('*').eq('email',row.organizer_email).maybeSingle();
      if(!tokRow){ results.push({id:row.id,skipped:'not_connected'}); continue; }
      const tok=await ensureFreshToken(sb,tokRow,CLIENT_ID,CLIENT_SECRET);
      if(!tok){ results.push({id:row.id,skipped:'token_refresh_failed'}); continue; }
      const cr=row.google_conference_record;

      // Path 1: Google's own transcript
      const tr=await gget('https://meet.googleapis.com/v2/'+cr+'/transcripts',tok);
      const firstT=tr.ok && tr.body.transcripts && tr.body.transcripts[0];
      if(firstT){
        const entries=await gget('https://meet.googleapis.com/v2/'+firstT.name+'/entries?pageSize=500',tok);
        const lines=(entries.body.transcriptEntries||[]).map((e:any)=>(e.participant||'Speaker')+': '+(e.text||'')).join('\n');
        if(lines.trim()){
          const jr=await geminiCall({contents:[{parts:[{text:promptFromText(terms,lines)}]}],generationConfig:{temperature:0.15,maxOutputTokens:40000,responseMimeType:'application/json',responseSchema:SCHEMA}},KEY);
          const p=extractResult(jr);
          if(p){ await saveResult(sb,row.id,p); results.push({id:row.id,ok:true,source:'transcript'}); continue; }
        }
      }

      // Path 2: an actual Drive recording
      const rec=await gget('https://meet.googleapis.com/v2/'+cr+'/recordings',tok);
      const firstR=rec.ok && rec.body.recordings && rec.body.recordings[0];
      const fileId=firstR && firstR.driveDestination && firstR.driveDestination.file;
      if(fileId){
        const dl=await fetch('https://www.googleapis.com/drive/v3/files/'+fileId+'?alt=media',{headers:{Authorization:'Bearer '+tok}});
        if(!dl.ok){ results.push({id:row.id,error:'drive fetch '+dl.status}); continue; }
        const bytes=new Uint8Array(await dl.arrayBuffer());
        const jr=await geminiCall({contents:[{parts:[{text:promptFromAudio(terms)},{inline_data:{mime_type:'video/mp4',data:encodeBase64(bytes)}}]}],generationConfig:{temperature:0.15,maxOutputTokens:40000,responseMimeType:'application/json',responseSchema:SCHEMA}},KEY);
        const p=extractResult(jr);
        if(p){ await saveResult(sb,row.id,p); results.push({id:row.id,ok:true,source:'recording'}); continue; }
      }

      // Neither artifact exists yet. Only give up permanently once it's old enough that neither
      // will ever appear (Google typically finalizes artifacts within hours of the call ending).
      const ageDays=(Date.now()-new Date(row.occurrence_date).getTime())/86400000;
      if(ageDays>7){
        // 'none' - the value the table's check allows ('no_artifact' was refused, silently, and the row came back every 15 minutes)
        const { error: gErr } = await sb.schema('acc').from('meeting_logs').update({transcript_status:'none'}).eq('id',row.id);
        results.push(gErr?{id:row.id,error:'could not mark none: '+gErr.message}:{id:row.id,gaveUp:'no_artifact_after_7d'});
      }
      else results.push({id:row.id,found:false});
    }catch(e){ results.push({id:row.id,error:String((e as any)?.message||e).slice(0,200)}); }
  }
  return j({ok:true,engine:'gemini:'+MODEL,processed:results.length,results});
});
