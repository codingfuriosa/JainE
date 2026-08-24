// ONE JOB EACH: a SPEECH model turns the audio into words, gpt-4o reads those words.
// The speech model is gpt-4o-transcribe by default and Gemini on request, so the two can be
// compared over the same recordings; the judging is gpt-4o either way.
//
// This exists because of a failure worth recording. The first version asked Gemini, in a single
// call, for a per-turn JSON array with four keys AND six dashboard fields AND six booleans AND seven
// QA judgements with evidence AND a summary - and it quietly stopped transcribing and started
// composing. Across 175 calls the name it claimed to hear matched the CRM's own record ZERO times
// out of the 20 it offered one: Pradip Das was greeted as "Suman babu", GB Nilachala Acharya came
// back as "Anil Sharma". Every check passed, because every check tested the SHAPE of the output.
//
// It was not the model. acc's own transcribe/analyse function has been reading these same
// recordings accurately all along - byte-identical MPEG-2.5 16 kbps 8 kHz files, same
// gemini-flash-latest - because it does three things this did not:
//   1. declares the audio as audio/mpeg. Knowlarity serves "binary/octet-stream" and the old code
//      passed that through, so Gemini was handed an unlabelled blob and a very suggestive prompt.
//   2. puts the PROJECT CATALOGUE in the prompt. A model cannot recognise "Dream Exotica" or "Badu
//      Road" in 8 kHz telephone speech unless it knows those words are possible.
//   3. asks for a transcript and little else, so the output budget goes on listening.
//
// Measured on six calls with independently known answers: 4 of 6 projects and 3 of 6 names exact,
// and blanks rather than inventions where it could not tell. name_matches_crm keeps watching that.
//
// Nightly Lost-Call QA. Pulls DreamCRM's report - recording_url, lead_id, lead_name, lead_mobile,
// business_unit_name, status, next_follow_up_date, lost_reason and remarks; no call duration, and
// no lead_mobile any more. Only Lost and In Followup are taken. Then it transcribes and
// audits each call. The report covers leads being followed up as well as lost ones, so the AI's own
// verdict (Qualified / Follow-Up / Not Qualified) is checked against the CRM's, and disagreement in
// either direction is what this exists to surface.
//
// AUDIO IS NEVER STORED: it lives in memory for one AI call. We keep the transcript and the ~90 byte
// link, and re-fetch audio live from Knowlarity. Storing it would be ~4.7 GB/year for no benefit.
//
// Two actions, because a day is 40-110 calls and one invocation cannot do them all:
//   pull  queue the day (seconds, no AI) - cron 00:30 IST, retried hourly to 05:30, because the
//         CRM's report for a day is not always published by half an hour after midnight
//   work  process a bounded batch      - cron every minute, no-ops when the queue is empty
//   run / retry / status
//
// Callers prove themselves via (1) acc.job_secrets, a token the DATABASE generated for itself, which
// pg_cron reads to build x-sync-secret and this function reads with its service-role key - no human
// ever invents or pastes a password; (2) SYNC_SECRET (legacy); (3) a signed-in user's token.

import { createClient } from "jsr:@supabase/supabase-js@2";
// Gemini takes audio as base64 inline data; the speech API takes the bytes directly.
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
type DB = ReturnType<typeof createClient>;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...CORS } });

/* THE EAR, either one. ChatGPT's speech model is the default on the evidence so far - on Pradip
   Das's 301 second call it returned 4726 characters against Gemini's 1172 - but the two are kept
   switchable so they can be compared on the same recordings rather than argued about. Only the ear
   changes: the judging is gpt-4o in both cases. */
const STT_MODEL = Deno.env.get("STT_MODEL") || "gpt-4o-transcribe";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest";

/* Only these two statuses are taken. The report also sends Qualified, Sit Visited and OV now; they
   are skipped at FETCH time rather than filtered afterwards, so they never reach the queue and never
   cost anything to ignore. */
const WANTED_STATUSES = ["Lost", "In Followup"];

/* The switchboard, not the conversation. Every call opens with this and it was being written down as
   the agent's first words, which made a two-line call look like a four-line one. Matched loosely -
   punctuation and repetition vary - and only at the START of the transcript, so the same words spoken
   later by a person would survive. */
const IVR_PATTERNS: RegExp[] = [
  /welcome\s+to\s+ja[iy]n\s+group[.,!]?/gi,
  /this\s+call\s+(?:will\s+be|is\s+being)\s+recorded\s+for\s+(?:monitoring\s+and\s+)?(?:training|quality)\s*(?:and\s+training\s*)?purposes?[.,!]?/gi,
  /please\s+wait\s+while\s+we\s+connect\s+your\s+call[.,!]?/gi,
  /please\s+hold\s+while\s+we\s+connect\s+you[.,!]?/gi,
];
function stripIvr(t: string): string {
  let out = String(t || "");
  for (const re of IVR_PATTERNS) out = out.replace(re, " ");
  /* A turn that was ONLY the IVR is now blank, and an empty "Agent:" line is worse than no line, so
     the label goes with it. */
  return out
    .replace(/^\s*(?:Agent|Customer|Speaker)\s*\d*\s*:\s*(?=$|\n)/gim, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* Kolkata place names as a Bengali speaker says them, which is not how they are written. Pailan comes
   back as "Poylan" every time, so the recogniser is primed with the correct spellings AND these are
   corrected afterwards - priming raises the odds, it does not guarantee them. Word-boundary matched
   so a longer name containing one of these is left alone. */
const SPELLINGS: [RegExp, string][] = [
  [/\bpoylan\b/gi, "Pailan"], [/\bpoilan\b/gi, "Pailan"], [/\bpailaan\b/gi, "Pailan"],
  [/\bjhoka\b/gi, "Joka"], [/\bjokha\b/gi, "Joka"],
  [/\bmodhyomgram\b/gi, "Madhyamgram"], [/\bmadhyamgra?am\b/gi, "Madhyamgram"],
  [/\bdoltola\b/gi, "Doltala"], [/\bdoltalla\b/gi, "Doltala"],
  [/\brajarhaat\b/gi, "Rajarhat"], [/\brajarhut\b/gi, "Rajarhat"],
  [/\bbarasaat\b/gi, "Barasat"], [/\bbarashat\b/gi, "Barasat"],
  [/\bnarendrapore\b/gi, "Narendrapur"],
  [/\bgems?\s+group\b/gi, "Jain Group"], [/\bjems?\s+group\b/gi, "Jain Group"],
  [/\bdream\s+gurukool\b/gi, "Dream Gurukul"], [/\bdream\s+exotika\b/gi, "Dream Exotica"],
];
function fixSpellings(t: string): string {
  let out = String(t || "");
  for (const [re, right] of SPELLINGS) out = out.replace(re, right);
  return out;
}
/* The judgement runs on the TEXT, which is a reading task, and gpt-4o is asked to do only that.
   Keeping the two stages on different providers is deliberate: the transcript is then evidence the
   judge did not produce, so name_matches_crm and crm_status_match stay meaningful checks. */
const ANALYSIS_MODEL = Deno.env.get("ANALYSIS_MODEL") || "gpt-4o";
// Was unset, which means a low default - one of the ways long output gets cut off.
const FEED_URL = Deno.env.get("LOST_CALL_FEED") || "https://www.realtybucket.com/report/lost_call_recordings";

const SOURCE = "lost_call_sync";
const JOB_SECRET_NAME = "transcription_sync";
const MIN_DURATION_SECONDS = 60;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
/* Three recordings at once, each now costing two API calls rather than one. Flash transcribes a
   five minute call in well under a minute and the analysis is seconds, so one round per invocation
   stays comfortably inside the wall clock while clearing ~180 calls an hour. */
const CONCURRENCY = 3;
/* Automatic retry. Both caps are three, and the "no speech" one is measured rather than guessed:
   of six calls marked no-speech on 21 Aug, THREE transcribed on a plain second attempt - a 213
   second recording first reported as "Ringing only" came back with ten turns in it. At a 50%
   recovery rate one extra listen is clearly too few. The cost is bounded: a genuinely silent
   recording is paid for three times and then left alone for good.
   Ten minutes between attempts keeps a rate-limit or an outage from being hammered, and means a
   retry lands on a later cron tick rather than the very next one. */
/* What counts as "too thin to be a transcript of this recording".
   Measured, not guessed: real transcripts of these calls run 6-16 characters per second of audio,
   and the failures cluster far below - "Hello." at 0.1, Gemini's 40-character answers at 0.2 and 0.5.
   1.5 sits in the empty gap between the two, so a genuinely brief exchange still passes while
   near-silence does not.
   The floor is absolute as well as relative: 120 characters is not a call whatever its length. */
const MIN_TRANSCRIPT_CHARS = 120;
const MIN_CHARS_PER_SECOND = 1.5;
const MAX_ATTEMPTS_ERROR = 3;
const MAX_ATTEMPTS_NO_SPEECH = 3;
const RETRY_AFTER_MINUTES = 10;

/* The catalogue is VOCABULARY, not content. Its job is to make the real words available to the
   recogniser - a model that has never heard of "Dream Exotica" will not pick it out of 8 kHz
   telephone speech. It has to be paired with a firm instruction not to recite it, because when the
   audio is hard a catalogue is also a tempting script: asked for a transcript with this list and no
   such warning, Gemini once returned "2 BHK starts from 57 lakh and 3 BHK starts from 80 lakh" -
   the catalogue's own figures, on a call that was about neither.
   Dream One is included because it is a real project that acc's own copy of this list omits, and a
   missing project reads as a misheard one. */
const CATALOGUE = `Jain Group projects (for RECOGNISING names, locations and figures you hear - never
to be used to fill in anything you did not hear):
- Dream Gurukul: 3BHK from 80 lakh, 2BHK from 57 lakh. UNDER CONSTRUCTION. Doltala, Madhyamgram / near Airport. Possession 2027/2028.
- Dream World City: 2BHK 29 lakh, 3BHK 36 lakh. READY TO MOVE. Near Joka Metro / Pailan More.
- Dream Valley: 3BHK 73 lakh (no 2BHK). READY TO MOVE. Siliguri, Hill Cart Road, Dagapur.
- Dream Eco City: 2BHK 34 lakh, 2.5BHK 39 lakh. READY TO MOVE. Durgapur, Muchipara, NH-2.
- Dream Exotica: 2BHK 36 lakh, 3BHK 44 lakh. READY TO MOVE. Madhyamgram, Badu Road.
- Dream One: Rajarhat, opposite Eco Park.`;

/* STAGE 1 is now a speech-to-text call, so there is no room for a page of instructions - the API
   takes one short "prompt" whose only real job is to prime spellings. Proper nouns are what a
   recogniser gets wrong on a bad line, so the projects and the company name go in and nothing else
   does. No rules about summarising are needed: a transcription model has no concept of summarising,
   which is precisely why it is being used. */
/* Gemini needs telling what a speech model knows by construction: transcribe, do not summarise,
   and do not stop early. Every instruction here exists because its absence produced a specific
   failure - an 8m26s call returned as 16 turns, a call written off as "silence" that had people
   talking in it, and the project catalogue recited back as the conversation. Deliberately NO
   catalogue here: given the list, it read the list out. */
const GEMINI_TRANSCRIBE_PROMPT = `You are a transcriptionist. This is a Jain Group (Kolkata
real-estate) sales call - a compressed 8 kHz telephone recording, speech mixing Bengali, Hindi and
English.

WRITE DOWN EVERY WORD SPOKEN. Not a summary. Not the gist. Every word.

- Transcribe the WHOLE recording, first sound to last. Never stop early, never write "conversation
  continues". Eight minutes of audio means dozens of turns.
- VERBATIM: keep every "hello", "haan", "achha", "ji", every repetition and false start. Do not tidy,
  merge or shorten.
- There is ALMOST ALWAYS speech. Ringing, a caller tune or an IVR message at the start is normal and
  is NEVER a reason to stop - skip past it and transcribe what follows. Do not call a recording empty
  because it opens with ringing, is noisy, or the voices are faint.
- Where you truly cannot make out a phrase, write [inaudible] in its place and carry on. That is for
  gaps, never for a whole call.
- NEVER invent a name, a figure, a location or a project you did not hear.

Kolkata place names are said in Bengali and written differently: Pailan (heard as "Poylan"), Joka,
Madhyamgram, Doltala, Rajarhat, Barasat, Narendrapur, Chinar Park. The developer is "Jain Group" -
"Gems Group" or "Jems Group" is a mishearing.

Output the conversation as plain text, one turn per line, each line starting "Agent:" or "Customer:".
Nothing else - no preamble, no JSON, no commentary.`;

const STT_HINT = "Jain Group real-estate sales call, Kolkata. Projects: Dream World City, Dream "
  + "Gurukul, Dream Exotica, Dream Valley, Dream Eco City, Dream One, Dream Residency Manor. Areas: "
  + "Rajarhat, New Town, Madhyamgram, Doltala, Badu Road, Joka, Pailan (spoken \"Poylan\"), Barasat, "
  + "Narendrapur, Siliguri, Durgapur, Eco Park, Chinar Park. Speech mixes Bengali, Hindi and English. "
  + "Amounts are in lakhs; flats are 2BHK or 3BHK. Ignore the recorded IVR greeting at the start.";

/* STAGE 2. Reading, not listening. It receives the verbatim transcript and NOTHING else - not the
   audio, not the CRM's name, not the CRM's status - which is what keeps name_matches_crm and
   crm_status_match honest checks rather than the judge agreeing with what it was told. */
const ANALYSE_PROMPT = `You are a Sales Quality Assurance Analyst for JainGroup, a Kolkata
real-estate developer. Below is a VERBATIM transcript of one outbound call, produced by a
speech-to-text system. Reply with a single json object and nothing else - the keys are listed below. It has no speaker labels and it is in the languages actually spoken - usually
a mix of Bengali, Hindi and English. It may contain repetitions, false starts and filler, because
that is what people say.

${CATALOGUE}

Do TWO things.

FIRST, lay the conversation out. Split it into turns and label each one, ONE PER LINE:
- "transcript_original": every turn as spoken, in the original words, each line starting "Agent:" or
  "Customer:". KEEP EVERY WORD. Do not summarise, do not tidy, do not merge turns, do not drop
  repetitions or fillers. The agent is the one calling from Jain Group; the customer is the other
  party. If you cannot tell who spoke a line, label it "Speaker:" rather than guessing.
- "transcript_english": the SAME turns, same count, same order, translated to natural English.
  A complete translation, not a condensed one.
Add nothing that is not in the transcript. If a passage is garbled, carry it across as it is.

SECOND, judge the call, using ONLY what the transcript contains:

"customer_name": the customer's name ONLY if it is actually spoken in the transcript, else ""
"project_discussed": the project actually named in the transcript, else "Unclear"
"languages": which of Hindi, Bengali, English actually appear

"dashboard_fields": {
  "number_asked": "Yes" or "No" - did the agent ask for or confirm a contact number,
  "pincode_provided": the pincode if one was given, else "None",
  "lead_category": EXACTLY one of 'Not Interested','Qualified','Interested Not Qualified','Interested Site Visit','Interested in Booking',
  "lost_reason": why this lead did not progress, or "None",
  "project_discussed": as above
}

"criteria": six booleans, true ONLY where the transcript establishes it:
  "site_visit_interested" - the customer agreed to a site visit or asked for one
  "location_match"        - the location they want is one JainGroup builds in
  "bhk_match"             - the configuration they want is available
  "budget_match"          - their budget fits the project discussed
  "ready_move_match"      - ready-to-move vs under-construction matches what was offered
  "follow_up_requested"   - they did not decide but asked to be contacted again ("call me later",
                            "I am busy", "call me next week"), or a callback time was agreed. FALSE if
                            they said they have no requirement, have already bought, or are simply
                            not interested - that is a closed lead, not a pending one.

"qa_evaluation": seven objects, each {"point","status","evidence","notes"}, status "Pass", "Fail" or
"Partial". The points are Script, Etiquette, Query Handling, Call to Action, Leakage Avoidance,
Follow-up Accuracy, Hyper-personalization. If something never arose because the customer ended the
call early, say so in notes rather than failing the agent for it.

"summary_verdict": several sentences - what the customer wanted, how the agent handled it, what was
agreed, and what the agent should have done differently. If the call was only a few words, say that
plainly instead of padding it out.`;


/* STAGE 3. Two accounts of the same call - the agent's and the transcript's - and one question: do
   they agree? It is given both, which is exactly what stage 2 must NOT be: the transcript and the
   summary were produced without any sight of the agent's version, so comparing them here is a real
   test rather than a confirmation.
   Told plainly that different WORDS for the same substance is agreement, because the agent types
   shorthand under time pressure and the point is whether the account is TRUE, not whether it is well
   written. */
const COMPARE_PROMPT = `You are auditing a sales call. You will be given what the CALL contains and
what the AGENT recorded about it in the CRM. Decide whether the agent's record is TRUE to the call.
Reply with a single json object and nothing else.

Judge SUBSTANCE, not wording. The agent types shorthand: "budget low", "BUDGET AMOUNT LOW" and "the
customer's budget was below our starting price" are all the SAME thing and all agree. Say it
disagrees only where the agent's record states something the call does not support, or misses the
actual reason entirely.

Return:
"lost_reason": { "agrees": true/false, "note": "one sentence" } - or null if no lost reason was given.
  agrees=false when the agent's reason is not the reason the call shows.
"remarks": { "agrees": true/false, "note": "one sentence" } - or null if no remarks were given.
  agrees=false when the remarks describe something that did not happen on this call, or contradict it.
Keep each note to one plain sentence naming the difference, or confirming the match.`;

// Calls are Indian, so "yesterday" must be yesterday in IST - at 19:00 UTC when the cron fires, UTC
// is still on the previous day.
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const istYesterday = () => new Date(Date.now() + 5.5 * 3600e3 - 864e5).toISOString().slice(0, 10);
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/* Duration without decoding. Knowlarity sends CBR MPEG 2.5 Layer III, 16 kbps, 8 kHz mono, so bytes
   over bitrate is exact enough - verified against ffprobe within 0.3s, and against a real 166,752
   byte file that came to 83.4s. The feed sends no duration, so this is the only way to apply the
   ">1 minute" rule, and it is what stops us paying to listen to ring-outs.
   NOTE it measures the FILE, which includes ringing and post-hangup silence: an 83s file held 15s of
   talk. So it is a cost gate, not a measure of conversation length. null never fails the gate. */
const BR_V1 = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0];
const BR_V2 = [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0];
const SAMPLE_RATES: Record<number, number[]> = { 3:[44100,48000,32000], 2:[22050,24000,16000], 0:[11025,12000,8000] };

function estimateDurationSeconds(b: Uint8Array): number | null {
  let off = 0;
  if (b.length > 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    off = 10 + (((b[6]&0x7f)<<21)|((b[7]&0x7f)<<14)|((b[8]&0x7f)<<7)|(b[9]&0x7f));
  }
  const limit = Math.min(b.length - 4, off + 0x20000);
  for (let i = off; i < limit; i++) {
    if (b[i] !== 0xff || (b[i+1] & 0xe0) !== 0xe0) continue;
    const version = (b[i+1] >> 3) & 3, layer = (b[i+1] >> 1) & 3;
    if (version === 1 || layer === 0) continue;
    const brIdx = (b[i+2] >> 4) & 15, srIdx = (b[i+2] >> 2) & 3;
    if (brIdx === 0 || brIdx === 15 || srIdx === 3) continue;
    const kbps = (version === 3 ? BR_V1 : BR_V2)[brIdx];
    const sr = SAMPLE_RATES[version]?.[srIdx];
    if (!kbps || !sr) continue;
    return Math.round(((b.length - i) * 8) / (kbps * 1000));
  }
  return null;
}

/* Turns, from the two flat transcripts. The stage-1 prompt asks for one turn per line in the same
   order in both versions, so line N of the English is line N of the original. Deliberately no
   timestamps: this pipeline genuinely does not have them, and an invented "00:42" beside a real
   sentence is exactly the kind of plausible detail that caused the trouble in the first place.
   A line the model did not label is kept rather than dropped - losing a turn is worse than showing
   it without a speaker. */
function parseTurns(en: string, bn: string) {
  /* Split on the SPEAKER LABEL, not on the line break. Asked for one turn per line, gpt-4o just as
     often returns them comma-separated on a single line - which read as one 3,768 character turn the
     first time this ran. The label is the real boundary, so whatever sits between turns (a newline, a
     comma, a semicolon, nothing at all) is treated as the separator. */
  const clean = (t: string) => String(t || "")
    .replace(/\r/g, "")
    .replace(/\s*[,;|]?\s*(?=(?:Agent|Customer|Speaker)\s*\d*\s*:)/g, "\n")
    .split("\n").map((x) => x.trim()).filter(Boolean);
  const eL = clean(en), bL = clean(bn);
  if (!eL.length) return [];
  const speakerOf = (line: string) => {
    const m = line.match(/^\s*(agent|customer|speaker\s*\d*)\s*:\s*/i);
    return m ? { who: /agent/i.test(m[1]) ? "Agent" : /customer/i.test(m[1]) ? "Customer" : "Speaker",
                 rest: line.slice(m[0].length) } : null;
  };
  const out: Record<string, string>[] = [];
  for (let i = 0; i < eL.length; i++) {
    const e = speakerOf(eL[i]);
    const b = i < bL.length ? speakerOf(bL[i]) : null;
    const text = e ? e.rest : eL[i];
    const original = b ? b.rest : (i < bL.length ? bL[i] : "");
    if (!text && !original) continue;
    out.push({ speaker: e ? e.who : "Speaker", text, original });
  }
  return out;
}

type FeedRow = {
  recording_url?: unknown; lead_id?: unknown; business_unit_name?: unknown;
  lead_name?: unknown; status?: unknown;
  /* What the AGENT recorded, which is the other half of every discrepancy check. lead_mobile is gone:
     the report stopped sending it. */
  next_follow_up_date?: unknown; lost_reason?: unknown; remarks?: unknown;
};
// The feed writes absence as text rather than as null, and not always the same text.
const FEED_BLANKS = ["none", "null", "undefined", "na", "n/a", "-", ""];
function feedText(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return FEED_BLANKS.includes(s.toLowerCase()) ? null : s;
}
const realUrl = feedText;

/* The CRM's own verdict on the lead, which is a different thing from the AI's. It sends "lost" and
   "In Followup" - inconsistent casing, so it is normalised here rather than at every place that
   reads it. An unrecognised value is kept as-is instead of dropped, so a new status shows up on
   screen as itself rather than silently becoming blank. */
const CRM_STATUSES: Record<string, string> = {
  "lost": "Lost", "in followup": "In Followup", "followup": "In Followup", "follow up": "In Followup",
};
function crmStatusFrom(v: unknown): string | null {
  const s = feedText(v);
  return s ? (CRM_STATUSES[s.toLowerCase()] || s) : null;
}

/* What each recording is called: "Full Name_Lead Id", or the lead id on its own when the CRM has no
   name for the lead. The lead id is always sent, so a recording can never end up nameless.
   Characters that are illegal in a file name are stripped, since this is used as one. */
function recordingName(name: string | null, leadId: number): string {
  const clean = String(name || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return clean ? clean + "_" + leadId : String(leadId);
}
const callUuidFrom = (url: string) => url.match(/callid=([0-9a-fA-F-]{36})/)?.[1] ?? null;

type Check = { check: string; status: "pass" | "fail" | "skip"; detail: string };

/* Does the CRM's verdict match what the call actually contains? The report used to be lost calls
   only; it now also sends leads still In Followup, and the two disagree in opposite directions:
   a Lost lead that wanted to buy was written off too early, while a lead still being chased who
   said no is effort going nowhere. Surfacing both is the point of this dashboard. */
const HIGH_INTENT = ["qualified", "interested site visit", "interested in booking"];
function judgeMismatch(crmStatus: string | null, category: string | null) {
  const st = String(crmStatus || "").toLowerCase();
  const cat = String(category || "").trim(), c = cat.toLowerCase();
  if (!cat) return { mismatch: null, severity: null, reason: null };

  if (st === "lost") {
    if (c === "not interested") {
      return { mismatch: false, severity: null,
        reason: "CRM marked this lead Lost and the call confirms the customer was not interested." };
    }
    if (HIGH_INTENT.includes(c)) {
      return { mismatch: true, severity: "high",
        reason: `CRM marked this lead Lost, but the call shows buying intent - the AI graded it "${cat}". This lead was written off while still active and should be re-opened.` };
    }
    if (c === "interested not qualified") {
      return { mismatch: true, severity: "low",
        reason: "CRM marked this lead Lost. The customer was interested but did not fit current inventory, so closing it is defensible - worth nurturing rather than discarding." };
    }
    return { mismatch: true, severity: "low",
      reason: `CRM marked this lead Lost; the AI returned an unrecognised category "${cat}" - review manually.` };
  }

  if (st === "in followup") {
    if (c === "not interested") {
      return { mismatch: true, severity: "low",
        reason: "CRM still has this lead In Followup, but on the call the customer said they are not interested - the team is chasing a lead that is already closed." };
    }
    return { mismatch: false, severity: null,
      reason: `CRM has this lead In Followup and the call agrees - the AI graded it "${cat}", so it is rightly still open.` };
  }

  return { mismatch: null, severity: null,
    reason: `CRM status "${crmStatus}" is not one this report has sent before, so it was not checked against the call.` };
}

/* THE OUTCOME, from the SAME criteria the dashboard renders, by the same rule it prints, so the panel
   and the badge cannot disagree. Previously this was
   `category === 'not interested' ? 'Not Qualified' : 'Qualified'` and `criteria` was never written at
   all - so the panel showed five red crosses beside a Qualified badge, two unrelated sources.

   Three outcomes, not two. A customer who asked to be called back later has neither matched nor been
   lost, and forcing them into Not Qualified is how a live lead gets written off. Order matters: a
   firm yes outranks a maybe, and a maybe outranks nothing. */
const CRIT_KEYS = ["site_visit_interested","location_match","bhk_match","budget_match","ready_move_match","follow_up_requested"];
function normaliseCriteria(v: unknown): Record<string, boolean> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, boolean> = {};
  for (const k of CRIT_KEYS) out[k] = (v as any)[k] === true;
  return out;
}
function qualifyFrom(c: Record<string, boolean> | null) {
  if (!c) return { qualification: null as string | null, why: null as string | null };
  if (c.site_visit_interested) {
    return { qualification: "Qualified", why: "The customer agreed to a site visit." };
  }
  if (c.location_match && c.bhk_match && c.budget_match && c.ready_move_match) {
    return { qualification: "Qualified", why: "Location, configuration, budget and possession timeline all match." };
  }
  if (c.follow_up_requested) {
    return { qualification: "Follow-Up",
      why: "The customer did not decide on this call but asked to be contacted again - still open, not lost." };
  }
  const missing = ([["location_match","location"],["bhk_match","configuration"],
                    ["budget_match","budget"],["ready_move_match","possession timeline"]] as const)
    .filter(([k]) => !c[k]).map(([, label]) => label);
  return {
    qualification: "Not Qualified",
    why: "No site visit was agreed and no callback was asked for" +
         (missing.length ? `; ${missing.join(", ")} did not match` : "") + ".",
  };
}

// Share of the 7 criteria passed, Partial counting as half.
function qaScoreFor(qa: unknown): number | null {
  if (!Array.isArray(qa) || !qa.length) return null;
  let got = 0;
  for (const it of qa) {
    const s = String((it as any)?.status || "").toLowerCase();
    if (s === "pass") got += 1; else if (s === "partial") got += 0.5;
  }
  return Math.round((got / qa.length) * 100);
}

/* Flat searchable text for the list, the export and the detail view - one labelled line per turn,
   which is also the shape the mailer and the tracker already read. No timestamp prefix: this
   pipeline has no timestamps, and inventing one would undo the point of the exercise. */
function flattenTurns(turns: Record<string, string>[], field: "text" | "original"): string {
  return turns.map((t) => `${t.speaker || "Speaker"}: ${t[field] || t.text || ""}`.trim())
              .filter((l) => l.replace(/^\w+:\s*/, "").length).join("\n");
}

// Only the three languages these calls are in, so a hallucinated value cannot reach the column.
const KNOWN_LANGUAGES = ["hindi", "bengali", "english"];
function languagesFrom(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    const s = String(x || "").trim(), k = s.toLowerCase();
    if (KNOWN_LANGUAGES.includes(k) && !out.some((y) => y.toLowerCase() === k)) {
      out.push(k.charAt(0).toUpperCase() + k.slice(1));
    }
  }
  return out.length ? out : null;
}

// ---------------------------------------------------------------- PULL
async function doPull(db: DB, from: string, to: string, trigger: string) {
  let feed: FeedRow[];
  try {
    const res = await fetch(`${FEED_URL}?from=${from}&to=${to}`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`feed returned ${res.status}`);
    const body = await res.json();
    if (!Array.isArray(body)) throw new Error("feed did not return a JSON array");
    feed = body;
  } catch (e) {
    const error_text = String((e as any)?.message || e).slice(0, 500);
    await db.schema("acc").from("lost_call_sync_runs").insert({ from_date: from, to_date: to, trigger, error_text });
    return j({ error: "feed fetch failed: " + error_text }, 502);
  }

  // The feed repeats rows, and sends exact duplicates when recording_url is "None". Dedupe so the
  // no-recording rows collapse to one per lead rather than inflating "calls received".
  const seen = new Set<string>();
  const queued: Record<string, unknown>[] = [];
  let noRecording = 0, skippedStatus = 0;

  for (const row of feed) {
    const leadId = Number(row.lead_id) || null;
    if (!leadId) continue;
    const crm = crmStatusFrom(row.status);
    /* Lost and In Followup only. Skipped HERE, so Qualified, Sit Visited and OV never enter the queue:
       filtering later would mean transcribing them first, which is the expensive way to ignore
       something. */
    if (!crm || !WANTED_STATUSES.includes(crm)) { skippedStatus++; continue; }

    const bu = row.business_unit_name ? String(row.business_unit_name) : null;
    const rec = realUrl(row.recording_url);
    // Straight from the CRM, so these are facts rather than the AI's reading of the audio.
    const nm = feedText(row.lead_name);
    const label = recordingName(nm, leadId);
    /* The agent's own record of this call, kept apart from anything the AI produces so the two can be
       compared rather than one quietly overwriting the other. */
    const agentReason = feedText(row.lost_reason);
    const agentRemarks = feedText(row.remarks);
    const nextFollowUp = feedText(row.next_follow_up_date);

    if (!rec) {
      const key = `norec:${leadId}`;
      if (seen.has(key)) continue;
      seen.add(key); noRecording++;
      queued.push({
        source: SOURCE, title: label, file_name: label, lead_id: leadId,
        customer_name: nm,
        crm_lost_reason: agentReason, crm_remarks: agentRemarks, next_follow_up_date: nextFollowUp,
        business_unit_name: bu, project: bu, crm_status: crm, report_date: from,
        status: "no_recording", synced_at: new Date().toISOString(),
        verification: [{ check: "recording_present", status: "fail",
          detail: 'The CRM feed returned "None" for this call - there is no recording to transcribe.' }] satisfies Check[],
      });
      continue;
    }
    const uuid = callUuidFrom(rec);
    const key = uuid ? `uuid:${uuid}` : `url:${rec}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // project comes from the feed and is known now; the AI returns "Unclear" most of the time.
    queued.push({
      source: SOURCE, title: label, file_name: label, lead_id: leadId,
      customer_name: nm,
      crm_lost_reason: agentReason, crm_remarks: agentRemarks, next_follow_up_date: nextFollowUp,
      business_unit_name: bu, project: bu, crm_status: crm, report_date: from,
      recording_url: rec, call_uuid: uuid, status: "queued", synced_at: new Date().toISOString(),
    });
  }

  // Skip what we already hold, so a re-run never re-bills for a call.
  const uuids = queued.map((r) => r.call_uuid).filter(Boolean) as string[];
  const urls = queued.map((r) => r.recording_url).filter(Boolean) as string[];
  const known = new Set<string>();
  if (uuids.length) {
    const { data } = await db.schema("acc").from("transcriptions").select("call_uuid").in("call_uuid", uuids);
    for (const r of data || []) if (r.call_uuid) known.add("uuid:" + r.call_uuid);
  }
  if (urls.length) {
    const { data } = await db.schema("acc").from("transcriptions").select("recording_url").in("recording_url", urls);
    for (const r of data || []) if (r.recording_url) known.add("url:" + r.recording_url);
  }
  {
    const { data } = await db.schema("acc").from("transcriptions")
      .select("lead_id").eq("report_date", from).eq("status", "no_recording");
    for (const r of data || []) if (r.lead_id) known.add("norec:" + r.lead_id);
  }
  const fresh = queued.filter((r) =>
    r.status === "no_recording" ? !known.has("norec:" + r.lead_id)
    : r.call_uuid ? !known.has("uuid:" + r.call_uuid)
    : !known.has("url:" + r.recording_url));

  let inserted = 0;
  for (let i = 0; i < fresh.length; i += 100) {
    const { data, error } = await db.schema("acc").from("transcriptions").insert(fresh.slice(i, i + 100)).select("id");
    // 23505 is a duplicate key: two overlapping runs, not worth aborting on.
    if (error && error.code !== "23505") {
      await db.schema("acc").from("lost_call_sync_runs").insert({
        from_date: from, to_date: to, trigger, feed_rows: feed.length, inserted,
        duplicates: queued.length - fresh.length, no_recording: noRecording,
        error_text: error.message.slice(0, 500) });
      return j({ error: error.message }, 500);
    }
    inserted += (data || []).length;
  }
  await db.schema("acc").from("lost_call_sync_runs").insert({
    from_date: from, to_date: to, trigger, feed_rows: feed.length, inserted,
    duplicates: queued.length - fresh.length, no_recording: noRecording });

  return { from, to, feed_rows: feed.length, unique_calls: queued.length, inserted,
           duplicates: queued.length - fresh.length, no_recording: noRecording,
           skipped_other_statuses: skippedStatus };
}

// ---------------------------------------------------------------- WORK
async function processOne(db: DB, row: any, openaiKey: string,
                          sttModel = STT_MODEL, analysisModel = ANALYSIS_MODEL,
                          engine = "chatgpt", geminiKey = "", geminiModel = GEMINI_MODEL) {
  // Counted here rather than at the end, so an attempt that crashes still counts against the cap.
  const attempts = Number(row.attempts || 0) + 1;
  const checks: Check[] = [{ check: "recording_present", status: "pass", detail: "CRM feed supplied a recording URL." }];
  const fail = async (status: string, errorText: string | null, extra: Record<string, unknown> = {}) => {
    const giveUp = status === "error" && attempts >= MAX_ATTEMPTS_ERROR;
    await db.schema("acc").from("transcriptions").update({
      status, attempts,
      error_text: errorText
        ? (errorText.slice(0, 460) + (giveUp ? ` [gave up after ${attempts} tries]` : ` [try ${attempts}]`))
        : null,
      verification: checks,
      mismatch: null, mismatch_severity: null, mismatch_reason: null,
      updated_at: new Date().toISOString(), ...extra }).eq("id", row.id);
    return { id: row.id, lead_id: row.lead_id, status };
  };

  let audio: Uint8Array;
  let mimeType = "audio/mpeg";
  try {
    // fetch follows the 302 to Knowlarity's presigned S3 URL, which expires in ~600s - which is why
    // we store the knowlarity link and not the redirect target.
    const res = await fetch(row.recording_url);
    if (!res.ok) throw new Error(`recording fetch failed (HTTP ${res.status})`);
    /* THE BUG THAT CAUSED ALL OF THIS. Knowlarity serves these recordings as
       "binary/octet-stream", and the previous line read
           if (!/^audio\/|octet-stream$/i.test(mimeType)) mimeType = "audio/mpeg";
       which allows anything ending in octet-stream THROUGH - so Gemini was handed a blob declared as
       unspecified binary data, could not treat it as audio, and answered from the prompt instead.
       octet-stream was the one case that needed replacing, not exempting. Only a genuine audio/* or
       video/* type from the server is trusted now; everything else is what these files actually are. */
    const served = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    mimeType = /^(audio|video)\/[a-z0-9.+-]+$/.test(served) ? served : "audio/mpeg";
    audio = new Uint8Array(await res.arrayBuffer());
    if (audio.length < 1024) throw new Error(`recording is empty (${audio.length} bytes)`);
    if (audio.length > MAX_AUDIO_BYTES) throw new Error(`recording too large (${Math.round(audio.length/1048576)} MB)`);
  } catch (e) {
    const msg = String((e as any)?.message || e);
    checks.push({ check: "recording_fetched", status: "fail", detail: msg });
    return fail("error", msg);
  }
  checks.push({ check: "recording_fetched", status: "pass",
    detail: `Fetched ${Math.round(audio.length/1024)} KB of ${mimeType}.` });

  const seconds = estimateDurationSeconds(audio);
  if (seconds === null) {
    checks.push({ check: "duration_over_60s", status: "skip",
      detail: "Could not read the audio header - sending to the AI without a duration check." });
  } else if (seconds <= MIN_DURATION_SECONDS) {
    checks.push({ check: "duration_over_60s", status: "fail",
      detail: `Recording is ~${seconds}s, at or under the ${MIN_DURATION_SECONDS}s floor - almost certainly a ring-out. Skipped without calling the AI.` });
    return fail("too_short", null, { duration_seconds: seconds });
  } else {
    checks.push({ check: "duration_over_60s", status: "pass",
      detail: `Recording file is ~${seconds}s (includes ringing and any silence after hang-up).` });
  }

  /* Already transcribed? Then do not pay to transcribe it again. This matters because the two stages
     fail independently: when the judgement failed on all 12 calls of the first ChatGPT run, the
     transcripts had already been bought and saved, and re-running would have bought them twice for
     nothing. A stored transcript is reused and only the judgement is redone. */
  const stored = String(row.transcript || "").trim();
  if (stored) {
    checks.push({ check: "recording_fetched", status: "skip",
      detail: `Reusing the transcript already stored for this call (${stored.length} characters) - only the analysis is being redone.` });
  }

  /* STAGE 1 - the listening, by whichever engine was asked for. Everything after this point is
     identical either way, which is the only way a comparison between the two means anything: the
     judging is gpt-4o regardless, so a difference in the result is a difference in the ear. */
  let spoken = stored;
  if (!stored) {
    try {
      if (engine === "gemini") {
        if (!geminiKey) throw new Error("GEMINI_API_KEY is not configured");
        /* audio/mpeg, NOT the "binary/octet-stream" Knowlarity serves. Passing the server's own
           header through was the original bug in this file: Gemini received a blob declared as
           unspecified binary data and answered from the prompt instead of the audio. */
        const gr = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`,
          { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [
                { text: GEMINI_TRANSCRIBE_PROMPT },
                { inline_data: { mime_type: "audio/mpeg", data: encodeBase64(audio) } }] }],
              // Plain text out, no schema: one job, and a schema to fill is an invitation to invent.
              generationConfig: { temperature: 0, maxOutputTokens: 60000 },
            }) });
        const gj = await gr.json().catch(() => ({}));
        if (!gr.ok) throw new Error(`Gemini failed (${gr.status}): ${JSON.stringify(gj).slice(0,300)}`);
        spoken = String(gj?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
        if (!spoken) {
          const why = gj?.candidates?.[0]?.finishReason;
          throw new Error(why ? `Gemini returned no text (finishReason: ${why})` : "Gemini returned nothing");
        }
      } else {
        if (!openaiKey) throw new Error("CHATGPT_API_KEY is not configured");
        /* The file MUST carry a name with an extension: OpenAI picks its decoder from that, and an
           unnamed octet-stream is rejected outright. The bytes go exactly as they were served. */
        const fd = new FormData();
        fd.append("file", new Blob([audio], { type: "audio/mpeg" }), "call.mp3");
        fd.append("model", sttModel);
        fd.append("response_format", "json");
        fd.append("temperature", "0");
        fd.append("prompt", STT_HINT);
        const tr = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST", headers: { Authorization: "Bearer " + openaiKey }, body: fd });
        const tj = await tr.json().catch(() => ({}));
        if (!tr.ok) throw new Error(`speech-to-text failed (${tr.status}): ${JSON.stringify(tj).slice(0,300)}`);
        spoken = String(tj.text || "").trim();
        if (!spoken) throw new Error("speech-to-text returned no text");
      }
    } catch (e) {
      const msg = String((e as any)?.message || e);
      checks.push({ check: "human_conversation", status: "skip", detail: "Not reached: " + msg });
      return fail("error", `transcription (${engine}): ` + msg, { duration_seconds: seconds });
    }
  }

  // audio goes out of scope here and is never persisted.

  /* The verbatim record, cleaned in this order: the IVR greeting out first, then the place names put
     right. Both act on the VERBATIM text, so what is STORED is already correct rather than needing
     fixing on screen - and everything below is a rendering of this, so "every word" survives whatever
     the labelling makes of it. */
  const verbatim = fixSpellings(stripIvr(spoken));
  checks.push({ check: "human_conversation", status: "pass",
    detail: `Speech-to-text returned ${verbatim.length} characters of speech`
      + (seconds ? ` for ~${seconds}s of audio (${Math.round((verbatim.length/seconds)*10)/10} per second)` : "")
      + `${attempts > 1 ? `, on attempt ${attempts}` : ""}.` });

  /* TOO THIN TO BE A TRANSCRIPT? Then this is a failure to HEAR, not a fact about the call, and it
     goes back round. Checked here, before the judging, for two reasons: paying to grade six
     characters is waste, and a verdict formed from six characters is worse than none - "Hello."
     produced a confident "Not Qualified" with every check green.
     The transcript is CLEARED rather than kept: promoteRetries reuses a stored transcript, so leaving
     the thin one in place would make every retry return the same nothing. */
  const density = seconds ? verbatim.length / seconds : null;
  const tooThin = verbatim.length < MIN_TRANSCRIPT_CHARS
    || (density !== null && seconds! > MIN_DURATION_SECONDS && density < MIN_CHARS_PER_SECOND);
  if (tooThin) {
    const giveUp = attempts >= MAX_ATTEMPTS_NO_SPEECH;
    const detail = `Only ${verbatim.length} characters came back for ~${seconds}s of audio`
      + (density !== null ? ` (${Math.round(density*10)/10} per second, against 6-16 on a real transcript)` : "")
      + `. Too little to be a transcript of this call`
      + (giveUp ? `, and it has now been heard ${attempts} times - treat the recording as unusable.`
                : `, so it will be listened to again.`);
    checks.push({ check: "enough_speech", status: "fail", detail });
    await db.schema("acc").from("transcriptions").update({
      status: "non_transcribable", attempts, duration_seconds: seconds,
      non_transcribable_reason: `Only ${verbatim.length} characters transcribed from ~${seconds}s of audio`,
      // cleared on purpose - a retry must transcribe afresh, not reuse this
      transcript: null, transcript_en: null, transcript_bn: null, utterances: null,
      verification: checks, gladia_id: engine,
      mismatch: null, mismatch_severity: null, mismatch_reason: null,
      discrepancy: null, has_discrepancy: null,
      error_text: null, updated_at: new Date().toISOString() }).eq("id", row.id);
    return { id: row.id, lead_id: row.lead_id, status: "non_transcribable", engine,
             verbatim_chars: verbatim.length, per_second: density ? Math.round(density*10)/10 : null,
             attempts, retrying: !giveUp };
  }
  checks.push({ check: "enough_speech", status: "pass",
    detail: `${verbatim.length} characters for ~${seconds}s of audio`
      + (density !== null ? ` (${Math.round(density*10)/10} per second)` : "")
      + `, in line with a real transcript.` });

  /* STAGE 2 - lay it out and judge it. */
  let parsed: any;
  try {
    const ar = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + openaiKey },
      body: JSON.stringify({
        model: analysisModel,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: ANALYSE_PROMPT },
          { role: "user", content: "VERBATIM TRANSCRIPT:\n\n" + verbatim },
        ],
      }) });
    const aj = await ar.json().catch(() => ({}));
    if (!ar.ok) throw new Error(`analysis failed (${ar.status}): ${JSON.stringify(aj).slice(0,300)}`);
    const raw = aj?.choices?.[0]?.message?.content || "";
    if (!raw) throw new Error("the analysis returned nothing");
    parsed = JSON.parse(raw);
  } catch (e) {
    /* The transcript is the expensive part and it is already in hand, so it is SAVED even when the
       judgement fails - left as 'error' so a retry redoes only the analysis. Losing a good verbatim
       transcript because the second call timed out would be daft. */
    const msg = String((e as any)?.message || e);
    checks.push({ check: "analysis", status: "fail", detail: msg });
    return fail("error", "analysis: " + msg, {
      duration_seconds: seconds, transcript: verbatim, transcript_bn: verbatim,
    });
  }

  const turns = parseTurns(String(parsed?.transcript_english || ""), String(parsed?.transcript_original || ""));
  const transcriptEn = turns.length ? flattenTurns(turns, "text") : verbatim;
  // The original-language column keeps the raw speech-to-text output, not a re-rendering of it.
  const transcriptBn = verbatim;

  /* Every word means every word: if the laid-out version came back materially shorter than the
     verbatim transcript it was given, turns were dropped, and that belongs on the row. The verbatim
     text is kept either way. */
  if (turns.length === 1 && verbatim.length > 400) {
    checks.push({ check: "transcript_complete", status: "fail",
      detail: `The whole ${verbatim.length} character call came back as a single turn - the speaker labelling failed, though the words themselves are all present.` });
  } else if (turns.length && transcriptEn.length < verbatim.length * 0.5) {
    checks.push({ check: "transcript_complete", status: "fail",
      detail: `Speech-to-text produced ${verbatim.length} characters but the laid-out version is only ${transcriptEn.length} - turns were dropped or condensed. The verbatim text is kept in the original-language column.` });
  } else {
    checks.push({ check: "transcript_complete", status: "pass",
      detail: `${turns.length} turns laid out from ${verbatim.length} characters of verbatim speech.` });
  }

  const df = parsed?.dashboard_fields || null;
  const category = df?.lead_category ? String(df.lead_category) : null;
  const crit = normaliseCriteria(parsed?.criteria);
  const qual = qualifyFrom(crit);
  const verdict = judgeMismatch(row.crm_status, category);

  /* Does what was heard agree with what the CRM independently knows? The only check here that tests
     CONTENT rather than shape, and the one that exposed the old prompt writing fiction. Informational
     rather than fatal: plenty of agents never say a name, so one mismatch is a reason to look. A RUN
     where it almost never agrees is the alarm. The name comes from stage 1, which was never told it. */
  const heardName = String(parsed?.customer_name || "").trim();
  const knownName = String(row.customer_name || "").trim();
  if (heardName && heardName.toLowerCase() !== "none" && knownName) {
    const firstOf = (x: string) => (x.toLowerCase().replace(/[^a-z ]/g, " ").trim().split(/ +/)[0] || "");
    const a = firstOf(knownName), b = firstOf(heardName);
    const agrees = !!a && !!b && (a === b
      || knownName.toLowerCase().includes(b) || heardName.toLowerCase().includes(a));
    checks.push({ check: "name_matches_crm", status: agrees ? "pass" : "fail",
      detail: agrees
        ? 'The name heard on the call ("' + heardName + '") matches the CRM record ("' + knownName + '").'
        : 'The CRM has this lead as "' + knownName + '" but the call was transcribed as being with "'
          + heardName + '". One of the two is wrong; if many calls in a run disagree like this, the '
          + 'transcripts are not reliable.' });
  } else {
    checks.push({ check: "name_matches_crm", status: "skip",
      detail: knownName
        ? "No name was spoken aloud on the call, so there was nothing to check the CRM name against."
        : "The CRM holds no name for this lead, so there was nothing to check against." });
  }

  checks.push({ check: "crm_status_match",
    status: verdict.mismatch === true ? "fail" : verdict.mismatch === false ? "pass" : "skip",
    detail: verdict.reason || "No lead category was returned, so the CRM status could not be verified." });
  if (qual.qualification) {
    checks.push({ check: "outcome", status: qual.qualification === "Not Qualified" ? "fail" : "pass",
      detail: `${qual.qualification} - ${qual.why}` });
  }

  /* The CRM's name for the lead is authoritative on the record; what was heard on a bad line only
     fills a gap. The heard name still travels into the check above, so overwriting here hides nothing. */
  const customerName = row.customer_name || (heardName && heardName.toLowerCase() !== "none" ? heardName : null);
  /* The feed's project is where the lead came from, which is not always what the agent pitched - so
     the project NAMED on the call wins when there is one, and the feed's is the fallback. */
  const namedProject = String(parsed?.project_discussed || "").trim();
  const project = (namedProject && namedProject.toLowerCase() !== "unclear") ? namedProject : (row.business_unit_name || null);
  const aiLost = df?.lost_reason && String(df.lost_reason).toLowerCase() !== "none" ? String(df.lost_reason) : null;
  const reason = qual.qualification === "Qualified" ? null
    : qual.qualification === "Follow-Up" ? (qual.why + (aiLost ? ` (${aiLost})` : ""))
    : (aiLost || qual.why);

  /* STAGE 3 - the agent's record against the call. Skipped entirely when there is nothing to
     compare, and a failure here never costs the transcript: the row still saves as done, just without
     a comparison, and has_discrepancy stays NULL meaning "not checked" rather than "fine". */
  const agentReason = String(row.crm_lost_reason || "").trim();
  const agentRemarks = String(row.crm_remarks || "").trim();
  /* The reason is only worth checking where it was asked for: a Lost lead that the call agrees is not
     qualified. On a Qualified or Follow-Up call the agent's "lost reason" is not in play. */
  const checkReason = !!agentReason
    && String(row.crm_status || "").toLowerCase() === "lost"
    && qual.qualification === "Not Qualified";
  let discrepancy: Record<string, unknown> | null = null;
  let hasDiscrepancy: boolean | null = null;

  if (checkReason || agentRemarks) {
    try {
      const sides = [
        "WHAT THE CALL CONTAINS",
        "Summary: " + String(parsed?.summary_verdict || "(none)"),
        "Why this lead did not progress, per the call: " + String(reason || "(none given)"),
        "Outcome: " + String(qual.qualification || "(none)"),
        "",
        "WHAT THE AGENT RECORDED",
        checkReason ? "Lost reason: " + agentReason : "Lost reason: (not applicable)",
        agentRemarks ? "Remarks: " + agentRemarks : "Remarks: (none)",
      ].join("\n");
      const cr = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + openaiKey },
        body: JSON.stringify({
          model: analysisModel, temperature: 0,
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: COMPARE_PROMPT }, { role: "user", content: sides }],
        }) });
      const cj = await cr.json().catch(() => ({}));
      if (!cr.ok) throw new Error("comparison failed (" + cr.status + ")");
      const got = JSON.parse(cj?.choices?.[0]?.message?.content || "{}");

      const out: Record<string, unknown> = {};
      if (checkReason && got?.lost_reason) {
        out.lost_reason = { agrees: got.lost_reason.agrees !== false,
                           note: String(got.lost_reason.note || ""),
                           agent: agentReason, call: reason };
      }
      if (agentRemarks && got?.remarks) {
        out.remarks = { agrees: got.remarks.agrees !== false,
                        note: String(got.remarks.note || ""),
                        agent: agentRemarks };
      }
      if (Object.keys(out).length) {
        discrepancy = out;
        hasDiscrepancy = Object.values(out).some((v: any) => v && v.agrees === false);
        for (const [kind, v] of Object.entries(out)) {
          const ok = (v as any).agrees !== false;
          checks.push({
            check: kind === "lost_reason" ? "agent_lost_reason_true" : "agent_remarks_true",
            status: ok ? "pass" : "fail",
            detail: "The agent's "
              + (kind === "lost_reason" ? "reason for losing this lead " : "remarks ")
              + (ok ? "match what the call contains. " : "do NOT match what the call contains. ")
              + String((v as any).note || "") });
        }
      }
    } catch (e) {
      /* A failed comparison is not a failed call. The transcript and the judgement stand; only the
         comparison is missing, and has_discrepancy stays null so it reads as unchecked. */
      checks.push({ check: "agent_record_compared", status: "skip",
        detail: "The agent's record could not be compared this time: " + String((e as any)?.message || e) });
    }
  } else {
    checks.push({ check: "agent_record_compared", status: "skip",
      detail: (agentRemarks || agentReason)
        ? "Nothing to compare: a lost reason is only checked on a Lost lead the call agrees is not qualified."
        : "The CRM holds no remarks or lost reason for this call, so there was nothing to compare." });
  }

  const { error } = await db.schema("acc").from("transcriptions").update({
    discrepancy, has_discrepancy: hasDiscrepancy,
    status: "done", attempts, duration_seconds: seconds, gladia_id: engine,
    utterances: turns, transcript: transcriptEn,
    transcript_en: transcriptEn, transcript_bn: transcriptBn,
    languages: languagesFrom(parsed?.languages),
    dashboard_fields: df, ai_lead_category: category,
    criteria: crit, qualification: qual.qualification, reason,
    qa_evaluation: parsed?.qa_evaluation || null, qa_score: qaScoreFor(parsed?.qa_evaluation),
    summary_verdict: parsed?.summary_verdict || null, summary: parsed?.summary_verdict || null,
    customer_name: customerName, project,
    mismatch: verdict.mismatch, mismatch_severity: verdict.severity, mismatch_reason: verdict.reason,
    verification: checks, non_transcribable_reason: null, error_text: null,
    updated_at: new Date().toISOString() }).eq("id", row.id);

  if (error) return fail("error", "could not save result: " + error.message, { duration_seconds: seconds });

  return { id: row.id, lead_id: row.lead_id, status: "done", engine, lead_category: category,
           qualification: qual.qualification, turns: turns.length,
           verbatim_chars: verbatim.length,
           per_second: seconds ? Math.round((verbatim.length/seconds)*10)/10 : null,
           reused_transcript: !!stored, attempts, mismatch: verdict.mismatch,
           discrepancy: hasDiscrepancy };
}

/* Put anything worth another go back in the queue before the queue is read, so the ordinary path
   picks it up with no special casing. Deliberately narrow: no_recording and too_short are never
   retried - there is nothing to fetch in the first, and the second was skipped on purpose to avoid
   paying to listen to a ring-out. */
async function promoteRetries(db: DB) {
  const after = new Date(Date.now() - RETRY_AFTER_MINUTES * 60e3).toISOString();
  const requeue = { status: "queued", error_text: null, verification: null,
                    non_transcribable_reason: null, updated_at: new Date().toISOString() };
  let errors = 0, noSpeech = 0;

  {
    const { data } = await db.schema("acc").from("transcriptions").update(requeue)
      .eq("source", SOURCE).eq("status", "error")
      .not("recording_url", "is", null).is("deleted_at", null)
      .lt("attempts", MAX_ATTEMPTS_ERROR).lt("updated_at", after).select("id");
    errors = (data || []).length;
  }
  {
    const { data } = await db.schema("acc").from("transcriptions").update(requeue)
      .eq("source", SOURCE).eq("status", "non_transcribable")
      .not("recording_url", "is", null).is("deleted_at", null)
      .lt("attempts", MAX_ATTEMPTS_NO_SPEECH).lt("updated_at", after).select("id");
    noSpeech = (data || []).length;
  }
  return { errors, no_speech: noSpeech };
}

async function doWork(db: DB, limit: number, openaiKey: string,
                      sttModel = STT_MODEL, analysisModel = ANALYSIS_MODEL,
                      engine = "chatgpt", geminiKey = "", geminiModel = GEMINI_MODEL) {
  const retried = await promoteRetries(db);
  const cols = "id, lead_id, recording_url, crm_status, report_date, business_unit_name, customer_name, "
    + "attempts, transcript, crm_lost_reason, crm_remarks, next_follow_up_date";
  const { data: queue, error } = await db.schema("acc").from("transcriptions").select(cols)
    .eq("source", SOURCE).eq("status", "queued").is("deleted_at", null)
    .order("id", { ascending: true }).limit(limit);
  if (error) return j({ error: error.message }, 500);
  if (!queue || !queue.length) return { processed: 0, remaining: 0, retried, results: [] };

  // Claim first, so an overlapping tick takes different rows instead of paying twice.
  const { data: claimed } = await db.schema("acc").from("transcriptions")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .in("id", queue.map((r) => r.id)).eq("status", "queued").select(cols);

  const mine = claimed || [];
  const results: unknown[] = [];
  for (let i = 0; i < mine.length; i += CONCURRENCY) {
    results.push(...await Promise.all(mine.slice(i, i + CONCURRENCY).map((r) =>
      processOne(db, r, openaiKey, sttModel, analysisModel, engine, geminiKey, geminiModel).catch((e) => ({
        id: r.id, lead_id: r.lead_id, status: "error", error: String((e as any)?.message || e) })))));
  }
  const { count } = await db.schema("acc").from("transcriptions")
    .select("id", { count: "exact", head: true })
    .eq("source", SOURCE).eq("status", "queued").is("deleted_at", null);
  return { processed: results.length, remaining: count ?? 0, retried,
           engine, transcriber: engine === "gemini" ? geminiModel : sttModel, analysisModel, results };
}

// ---------------------------------------------------------------- HTTP
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const SB = Deno.env.get("SUPABASE_URL")!;
  const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SECRET = Deno.env.get("SYNC_SECRET");
  // This project names it CHATGPT_API_KEY; the conventional name is accepted as well.
  const OPENAI_KEY = Deno.env.get("CHATGPT_API_KEY") || Deno.env.get("OPENAI_API_KEY") || "";
  const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") || "";

  const secretHeader = req.headers.get("x-sync-secret") || "";
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const db = createClient(SB, SRV);
  let authorized = false, viaCron = false;

  if (secretHeader) {
    // acc.job_secrets has RLS on with no policies, so only the service role can read it.
    try {
      const { data } = await db.schema("acc").from("job_secrets")
        .select("value").eq("name", JOB_SECRET_NAME).maybeSingle();
      if (data?.value && secretHeader === data.value) { authorized = true; viaCron = true; }
    } catch { /* fall through */ }
    if (!authorized && SECRET && secretHeader === SECRET) { authorized = true; viaCron = true; }
  }
  if (!authorized && bearer) {
    const asUser = createClient(SB, Deno.env.get("SUPABASE_ANON_KEY") || SRV, {
      global: { headers: { Authorization: "Bearer " + bearer } } });
    const { data } = await asUser.auth.getUser();
    authorized = !!data?.user;
  }
  if (!authorized) return j({ error: "unauthorized" }, 401);
  if (!OPENAI_KEY) return j({ error: "CHATGPT_API_KEY not configured in Secrets - the analysis stage needs it" }, 500);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }

  const action = String(body.action || "run");
  const trigger = viaCron ? "cron" : "manual";
  const from = isDate(body.from) ? body.from : istYesterday();
  const to = isDate(body.to) ? body.to : (isDate(body.from) ? body.from : istYesterday());
  if (from > to) return j({ error: "`from` is after `to`" }, 400);
  if (to > istToday()) return j({ error: "`to` is in the future" }, 400);
  // One round of CONCURRENCY per invocation: two API calls per recording, so a small batch keeps each
  // invocation well inside its wall clock.
  const limit = Math.min(Math.max(Number(body.limit) || 3, 1), 24);
  /* Optional per-request models, so a new id can be proved on one call before it becomes the default
     for every call. Restricted to the shape of a model name so a request cannot point the URL
     somewhere else. */
  const reqStt = String(body.stt_model || body.model || "").trim();
  if (reqStt && !/^[a-zA-Z0-9._-]{3,60}$/.test(reqStt)) return j({ error: "that does not look like a model name" }, 400);
  const sttModel = reqStt || STT_MODEL;
  /* Which engine does the LISTENING. ChatGPT by default; "gemini" is here so the two can be run over
     the same recordings and compared rather than argued about. The judging is gpt-4o either way. */
  const engine = String(body.engine || "chatgpt").trim().toLowerCase() === "gemini" ? "gemini" : "chatgpt";
  const reqGemini = String(body.gemini_model || "").trim();
  if (reqGemini && !/^[a-zA-Z0-9._-]{3,60}$/.test(reqGemini)) return j({ error: "that does not look like a model name" }, 400);
  const geminiModel = reqGemini || GEMINI_MODEL;
  const reqAnalysis = String(body.analysis_model || "").trim();
  if (reqAnalysis && !/^[a-zA-Z0-9._-]{3,60}$/.test(reqAnalysis)) return j({ error: "that does not look like a model name" }, 400);
  const analysisModel = reqAnalysis || ANALYSIS_MODEL;

  try {
    if (action === "status") {
      const counts: Record<string, number> = {};
      for (const st of ["queued","processing","done","non_transcribable","no_recording","too_short","error"]) {
        const { count } = await db.schema("acc").from("transcriptions")
          .select("id", { count: "exact", head: true })
          .eq("source", SOURCE).eq("status", st).is("deleted_at", null);
        counts[st] = count ?? 0;
      }
      const { data: last } = await db.schema("acc").from("lost_call_sync_runs")
        .select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();
      return j({ ok: true, counts, last_run: last || null,
                 transcriber: STT_MODEL, analyst: ANALYSIS_MODEL });
    }
    if (action === "retry") {
      const id = Number(body.id);
      if (!id) return j({ error: "missing id" }, 400);
      const { data, error } = await db.schema("acc").from("transcriptions")
        .update({ status: "queued", error_text: null, verification: null,
                  mismatch: null, mismatch_severity: null, mismatch_reason: null,
                  updated_at: new Date().toISOString() })
        .eq("id", id).not("recording_url", "is", null).select("id, status").maybeSingle();
      if (error) return j({ error: error.message }, 500);
      if (!data) return j({ error: "no such call, or it has no recording URL to retry" }, 404);
      return j({ ok: true, requeued: id, work: await doWork(db, 1, OPENAI_KEY, sttModel, analysisModel, engine, GEMINI_KEY, geminiModel) });
    }
    if (action === "pull") {
      const pulled = await doPull(db, from, to, trigger);
      return pulled instanceof Response ? pulled : j({ ok: true, action, ...pulled });
    }
    if (action === "work") {
      const worked = await doWork(db, limit, OPENAI_KEY, sttModel, analysisModel, engine, GEMINI_KEY, geminiModel);
      return worked instanceof Response ? worked : j({ ok: true, action, ...worked });
    }
    if (action === "run") {
      const pulled = await doPull(db, from, to, trigger);
      if (pulled instanceof Response) return pulled;
      const worked = await doWork(db, limit, OPENAI_KEY, sttModel, analysisModel, engine, GEMINI_KEY, geminiModel);
      return worked instanceof Response ? worked : j({ ok: true, action, pull: pulled, work: worked });
    }
    return j({ error: `unknown action "${action}"` }, 400);
  } catch (e) {
    return j({ error: String((e as any)?.message || e) }, 500);
  }
});
