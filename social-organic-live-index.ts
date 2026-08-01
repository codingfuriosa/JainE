// Reference copy of the deployed Supabase edge function `social-organic-live`.
// Organic content (Business Suite -> Content -> Posts & Reels) for our own Pages, into camp.social_*.
//
// METRIC NAMES MATTER MORE THAN THE DOCS SUGGEST - all probed live against the real Page:
//   posts : post_clicks, post_clicks_by_type, post_reactions_by_type_total,
//           post_activity_by_action_type, post_video_views, post_video_views_unique,
//           post_video_avg_time_watched, post_video_view_time
//   reels : the post_video_* names on the video_insights edge - NOT the total_video_* family,
//           which is accepted but returns null. fb_reels_total_plays is the complete play count
//           (blue_reels_play_count undercounts: 619 vs 726 on the same reel).
//   GONE  : post_impressions, post_impressions_unique, post_reach, post_engaged_users,
//           post_follows - rejected as invalid on v20, so Reach cannot be had at all.
//
// CRITICAL: Graph fails the ENTIRE insights request if ONE metric name is invalid for that
// object type. post_video_views_unique is valid on posts but NOT on reels, and including it in
// the reel batch silently blanked every reel metric. Only add a name probed on its own first.
//
// PERFORMANCE: post insights come back inline (one call per 50 posts). Reels have no inline
// equivalent, so their insight calls are fired in CONCURRENT batches - 150 sequential round
// trips exceeded the worker's wall-clock budget.
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const j=(o:any,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{...cors,'Content-Type':'application/json'}});
const G='https://graph.facebook.com/v20.0';
const num=(x:any)=>{const n=Number(x);return isFinite(n)?Math.round(n):0;};
const POST_METRICS='post_clicks,post_clicks_by_type,post_reactions_by_type_total,post_activity_by_action_type,post_video_views,post_video_views_unique,post_video_avg_time_watched,post_video_view_time';
const REEL_METRICS='fb_reels_total_plays,blue_reels_play_count,post_video_view_time,post_video_avg_time_watched,post_video_followers,post_video_likes_by_reaction_type';

async function gget(url:string){
  const r=await fetch(url); const b=await r.json().catch(()=>({}));
  if(b&&b.error) return {err:b.error.message||'graph error', code:b.error.code};
  return b;
}
async function gall(url:string, maxPages:number, cap:number){
  const out:any[]=[]; let next:string|null=url;
  for(let i=0;i<maxPages && next && out.length<cap;i++){
    const b:any=await gget(next);
    if(b?.err) return {err:b.err, code:b.code, data:out};
    (b.data||[]).forEach((x:any)=>out.push(x));
    next=b.paging?.next||null;
  }
  return {data:out};
}
// run an async mapper over items, `size` at a time
async function inBatches<T,R>(items:T[], size:number, fn:(x:T)=>Promise<R>):Promise<R[]>{
  const out:R[]=[];
  for(let i=0;i<items.length;i+=size){ out.push(...await Promise.all(items.slice(i,i+size).map(fn))); }
  return out;
}
function nested(p:any){ const m:any={}; (p?.insights?.data||[]).forEach((x:any)=>{ m[x.name]=x.values?.[0]?.value; }); return m; }
function kindOf(p:any){
  const at=String(p.attachments?.data?.[0]?.media_type||'').toLowerCase();
  const sub=String(p.attachments?.data?.[0]?.type||'').toLowerCase();
  if(sub.includes('reel')||at==='reel') return 'reel';
  if(at==='album'||sub.includes('album')||sub==='new_album') return 'carousel';
  return 'post';
}
function thumbOf(p:any){
  const a=p.attachments?.data?.[0];
  return p.full_picture || a?.media?.image?.src || a?.subattachments?.data?.[0]?.media?.image?.src || null;
}
function rxObj(rx:any){ rx=rx||{}; return {like:num(rx.like),love:num(rx.love),wow:num(rx.wow),haha:num(rx.haha),sad:num(rx.sorry||rx.sad),angry:num(rx.anger||rx.angry),care:num(rx.care)}; }
function rxTotal(o:any){ return Object.keys(o||{}).reduce((a,k)=>a+(Number(o[k])||0),0); }
function reelRx(o:any){ o=o||{}; const g=(k:string)=>num(o['REACTION_'+k]||o[k.toLowerCase()]);
  return {like:g('LIKE'),love:g('LOVE'),wow:g('WOW'),haha:g('HAHA'),sad:g('SORRY'),angry:g('ANGER'),care:g('CARE')}; }

Deno.serve(async (req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return j({error:'method not allowed'},405);
  const SB=Deno.env.get('SUPABASE_URL')!,ANON=Deno.env.get('SUPABASE_ANON_KEY')!,SRV=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
  if(!token)return j({error:'missing token'},401);
  if(token!==SRV){
    const who=await fetch(SB+'/auth/v1/user',{headers:{Authorization:'Bearer '+token,apikey:ANON}});
    if(!who.ok)return j({error:'unauthorized'},401);
  }
  const T=Deno.env.get('META_PAGES_TOKEN')||Deno.env.get('META_SYSTEM_TOKEN')||Deno.env.get('META_ACCESS_TOKEN');
  if(!T)return j({error:'No Meta token secret set'},500);
  const t=encodeURIComponent(T);
  const db=createClient(SB,SRV);
  let body:any={}; try{ body=await req.json(); }catch(_e){}
  const since=body.since||'', until=body.until||'';
  const maxPages=Math.min(Number(body.max_pages)||4, 12);
  const cap=maxPages*50;
  const reelPages=Math.min(Number(body.reel_pages)||2, 8);
  const doPosts=body.only!=='reels', doReels=body.only!=='posts';
  const report:any={pages:0, posts:0, reels:0, ig:0, truncated:false, errors:[] as string[]};

  const pg=await gget(G+'/me/accounts?fields=id,name,username,access_token,followers_count,fan_count,picture{url},instagram_business_account{id,username,followers_count,profile_picture_url}&limit=50&access_token='+t);
  if((pg as any).err) return j({error:'Cannot list Pages: '+(pg as any).err},400);
  const pages=(pg as any).data||[];
  if(!pages.length) return j({error:'This token sees 0 Pages. Assign the Pages to the system user and give it the Insights task.'},400);

  for(const P of pages){
    if(!P.access_token){ report.errors.push(P.name+': no Page token - give the system user the Insights task on this Page'); continue; }
    const pt=encodeURIComponent(P.access_token);
    const ig=P.instagram_business_account;
    await db.schema('camp').from('social_pages').upsert({
      id:P.id, network:'facebook', name:P.name, username:P.username||null,
      picture:P.picture?.data?.url||null, followers:num(P.followers_count), fan_count:num(P.fan_count),
      ig_id:ig?.id||null, ig_username:ig?.username||null, updated_at:new Date().toISOString()
    },{onConflict:'id'});
    report.pages++;

    if(doPosts){
      let purl=G+'/'+P.id+'/published_posts?limit=50&fields=id,message,story,created_time,permalink_url,full_picture,status_type,'
        +'attachments{media_type,type,url,media,subattachments},shares,comments.summary(true).limit(0),likes.summary(true).limit(0),'
        +'insights.metric('+POST_METRICS+')&access_token='+pt;
      if(since) purl+='&since='+since;
      if(until) purl+='&until='+until;
      const posts:any=await gall(purl, maxPages, cap);
      if(posts.err) report.errors.push(P.name+' posts: '+posts.err);
      if((posts.data||[]).length>=cap) report.truncated=true;
      const rows=(posts.data||[]).map((p:any)=>{
        const M=nested(p), act=M.post_activity_by_action_type||{};
        const rx=rxObj(M.post_reactions_by_type_total);
        const likes=num(p.likes?.summary?.total_count)||rxTotal(rx);
        const comments=num(p.comments?.summary?.total_count);
        const shares=num(p.shares?.count)||num(act.share);
        return {
          id:p.id, page_id:P.id, page_name:P.name, network:'facebook', kind:kindOf(p),
          message:p.message||p.story||'', permalink:p.permalink_url||null,
          media_url:p.attachments?.data?.[0]?.url||null, thumbnail:thumbOf(p),
          created_time:p.created_time||null,
          likes:likes, comments:comments, shares:shares, interactions:likes+comments+shares,
          reactions:rx,
          clicks:num(M.post_clicks), clicks_by_type:M.post_clicks_by_type||null,
          video_views:num(M.post_video_views), viewers:num(M.post_video_views_unique),
          video_avg_watch_ms:num(M.post_video_avg_time_watched), video_total_time_ms:num(M.post_video_view_time),
          synced_at:new Date().toISOString()
        };
      });
      for(let i=0;i<rows.length;i+=100){
        const { error }=await db.schema('camp').from('social_posts').upsert(rows.slice(i,i+100),{onConflict:'id'});
        if(error) report.errors.push('save posts: '+error.message);
      }
      report.posts+=rows.length;
    }

    if(doReels){
      const rl:any=await gall(G+'/'+P.id+'/video_reels?limit=50&fields=id,description,title,created_time,permalink_url,picture,length,views,'
        +'likes.summary(true).limit(0),comments.summary(true).limit(0)&access_token='+pt, reelPages, reelPages*50);
      if(rl.err) report.errors.push(P.name+' reels: '+rl.err);
      const rrows=await inBatches((rl.data||[]), 10, async (r:any)=>{
        const vi:any=await gget(G+'/'+r.id+'/video_insights?metric='+REEL_METRICS+'&access_token='+pt);
        if(vi?.err && report.errors.length<6) report.errors.push('reel insights: '+vi.err);
        const M:any={}; if(!vi?.err)(vi.data||[]).forEach((x:any)=>{M[x.name]=x.values?.[0]?.value;});
        const rx=reelRx(M.post_video_likes_by_reaction_type);
        const plays=num(M.fb_reels_total_plays)||num(r.views)||num(M.blue_reels_play_count);
        const likes=num(r.likes?.summary?.total_count)||rxTotal(rx);
        const comments=num(r.comments?.summary?.total_count);
        return {
          id:r.id, page_id:P.id, page_name:P.name, network:'facebook', kind:'reel',
          message:r.description||r.title||'', permalink:r.permalink_url||null, thumbnail:r.picture||null,
          created_time:r.created_time||null, video_length_s:r.length||null,
          likes:likes, comments:comments, shares:0, interactions:likes+comments,
          reactions:rx,
          video_views:plays, follows:num(M.post_video_followers),
          video_total_time_ms:num(M.post_video_view_time), video_avg_watch_ms:num(M.post_video_avg_time_watched),
          synced_at:new Date().toISOString()
        };
      });
      for(let i=0;i<rrows.length;i+=100){
        const { error }=await db.schema('camp').from('social_posts').upsert(rrows.slice(i,i+100),{onConflict:'id'});
        if(error) report.errors.push('save reels: '+error.message);
      }
      report.reels+=rrows.length;
    }

    if(ig?.id && doPosts){
      await db.schema('camp').from('social_pages').upsert({
        id:ig.id, network:'instagram', name:'@'+(ig.username||''), username:ig.username||null,
        picture:ig.profile_picture_url||null, followers:num(ig.followers_count), updated_at:new Date().toISOString()
      },{onConflict:'id'});
      const im:any=await gall(G+'/'+ig.id+'/media?limit=50&fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,insights.metric(reach,saved,total_interactions)&access_token='+pt, 3, 150);
      if(im.err) report.errors.push('instagram: '+im.err);
      const irows=(im.data||[]).map((m:any)=>{
        const M=nested(m);
        const mt=String(m.media_product_type||'').toUpperCase()==='REELS'?'reel'
          :(String(m.media_type||'').toUpperCase()==='CAROUSEL_ALBUM'?'carousel':'post');
        const likes=num(m.like_count), comments=num(m.comments_count);
        return {id:m.id, page_id:ig.id, page_name:'@'+(ig.username||''), network:'instagram', kind:mt,
          message:m.caption||'', permalink:m.permalink||null, media_url:m.media_url||null,
          thumbnail:m.thumbnail_url||m.media_url||null, created_time:m.timestamp||null,
          likes:likes, comments:comments, saves:num(M.saved), interactions:num(M.total_interactions)||(likes+comments),
          reach:num(M.reach), engaged_users:num(M.total_interactions), synced_at:new Date().toISOString()};
      });
      if(irows.length){ const { error }=await db.schema('camp').from('social_posts').upsert(irows,{onConflict:'id'}); if(error) report.errors.push('save instagram: '+error.message); }
      report.ig+=irows.length;
    }
  }
  return j({ok:true, ...report});
});
