/* AGREEMENT TEMPLATE FROM A WORD FILE (26 Oct 2026).

   The Dream World City agreements were supplied as .docx (one per promoter company), not as the
   signed PDF the Gurukul template was cut from. This reads the Word file's own XML - paragraphs and
   tables in order, with Word's automatic clause numbers worked out the way Word draws them - and
   writes the same {project, blocks:[...]} shape assets/forms/agreement-gurukul.js uses.

   The words are the file's own. The only changes are the replacements listed per template in
   TEMPLATES below: each swaps one customer's particulars (name, flat, price...) for a {{token}}
   that accountability.js fills for the next customer. A replacement that does not match exactly
   once stops the run, so a template can never silently keep one customer's details.

   Usage:  node tools/agreement/docx_template.mjs <dghl.docx> <jgppl.docx>
   Writes: assets/forms/agreement-dwc-dghl.js, assets/forms/agreement-dwc-jgppl.js */

import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function unzip(file, name){
  const b=fs.readFileSync(file);
  let i=b.length-22; while(b.readUInt32LE(i)!==0x06054b50) i--;
  const n=b.readUInt16LE(i+10); let o=b.readUInt32LE(i+16);
  for(let k=0;k<n;k++){
    const nl=b.readUInt16LE(o+28), el=b.readUInt16LE(o+30), cl=b.readUInt16LE(o+32);
    const lo=b.readUInt32LE(o+42), meth=b.readUInt16LE(o+10), cs=b.readUInt32LE(o+20);
    const nm=b.slice(o+46,o+46+nl).toString();
    if(nm===name){
      const l=lo+30+b.readUInt16LE(lo+26)+b.readUInt16LE(lo+28);
      const d=b.slice(l,l+cs);
      return meth?zlib.inflateRawSync(d).toString('utf8'):d.toString('utf8');
    }
    o+=46+nl+el+cl;
  }
  return '';
}
const ent=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
const attr=(xml,tag,a)=>{ const m=xml.match(new RegExp('<'+tag+'\\b[^>]*\\b'+a+'="([^"]*)"')); return m?m[1]:null; };

/* ---- numbering: what Word prints in front of a numbered paragraph ---- */
function numbering(numXml, stylesXml){
  const abs={}, nums={}, styleNum={};
  for(const m of numXml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)){
    const lv={};
    for(const l of m[2].matchAll(/<w:lvl\b[^>]*w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g)){
      lv[l[1]]={start:Number(attr(l[2],'w:start','w:val')||1), fmt:attr(l[2],'w:numFmt','w:val')||'decimal',
                text:attr(l[2],'w:lvlText','w:val')||''};
    }
    abs[m[1]]=lv;
  }
  for(const m of numXml.matchAll(/<w:num\b[^>]*w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/g)){
    const over={};
    for(const o of m[2].matchAll(/<w:lvlOverride\b[^>]*w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvlOverride>/g)){
      const s=attr(o[2],'w:startOverride','w:val'); if(s!=null) over[o[1]]=Number(s);
    }
    nums[m[1]]={abs:attr(m[2],'w:abstractNumId','w:val'), over};
  }
  for(const m of stylesXml.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)){
    const id=attr(m[2],'w:numId','w:val'); if(id) styleNum[m[1]]={numId:id, ilvl:attr(m[2],'w:ilvl','w:val')||'0'};
  }
  const counters={};   // per abstract list, like Word
  const roman=(n)=>{ const r=[[1000,'m'],[900,'cm'],[500,'d'],[400,'cd'],[100,'c'],[90,'xc'],[50,'l'],[40,'xl'],[10,'x'],[9,'ix'],[5,'v'],[4,'iv'],[1,'i']]; let s=''; for(const [v,t] of r){ while(n>=v){ s+=t; n-=v; } } return s; };
  const letter=(n)=>{ let s=''; while(n>0){ n--; s=String.fromCharCode(97+n%26)+s; n=Math.floor(n/26); } return s; };
  const fmtOne=(n,f)=> f==='lowerLetter'?letter(n): f==='upperLetter'?letter(n).toUpperCase()
    : f==='lowerRoman'?roman(n): f==='upperRoman'?roman(n).toUpperCase(): f==='bullet'?'•': String(n);
  return function label(numId, ilvl){
    const N=nums[numId]; if(!N || numId==='0') return '';
    const A=abs[N.abs]; if(!A) return '';
    const L=Number(ilvl||0), key=N.abs;
    const c=counters[key]||(counters[key]={});
    const lv=A[L]||{start:1,fmt:'decimal',text:''};
    if(lv.fmt==='bullet') return '•';
    if(c[L]==null) c[L]=(N.over[L]!=null?N.over[L]:lv.start); else c[L]++;
    for(const k of Object.keys(c)) if(Number(k)>L) delete c[k];
    return lv.text.replace(/%(\d)/g,(_m,d)=>{ const li=Number(d)-1; const v=(c[li]!=null?c[li]:(A[li]||{start:1}).start);
      return fmtOne(v,(A[li]||{fmt:'decimal'}).fmt); });
  };
}

/* ---- the body: paragraphs and tables, in order ---- */
function topLevel(body){
  // Splits the body into its top-level <w:p> and <w:tbl> elements (tables hold paragraphs of their own).
  const out=[]; let i=0;
  while(i<body.length){
    const p=body.indexOf('<w:p',i), t=body.indexOf('<w:tbl>',i);
    const nextP=(p>=0 && /[\s>]/.test(body[p+4]))?p:(p>=0?body.indexOf('<w:p ',p+1):-1);
    if(t>=0 && (nextP<0 || t<nextP)){
      let depth=0, j=t;
      while(j<body.length){
        const o=body.indexOf('<w:tbl>',j), c=body.indexOf('</w:tbl>',j);
        if(o>=0 && o<c){ depth++; j=o+7; } else { depth--; j=c+8; if(depth===0) break; }
      }
      out.push({k:'tbl', x:body.slice(t,j)}); i=j; continue;
    }
    if(nextP<0) break;
    const self=body.slice(nextP, body.indexOf('>',nextP)+1).endsWith('/>');
    if(self){ i=body.indexOf('>',nextP)+1; continue; }
    const e=body.indexOf('</w:p>',nextP);
    out.push({k:'p', x:body.slice(nextP,e+6)}); i=e+6;
  }
  return out;
}
function paraText(px){
  let s='';
  for(const m of px.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)){
    if(m[1]!=null) s+=ent(m[1]); else s+=' ';
  }
  return s.replace(/\s+/g,' ').trim();
}
function isHeading(px, text){
  if(!text || text.length>90) return false;
  const centred=/<w:jc w:val="center"\/>/.test(px.split('<w:r')[0]);
  const runs=[...px.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)].map(m=>m[0]).filter(r=>/<w:t\b/.test(r));
  const allBold=runs.length>0 && runs.every(r=>/<w:b\/>|<w:b w:val="(1|true)"\/>/.test(r));
  return centred || (allBold && text===text.toUpperCase() && /[A-Z]/.test(text));
}
function blocks(docx){
  const doc=unzip(docx,'word/document.xml');
  const label=numbering(unzip(docx,'word/numbering.xml'), unzip(docx,'word/styles.xml'));
  const body=doc.slice(doc.indexOf('<w:body>')+8, doc.lastIndexOf('</w:body>'));
  const out=[];
  const styleNumOf=(px)=>null;
  for(const el of topLevel(body)){
    if(el.k==='tbl'){
      const rows=[];
      for(const r of el.x.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)){
        const cells=[...r[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map(c=>
          [...c[0].matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map(p=>paraText(p[0])).filter(Boolean).join(' '));
        if(cells.some(Boolean)) rows.push(cells);
      }
      if(rows.length) out.push({t:'table', id:'static', head:null, rows});
      continue;
    }
    const text=paraText(el.x);
    const pPr=(el.x.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)||[''])[0];
    const numId=attr(pPr,'w:numId','w:val'), ilvl=attr(pPr,'w:ilvl','w:val');
    const lab=numId?label(numId,ilvl):'';
    if(!text) continue;
    const x=(lab?lab+(lab==='•'?' ':' '):'')+text;
    out.push({t:isHeading(el.x,text)?'h':'p', x});
  }
  return out;
}

/* ---- one customer's particulars become tokens ---- */
function tokenise(bl, reps, name){
  let all=JSON.stringify(bl);
  for(const [from,to] of reps){
    const f=JSON.stringify(from).slice(1,-1);
    const n=all.split(f).length-1;
    if(n!==1) throw new Error(name+': expected exactly one "'+from.slice(0,70)+'", found '+n);
    all=all.replace(f, JSON.stringify(to).slice(1,-1));
  }
  return JSON.parse(all);
}

const [dghl, jgppl, dumpOnly]=process.argv.slice(2);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const TEMPLATES=JSON.parse(fs.readFileSync(path.join(root,'tools','agreement','dwc_tokens.json'),'utf8'));
for(const [file,key] of [[dghl,'dghl'],[jgppl,'jgppl']]){
  const T=TEMPLATES[key];
  let bl=blocks(file);
  if(dumpOnly){ fs.writeFileSync(key+'.blocks.json', JSON.stringify(bl,null,1)); console.log(key, bl.length,'blocks (dumped)'); continue; }
  bl=tokenise(bl, T.replace, key);
  // The title is a heading, whatever Word's own formatting said.
  if(bl[0] && /^AGREEMENT FOR SALE$/i.test(bl[0].x||'')) bl[0].t='h';
  // A line that held only the customer's address continuation is now empty - it goes.
  bl=bl.filter(b=>b.t==='table' || String(b.x||'').trim()!=='');
  /* THE PRICE TABLE: the row labels stay the file's own; each value becomes the token for this
     customer's figure. Every row must be accounted for, so a table that changes shape stops the run. */
  const pt=bl.find(b=>b.t==='table' && b.rows.some(r=>/^Block\/Building No\./.test(r[0])));
  if(!pt) throw new Error(key+': price table not found');
  pt.id='dwcprice';
  pt.rows=pt.rows.map(r=>{
    const m=T.price_rows[r[0]];
    if(m) return [m[0]||r[0], m[1]];
    if(/^Taxes/.test(r[0])) return r;            // "NIL" - the company's own statement, not a figure of this sale
    throw new Error(key+': price row with no token: '+r[0]);
  });
  // THE PAYMENT PLAN is drawn from the booking's own cost-sheet schedule, so its rows are not kept.
  const plan=bl.find(b=>b.t==='table' && b.rows[0] && /^Booking Amount$/.test(b.rows[0][0]));
  if(!plan) throw new Error(key+': payment plan table not found');
  plan.id='dwcplan'; plan.rows=[];
  const left=JSON.stringify(bl).match(new RegExp(T.must_not_remain.join('|'),'gi'));
  if(left) throw new Error(key+': customer details still present: '+[...new Set(left)].join(', '));
  const js='/* '+T.title+' - AGREEMENT FOR SALE, as a template.\n\n'
    +'   Every word is the supplied Word file\'s own; what is marked {{like_this}} is the only part that\n'
    +'   varies from customer to customer. Generated by tools/agreement/docx_template.mjs from\n'
    +'   '+path.basename(file)+' with tools/agreement/dwc_tokens.json; edit those, not this. */\n'
    +'window.'+T.global+' = '+JSON.stringify({project:T.project, company:T.company, blocks:bl},null,1)+';\n';
  fs.writeFileSync(path.join(root,'assets','forms',T.out), js);
  console.log(key, bl.length,'blocks ->', T.out);
}
