const CONS_SOLDOUT=[
  {n:'Dream Pratham',loc:'Madhyamgram, Kolkata',meta:'120 flats · 2 & 3 BHK',img:'https://codingfuriosa.github.io/JainGroup/images/Dream%20Pratham.jpg'},
  {n:'Dream Residency Manor',loc:'Kolkata',meta:'2, 3 & 4 BHK',img:'https://codingfuriosa.github.io/JainGroup/images/Dream%20Residency%20Manor.jpg'},
  {n:'Dream Excellency',loc:'Kolkata',meta:'162 flats',img:'https://codingfuriosa.github.io/JainGroup/images/Dream%20Excellency.jpg'},
  {n:'Dream Villa',loc:'Kolkata',meta:'Duplex & Triplex',img:'https://codingfuriosa.github.io/JainGroup/images/Dream%20Villa.jpg'},
  {n:'Dream Park',loc:'Kolkata',meta:'164 flats · 520–1,255 sq.ft',img:'https://codingfuriosa.github.io/JainGroup/images/Dream%20Park.jpg'},
  {n:'Dream Residency',loc:'Kolkata',meta:'135 flats · 930–1,620 sq.ft',img:'https://codingfuriosa.github.io/JainGroup/images/Dream%20Residency.jpg'},
];
VIEWS.projects=function(v){
  setCrumb(['Operations','Projects']);
  const card=(p,sold)=>`<div class="proj-card${sold?' sold':''}" ${sold?'':`onclick="window.open('${p.url}','_blank','noopener')"`}>
    <div class="proj-img" style="background-image:url('${p.img}')"><span class="proj-badge${sold?' sold':''}">${sold?'Sold Out':'Ongoing'}</span></div>
    <div class="proj-body">
      <h3>${esc(p.n)}</h3>
      <div class="proj-loc"><i class="fa-solid fa-location-dot"></i> ${esc(p.loc)}</div>
      <div class="proj-meta">${esc(p.meta)}</div>
      <div class="proj-price${sold?' sold':''}">${sold?'Sold Out':esc(p.price)}</div>
      ${sold?'<button class="btn proj-btn" disabled>Sold Out</button>':`<a class="btn btn-primary proj-btn" href="${p.url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">View Project <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:11px"></i></a>`}
    </div>
  </div>`;
  v.innerHTML='<div class="page-head"><div><h1><i class="fa-solid fa-building" style="color:#1d4ed8"></i> Projects</h1><p>Ongoing developments and delivered projects across Kolkata, Siliguri & Durgapur</p></div></div>'+
    '<div class="sec-title" style="margin:4px 0 12px"><i class="fa-solid fa-circle" style="color:#16855a;font-size:8px;vertical-align:middle;margin-right:7px"></i>Ongoing Projects</div>'+
    '<div class="proj-grid">'+CONS_ONGOING.map(p=>card(p,false)).join('')+'</div>'+
    '<div class="sec-title" style="margin:28px 0 12px"><i class="fa-solid fa-circle" style="color:#c83232;font-size:8px;vertical-align:middle;margin-right:7px"></i>Sold Out</div>'+
    '<div class="proj-grid">'+CONS_SOLDOUT.map(p=>card(p,true)).join('')+'</div>';
};


/* ===== VIDEO LIBRARY ===== */