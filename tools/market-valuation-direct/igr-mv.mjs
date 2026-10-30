// West Bengal "Market Value of Flat/Apartment" from the new IGR portal (igr.wb.gov.in) - no browser.
// The old ASP.NET form (wbregistration.gov.in/MV/mv_aprt.aspx) now only answers "Website Moved".
// The new portal is an Angular app over plain JSON APIs; the calculator calls are anonymous
// (Content-Type: application/json, no token, no CAPTCHA check server-side). The only gate is the
// front door rejecting requests without a browser-like User-Agent ("Forbidden: Unauthorized origin").
// Modern TLS - no legacy OpenSSL option needed. Portable to Deno: fetch only.
//
// Flow mirrors the site's own component (mvof-flat-or-apartment):
//   1. ValidateApartmentLocation  (the "Validate" button)  -> must answer status 200
//   2. GetActualAparmentArea      (flat cover / carpet / super built-up -> area the rate applies to)
//   3. ApartmentMVCalculator      -> result = market value in rupees
// Any non-200 status or non-numeric result throws - nothing is ever guessed.

const ROOT = 'https://igr.wb.gov.in/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

// Fixed per-project answers. Codes are the portal's own master-data codes, resolved from its
// District / PoliceStation / Localbody / Mouza / Jurisdiction / Road / RoadZone / LocalbodyName /
// ApartmentSpecialProject lists (same places, same plot numbers as the old form's config).
export const PROJECTS = {
  'Dream World City': {
    districtCode: '16', psCode: '09', localBodyCode: '6', areaType: 'G', // South 24-Parganas / Bishnupur / Gram Panchayat
    mouzaCode: '093', roCode: '13', localBodyName: '401',               // Amgachhia / A.D.S.R. Bishnupur / AMGACHHIA
    road: '0', roadWithJurisdiction: '0', zone: '0', isRoadAvailable: false, isZoneAvailable: false,
    specialProjectCode: 'NA', isSpecialProjectAvailable: false, idn: '1604093',
    plotCodeType: 'LR', plotNo: '00266', ageOfApartment: 1, widthOfApproachRoad: 20,
  },
  'Dream Gurukul': {
    districtCode: '15', psCode: '01', localBodyCode: '3', areaType: 'M', // North 24-Parganas / Barasat / Municipality
    mouzaCode: '045', roCode: '03', localBodyName: '051',               // Doharia / A.D.S.R. Barasat / MADHYAMGRAM
    road: '0009', roadWithJurisdiction: '030009', zone: '1',            // Jessore Rd [BARASAT (A.D.S.R.)], zone 1 (Airport to Madhyagram Crossing On Road)
    isRoadAvailable: true, isZoneAvailable: true,
    specialProjectCode: '000', isSpecialProjectAvailable: false, idn: '1503045', // "not specified"
    plotCodeType: 'LR', plotNo: '01165', ageOfApartment: 0,
    // The old form disabled this for an on-road property; the new one has no "on road" question and
    // insists on >= 8 ft for buildings over 2 floors. Overridable per call (see widthOfApproachRoad).
    widthOfApproachRoad: 80,
  },
};

const FLOOR_TYPE_MARBLE = '3';
const USE_RESIDENTIAL = '01';

async function call(path, body, log) {
  const res = await fetch(ROOT + path, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json', Origin: ROOT.slice(0, -1), Referer: ROOT + 'mv-flat-or-apartment' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { throw new Error(`${path}: HTTP ${res.status}, not JSON: ${text.slice(0, 200)}`); }
  log(path.split('/').pop(), j);
  if (!res.ok || j.status !== 200) throw new Error(`${path.split('/').pop()}: ${j.message || 'HTTP ' + res.status} (status ${j.status})`);
  return j.result;
}

/**
 * input: { project, carpetArea, buildupArea, superBuildupArea, floor (number), widthOfApproachRoad? }
 * returns { value, area, requests } - throws on anything unexpected.
 */
export async function marketValue(input, log = () => {}) {
  const cfg = PROJECTS[input.project];
  if (!cfg) throw new Error(`unknown project "${input.project}"`);
  for (const k of ['carpetArea', 'buildupArea', 'superBuildupArea', 'floor']) {
    if (input[k] == null || input[k] === '' || !Number.isFinite(Number(input[k]))) throw new Error(`missing/invalid ${k}`);
  }
  const carpet = Number(input.carpetArea), cover = Math.round(Number(input.buildupArea)), sba = Number(input.superBuildupArea);
  const floor = Number(input.floor);
  if (!(sba > cover && cover > carpet)) throw new Error(`areas out of order: super ${sba} > built-up ${cover} > carpet ${carpet} must hold`);
  const width = Number(input.widthOfApproachRoad ?? cfg.widthOfApproachRoad);

  const loc = {
    arn: '', version: 1, slNoApartment: 0, slNoPlotOrRoad: 0,
    districtCode: cfg.districtCode, roCode: cfg.roCode, psCode: cfg.psCode, localBodyType: cfg.areaType,
    areaOfApartment: 0, mouzaCode: cfg.mouzaCode, plotCodeType: cfg.plotCodeType, plotNo: cfg.plotNo, bataPlotNo: '',
    roadCode: cfg.road, zoneNo: cfg.zone, localBodyCode: cfg.localBodyCode, localBodyName: cfg.localBodyName,
    roadWithJurisdicsionCode: cfg.roadWithJurisdiction, premises: cfg.road === '0' ? '0' : '',
    isRoadAvailable: cfg.isRoadAvailable, isRoadWiseMVAvailable: false, isMouzaAvailable: true, isZoneAvailable: cfg.isZoneAvailable,
    isLRRSConversionRequired: false, isSpecialProjectAvailable: cfg.isSpecialProjectAvailable,
    majorMinorCode: '', deedType: 'C', specialProjectCode: cfg.specialProjectCode, idn: cfg.idn,
  };
  const requests = {};
  requests.validate = loc;
  if (!input.skipValidate) await call('requisitionservice/public/api/ApartmentCircleRateValidator/v1/ValidateApartmentLocation', loc, log);

  requests.area = { flatCover: String(cover), carpetArea: String(carpet), superBuildUp: String(sba) };
  const area = await call('requisitionservice/public/api/ApartmentCircleRateValidator/v1/GetActualAparmentArea', requests.area, log);
  if (!Number.isFinite(Number(area)) || Number(area) <= 0) throw new Error(`GetActualAparmentArea: unusable area ${JSON.stringify(area)}`);

  requests.calc = {
    arn: '', version: 1, queryDate: '', slNoApartment: 0, specialProjectCode: cfg.specialProjectCode,
    apartmentType: 'FL', areaOfApartment: area, useOfFlat: USE_RESIDENTIAL, floorType: FLOOR_TYPE_MARBLE,
    widthOfApproachRoad: width, ageOfApartment: cfg.ageOfApartment, flatLocatedOnFloor: floor,
    isEncumberedByTenant: false, isTenantPurchaser: false, isLitigatedProperty: false, decorativeCharge: 0,
    isLiftFacilityAvailable: true, // building > 5 floors -> the site forces true
    isRoofGardenAvailable: false, isSwimmingPoolAvailable: true, isClubFacilityAvailable: true,
    isGymnasiumAvailable: true, isShoppingComplexAvailable: false, statedSetforthValue: 0,
    objApartPlotAndRoadModel: [{
      arn: '', version: 1, slNoApartment: 0, slNoPlotOrRoad: 0, districtCode: cfg.districtCode, roCode: cfg.roCode,
      psCode: cfg.psCode, localBodyType: cfg.areaType, areaOfApartment: area, mouzaCode: cfg.mouzaCode,
      plotCodeType: cfg.plotCodeType, plotNo: cfg.plotNo, bataPlotNo: '', roadCode: cfg.road, zoneNo: cfg.zone, useOfFlat: USE_RESIDENTIAL,
    }],
  };
  const v = await call('marketvalueservice/api/MarketValueCalculator/v1/ApartmentMVCalculator', requests.calc, log);
  const value = Number(v);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`ApartmentMVCalculator: unusable result ${JSON.stringify(v)}`);
  return { value, area: Number(area), requests };
}

// CLI: node igr-mv.mjs '{"project":"Dream Gurukul","carpetArea":534,"buildupArea":650,"superBuildupArea":870,"floor":6}'
if (typeof process !== 'undefined' && process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop()) && process.argv[2]) {
  marketValue(JSON.parse(process.argv[2]), (step, j) => console.error('  ', step, JSON.stringify(j).slice(0, 300)))
    .then((r) => console.log(JSON.stringify({ value: r.value, area: r.area })))
    .catch((e) => { console.log(JSON.stringify({ error: String(e.message || e) })); process.exitCode = 1; });
}
