-- Accounts: TDS returns - the quarterly statement for non-salary payments to residents
-- (Form 140, formerly 26Q), Tax Year 2026-27 onwards, in the Income Tax Department's prescribed text format.
--
-- What the statement needs and where it comes from:
--   * deductor + responsible person ........ tds_deductors (one row per company; entered once)
--   * one line per TDS deduction ........... tds_entries (written when a bill is posted - see _tds_register)
--   * the code of the payment (Annexure 2) . tds_codes (the 40 codes of the official file format)
--   * the challans the tax was deposited by . tds_challans (BSR code, serial no, date) + tds_entries.challan_id
--   * a log of the files made .............. tds_statements (its id is the File Sequence No in the file)
-- Nothing here changes how a bill is posted; the register is filled in the same transaction, after the voucher.
-- All writes go through the definer functions below; the tables are read-only to the app (RLS read policy only).

-- ============================================================ reference: the official tax codes
create table if not exists accounts.tds_codes (
  code        text primary key check (code ~ '^[0-9]{4}$'),
  section     text not null,
  nature      text not null,
  common      boolean not null default false,
  flags       text[] not null default '{}',     -- reason flags the file format allows for this code (Annexure 6)
  sort_order  integer not null default 100
);
comment on table accounts.tds_codes is 'Section / tax codes of Annexure 2 of the Form 140 file format (Protean, version 1.2). flags = the reason flags Annexure 6 allows for the code.';

insert into accounts.tds_codes (code, section, nature, common, flags, sort_order) values
  ('1004', $q$392(7)$q$, $q$Any payment of accumulated balance due to an employee$q$, false, array['A','B','C','E','Y']::text[], 1),
  ('1005', $q$393(1) [Table: Sl. No. 1(i)]$q$, $q$Commission or brokerage - insurance$q$, false, array['A','B','C','E','Y','Z']::text[], 2),
  ('1006', $q$393(1) [Table: Sl. No. 1(ii)]$q$, $q$Commission or Brokerage - others$q$, true, array['A','C','E','Y','Z']::text[], 3),
  ('1008', $q$393(1) [Table: Sl. No. 2(ii).D(a)]$q$, $q$Rent on machinery etc.- specified person$q$, true, array['A','B','C','E','Z']::text[], 4),
  ('1009', $q$393(1) [Table: Sl. No. 2(ii).D(b)]$q$, $q$Rent other than machinery etc.- specified person$q$, true, array['A','B','C','E']::text[], 5),
  ('1011', $q$393(1) [Table: Sl. No. 3(ii)]$q$, $q$Payment on any consideration, not being consideration in kind, under the agreement referred to in section 67(14).$q$, false, array['A','C','E']::text[], 6),
  ('1012', $q$393(1) [Table: Sl. No. 3(iii)]$q$, $q$Payment of Compensation on Acquisition of Certain Immovable Property$q$, false, array['A','C','E','Y']::text[], 7),
  ('1013', $q$393(1) [Table: Sl. No. 4(i)]$q$, $q$Income payable to a resident assessee in respect of Units of a specified Mutual Fund specified under Schedule VII (Table: Sl. No. 20 or 21) or units from the Administrator of the specified undertaking or units from specified company$q$, false, array['A','B','C','E','Y']::text[], 8),
  ('1014', $q$393(1) [Table: Sl. No. 4(ii)]$q$, $q$Certain income in the form of interest from units of a business trust to a resident unit holder$q$, false, array['A','C','E']::text[], 9),
  ('1015', $q$393(1) [Table: Sl. No. 4(ii)]$q$, $q$Certain income in the form of dividend from units of a business trust to a resident unit holder$q$, false, array['A','C','E','O']::text[], 10),
  ('1016', $q$393(1) [Table: Sl. No. 4(ii)]$q$, $q$Certain income in the form of Renting from units of a business trust being a real estate investment trust to a resident unit holder$q$, false, array['A','C','E']::text[], 11),
  ('1017', $q$393(1) [Table: Sl. No. 4(iii)]$q$, $q$Any income, other than that proportion of income which is exempt under Schedule V [Table: Sl. No. 2], in respect of units of an investment fund specified in section 224, payable to its unitholder.$q$, false, array['A','C','E','Z']::text[], 12),
  ('1018', $q$393(1) [Table: Sl. No. 4(iv)]$q$, $q$Any income, in respect of an investment in a securitisation trust specified in section 221 to an investor.$q$, false, array['A','C','E']::text[], 13),
  ('1019', $q$393(1) [Table: Sl. No. 5(i)]$q$, $q$Any income by way of Interest on securities$q$, false, array['A','B','C','E','Y','Z']::text[], 14),
  ('1020', $q$393(1) [Table: Sl. No. 5(ii).D(a)]$q$, $q$Any income by way of interest other than interest on securities, in case of deductee/payee is a senior citizen$q$, false, array['A','B','C','D','E','Q','Y']::text[], 15),
  ('1021', $q$393(1) [Table: Sl. No. 5(ii).D(b)]$q$, $q$Any income by way of interest other than interest on securities, in case of deductee/payee is other than senior citizen$q$, false, array['A','B','C','D','E','Q','Y']::text[], 16),
  ('1022', $q$393(1) [Table: Sl. No. 5(iii)]$q$, $q$Any income being interest other than interest on securities$q$, false, array['A','B','C','D','E','Q','Y']::text[], 17),
  ('1023', $q$393(1) [Table: Sl. No. 6(i).D(a)]$q$, $q$Any sum for carrying out any work (including supply of labour for carrying out any work) in pursuance of a contract between the contractor and a designated person – if contractor is individual or Hindu undivided family$q$, true, array['A','C','E','T','Y','Z']::text[], 18),
  ('1024', $q$393(1) [Table: Sl. No. 6(i).D(b)]$q$, $q$Any sum for carrying out any work (including supply of labour for carrying out any work) in pursuance of a contract between the contractor and a designated person – if contractor is a person other than individual or Hindu undivided family$q$, true, array['A','C','E','T','Y','Z']::text[], 19),
  ('1026', $q$393(1) [Table: Sl. No. 6(iii).D(a)]$q$, $q$Any sum by way of–– (a) fees for technical services (not being a professional services); or (b) royalty in the nature of consideration for sale, distribution or exhibition of cinematographic films; or (c) payee, engaged only in the business of operation of call centre$q$, true, array['A','C','E','Y','Z']::text[], 20),
  ('1027', $q$393(1) [Table: Sl. No. 6(iii).D(b)]$q$, $q$Any sum by way of–– (a) fees for professional services; or (b) any sum referred to in section 26(2)(h)$q$, true, array['A','C','E','Y','Z']::text[], 21),
  ('1028', $q$393(1) [Table: Sl. No. 6(iii).D(b)]$q$, $q$Any sum by way of remuneration or fees or commission by whatever name called, other than those on which tax is deductible under section 392, to a director of a company$q$, false, array['A','C','E','Z']::text[], 22),
  ('1029', $q$393(1) [Table: Sl. No. 7]$q$, $q$Any dividends (including on preference shares) declared.$q$, false, array['A','B','C','E','P','Y','Z']::text[], 23),
  ('1030', $q$393(1) [Table: Sl. No. 8(i)]$q$, $q$Any sum under a life insurance policy, including the sum allocated as bonus on such policy, other than the amount not includible in the total income under Schedule II [Table: Sl. No. 2]$q$, false, array['A','B','C','E','Y']::text[], 24),
  ('1031', $q$393(1) [Table: Sl. No. 8(ii)]$q$, $q$Any sum for purchase of any goods$q$, true, array['A','C','E','S','Y']::text[], 25),
  ('1033', $q$393(1) [Table: Sl. No. 8(iv)]$q$, $q$Any benefit or perquisite, whether convertible into money or not, arising from business or the exercise of a profession of any resident.$q$, false, array['A','C','E','Y']::text[], 26),
  ('1034', $q$393(1) [Table: Sl. No. 8(iv)] Note 6$q$, $q$Benefits or perquisites of business or profession where such benefit is provided in kind or where part in cash is not sufficient to meet tax liability and tax required to be deducted is paid before such benefit is released$q$, false, array['A','C','E','Y']::text[], 27),
  ('1035', $q$393(1) [Table: Sl. No. 8(v)]$q$, $q$Sale of goods or provision of services by an e-commerce participant, facilitated by an e-commerce operator through its digital or electronic facility or platform. - any e commerce operator$q$, false, array['A','C','E','Y']::text[], 28),
  ('1037', $q$393(1) [Table: Sl. No. 8(vi)]$q$, $q$Any sum by way of consideration for transfer of a virtual digital asset by other than Individual or Hindu Undivided Family.$q$, false, array['A','C','E','Y']::text[], 29),
  ('1038', $q$393(1) [Table: Sl. No. 8(vi)] Note 6$q$, $q$Any sum by way of consideration, whether in cash or in kind or partly in cash and partly in kind, for transfer of a virtual digital asset.$q$, false, array['A','C','E','Y']::text[], 30),
  ('1058', $q$393(3) [Table: Sl. No. 1]$q$, $q$Any income by way of winnings (other than winnings from Sl. No. 2 of the table at section 393(3)) from–– (a) any lottery; or (b) crossword puzzle; or (c) card game and other game of any sort; or (d) gambling or betting of any form or nature whatsoever$q$, false, array['A','C','E','Y']::text[], 31),
  ('1059', $q$393(3) [Table: Sl. No. 1] Note 2$q$, $q$Any income by way of winnings (other than winnings from Sl. No. 2 of the table at section 393(3)) from–– (a) any lottery; or (b) crossword puzzle; or (c) card game and other game of any sort; or (d) gambling or betting of any form or nature whatsoever where consideration, is made in kind or cash is not sufficient to meet the tax liability and tax has been paid before such winnings are released$q$, false, array['A','C','E','Y']::text[], 32),
  ('1060', $q$393(3) [Table: Sl. No. 2]$q$, $q$Any income by way of winnings from online game.$q$, false, array['A','C','E']::text[], 33),
  ('1061', $q$393(3) [Table: Sl. No. 2] Note 2$q$, $q$Any income by way of winnings from online games, is made in kind or cash is not sufficient to meet the tax liability and tax has been paid before such winnings are released$q$, false, array['A','C','E']::text[], 34),
  ('1062', $q$393(3) [Table: Sl. No. 3]$q$, $q$Any income by way of winnings from any horse race.$q$, false, array['A','C','E','Y']::text[], 35),
  ('1063', $q$393(3) [Table: Sl. No. 4]$q$, $q$Any income, credited or paid to a person, who is or has been stocking, distributing, purchasing or selling lottery tickets, by way of commission, remuneration or prize (by whatever name called) on such tickets$q$, false, array['A','C','E','Y']::text[], 36),
  ('1064', $q$393(3) [Table: Sl. No. 5.D(a)]$q$, $q$Payment of certain amounts in cash by bank/ post office / co-operative society to a deductee being a co-operative society$q$, false, array['A','C','E','N']::text[], 37),
  ('1065', $q$393(3) [Table: Sl. No. 5.D(b)]$q$, $q$Payment of certain amounts in cash by bank/ post office / co-operative society to a deductee being a person other than co-operative society$q$, false, array['A','C','E','N']::text[], 38),
  ('1066', $q$393(3) [Table: Sl. No. 6]$q$, $q$Any amount referred to in section 80CCA(2)(a) of the Income-tax Act, 1961 (43 of 1961).$q$, false, array['A','C','E','Y']::text[], 39),
  ('1067', $q$393(3) [Table: Sl. No. 7]$q$, $q$Any sum in the nature of salary, remuneration, commission, bonus or interest paid to a partner of the firm or credited to his account (including capital account).$q$, false, array['A','C','E','Y']::text[], 40)
on conflict (code) do update set section = excluded.section, nature = excluded.nature, flags = excluded.flags, sort_order = excluded.sort_order;

-- ============================================================ the deductor (once per company)
create table if not exists accounts.tds_deductors (
  company_id        bigint primary key references accounts.companies(id) on delete cascade,
  tan               text check (tan is null or tan ~ '^[A-Z]{4}[0-9]{5}[A-Z]$'),
  deductor_type     text not null default 'K' check (deductor_type ~ '^[A-Z]$'),
  name              text check (name is null or length(name) <= 75),
  addr1 text, addr2 text, addr3 text, addr4 text, addr5 text,
  country           text not null default 'INDIA',
  state_code        text check (state_code is null or state_code ~ '^[0-9]{2}$'),
  pin               text check (pin is null or pin ~ '^[0-9]{6}$'),
  email             text check (email is null or email ~ '^[^@[:space:]^]+@[^@[:space:]^]+\.[^@[:space:]^]+$'),
  phone_cc          text not null default '91' check (phone_cc ~ '^[0-9]{1,5}$'),
  phone             text check (phone is null or phone ~ '^[0-9]{6,15}$'),
  resp_name         text check (resp_name is null or length(resp_name) <= 75),
  resp_designation  text check (resp_designation is null or length(resp_designation) <= 20),
  resp_pan          text check (resp_pan is null or resp_pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  resp_addr1 text, resp_addr2 text, resp_addr3 text, resp_addr4 text, resp_addr5 text,
  resp_country      text not null default 'INDIA',
  resp_state_code   text check (resp_state_code is null or resp_state_code ~ '^[0-9]{2}$'),
  resp_pin          text check (resp_pin is null or resp_pin ~ '^[0-9]{6}$'),
  resp_email        text check (resp_email is null or resp_email ~ '^[^@[:space:]^]+@[^@[:space:]^]+\.[^@[:space:]^]+$'),
  resp_phone_cc     text not null default '91' check (resp_phone_cc ~ '^[0-9]{1,5}$'),
  resp_phone        text check (resp_phone is null or resp_phone ~ '^[6-9][0-9]{9}$'),
  updated_at        timestamptz not null default now(),
  updated_by        text default app.current_user_email()
);
comment on table accounts.tds_deductors is 'TAN, address and responsible person printed in the Batch Header of the TDS statement. The company PAN and GSTIN come from accounts.companies.';

-- ============================================================ default code per vendor
create table if not exists accounts.vendor_tds (
  vendor_id   bigint primary key,
  tds_code    text not null references accounts.tds_codes(code),
  updated_at  timestamptz not null default now(),
  updated_by  text default app.current_user_email()
);
comment on table accounts.vendor_tds is 'The nature of payment (tax code) usually deducted on a vendor''s bills; used to fill the code when a bill is posted.';

-- ============================================================ challans (the tax deposited)
create table if not exists accounts.tds_challans (
  id            bigint generated always as identity primary key,
  company_id    bigint not null references accounts.companies(id),
  deposit_date  date not null,
  bsr_code      text not null check (bsr_code ~ '^[0-9]{7}$'),
  serial_no     text not null check (serial_no ~ '^[0-9]{1,5}$'),
  minor_head    text not null default '200' check (minor_head in ('200', '400')),
  tax           numeric(15,0) not null check (tax >= 0),
  interest      numeric(15,0) not null default 0 check (interest >= 0),
  fee           numeric(15,0) not null default 0 check (fee >= 0),
  other         numeric(15,0) not null default 0 check (other >= 0),
  voucher_id    bigint references accounts.vouchers(id),
  remark        text,
  status        text not null default 'active' check (status in ('active', 'cancelled')),
  created_at    timestamptz not null default now(),
  created_by    text default app.current_user_email(),
  updated_at    timestamptz not null default now(),
  updated_by    text default app.current_user_email()
);
create unique index if not exists tds_challans_cin_uq on accounts.tds_challans (company_id, bsr_code, serial_no, deposit_date) where status = 'active';
comment on table accounts.tds_challans is 'A TDS challan paid to the government: BSR code of the bank branch + challan serial no + date make its CIN. Amounts are whole rupees, as the file format requires.';

-- ============================================================ the deduction register
create table if not exists accounts.tds_entries (
  id               bigint generated always as identity primary key,
  company_id       bigint not null references accounts.companies(id),
  business_unit_id bigint,
  voucher_id       bigint not null references accounts.vouchers(id),
  source_type      text not null check (source_type in ('purchase_bill', 'ra_bill', 'bill_enter')),
  source_id        bigint not null,
  vendor_id        bigint not null,
  deductee_pan     text check (deductee_pan is null or deductee_pan ~ '^([A-Z]{5}[0-9]{4}[A-Z]|PANNOTAVBL|PANAPPLIED|PANINVALID)$'),
  deductee_name    text not null,
  tds_code         text references accounts.tds_codes(code),
  code_source      text check (code_source in ('vendor', 'auto', 'manual')),
  amount_credited  numeric(15,2) not null check (amount_credited > 0),
  rate             numeric(7,4) not null check (rate >= 0 and rate <= 100),
  tds_amount       numeric(15,2) not null check (tds_amount > 0),
  credit_date      date not null,
  deduction_date   date not null,
  reason_flag      text check (reason_flag in ('A', 'C')),
  certificate_no   text,
  challan_id       bigint references accounts.tds_challans(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       text default app.current_user_email(),
  check (tds_amount <= amount_credited)
);
create unique index if not exists tds_entries_voucher_uq on accounts.tds_entries (voucher_id);
create index if not exists tds_entries_company_date_idx on accounts.tds_entries (company_id, deduction_date);
create index if not exists tds_entries_challan_idx on accounts.tds_entries (challan_id);
comment on table accounts.tds_entries is 'One row per TDS deduction, written when the bill is posted. amount_credited is the amount the rate was applied to (GST excluded). The quarter follows deduction_date, which is the date the bill was booked (tax is deducted at credit).';

-- ============================================================ the statements made
create table if not exists accounts.tds_statements (
  id               bigint generated always as identity primary key,    -- File Sequence No of the file header
  company_id       bigint not null references accounts.companies(id),
  tax_year_start   integer not null check (tax_year_start >= 2026),
  quarter          integer not null check (quarter between 1 and 4),
  form             text not null default '140',
  status           text not null default 'draft' check (status in ('draft', 'generated', 'filed')),
  prev_token       text check (prev_token is null or prev_token ~ '^[0-9]{15}$'),
  token_no         text check (token_no is null or token_no ~ '^[0-9]{15}$'),
  filed_on         date,
  file_name        text,
  file_text        text,
  deductee_rows    integer,
  challan_rows     integer,
  tds_total        numeric(15,2),
  created_at       timestamptz not null default now(),
  created_by       text default app.current_user_email()
);
create index if not exists tds_statements_company_idx on accounts.tds_statements (company_id, tax_year_start, quarter);

-- ============================================================ access: read for readers, writes only through the functions
alter table accounts.tds_codes      enable row level security;
alter table accounts.tds_deductors  enable row level security;
alter table accounts.vendor_tds     enable row level security;
alter table accounts.tds_challans   enable row level security;
alter table accounts.tds_entries    enable row level security;
alter table accounts.tds_statements enable row level security;
drop policy if exists tds_codes_read      on accounts.tds_codes;
drop policy if exists tds_deductors_read  on accounts.tds_deductors;
drop policy if exists vendor_tds_read     on accounts.vendor_tds;
drop policy if exists tds_challans_read   on accounts.tds_challans;
drop policy if exists tds_entries_read    on accounts.tds_entries;
drop policy if exists tds_statements_read on accounts.tds_statements;
create policy tds_codes_read      on accounts.tds_codes      for select to authenticated using ((select accounts.can_read()));
create policy tds_deductors_read  on accounts.tds_deductors  for select to authenticated using ((select accounts.can_read()));
create policy vendor_tds_read     on accounts.vendor_tds     for select to authenticated using ((select accounts.can_read()));
create policy tds_challans_read   on accounts.tds_challans   for select to authenticated using ((select accounts.can_read()));
create policy tds_entries_read    on accounts.tds_entries    for select to authenticated using ((select accounts.can_read()));
create policy tds_statements_read on accounts.tds_statements for select to authenticated using ((select accounts.can_read()));
revoke all on accounts.tds_codes, accounts.tds_deductors, accounts.vendor_tds, accounts.tds_challans, accounts.tds_entries, accounts.tds_statements from public, anon;
grant select on accounts.tds_codes, accounts.tds_deductors, accounts.vendor_tds, accounts.tds_challans, accounts.tds_entries, accounts.tds_statements to authenticated;

-- ============================================================ quarter helpers (Tax Year = 1 Apr to 31 Mar)
create or replace function accounts._tds_year(p_date date) returns integer language sql immutable
as $$ select extract(year from p_date)::int - case when extract(month from p_date) < 4 then 1 else 0 end $$;

create or replace function accounts._tds_quarter(p_date date) returns integer language sql immutable
as $$ select case when extract(month from p_date) in (4, 5, 6) then 1 when extract(month from p_date) in (7, 8, 9) then 2 when extract(month from p_date) in (10, 11, 12) then 3 else 4 end $$;

create or replace function accounts._tds_qstart(p_year integer, p_q integer) returns date language sql immutable
as $$ select make_date(case when p_q = 4 then p_year + 1 else p_year end, case p_q when 1 then 4 when 2 then 7 when 3 then 10 else 1 end, 1) $$;

create or replace function accounts._tds_qend(p_year integer, p_q integer) returns date language sql immutable
as $$ select (accounts._tds_qstart(p_year, p_q) + interval '3 months' - interval '1 day')::date $$;

-- A quarter whose statement has been filed is closed: its deductions, PANs, codes and challan mapping stay as filed.
create or replace function accounts._tds_locked(p_company bigint, p_date date) returns boolean language sql stable security definer set search_path to 'accounts', 'public'
as $$ select exists (select 1 from accounts.tds_statements s where s.company_id = p_company and s.status = 'filed'
                      and s.tax_year_start = accounts._tds_year(p_date) and s.quarter = accounts._tds_quarter(p_date)) $$;

-- ============================================================ called by the three posting functions
-- Writes the register row for the TDS taken on a bill. p_base is the amount the rate was applied to (GST excluded).
create or replace function accounts._tds_register(p_voucher bigint, p_vendor bigint, p_base numeric, p_rate numeric, p_tds numeric,
                                                  p_source text, p_source_id bigint, p_code text)
returns void language plpgsql security definer set search_path to 'accounts', 'public'
as $$
declare
  v accounts.vouchers; ven purchase.vendors; v_pan text; v_code text; v_src text; v_base numeric; v_rate numeric;
begin
  if coalesce(p_tds, 0) <= 0 then return; end if;
  select * into v from accounts.vouchers where id = p_voucher;
  if not found then raise exception 'TDS register: voucher % not found', p_voucher; end if;
  select * into ven from purchase.vendors where id = p_vendor;
  v_pan := nullif(upper(btrim(coalesce(ven.pan, ''))), '');
  if v_pan is not null and v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then v_pan := 'PANINVALID'; end if;

  -- the code: what the user chose on the bill, else the vendor's usual code, else (contract work) from the PAN
  v_code := nullif(btrim(coalesce(p_code, '')), '');
  if v_code is not null then
    if not exists (select 1 from accounts.tds_codes where code = v_code) then raise exception '% is not a TDS code of the return format', v_code; end if;
    v_src := 'manual';
  else
    select tds_code into v_code from accounts.vendor_tds where vendor_id = p_vendor;
    if v_code is not null then v_src := 'vendor';
    elsif p_source = 'ra_bill' and v_pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then
      v_code := case when substr(v_pan, 4, 1) in ('P', 'H') then '1023' else '1024' end;   -- contractor: individual / HUF, or anyone else
      v_src := 'auto';
    end if;
  end if;

  -- amount the rate was applied to: the bill's own base when it reproduces the TDS, else worked back from the TDS
  v_rate := coalesce(nullif(p_rate, 0), case when coalesce(p_base, 0) > 0 then round(p_tds * 100 / p_base, 4) end, 0);
  v_base := p_base;
  if v_rate > 0 and (v_base is null or v_base <= 0 or abs(round(v_base * v_rate / 100, 2) - p_tds) > 1) then
    v_base := round(p_tds * 100 / v_rate, 2);
  end if;
  if v_base is null or v_base <= 0 then v_base := p_tds; end if;
  if v_base < p_tds then v_base := p_tds; end if;

  insert into accounts.tds_entries (company_id, business_unit_id, voucher_id, source_type, source_id, vendor_id, deductee_pan, deductee_name,
                                    tds_code, code_source, amount_credited, rate, tds_amount, credit_date, deduction_date)
  values (v.company_id, v.business_unit_id, v.id, p_source, p_source_id, p_vendor, v_pan,
          left(coalesce(nullif(btrim(ven.legal_name), ''), nullif(btrim(ven.trade_name), ''), 'Vendor ' || p_vendor), 75),
          v_code, v_src, v_base, least(v_rate, 100), p_tds, v.voucher_date, v.voucher_date)
  on conflict (voucher_id) do nothing;
end $$;
revoke all on function accounts._tds_register(bigint, bigint, numeric, numeric, numeric, text, bigint, text) from public, anon, authenticated;

-- ============================================================ wire the register into the three posting functions
-- Each patch inserts one call just before the function returns, and is skipped if it is already there.
do $patch$
declare d text; anchor text; n int;
begin
  d := pg_get_functiondef('accounts.post_purchase_bill(bigint)'::regprocedure);
  if position('_tds_register' in d) = 0 then
    anchor := E'  return v_id;\nend $function$';
    n := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if n <> 1 then raise exception 'post_purchase_bill: expected 1 anchor, found %', n; end if;
    d := replace(d, anchor, E'  if b.tds_amount > 0 then perform accounts._tds_register(v_id, b.vendor_id, b.taxable_value, b.tds_rate, b.tds_amount, ''purchase_bill'', b.id, null); end if;\n' || anchor);
    execute d;
  end if;

  d := pg_get_functiondef('accounts.post_ra_bill(bigint)'::regprocedure);
  if position('_tds_register' in d) = 0 then
    anchor := E'  return v_id;\nend $function$';
    n := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if n <> 1 then raise exception 'post_ra_bill: expected 1 anchor, found %', n; end if;
    d := replace(d, anchor, E'  if v_tds > 0 then perform accounts._tds_register(v_id, w.vendor_id, v_gross, r.tds_pct, v_tds, ''ra_bill'', p_id, null); end if;\n' || anchor);
    execute d;
  end if;

  d := pg_get_functiondef('accounts.bill_enter(jsonb, jsonb)'::regprocedure);
  if position('_tds_register' in d) = 0 then
    anchor := E'  return jsonb_build_object(''payable_id'', v_pid,';
    n := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if n <> 1 then raise exception 'bill_enter: expected 1 anchor, found %', n; end if;
    d := replace(d, anchor, E'  if v_tds > 0 then perform accounts._tds_register(v_id, v_vendor, v_taxable, v_tds_pct, v_tds, ''bill_enter'', v_pid, nullif(p_head->>''tds_code'', '''')); end if;\n' || anchor);
    execute d;
  end if;
end $patch$;

-- bills already posted (before this migration) get their register row too
do $backfill$
declare r record; am jsonb;
begin
  for r in select v.id as vid, v.source_id, ra.tds_pct, w.vendor_id
             from accounts.vouchers v join eng.ra_bills ra on ra.id = v.source_id join eng.work_orders w on w.id = ra.wo_id
            where v.source_type = 'ra_bill' and v.status = 'posted' and not exists (select 1 from accounts.tds_entries e where e.voucher_id = v.id) loop
    am := accounts._ra_amounts(r.source_id);
    if coalesce((am->>'tds')::numeric, 0) > 0 then
      perform accounts._tds_register(r.vid, r.vendor_id, (am->>'gross')::numeric, r.tds_pct, (am->>'tds')::numeric, 'ra_bill', r.source_id, null);
    end if;
  end loop;
  for r in select v.id as vid, b.id as bid, b.vendor_id, b.taxable_value, b.tds_rate, b.tds_amount
             from accounts.vouchers v join purchase.bills b on b.id = v.source_id
            where v.source_type = 'purchase_bill' and v.status = 'posted' and coalesce(b.tds_amount, 0) > 0
              and not exists (select 1 from accounts.tds_entries e where e.voucher_id = v.id) loop
    perform accounts._tds_register(r.vid, r.vendor_id, r.taxable_value, r.tds_rate, r.tds_amount, 'purchase_bill', r.bid, null);
  end loop;
end $backfill$;

-- ============================================================ functions the screens call
-- The deductor and responsible person (once per company)
create or replace function accounts.tds_deductor_save(p_company bigint, p jsonb) returns void
language plpgsql security definer set search_path to 'accounts', 'public'
as $$
declare me text; t jsonb := '{}'::jsonb; k text;
begin
  me := accounts._guard_post();
  if not exists (select 1 from accounts.companies where id = p_company) then raise exception 'Company not found'; end if;
  for k in select unnest(array['tan','deductor_type','name','addr1','addr2','addr3','addr4','addr5','country','state_code','pin','email','phone_cc','phone',
                               'resp_name','resp_designation','resp_pan','resp_addr1','resp_addr2','resp_addr3','resp_addr4','resp_addr5','resp_country',
                               'resp_state_code','resp_pin','resp_email','resp_phone_cc','resp_phone']) loop
    t := t || jsonb_build_object(k, nullif(btrim(coalesce(p->>k, '')), ''));
  end loop;
  insert into accounts.tds_deductors (company_id, tan, deductor_type, name, addr1, addr2, addr3, addr4, addr5, country, state_code, pin, email, phone_cc, phone,
         resp_name, resp_designation, resp_pan, resp_addr1, resp_addr2, resp_addr3, resp_addr4, resp_addr5, resp_country, resp_state_code, resp_pin, resp_email, resp_phone_cc, resp_phone)
  values (p_company, upper(t->>'tan'), coalesce(upper(t->>'deductor_type'), 'K'), t->>'name', t->>'addr1', t->>'addr2', t->>'addr3', t->>'addr4', t->>'addr5',
          coalesce(upper(t->>'country'), 'INDIA'), t->>'state_code', t->>'pin', t->>'email', coalesce(t->>'phone_cc', '91'), t->>'phone',
          t->>'resp_name', t->>'resp_designation', upper(t->>'resp_pan'), t->>'resp_addr1', t->>'resp_addr2', t->>'resp_addr3', t->>'resp_addr4', t->>'resp_addr5',
          coalesce(upper(t->>'resp_country'), 'INDIA'), t->>'resp_state_code', t->>'resp_pin', t->>'resp_email', coalesce(t->>'resp_phone_cc', '91'), t->>'resp_phone')
  on conflict (company_id) do update set
    tan = excluded.tan, deductor_type = excluded.deductor_type, name = excluded.name, addr1 = excluded.addr1, addr2 = excluded.addr2, addr3 = excluded.addr3,
    addr4 = excluded.addr4, addr5 = excluded.addr5, country = excluded.country, state_code = excluded.state_code, pin = excluded.pin, email = excluded.email,
    phone_cc = excluded.phone_cc, phone = excluded.phone, resp_name = excluded.resp_name, resp_designation = excluded.resp_designation, resp_pan = excluded.resp_pan,
    resp_addr1 = excluded.resp_addr1, resp_addr2 = excluded.resp_addr2, resp_addr3 = excluded.resp_addr3, resp_addr4 = excluded.resp_addr4, resp_addr5 = excluded.resp_addr5,
    resp_country = excluded.resp_country, resp_state_code = excluded.resp_state_code, resp_pin = excluded.resp_pin, resp_email = excluded.resp_email,
    resp_phone_cc = excluded.resp_phone_cc, resp_phone = excluded.resp_phone, updated_at = now(), updated_by = app.current_user_email();
end $$;

-- Set the code / PAN / reason / certificate on one or more deductions. p keys: tds_code, deductee_pan, reason_flag, certificate_no, remember (bool)
create or replace function accounts.tds_entry_update(p_ids bigint[], p jsonb) returns integer
language plpgsql security definer set search_path to 'accounts', 'public'
as $$
declare
  me text; e accounts.tds_entries; n int := 0; v_code text; v_pan text; v_flag text; v_cert text;
begin
  me := accounts._guard_post();
  if p ? 'tds_code' then
    v_code := nullif(btrim(coalesce(p->>'tds_code', '')), '');
    if v_code is not null and not exists (select 1 from accounts.tds_codes where code = v_code) then raise exception '% is not a TDS code of the return format', v_code; end if;
  end if;
  if p ? 'deductee_pan' then
    v_pan := nullif(upper(btrim(coalesce(p->>'deductee_pan', ''))), '');
    if v_pan is not null and v_pan !~ '^([A-Z]{5}[0-9]{4}[A-Z]|PANNOTAVBL|PANAPPLIED|PANINVALID)$' then raise exception 'The PAN must be 10 characters like ABCDE1234F (or PANNOTAVBL / PANAPPLIED / PANINVALID)'; end if;
  end if;
  if p ? 'reason_flag' then
    v_flag := nullif(upper(btrim(coalesce(p->>'reason_flag', ''))), '');
    if v_flag is not null and v_flag not in ('A', 'C') then raise exception 'Only the reasons A (lower deduction certificate) and C (higher rate, no PAN) are supported'; end if;
  end if;
  if p ? 'certificate_no' then
    v_cert := nullif(btrim(coalesce(p->>'certificate_no', '')), '');
    if v_cert is not null and v_cert !~ '^[A-Za-z0-9]{10,15}$' then raise exception 'The certificate number is 10 to 15 letters and digits'; end if;
  end if;
  for e in select * from accounts.tds_entries where id = any (p_ids) order by id for update loop
    if accounts._tds_locked(e.company_id, e.deduction_date) then raise exception 'The statement for that quarter is already marked as filed - its deductions are closed'; end if;
    update accounts.tds_entries set
      tds_code       = case when p ? 'tds_code' then v_code else tds_code end,
      code_source    = case when p ? 'tds_code' then (case when v_code is null then null else 'manual' end) else code_source end,
      deductee_pan   = case when p ? 'deductee_pan' then v_pan else deductee_pan end,
      reason_flag    = case when p ? 'reason_flag' then v_flag else reason_flag end,
      certificate_no = case when p ? 'certificate_no' then v_cert else certificate_no end,
      updated_at = now(), updated_by = app.current_user_email()
    where id = e.id;
    if p ? 'tds_code' and v_code is not null and coalesce((p->>'remember')::boolean, false) then
      insert into accounts.vendor_tds (vendor_id, tds_code) values (e.vendor_id, v_code)
      on conflict (vendor_id) do update set tds_code = excluded.tds_code, updated_at = now(), updated_by = app.current_user_email();
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- A challan: add (no id) or change (id). Amounts are whole rupees.
create or replace function accounts.tds_challan_save(p jsonb) returns bigint
language plpgsql security definer set search_path to 'accounts', 'public'
as $$
declare
  me text; v_id bigint := nullif(p->>'id', '')::bigint; v_co bigint := (p->>'company_id')::bigint; v_date date := (p->>'deposit_date')::date;
  v_tax numeric := coalesce(nullif(p->>'tax', '')::numeric, 0); v_int numeric := coalesce(nullif(p->>'interest', '')::numeric, 0);
  v_fee numeric := coalesce(nullif(p->>'fee', '')::numeric, 0); v_oth numeric := coalesce(nullif(p->>'other', '')::numeric, 0);
  v_bsr text := btrim(coalesce(p->>'bsr_code', '')); v_ser text := btrim(coalesce(p->>'serial_no', '')); v_mh text := coalesce(nullif(p->>'minor_head', ''), '200');
  v_mapped numeric;
begin
  me := accounts._guard_post();
  if v_co is null or not exists (select 1 from accounts.companies where id = v_co) then raise exception 'Choose the company'; end if;
  if v_date is null then raise exception 'Enter the date the challan was paid'; end if;
  if v_date > current_date then raise exception 'The challan date cannot be in the future'; end if;
  if v_bsr !~ '^[0-9]{7}$' then raise exception 'The BSR code is the 7 digits of the bank branch printed on the challan'; end if;
  if v_ser !~ '^[0-9]{1,5}$' then raise exception 'The challan serial number is up to 5 digits'; end if;
  if v_mh not in ('200', '400') then raise exception 'The minor head is 200 (TDS paid by the deductor) or 400 (TDS on regular assessment)'; end if;
  if v_tax <> trunc(v_tax) or v_int <> trunc(v_int) or v_fee <> trunc(v_fee) or v_oth <> trunc(v_oth) then raise exception 'Challan amounts are whole rupees'; end if;
  if v_tax + v_int + v_fee + v_oth <= 0 then raise exception 'Enter the amount of the challan'; end if;
  if v_id is null then
    insert into accounts.tds_challans (company_id, deposit_date, bsr_code, serial_no, minor_head, tax, interest, fee, other, voucher_id, remark)
    values (v_co, v_date, v_bsr, v_ser, v_mh, v_tax, v_int, v_fee, v_oth, nullif(p->>'voucher_id', '')::bigint, nullif(btrim(coalesce(p->>'remark', '')), ''))
    returning id into v_id;
  else
    perform 1 from accounts.tds_challans where id = v_id and company_id = v_co and status = 'active' for update;
    if not found then raise exception 'Challan not found'; end if;
    select coalesce(sum(e.tds_amount), 0) into v_mapped from accounts.tds_entries e where e.challan_id = v_id;
    if v_mapped > v_tax then raise exception 'Deductions worth % are already mapped to this challan - the tax amount cannot be less', v_mapped; end if;
    if exists (select 1 from accounts.tds_entries e where e.challan_id = v_id and accounts._tds_locked(e.company_id, e.deduction_date)) then
      raise exception 'A filed statement uses this challan - it is closed';
    end if;
    update accounts.tds_challans set deposit_date = v_date, bsr_code = v_bsr, serial_no = v_ser, minor_head = v_mh, tax = v_tax, interest = v_int, fee = v_fee, other = v_oth,
           voucher_id = nullif(p->>'voucher_id', '')::bigint, remark = nullif(btrim(coalesce(p->>'remark', '')), ''), updated_at = now(), updated_by = app.current_user_email()
     where id = v_id;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'That challan (BSR code, serial number and date) is already entered';
end $$;

create or replace function accounts.tds_challan_cancel(p_id bigint) returns void
language plpgsql security definer set search_path to 'accounts', 'public'
as $$
declare me text;
begin
  me := accounts._guard_post();
  perform 1 from accounts.tds_challans where id = p_id and status = 'active' for update;
  if not found then raise exception 'Challan not found'; end if;
  if exists (select 1 from accounts.tds_entries e where e.challan_id = p_id and accounts._tds_locked(e.company_id, e.deduction_date)) then
    raise exception 'A filed statement uses this challan - it is closed';
  end if;
  update accounts.tds_entries set challan_id = null, updated_at = now(), updated_by = app.current_user_email() where challan_id = p_id;
  update accounts.tds_challans set status = 'cancelled', updated_at = now(), updated_by = app.current_user_email() where id = p_id;
end $$;

-- Set which deductions this challan paid (replaces the earlier mapping of that challan)
create or replace function accounts.tds_challan_map(p_challan bigint, p_entry_ids bigint[]) returns jsonb
language plpgsql security definer set search_path to 'accounts', 'public'
as $$
declare
  me text; c accounts.tds_challans; v_sum numeric; v_bad int;
begin
  me := accounts._guard_post();
  select * into c from accounts.tds_challans where id = p_challan and status = 'active' for update;
  if not found then raise exception 'Challan not found'; end if;
  p_entry_ids := coalesce(p_entry_ids, '{}');
  select count(*) into v_bad from accounts.tds_entries e join accounts.vouchers v on v.id = e.voucher_id
   where e.id = any (p_entry_ids) and (e.company_id <> c.company_id or v.status <> 'posted' or (e.challan_id is not null and e.challan_id <> p_challan));
  if v_bad > 0 or (select count(*) from accounts.tds_entries where id = any (p_entry_ids)) <> cardinality(p_entry_ids) then
    raise exception 'Some of the chosen deductions belong to another company, are cancelled, or are already mapped to another challan';
  end if;
  if exists (select 1 from accounts.tds_entries e where (e.id = any (p_entry_ids) or e.challan_id = p_challan) and accounts._tds_locked(e.company_id, e.deduction_date)) then
    raise exception 'A filed statement uses these deductions - they are closed';
  end if;
  select coalesce(sum(tds_amount), 0) into v_sum from accounts.tds_entries where id = any (p_entry_ids);
  if v_sum > c.tax then raise exception 'The chosen deductions come to % but the challan carries only % of tax', v_sum, c.tax; end if;
  update accounts.tds_entries set challan_id = null, updated_at = now(), updated_by = app.current_user_email() where challan_id = p_challan and not (id = any (p_entry_ids));
  update accounts.tds_entries set challan_id = p_challan, updated_at = now(), updated_by = app.current_user_email() where id = any (p_entry_ids) and challan_id is distinct from p_challan;
  return jsonb_build_object('mapped', v_sum, 'tax', c.tax, 'difference', c.tax - v_sum);
end $$;

-- Suggest the mapping: oldest deductions first, each into the earliest challan paid on or after the deduction that still has room.
-- Only touches deductions of that quarter that are not mapped yet.
create or replace function accounts.tds_auto_map(p_company bigint, p_year integer, p_quarter integer) returns integer
language plpgsql security definer set search_path to 'accounts', 'public'
as $$
declare
  me text; qs date := accounts._tds_qstart(p_year, p_quarter); qe date := accounts._tds_qend(p_year, p_quarter);
  e record; c record; n int := 0;
begin
  me := accounts._guard_post();
  if accounts._tds_locked(p_company, qs) then raise exception 'That quarter is marked as filed - it is closed'; end if;
  for e in select te.id, te.tds_amount, te.deduction_date from accounts.tds_entries te join accounts.vouchers v on v.id = te.voucher_id
            where te.company_id = p_company and te.challan_id is null and v.status = 'posted' and te.deduction_date between qs and qe order by te.deduction_date, te.id loop
    for c in select ch.id, ch.tax - coalesce((select sum(x.tds_amount) from accounts.tds_entries x where x.challan_id = ch.id), 0) as room
               from accounts.tds_challans ch where ch.company_id = p_company and ch.status = 'active' and ch.deposit_date >= e.deduction_date order by ch.deposit_date, ch.id loop
      if c.room >= e.tds_amount then
        update accounts.tds_entries set challan_id = c.id, updated_at = now(), updated_by = app.current_user_email() where id = e.id;
        n := n + 1; exit;
      end if;
    end loop;
  end loop;
  return n;
end $$;

-- Everything the screen and the file need for one quarter, in one call
create or replace function accounts.tds_statement_data(p_company bigint, p_year integer, p_quarter integer) returns jsonb
language plpgsql stable security definer set search_path to 'accounts', 'public'
as $$
declare qs date := accounts._tds_qstart(p_year, p_quarter); qe date := accounts._tds_qend(p_year, p_quarter); r jsonb;
begin
  if not accounts.can_read() then raise exception 'not allowed'; end if;
  select jsonb_build_object(
    'company', (select jsonb_build_object('id', c.id, 'name', c.name, 'pan', c.pan, 'gstin', c.gstin, 'books_start', c.books_start, 'locked_till', c.books_locked_till) from accounts.companies c where c.id = p_company),
    'deductor', (select to_jsonb(d) - 'updated_by' - 'updated_at' from accounts.tds_deductors d where d.company_id = p_company),
    'quarter', jsonb_build_object('year', p_year, 'q', p_quarter, 'start', qs, 'end', qe),
    'entries', coalesce((select jsonb_agg(to_jsonb(x) order by x.deduction_date, x.id) from (
        select e.id, e.voucher_id, v.doc_no as voucher_no, e.source_type, e.source_id, e.vendor_id, e.deductee_pan, e.deductee_name, e.tds_code, e.code_source,
               e.amount_credited, e.rate, e.tds_amount, e.credit_date, e.deduction_date, e.reason_flag, e.certificate_no, e.challan_id, vn.pan as vendor_pan
          from accounts.tds_entries e join accounts.vouchers v on v.id = e.voucher_id left join purchase.vendors vn on vn.id = e.vendor_id
         where e.company_id = p_company and v.status = 'posted' and e.deduction_date between qs and qe) x), '[]'::jsonb),
    'challans', coalesce((select jsonb_agg(to_jsonb(y) order by y.deposit_date, y.id) from (
        select ch.id, ch.deposit_date, ch.bsr_code, ch.serial_no, ch.minor_head, ch.tax, ch.interest, ch.fee, ch.other, ch.voucher_id, ch.remark,
               coalesce((select sum(e.tds_amount) from accounts.tds_entries e where e.challan_id = ch.id), 0) as mapped_total,
               (select count(*) from accounts.tds_entries e where e.challan_id = ch.id) as mapped_count,
               (select count(*) from accounts.tds_entries e where e.challan_id = ch.id and e.deduction_date between qs and qe) as mapped_in_quarter
          from accounts.tds_challans ch
         where ch.company_id = p_company and ch.status = 'active'
           and (ch.deposit_date between qs and (qe + 45) or exists (select 1 from accounts.tds_entries e where e.challan_id = ch.id and e.deduction_date between qs and qe))) y), '[]'::jsonb),
    'statements', coalesce((select jsonb_agg(to_jsonb(s) order by s.id desc) from (
        select id, tax_year_start, quarter, status, prev_token, token_no, filed_on, file_name, deductee_rows, challan_rows, tds_total, created_at, created_by
          from accounts.tds_statements where company_id = p_company and tax_year_start = p_year) s), '[]'::jsonb),
    'vendor_codes', coalesce((select jsonb_object_agg(vendor_id::text, tds_code) from accounts.vendor_tds), '{}'::jsonb)
  ) into r;
  return r;
end $$;

-- The log of files made. The row's id is the File Sequence No printed in the file header.
create or replace function accounts.tds_statement_new(p_company bigint, p_year integer, p_quarter integer, p_prev_token text) returns bigint
language plpgsql security definer set search_path to 'accounts', 'public'
as $$
declare me text; v_id bigint;
begin
  me := accounts._guard_post();
  if p_year < 2026 then raise exception 'Form 140 is for Tax Year 2026-27 onwards (periods from 1 April 2026)'; end if;
  if p_quarter not between 1 and 4 then raise exception 'Choose the quarter'; end if;
  if nullif(btrim(coalesce(p_prev_token, '')), '') is not null and btrim(p_prev_token) !~ '^[0-9]{15}$' then raise exception 'The token number of the previous statement is 15 digits'; end if;
  if exists (select 1 from accounts.tds_statements where company_id = p_company and tax_year_start = p_year and quarter = p_quarter and status = 'filed') then
    raise exception 'The statement for that quarter is already marked as filed';
  end if;
  insert into accounts.tds_statements (company_id, tax_year_start, quarter, prev_token) values (p_company, p_year, p_quarter, nullif(btrim(coalesce(p_prev_token, '')), '')) returning id into v_id;
  return v_id;
end $$;

create or replace function accounts.tds_statement_finish(p_id bigint, p_file_name text, p_text text, p_rows integer, p_challans integer, p_tds numeric) returns void
language plpgsql security definer set search_path to 'accounts', 'public'
as $$
declare me text;
begin
  me := accounts._guard_post();
  update accounts.tds_statements set status = 'generated', file_name = p_file_name, file_text = p_text, deductee_rows = p_rows, challan_rows = p_challans, tds_total = p_tds
   where id = p_id and status = 'draft';
  if not found then raise exception 'That statement is not a draft'; end if;
end $$;

create or replace function accounts.tds_statement_filed(p_id bigint, p_token text, p_date date) returns void
language plpgsql security definer set search_path to 'accounts', 'public'
as $$
declare me text;
begin
  me := accounts._guard_post();
  if btrim(coalesce(p_token, '')) !~ '^[0-9]{15}$' then raise exception 'The token number is 15 digits'; end if;
  update accounts.tds_statements set status = 'filed', token_no = btrim(p_token), filed_on = coalesce(p_date, current_date) where id = p_id and status = 'generated';
  if not found then raise exception 'Only a generated statement can be marked as filed'; end if;
end $$;

-- Let the person who marked a statement filed by mistake reopen it (administrators only)
create or replace function accounts.tds_statement_reopen(p_id bigint) returns void
language plpgsql security definer set search_path to 'accounts', 'public'
as $$
begin
  if not accounts.is_admin() then raise exception 'Only an Accounts administrator can reopen a filed statement'; end if;
  update accounts.tds_statements set status = 'generated', token_no = null, filed_on = null where id = p_id and status = 'filed';
  if not found then raise exception 'That statement is not marked as filed'; end if;
end $$;

revoke all on function accounts.tds_deductor_save(bigint, jsonb), accounts.tds_entry_update(bigint[], jsonb), accounts.tds_challan_save(jsonb), accounts.tds_challan_cancel(bigint),
  accounts.tds_challan_map(bigint, bigint[]), accounts.tds_auto_map(bigint, integer, integer), accounts.tds_statement_data(bigint, integer, integer),
  accounts.tds_statement_new(bigint, integer, integer, text), accounts.tds_statement_finish(bigint, text, text, integer, integer, numeric),
  accounts.tds_statement_filed(bigint, text, date), accounts.tds_statement_reopen(bigint) from public, anon;
grant execute on function accounts.tds_deductor_save(bigint, jsonb), accounts.tds_entry_update(bigint[], jsonb), accounts.tds_challan_save(jsonb), accounts.tds_challan_cancel(bigint),
  accounts.tds_challan_map(bigint, bigint[]), accounts.tds_auto_map(bigint, integer, integer), accounts.tds_statement_data(bigint, integer, integer),
  accounts.tds_statement_new(bigint, integer, integer, text), accounts.tds_statement_finish(bigint, text, text, integer, integer, numeric),
  accounts.tds_statement_filed(bigint, text, date), accounts.tds_statement_reopen(bigint) to authenticated;
