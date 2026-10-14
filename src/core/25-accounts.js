/* ===== ACCOUNTS MODULE =====
   Two tabs. Transactions (vouchers, bills & on-account payments, bank reconciliation, cheque printing,
   enterprise / company / business-unit structure) lives in accounts.js + accounts-bank.js; Ledgers &
   postings (automatic GST / TDS / retention / Post Sales postings, chart of accounts, ledger opening,
   ledgers and trial balance) lives in accounts-books.js. Loaded on demand - see PAGE_EXTRA_SCRIPT.
   Spec: docs/accounts-spec.md. Tables and functions: supabase/migrations/2026100510*..2026100512*. */
VIEWS.accounts=async function(v,seg){
  setCrumb(['Governance','Accounts']);
  const tabs=['Transactions','Ledgers & postings'];const ti=mTab(seg,tabs.length);
  v.innerHTML=mHead('fa-calculator','#0e7490','Accounts')+mTabs('accounts',tabs,ti)+'<div id="acxBody" style="margin-top:16px"></div>';
  const host=$('acxBody');
  const fn=ti===0?window.acxRender:window.acxBooksRender;
  if(typeof fn!=='function'){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Accounts could not finish loading - refresh the page.</div></div>'; return; }
  await fn(host,seg.slice(1));
};

