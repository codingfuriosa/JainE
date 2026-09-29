// Fills West Bengal's Market Value of Apartment form (wbregistration.gov.in/MV/mv_aprt.aspx) via
// chrome.debugger, the same mechanism sheet-automation.js uses -- but this is a normal DOM form
// (not canvas-rendered like Sheets), so it's driven mostly through Runtime.evaluate: set a field's
// value, dispatch the event ASP.NET's own onchange="__doPostBack(...)" is listening for, rather
// than simulated clicks for every step. Plot No is the one exception -- it needs a real Tab
// keypress, confirmed directly (during the original Playwright build of this same form-fill logic)
// that only genuine input triggers that field's auto-fill behaviour.
//
// Every timing/quirk fix below was found the hard way against the live site during that earlier
// Playwright build (see the comments) and is carried over unchanged -- this is a straight port to
// CDP, not a rewrite of the site-specific knowledge.
import { sleep, attach, detach, pressKey, evaluate, screenshotAndSave, findOrOpenTab } from './cdp-input.js';
import { fetchMarketValuationPending, writeMarketValuation } from './supabase-rpc.js';

const FORM_URL = 'https://wbregistration.gov.in/MV/mv_aprt.aspx';

const ID = {
  district: '#ctl00_CPH_DDL_District',
  thana: '#ctl00_CPH_DDL_Thana',
  mouza: '#ctl00_CPH_DDL_Mouza',
  road: '#ctl00_CPH_DDL_Road',
  roadZone: '#ctl00_CPH_DDL_Zone',
  plotType: '#ctl00_CPH_DDL_plot_code_type',
  plotNo: '#ctl00_CPH_txt_plot_no',
  projectName: '#ctl00_CPH_DDL_project_name',
  carpetArea: '#ctl00_CPH_txtCarpetArea',
  coveredArea: '#ctl00_CPH_txt_covered_area',
  buildArea: '#ctl00_CPH_txt_build_area',
  useOfFlat: '#ctl00_CPH_DDL_use_of_flat',
  floorType: '#ctl00_CPH_DDL_floor_type',
  floorLocation: '#ctl00_CPH_txt_floor_location',
  flatNo: '#ctl00_CPH_txt_flat_no',
  flatAge: '#ctl00_CPH_txt_flat_age',
  litigated: '#ctl00_CPH_DDL_Litigeted',
  propertyOnRoad: '#ctl00_CPH_DDL_property_on_road',
  widthOfRoad: '#ctl00_CPH_txt_width_of_road',
  encumberedByTenant: '#ctl00_CPH_DDL_encumbered_by_tenant',
  tenantPurchaser: '#ctl00_CPH_DDL_Tenant_Purchaser',
  noOfFloor: '#ctl00_CPH_txtNoOfFloor',
  swimmingPool: '#ctl00_CPH_CB_Swimming_Pool',
  clubFacility: '#ctl00_CPH_CB_Club_Facility',
  gymnasium: '#ctl00_CPH_CB_Gymnasium',
  submit: '#ctl00_CPH_btn_Display',
};

// Fixed, per-project answers - confirmed against the live form by hand during the Playwright build.
const PROJECTS = {
  'Dream World City': {
    district: 'South 24-Parganas', thana: 'Bishnupur', mouza: 'Amgachhia',
    road: null, roadZone: null, plotType: 'LR', plotNo: '00266',
    ageOfFlat: '1', isPropertyOnRoad: 'No', widthOfApproachRoad: '20',
  },
  'Dream Gurukul': {
    district: 'North 24-Parganas', thana: 'Barasat', mouza: 'Doharia',
    road: 'Jessore Rd [BARASAT (A.D.S.R.)]',
    // Confirmed directly against the live dropdown: the site spells this "Madhyagram", not
    // "Madhyamgram" - the obvious spelling silently fails to match and leaves Zone unselected.
    roadZone: '1 -- Airport to Madhyagram Crossing On Road',
    plotType: 'LR', plotNo: '01165',
    ageOfFlat: '0', isPropertyOnRoad: 'Yes', widthOfApproachRoad: null,
  },
};

function round(n) { return String(Math.round(Number(n))); }

async function selectByLabel(tabId, id, label, required) {
  const r = await evaluate(tabId, `(function(){
    const el = document.querySelector(${JSON.stringify(id)});
    if(!el) return {ok:false, err:'no element'};
    if(el.disabled) return {ok:false, err:'disabled'};
    const opts = Array.from(el.options);
    const m = opts.find(o => o.textContent.trim() === ${JSON.stringify(label)});
    if(!m) return {ok:false, err:'no option matching label'};
    el.value = m.value;
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return {ok:true};
  })()`);
  if (required && !r?.ok) throw new Error(`market-valuation: could not select "${label}" on ${id} (${r?.err ?? 'unknown'})`);
  return r?.ok;
}

async function selectMatching(tabId, id, regexSource) {
  return evaluate(tabId, `(function(){
    const el = document.querySelector(${JSON.stringify(id)});
    if(!el) return {ok:false, err:'no element'};
    const opts = Array.from(el.options);
    const re = new RegExp(${JSON.stringify(regexSource)}, 'i');
    const m = opts.find(o => re.test(o.textContent.trim()));
    if(!m) return {ok:false, err:'no option matching pattern'};
    el.value = m.value;
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return {ok:true};
  })()`);
}

// Skips a disabled field rather than forcing a value into it - confirmed directly that Width of
// Road becomes disabled the moment Property on Road is set to "No" (still visible, just disabled),
// and setting .value on it anyway is what was producing "Minimum Road Width should be 8ft": the
// field ends up carrying a value while disabled, which the site's own validation reads as invalid
// rather than as "not applicable". The original Playwright script never had this bug only because
// Playwright's own .fill() refuses to act on a disabled element and that failure was silently
// caught - the field was never actually being filled there either, and the form works correctly
// without it. This makes the real behaviour explicit instead of accidental.
async function fillValue(tabId, id, value) {
  return evaluate(tabId, `(function(){
    const el = document.querySelector(${JSON.stringify(id)});
    if(!el) return {ok:false, err:'no element'};
    if(el.disabled) return {ok:false, err:'disabled'};
    el.value = ${JSON.stringify(String(value))};
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return {ok:true};
  })()`);
}

async function checkBox(tabId, id) {
  return evaluate(tabId, `(function(){
    const el = document.querySelector(${JSON.stringify(id)});
    if(!el) return {ok:false};
    if(!el.checked){ el.checked = true; el.dispatchEvent(new Event('change',{bubbles:true})); }
    return {ok:true};
  })()`);
}

async function focusAndTab(tabId, id) {
  await evaluate(tabId, `document.querySelector(${JSON.stringify(id)})?.focus()`);
  await pressKey(tabId, { key: 'Tab', code: 'Tab', keyCode: 9 });
}

async function navigateAndWait(tabId, url) {
  await new Promise((resolve) => {
    function onUpdated(id, info) {
      if (id === tabId && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(onUpdated); resolve(); }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.update(tabId, { url });
  });
}

/** Fills and submits the Market Value form for one case, returns the parsed rupee value. */
async function fetchMarketValueFromSite({ project, carpetArea, buildupArea, superBuildupArea, floor, flatNo }) {
  const cfg = PROJECTS[project];
  if (!cfg) throw new Error(`market-valuation: unknown project "${project}"`);
  if (carpetArea == null || buildupArea == null || floor == null || !flatNo) {
    throw new Error('market-valuation: missing a required figure - refusing to guess');
  }

  const tabId = await findOrOpenTab('https://wbregistration.gov.in/MV/*', FORM_URL);
  await attach(tabId);
  try {
    // A fresh navigation every time, even if a stale tab from a previous (possibly failed) attempt
    // was already sitting open on this URL - the form must start from a clean state.
    await navigateAndWait(tabId, FORM_URL);
    await sleep(1500);

    await selectByLabel(tabId, ID.district, cfg.district, true);
    // District's own postback repopulates the Thana list itself - confirmed directly this needs
    // longer than it looks like it should.
    await sleep(3000);

    // Thana's postback auto-fills Jurisdiction and Gram Panchayat/Local Body - the longest wait of
    // any field on this form (confirmed directly).
    await selectByLabel(tabId, ID.thana, cfg.thana, true);
    await sleep(8000);

    await selectByLabel(tabId, ID.mouza, cfg.mouza, true);
    await sleep(3000);

    if (cfg.road) {
      await selectByLabel(tabId, ID.road, cfg.road, true);
      // Road Zone stays disabled until this postback finishes populating it.
      await sleep(9000);
    }
    if (cfg.roadZone) {
      await selectByLabel(tabId, ID.roadZone, cfg.roadZone, true);
      await sleep(1000);
    }

    await selectByLabel(tabId, ID.plotType, cfg.plotType, false);
    await fillValue(tabId, ID.plotNo, cfg.plotNo);
    await focusAndTab(tabId, ID.plotNo);
    await sleep(3000);

    await selectByLabel(tabId, ID.useOfFlat, 'Residential', false);
    await selectByLabel(tabId, ID.floorType, 'Marble', false);

    // Carpet Area and Super Buildup Area keep full DB precision; Covered/Buildup Area is the one
    // field on this form that rejects a decimal point outright (confirmed directly: "Covered Area
    // should not contain Special Character or Blank Space").
    await fillValue(tabId, ID.carpetArea, String(carpetArea));
    await fillValue(tabId, ID.coveredArea, round(buildupArea));
    if (superBuildupArea != null) await fillValue(tabId, ID.buildArea, String(superBuildupArea));

    await fillValue(tabId, ID.floorLocation, String(floor));
    await fillValue(tabId, ID.flatNo, String(flatNo));
    await fillValue(tabId, ID.flatAge, cfg.ageOfFlat);

    await selectByLabel(tabId, ID.litigated, 'No', false);
    await selectByLabel(tabId, ID.propertyOnRoad, cfg.isPropertyOnRoad, false);
    await sleep(800);
    if (cfg.widthOfApproachRoad) await fillValue(tabId, ID.widthOfRoad, cfg.widthOfApproachRoad);

    await selectByLabel(tabId, ID.encumberedByTenant, 'No', false);
    await selectByLabel(tabId, ID.tenantPurchaser, 'No', false);
    await fillValue(tabId, ID.noOfFloor, '8');

    for (const id of [ID.swimmingPool, ID.clubFacility, ID.gymnasium]) await checkBox(tabId, id);

    // Project Name auto-fills from Plot No/Road and can get RE-populated by later postbacks even
    // after being reset once - setting it here, as the very last action before submit, is what
    // actually sticks (confirmed directly during the Playwright build: resetting it earlier let a
    // later postback silently put a real project name back).
    //
    // The "no specific project" option's exact text varies by plot - "Not Available" for one,
    // " Not Specified" (leading space) for another (confirmed directly) - match either.
    const noneSel = await selectMatching(tabId, ID.projectName, '^not (available|specified)$');
    if (!noneSel?.ok) throw new Error('market-valuation: no "Not Available"/"Not Specified" option found in Project Name');
    await sleep(500);

    // The CAPTCHA field is deliberately left untouched - confirmed directly, across several real
    // submissions, that this specific form never actually validates it.
    await evaluate(tabId, `document.querySelector(${JSON.stringify(ID.submit)})?.click()`);
    await sleep(3000);

    const bodyText = await evaluate(tabId, 'document.body.innerText');
    const m = String(bodyText || '').match(/Market Value of Apartment\s*:-?\s*Rs\.?\s*([\d,]+)/i);
    if (!m) {
      const errLine = String(bodyText || '').split('\n').map((s) => s.trim())
        .find((s) => /should be|must be|please|invalid|required/i.test(s) && s.length < 200);
      throw new Error(errLine || 'market-valuation: value not found in page - form was not accepted as filled');
    }
    return parseInt(m[1].replace(/,/g, ''), 10);
  } catch (err) {
    await screenshotAndSave(tabId, 'market-valuation');
    throw err;
  } finally {
    await detach(tabId);
  }
}

// cost_sheet's flat can read like "Block A2 - 6B" - only the part after the last dash is the
// actual flat number; booking_form's version is already clean.
function deriveFlat(costSheetFlat, bookingFormFlat) {
  let flat = bookingFormFlat || costSheetFlat;
  if (!flat) return null;
  flat = String(flat).trim();
  if (flat.includes('-')) flat = flat.split('-').pop().trim();
  return flat || null;
}

/**
 * The market_valuation "sub agent". Deliberately ignores job.payload.case_id as the ONLY thing to
 * do -- it re-derives the full backlog from acc.market_valuation_job_pending() every time it runs
 * (whatever job actually woke it) and clears every case still missing a value, not just the one
 * the triggering job named. That is what makes this self-healing: if a previous run's job was lost,
 * failed, or never claimed (browser closed, tunnel down, whatever), the NEXT run - on its own
 * ~1-minute alarm, or a manual "Run now" - picks up every case still pending regardless of which
 * job (if any) is nominally associated with it. One case per invocation is genuinely processed;
 * this function itself is only ever asked to do the one the queue handed it, but see background.js
 * -- drainQueue keeps calling processOneJob while more jobs remain pending, so a real backlog of
 * several cases still gets cleared in the same drain cycle, one submission after another rather
 * than all at once (each fill-and-submit already takes 30-40s from the waits above, which keeps
 * requests naturally spaced out rather than hammering the government site the way an instant retry
 * loop would - confirmed earlier this same build that rapid repeated submissions get rate-limited).
 */
export async function runMarketValuationJob(config) {
  const pending = await fetchMarketValuationPending(config);
  if (!pending.length) return { ok: true, note: 'nothing pending' };

  const row = pending[0];
  const carpetArea = row.carpet_ua ?? null;
  const buildupArea = row.builtup_ua ?? row.cost_sheet?.builtup_sqft ?? null;
  const superBuildupArea = row.sba ?? null;
  const flat = deriveFlat(row.cost_sheet?.flat, row.booking_form?.flat);
  const floor = row.floor ?? row.cost_sheet?.floor ?? row.booking_form?.floor ?? null;

  if (carpetArea == null || buildupArea == null || !flat || floor == null) {
    // Not a failure - there is genuinely nothing more to check. Marking it failed would just
    // retry-and-fail three times for no reason; leave it for a human, same as the old edge
    // function's skip response.
    return { ok: true, note: `case ${row.case_id}: skipped - missing a figure after checking every known source` };
  }

  const value = await fetchMarketValueFromSite({ project: row.project, carpetArea, buildupArea, superBuildupArea, floor, flatNo: flat });
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, note: `case ${row.case_id}: site returned no usable value` };
  }
  await writeMarketValuation(config, row.case_id, String(value));
  return { ok: true, note: `case ${row.case_id}: wrote market valuation ${value}${pending.length > 1 ? ` (${pending.length - 1} more still pending, will clear on the next run)` : ''}` };
}
