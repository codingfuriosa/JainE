VIEWS.recruitment_new=async function(v,seg){
  setCrumb(['People','Recruitment']);
  const canApprove=rtCanManage();
  const slots=[
    {label:'Tests',run:recTests},
    canApprove?{label:'Job Descriptions',run:()=>recLoadJDs(v)}:null,
    {label:'Hiring Request',run:tpManpower},
    {label:recCanWrite()?'Referrals':'Refer to HR',run:tpReferrals},
  ].filter(Boolean);
  const tabs=slots.map(s=>s.label);
  const ti=mTab(seg,tabs.length);
  v.innerHTML=REC_RO_CSS+TP_CSS+mHead('fa-user-plus','#0369a1','Recruitment')
    +(recCanWrite()?'':'<div class="rec-ro"><i class="fa-solid fa-lock"></i> Approving, editing and deleting here is limited to HR, Abhay Mati and Administrators — anyone can still submit a ManPower Form or Referral.</div>')
    +mTabs('recruitment_new',tabs,ti)+'<div id="recBody" style="margin-top:16px"><div class="loader"><div class="spin"></div></div></div>';
  recWatchPerms();
  await slots[ti].run();
};

/* ── Tests (dynamic, DB-backed) ── */
let RT_SEL=new Set();
async function recTests(){
  const b=$('recBody');
  loader(b);
  if(!RT_RECORDS){
    try{const{data,error}=await sb.schema('recruit').from('tests').select('*').order('sl',{ascending:true});
      if(error)throw error; RT_RECORDS=data||[];}catch(e){b.innerHTML='<div class="empty" style="padding:40px;color:var(--err)">'+esc(e.message)+'</div>';return;}
  }
  RT_SEL=new Set();
  rtRender();
}
async function tpReferrals(){
  const b=$('recBody');
  b.innerHTML='<div class="empty" style="padding:40px"><i class="fa-solid fa-spinner fa-spin"></i></div>';
  try{const {data,error}=await sb.schema('hr').from('referrals').select('*').order('created_at',{ascending:false});
    if(error)throw error; TP_REF_RECORDS=data||[];}catch(e){b.innerHTML='<div class="empty" style="padding:40px;color:#c83232">'+esc(e.message)+'</div>';return;}
  tpRefRender();
}