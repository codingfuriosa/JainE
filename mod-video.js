const VIDEOS=[
  // ── Training videos (open directly in YouTube) ──────────────────────────
  {t:'Dream Eco City - B',cat:'Training',yt:'hW168rf3DWg',url:'https://youtu.be/hW168rf3DWg'},
  {t:'Dream Eco City - HO',cat:'Training',yt:'Q4j5TSYPX50',url:'https://youtu.be/Q4j5TSYPX50'},
  {t:'Sales Training Pitch',cat:'Training',yt:'u5lcUE7ocwU',url:'https://youtu.be/u5lcUE7ocwU'},
  {t:'Dream Gurukul Sales Pitch',cat:'Training',yt:'tynTW_MhGLY',url:'https://www.youtube.com/watch?v=tynTW_MhGLY'},
  {t:'Dream Eco City Bungalows Pitch',cat:'Training',yt:'hW168rf3DWg',url:'https://youtu.be/hW168rf3DWg'},
  {t:'Sales Training Pitch (Oct 19)',cat:'Training',yt:'Q4j5TSYPX50',url:'https://youtu.be/Q4j5TSYPX50'},
  {t:'TagAtask Training 1',cat:'Training',yt:'t2PmvQ2RUxg',url:'https://youtu.be/t2PmvQ2RUxg'},
  {t:'TagAtask Training 2',cat:'Training',yt:'inunx2qhPCI',url:'https://youtu.be/inunx2qhPCI'},
  {t:'Training for TagAtask',cat:'Training',yt:'1QrBgnMboXE',url:'https://youtu.be/1QrBgnMboXE'},
  {t:'Hotel Bill Tracker Video',cat:'Training',yt:'E_O2VTMljcs',url:'https://youtu.be/E_O2VTMljcs'},
  {t:'Head Office Bill Tracker System',cat:'Training',yt:'hrmF_Q6FHic',url:'https://youtu.be/hrmF_Q6FHic'},
  {t:'Tele Caller Training Part 1',cat:'Training',yt:'nBp1DihUvsc',url:'https://youtu.be/nBp1DihUvsc'},
  {t:'Tele Caller Training Part 2',cat:'Training',yt:'iUR7r2nshAw',url:'https://youtu.be/iUR7r2nshAw'},
  {t:'ChatGPT Hindi',cat:'Training',yt:'Nz1MI8nsFTs',url:'https://youtu.be/Nz1MI8nsFTs'},
  {t:'Conveyance payment',cat:'Training',yt:'5anvF_uEE7w',url:'https://youtu.be/5anvF_uEE7w'},
  {t:'Accountability',cat:'Training',yt:'x8qThRAEO-I',url:'https://youtu.be/x8qThRAEO-I'},
  // ── WalkThrough videos ───────────────────────────────────────────────────
  {t:'Dream Gurukul',cat:'WalkThrough',yt:'4bWFJfU5AYg',url:'https://youtu.be/4bWFJfU5AYg?list=PLYy3u2uXULpWE5EzepbEQ5IcBWJaCYUWE'},
  {t:'Dream World City',cat:'WalkThrough',yt:'2hUcUUbF_1k',url:'https://youtu.be/2hUcUUbF_1k?list=PLYy3u2uXULpVxlLWwmLfW36kHn8j2gKcr'},
  {t:'Dream One',cat:'WalkThrough',yt:'YEHL1Wi16d0',url:'https://youtu.be/YEHL1Wi16d0?list=PLYy3u2uXULpV91mBBQeJFAQq5zyWcTQB9'},
  {t:'Dream Valley',cat:'WalkThrough',yt:'v43BAzo-Ric',url:'https://youtu.be/v43BAzo-Ric?list=PLYy3u2uXULpV5xDmsOWOw8cmctDH07LZm'},
  {t:'Dream Eco City',cat:'WalkThrough',yt:'mOymoLR5nro',url:'https://youtu.be/mOymoLR5nro?list=PLYy3u2uXULpX1O7WknBnY7v61xr9EW_wC'}
];
/* ============================ FEEDBACK HUB ============================
   QR-code feedback forms. Design builds a form (fixed question types: rating, multiple choice,
   short text, long text) and gets a QR/link; anyone who scans it lands on the public
   feedback-fill.html page (no login) which talks to the single feedback-get-form edge function
   (action:'get'|'submit' -- folded into one function because this project is at its edge-function
   slot cap). Records shows what came back. Module visibility is already gated by NAV + roles.modules
   like every other module, so anyone who can see this page can manage forms and read responses.

   UI follows "Don't Make Me Think": a form is a row of cards, not a cramped table; adding a question
   means picking a self-labelled tile (icon + one-line description of what it does), not guessing from
   a bare button; every action is an icon WITH a word next to it, never an icon alone. */
VIEWS.video=function(v,seg){
  setCrumb(['Knowledge','Video Library']);
  const tabs=['All Videos','Training','Youtube','WalkThrough'];
  let ti=parseInt(seg&&seg[0]); if(isNaN(ti)||ti<0||ti>=tabs.length)ti=0;
  const tname=tabs[ti];
  const list=ti===0?VIDEOS:VIDEOS.filter(x=>x.cat===tname);
  const tabbar='<div class="tabs">'+tabs.map((t,i)=>'<div class="tab '+(i===ti?'active':'')+'" onclick="navTo(\'video/'+i+'\')">'+esc(t)+'</div>').join('')+'</div>';
  function vidCard(x){
    const ytOpen=(x.cat==='Youtube'||x.cat==='WalkThrough'||x.cat==='Training');
    const ytUrl=x.url||('https://www.youtube.com/watch?v='+x.yt);
    const badge=ytOpen?'<span style="position:absolute;top:8px;right:8px;background:#ff0000;color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;letter-spacing:.4px;line-height:1.6"><i class=\"fa-brands fa-youtube\"></i> YouTube</span>':'';
    const thumbUrl=x.yt?('https://img.youtube.com/vi/'+x.yt+'/hqdefault.jpg'):'';const thumbStyle=thumbUrl?'background-image:url('+thumbUrl+')':'background:#0a2640';const thumbInner=thumbUrl?'<span class="vid-play"><i class="fa-solid fa-play"></i></span>'+badge:'<span style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px"><i class="fa-brands fa-youtube" style="color:#ff0000;font-size:38px"></i><span style="color:#fff;font-size:11px;font-weight:600;letter-spacing:.5px;opacity:.8">PLAYLIST</span></span>';const thumb='<div class="vid-thumb" style="'+thumbStyle+'">'+thumbInner+'</div>';
    const meta='<div class="vid-meta"><div class="vid-title">'+esc(x.t)+'</div><div class="vid-cat"><i class="fa-brands fa-youtube" style="color:#ff0000"></i> '+esc(x.cat)+'</div></div>';
    // Use <a> tag for YouTube — anchor clicks are never blocked by popup blockers
    if(ytOpen) return '<a class="vid-card" href="'+ytUrl+'" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:block">'+thumb+meta+'</a>';
    return '<div class="vid-card" onclick="vidPlay(\''+x.yt+'\',\''+esc(x.t).replace(/'/g,'\\x27')+'\')">'+thumb+meta+'</div>';
  }
  const grid=list.length?'<div class="vid-grid">'+list.map(vidCard).join('')+'</div>':'<div class="card card-pad empty" style="margin-top:0"><i class="fa-regular fa-circle-play"></i><div style="font-weight:600;color:var(--ink)">No videos in '+esc(tname)+' yet</div><p style="max-width:380px;margin:6px auto 0">Videos added to this section will appear here.</p></div>';
  v.innerHTML='<div class="page-head"><div><h1><i class="fa-solid fa-clapperboard" style="color:#be123c"></i> Video Library</h1><p>Training videos, project walkthroughs & recorded sessions</p></div></div>'+tabbar+grid;
};
window.vidPlay=function(yt,title){ openModal('<div class="modal-head"><h3><i class="fa-brands fa-youtube" style="color:#ff0000"></i> '+esc(title)+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body" style="padding:0;background:#000"><div style="position:relative;padding-bottom:56.25%;height:0"><iframe src="https://www.youtube.com/embed/'+yt+'?autoplay=1&rel=0" style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe></div></div>','lg'); };

/* ===== reference-matched module builders ===== */