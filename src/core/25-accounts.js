/* ===== ACCOUNTS MODULE =====
   Three tabs. Transactions (vouchers, bills & on-account payments, bank reconciliation, cheque printing,
   enterprise / company / business-unit structure) lives in accounts.js + accounts-bank.js; Ledgers &
   postings (automatic GST / TDS / retention / Post Sales postings, chart of accounts, ledger opening,
   ledgers and trial balance) and Audit (the deleted, modification, transfer and document-reversal registers)
   live in accounts-books.js. Loaded on demand - see PAGE_EXTRA_SCRIPT.
   Spec: docs/accounts-spec.md. Tables and functions: supabase/migrations/2026100510*..2026100512*, ..20261102150000. */
VIEWS.accounts=async function(v,seg){
  setCrumb(['Governance','Accounts']);
  // Audit is for Accounts administrators only: it is not even listed for anyone else (the database enforces it too)
  const adm=typeof window.acxIsAdmin==='function'?await window.acxIsAdmin():false;
  const tabs=adm?['Transactions','Ledgers & postings','Audit']:['Transactions','Ledgers & postings'];const ti=mTab(seg,tabs.length);
  v.innerHTML=mHead('fa-calculator','#0e7490','Accounts')+mTabs('accounts',tabs,ti)+'<div id="acxBody" style="margin-top:16px"></div>';
  const host=$('acxBody');
  const fn=ti===0?window.acxRender:ti===1?window.acxBooksRender:window.acxAuditRender;
  if(typeof fn!=='function'){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Accounts could not finish loading - refresh the page.</div></div>'; return; }
  await fn(host,seg.slice(1));
};

