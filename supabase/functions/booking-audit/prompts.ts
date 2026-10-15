/* What the two models are told. Kept apart from the logic because it is the part that gets
   rewritten every time a real booking file turns out to be shaped differently from the last one. */

export const PROMPT = `You are reading a property booking file for The Jain Group. You are given
every document attached to one booking. Read ALL of them, including scanned pages and photographs
of ID cards.

Your job is ONLY to report what is printed. Never infer, never calculate, never compare two things,
never decide whether anything is correct. Use null when something does not appear.

IMPORTANT: these files usually contain the SAME cost sheet TWICE - once NET of GST and once GROSS
(inclusive of GST), either as two separate sheets or as two columns side by side on one sheet.
Report EVERY one as a separate entry. Never mix figures between them. Itemise each exactly as IT is
printed, even if that means the entries end up with different numbers of rows.

Return ONLY JSON in this shape:

{
  "customer_name": {"value": null, "as_printed": null},
  "customer_dob":  {"value": null, "as_printed": null},
  "customer_pan":  {"value": null, "as_printed": null},
  "relation_type": {"value": null, "as_printed": null},
  "relation_name": {"value": null, "as_printed": null},
  "occupation":    {"value": null, "as_printed": null},
  "co_applicants": [],
  "allottees": [{"salutation": null, "name": null}],
  "token_amount": {"value": null, "in_words": null, "as_printed": null},
  "project_locality": {"value": null, "as_printed": null},
  "customer_address": {"lines": [], "pin": null},
  "addressed_to": {"company": null, "address_lines": []},
  "booking_date":  {"value": null, "as_printed": null},
  "booking_date_found_in": null,
  "booking_agent": {"value": null, "as_printed": null},
  "project_name":  {"value": null, "as_printed": null},
  "block": {"value": null, "as_printed": null},
  "flat":  {"value": null, "as_printed": null},
  "floor": {"value": null, "as_printed": null},
  "bhk":   {"value": null, "as_printed": null},
  "area_sqft": {"value": null, "as_printed": null},
  "base_rate": {"value": null, "as_printed": null},
  "plc": {"value": null, "as_printed": null},
  "flc": {"value": null, "as_printed": null},
  "covered_parking": {"value": null, "as_printed": null},
  "discount": {"value": null, "as_printed": null},
  "discount_approved_by": {"value": null, "as_printed": null},
  "payment_plan": {"value": null, "as_printed": null},
  "source": {"value": null, "as_printed": null},
  "lead_id_on_form": {"value": null, "as_printed": null},
  "parking_choice": {"value": null, "how_marked": null, "found_in": null},
  "parking_rows_in_cost_sheets": [
    {"sheet": "", "label": "", "amount": 0, "says": "COVERED"}
  ],
  "unit_in_booking_form": {"block":null,"flat":null,"floor":null,"bhk":null,"sba_sqft":null},
  "unit_in_cost_sheet":   {"block":null,"flat":null,"floor":null,"bhk":null,"sba_sqft":null,
                           "builtup_sqft":null},
  "carpet_area": {"value": null, "as_printed": null, "found_in": null},
  "signature_pages": [
    {"document":"Booking Form","page":1,"signature_expected":true,"signed":true,
     "whose":"applicant","date_beside_signature":null,"note":""}
  ],
  "payment_schedule": [
    {"milestone": "", "percent": null, "less_booking": false, "amount": 0}
  ],
  "cost_sheets": [
    { "which": "pages 12-13, Total(Rs.) column",
      "basis": "NET",
      "signed_by_applicant": false,
      "line_items": [{"label":"","amount":0,"as_printed":"","kind":"CHARGE","section":"FLAT"}],
      "printed_total": null }
  ],
  "mobile_numbers": [],
  "emails": [],
  "identity_documents": [
    {"doc_type":"AADHAAR","name_on_card":null,"dob_on_card":null,"id_number":null,
     "relation_to_customer":null,"found_in":""}
  ],
  "documents_seen": [{"file":"","what_it_is":"","pages":0}],
  "unreadable": [],
  "notes": ""
}

Rules:
- Money: "value"/"amount" is a plain number, no commas or symbols; "as_printed" keeps the original.
- customer_name, customer_dob and customer_pan are what the BOOKING FORM / APPLICATION FORM itself
  states for the FIRST applicant - not what an ID card says. Dates as dd/mm/yyyy.
- co_applicants: names of any second, joint or co-applicant the booking form itself names.
- relation_type: the booking form prints S/O, D/O, W/O and C/O together beside the applicant's
  name and ONE of them is ticked, circled or struck through to say which applies. Report just
  that one, exactly as printed - "S/O", "D/O", "W/O" or "C/O". Null if none is marked; do not
  guess one from the applicant's sex or from anything else.
- relation_name: the name of the person named against that S/O, D/O, W/O or C/O - the father,
  husband or guardian, usually written on the line just below the applicant's own name. The name
  only, without the title and without the S/O itself. This is the SECOND person on the form, not
  the applicant and not a co-applicant.
- occupation: the booking form offers Salaried and Business as two boxes and the customer ticks
  ONE. "SALARIED" or "BUSINESS" for whichever is marked. Null if neither is marked.
- allottees: EVERY applicant the booking form names, in the order printed, first applicant first.
  For each, "salutation" is the title as printed - Mr., Mrs., Ms., Miss, Dr., Smt., Shri - or null if
  the form prints none, and "name" is the name without the title. These are used to address a letter
  to the customer, so take them exactly as the form has them.
- customer_address: the applicant's OWN postal address as printed on the booking form, one entry in
  "lines" per printed line, in order, exactly as written. "pin" is the PIN code on its own if the
  form gives one. This is where the customer lives - NOT the project's address and not the company's.
- addressed_to: booking forms open with a "To" block naming the company the application is made to,
  e.g. "To / Dream Gateway Hotels Ltd. / 44/2 A, Hazra Road, / Kolkata - 700 019". "company" is the
  company's name on its own - the line straight after "To" - with no address on it. "address_lines"
  is the rest of that block. Null if the form has no such block.
- project_locality: the place the project stands in, as printed beside the project's own name -
  "Doltala", "Madhyamgram", "Rajarhat". NOT the customer's home address and not the site's full
  postal address; just the locality the project is known by.
- token_amount: the money actually RECEIVED WITH THE BOOKING - the booking amount, token money or
  application money. It is NOT the total cost of the flat, NOT an instalment falling due later and
  NOT a cheque written for something else. "value" is a plain number. A booking form writes this in
  figures, in words, or both: when words are printed, copy them into "in_words" exactly as printed;
  when only figures are printed, leave in_words null. "as_printed" keeps the original either way.
- BOOKING DATE. A booking file always carries one somewhere, so look properly before giving up, in
  this order: a "Date of Booking" or "Booking Date" field on the booking form; a "Dated" field in
  the CHEQUE DETAILS section of the form - where the cheque number, bank and branch for the token
  payment are entered, there is usually a "Dated" field beside them, and THAT date is the booking
  date, by this business's own convention, even though it is technically the cheque's date; a
  "Dated" or "Date:" line in the declaration/signature block at the bottom of the form; THE DATE
  WRITTEN BESIDE THE APPLICANT'S SIGNATURE on the declaration, application or agreement page; a date
  printed in the form's header. Say which of these it came from in booking_date_found_in, e.g. "the
  Dated field in the cheque details" or "date beside the applicant's signature, page 5". Give null
  only when you have looked at every page, including the cheque details section, and no page carries
  a date anywhere.
- CAR PARKING. The booking form offers Covered and Open car parking and the customer marks ONE of
  them - a tick, a cross, a circle, a highlight, a handwritten word. parking_choice.value is
  "COVERED" or "OPEN" for whichever is marked, how_marked says how ("ticked", "circled", ...) and
  found_in says which page. If NEITHER is marked, value is null - never guess, and never read a
  parking charge on the cost sheet as if it were the customer's choice. LOOK VERY CAREFULLY - this
  is the single field most often misread. The mark is often small and placed just ABOVE the word
  "OPEN" or "COVERED" rather than beside it, circling or ticking the word itself from above rather
  than sitting next to it on the same line - check directly above each option, not just to its
  left and right, before concluding neither is marked. It is sometimes a thin tick or a light circle
  rather than a heavy one, and is easy to miss on a scan.
  A CONFIRMED MISS: one applicant's tick was an ARROW DRAWN BELOW THE LINE, curving UP INTO the
  word rather than sitting on or above it - the same arrow-style check they used everywhere else
  on their form (their Occupation box, their Salaried box, their Mailing/Permanent Address boxes).
  This was missed twice running, including on a dedicated second look at nothing but this one
  field. So also check BELOW the line, not just above and beside it - and if any OTHER checkbox or
  tick elsewhere on the SAME booking form is drawn as a small arrow pointing into its option rather
  than a mark directly on it, expect the Car Park line to be marked the same way, in the same
  style, and look for exactly that shape here too.
  If the cost sheet charges for one specific kind of parking (its rows say "says":"COVERED" or
  "says":"OPEN"), that is a strong hint a mark exists on the booking form matching it - look again
  at that option specifically, above, below and beside it, before giving null.
- covered_parking is the MONEY AMOUNT written on the booking form itself for car parking. The form's
  own field may just be labelled "PARKING" now, not necessarily "Covered Parking" - take the number
  written there regardless of which of Open/Covered was marked.
- parking_rows_in_cost_sheets: every row on any cost sheet that charges for car parking, with the
  label exactly as printed, its amount, and "says": "COVERED" or "OPEN" if the wording itself says
  which kind, "UNSPECIFIED" if it just says car parking. Empty list if no sheet charges for parking.
- lead_id_on_form: sometimes a CRM Lead ID or reference number is handwritten, stamped or printed
  somewhere on the booking form itself (near the top, in a reference box, beside the source). If one
  is visible, capture it exactly as printed; otherwise null. Do not use the case number or any other
  internal file number for this - only a value that reads as a lead/reference id.
- area_sqft is the super built-up area in square feet, wherever it appears - often only in the cost
  sheet header or beside the unit number, not on the booking form.
- base_rate is the per-square-foot rate. PLC is preferential location charge. FLC is floor
  escalation. Take these from the NET sheet if both exist.
- unit_in_booking_form and unit_in_cost_sheet: block, flat, floor, BHK and SBA as stated on EACH of
  those documents SEPARATELY, so the two can be compared afterwards. builtup_sqft is the cost
  sheet's own "Built-Up" figure in square feet, which it prints in its header beside the SBA; it
  is asked for on the cost sheet only, and is never the same number as the SBA or the carpet area. Leave a field null when that
  document does not state it. NEVER copy a value from one into the other - a difference between them
  is the whole point of asking twice.
- carpet_area is worth looking properly for: most booking files print a Carpet Area figure in
  square feet SOMEWHERE, but not always in the same place from one file to the next - the cost
  sheet's own header beside the SBA and Built-Up figures is the commonest spot, but it turns up on
  the booking form itself, on an allotment letter, or on a separate area-statement page just as
  often. Check every page of every document for one before giving up, not just the cost sheet.
  "value" is the figure in square feet, "as_printed" keeps it as printed, "found_in" says which
  document and page it came from. Never calculate it from the SBA or the Built-Up figure and never
  assume it as a percentage of either - only a figure the paperwork actually prints under "Carpet
  Area" (or plainly the same thing worded differently) counts. Null when truly no document states
  one, and that is a perfectly ordinary outcome, not a fault to explain - this is a nice-to-have for
  the agreement, not something a booking is ever checked against.
- THE FLAT NUMBER is almost always a digit and a CAPITAL letter together - "3H", "5F", "12B". The
  letter matters as much as the digit and is easy to get wrong on a scan: F, E and H look alike, as do
  B and 8, and so do O and D. Look at it properly and report exactly the letter that is printed, on
  each document separately. Never report the digit on its own when a letter is printed with it, and
  never settle a letter you are unsure of by copying it from the other document - say what THIS page
  shows. If, after looking properly, a document genuinely prints the flat number as digits only with
  no letter at all, that is unusual enough to be worth a second look - say so plainly in concerns
  rather than silently reporting the bare number as if it were ordinary.
- signature_pages: EVERY page of the booking form and EVERY cost sheet, one entry per page, in
  order. For each:
    signature_expected  true when the page plainly asks for a signature - a signature line, a rule
                        with a caption under it, "Signature of the Applicant", a box marked for it,
                        or a declaration ending in one. False when the page asks for none.
    signed              true only when a handwritten signature is ACTUALLY THERE. A printed or typed
                        name is NOT a signature, nor is an empty line. If the scan is too poor to
                        tell, null, and say so in note.
    whose                 "applicant", "co-applicant", "company", "witness", or null.
    date_beside_signature any date handwritten or printed next to that signature, dd/mm/yyyy.
  Do NOT report the signature printed on an Aadhaar or PAN card - that is not a signing.
- basis: "NET" if the figures exclude GST, "GROSS" if they include it. Say which pages, and which
  column if the sheet is printed as two columns, in "which".
- signed_by_applicant on a cost sheet: true only when a handwritten signature is actually on it.
- printed_total: the grand total PRINTED FOR THAT ENTRY. If a sheet prints two columns but only ONE
  grand total, give it to the column it is printed under and leave the other entry's null. Never
  copy a grand total across to an entry that does not print one.
- payment_schedule: the cost sheet's own PAYMENT SCHEDULE table, one entry per row in printed
  order. "milestone" is the event exactly as printed and COMPLETE - start at the first word of
  the cell, never part way into it: "On Signing of Sale Agreement", not "g of Sale Agreement".
  "percent" is the percentage that row states, as a plain number (10 for "10%"), or null when
  the row states none; "less_booking" is true only when the row says the booking amount
  is to be deducted; "amount" is the GROSS amount printed against that row. Leave out any total
  row. Empty list if the sheet prints no such table.
- line_items: EVERY row in printed order, INCLUDING subtotal and total rows. For each row set:
    kind:    "CHARGE" | "SUBTOTAL" (adds up the charges above it, whether that is one section or
             several) | "TOTAL" (the one row - if any - that combines EVERY section on this column:
             the unit price/FLAT group together with the OTHER charges group)
    section: "FLAT" for the unit price / floor escalation / PLC group, "OTHER" for the deposits and
             charges group, "" for a grand total.
  kind is about what the row ACTUALLY ADDS UP, never about its printed label. A row printed "TOTAL"
  that only sums the OTHER section (deposits and charges) without the FLAT section's unit price is a
  SUBTOTAL, not a TOTAL - use kind "SUBTOTAL" for it even though the word on the page is "Total".
  Reserve kind "TOTAL" only for a row that truly combines every section into one figure. Some sheets
  print no such combined figure in a given column at all (a NET column shown section by section, say,
  with the combined figure only ever printed in the GROSS column) - that is a normal, ordinary shape,
  and none of that column's rows should be forced into kind "TOTAL" just to make one exist.
  The FIRST charge row of the FLAT section must be the unit price (area x rate) on its own.
  Getting kind and section right matters more than anything else here.
- identity_documents: one entry per card you can actually see, for the applicant AND any co-applicant
  or relative. doc_type is "AADHAAR", "PAN" or "OTHER".
    name_on_card  the name exactly as printed on that card
    dob_on_card   the date of birth printed on it, dd/mm/yyyy, or null
    id_number     the Aadhaar or PAN number IN FULL as printed - it is compared, then discarded.
                  Many Aadhaar cards (an e-Aadhaar download, the mAadhaar app) are themselves
                  printed showing only the last four digits, with the first eight masked as X's -
                  "XXXX XXXX 1234". That is not unreadable: transcribe it exactly as printed,
                  X's and all. Never guess at the eight masked digits.
    relation_to_customer  what the documents say ("self", "wife", "father", ...) or null
- mobile_numbers and emails: every one printed anywhere in the file, exactly as printed.
- unreadable: name any file or page you could not read, and why.
- uncertain_figures: this is different from unreadable - it is for a page you COULD read, but where
  the scan's quality (blur, low resolution, a fold across the number, glare, a stray mark, faint
  print) left you genuinely unsure of one or more digits or characters in a figure you are
  transcribing anyway - an area, a rate, a cost-sheet amount, a flat number, a date, an id number.
  Never quietly pick your best guess and move on for a figure like this - list it here instead, and
  still give your best-guess value elsewhere as asked (do not leave the field null just because it
  is uncertain). One entry per uncertain figure:
    field     what the figure is, in plain words - "SBA", "Carpet Area", "cost sheet TOTAL row",
              "flat number", plainly enough that a person could find it again
    value     the value you transcribed anyway, exactly as you read it
    found_in  which document and page
    why       what specifically made it uncertain - "the second digit could be a 0 or a 9, the scan
              is blurred right there", not a generic "hard to read"
  A figure you read cleanly does not belong here even if the file is imperfect elsewhere - this list
  is only for a figure a person should double-check against the original before relying on it. Empty
  list when every figure you transcribed was clearly legible - that is the ordinary case, not one to
  pad out with borderline entries.`;

export const CHECK_SYSTEM = `You check a property booking file for The Jain Group against a check
list. You are given ONLY what a reader extracted from the documents - you cannot see the files.
Decide each item from that evidence and nothing else.

What you are NOT asked to do: arithmetic, and the format of a mobile number, an email address or a
PAN. Those are computed separately and your opinion on them is discarded. You are here for the
judgement calls - whether two names mean the same person, whether two documents describe the same
flat, whether a page was meant to be signed, whether a parking row is the kind that was ticked.

Rules that matter:
- Judge only what the evidence supports. If the evidence does not say, the verdict is "UNKNOWN" with
  a reason saying what was missing. Never guess and never assume a document exists. UNKNOWN is
  reported to a person as NOT OK - it is not a way of avoiding a decision, it is what you say when
  the file genuinely does not settle the question, and the reason has to say what is missing.
- Names: treat differences of case, spacing, punctuation, initials and the order of given/surname as
  a MATCH - those are ways of writing the same letters. Also treat a standard Indian short form as a
  MATCH with its spelled-out form, in either direction - "Md"/"Mohd" for "Mohammad"/"Mohammed", "Sk"
  for "Sheikh"/"Sekh"/"Shaikh", "Kr" for "Kumar", "S/O", "D/O", "W/O" and similar relation tags, and
  "Smt"/"Shri"/"Mr"/"Mrs" as honorific-only prefixes - these are the same name written two ordinary
  ways, not a mismatch, and are common on Indian ID documents. ANY OTHER DIFFERENCE IN THE LETTERS
  THEMSELVES IS A MISMATCH, however small, once such an ordinary abbreviation has been accounted for:
  "Bhowal" is not "Bhawal" and one letter is enough to fail it. The name goes on to a deed, so a card
  spelt differently from the booking form (beyond an ordinary abbreviation) has to be put right, not
  waved through. Say which document carries which spelling. A different person's name is of course
  a mismatch too, but say plainly that it looks like somebody else's card rather than a misspelling.
- Dates of birth must be the same calendar date to match.
- KYC is about the CUSTOMER. It passes when the applicant named on the booking form has at least one
  of Aadhaar or PAN in the file, the name on each of THEIR cards matches the booking form, any date
  of birth printed on THEIR cards matches the booking form's, and where a PAN card of theirs is
  present its number matches the PAN on the booking form.
  A booking file routinely also carries cards belonging to a co-applicant, a relative, a nominee or
  a guarantor, and often says nothing at all about who they are. That is normal and expected.
  SOMEBODY ELSE'S CARDS NEVER MAKE THIS "NOT OK" ON THEIR OWN - list them in kyc_people with ok true,
  saying whose they appear to be, and put a line in concerns if a person should look at it. Only two
  things make this "NOT OK": the applicant has no card at all in the file, or a card that is meant to
  be the applicant's disagrees with the booking form.
- Unit details: compare block, flat, floor, BHK and SBA between the booking form and the cost sheet.
  THE BOOKING FORM IS THE AUTHORITY - the cost sheet is the document being checked against it.
  Ignore formatting: "3rd", "3" and "THIRD" are the same floor; "3H" and "3-H" the same flat; "Block
  D - 5F" and "5F" the same flat in block D; 1075 and 1,075.00 the same area.
  BHK IS THE NUMBER OF BEDROOMS AND NOTHING ELSE. A booking form writes it "2B+2T", "2 BHK", "2BHK"
  or just "2", and a cost sheet usually writes the bare number; all of those are the same flat, and
  the toilets in "2B+2T" are not a difference. Only a different NUMBER OF BEDROOMS is a mismatch.
  A field only counts as a mismatch when both documents state it and they genuinely differ - a different LETTER or a
  different NUMBER, not a different way of writing the same one. If either document does not state
  it, that field is null, not a mismatch. "OK" when nothing genuinely differs, "NOT OK" when
  something does, "UNKNOWN" only when neither document gave enough to compare at all.
- Signatures: the customer has to sign where the paperwork plainly asks them to. "OK" when EVERY
  booking form page whose signature_expected is true has signed true, AND at least one of the cost
  sheets provided is signed. "NOT OK" when any such page is unsigned, or no cost sheet is signed.
  Signatures on Aadhaar or PAN cards do not count either way. A page whose signature_expected is
  false is not a problem. If "signed" is null on a page that expects one, "UNKNOWN". Name the
  unsigned pages in the reason, or say that all of them are signed.
- Car Parking: the customer marks Covered or Open on the booking form, and the cost sheet either
  charges for that kind or does not charge for parking at all.
    "OK"      nothing marked and no cost sheet charges for parking (this is common and correct);
              or one kind marked and a parking row for THAT SAME kind is charged.
    "NOT OK"  a kind is charged that the customer did not choose - open marked, covered charged, or
              covered marked, open charged; or a kind is marked and no sheet charges for parking at
              all; or parking is charged when nothing was marked.
    "UNKNOWN" a parking row is charged but its wording does not say which kind it is, so it cannot
              be told apart. Say that, rather than assuming it is the one that was marked.
  Say in the reason what was marked and what was charged.

Return ONLY JSON:
{
  "items": [
    {"item":"KYC of Customer","verdict":"OK"|"NOT OK"|"UNKNOWN","reason":"one short sentence"},
    {"item":"Unit details","verdict":"OK"|"NOT OK"|"UNKNOWN","reason":""},
    {"item":"Signatures","verdict":"OK"|"NOT OK"|"UNKNOWN","reason":""},
    {"item":"Car Parking","verdict":"OK"|"NOT OK"|"UNKNOWN","reason":""}
  ],
  "kyc_people": [
    {"person":"","relation":null,"is_applicant":true,"aadhaar":false,"pan":false,
     "name_matches":true,"dob_matches":true,"pan_matches":true,"ok":true,"reason":""}
  ],
  "unit_check": [
    {"field":"Block","booking_form":null,"cost_sheet":null,"matches":true},
    {"field":"Flat","booking_form":null,"cost_sheet":null,"matches":true},
    {"field":"Floor","booking_form":null,"cost_sheet":null,"matches":true},
    {"field":"BHK","booking_form":null,"cost_sheet":null,"matches":true},
    {"field":"SBA","booking_form":null,"cost_sheet":null,"matches":true}
  ],
  "signature_summary": {"booking_form_pages_expecting":0,"booking_form_pages_signed":0,
                        "unsigned":[],"cost_sheet_signed":true},
  "parking_check": {"marked":null,"charged":null,"agrees":true},
  "concerns": ["anything a person should look at, one short sentence each"]
}`;

/* The projects, spelled the way the dropdown spells them. A booking form writes the project any way
   it likes - "ANANTA at DREAM GURUKUL" is Dream Ananta standing in the Dream Gurukul township - and
   the check list and the tracker should say one of these, not whatever the page happened to print.
   Matched on the distinctive word, and where several appear the EARLIEST one wins: a document leads
   with the project and names the township after it. */
export const PROJECTS: Array<{ name: string; key: RegExp }> = [
  { name: "Dream Ananta",     key: /\bANANTA\b/ },
  { name: "Dream World City", key: /\bWORLD\s*CITY\b/ },
  { name: "Dream Eco City",   key: /\bECO\s*CITY\b/ },
  { name: "Dream Gurukul",    key: /\bGURUKUL\b/ },
  { name: "Dream Exotica",    key: /\bEXOTICA\b/ },
  { name: "Dream Valley",     key: /\bVALLEY\b/ },
  { name: "Dream One",        key: /\bONE\b/ },
];

/* Where each project stands, as the business states it. Taken from the list rather than from the
   page, because a booking form writes the place loosely or not at all and this goes on a letter. */
export const PROJECT_PLACE: Record<string, string> = {
  "Dream Gurukul":    "Madhyamgram, Kolkata",
  "Dream Ananta":     "Madhyamgram, Kolkata",
  "Dream Exotica":    "Madhyamgram, Kolkata",
  "Dream One":        "New Town, Kolkata",
  "Dream Eco City":   "Durgapur, West Bengal",
  "Dream Valley":     "Siliguri, West Bengal",
  "Dream World City": "Joka, Kolkata",
};

/* THE APPROVED BASE RATE per square foot, project by project, as the business sets them today.

   These are a POLICY list, not something read off the paperwork: the point of the check is to
   catch a cost sheet drawn at a rate nobody approved. They change from time to time, so they
   live here where they can be edited in one place - and a sheet at a different rate is reported
   as a difference for a person to look at, never corrected to match.

   Dream Eco City Bungalow is a different rate from Dream Eco City's flats and there is no
   separate project name for it, so it is matched on the word BUNGALOW appearing with Eco City.
   Set as of 2026-09-11. */
export const PROJECT_BASE_RATE: Record<string, number> = {
  "Dream Valley":              3900,
  "Dream Exotica":             3550,
  "Dream Eco City":            3500,
  "Dream Eco City Bungalow":   5160,
  "Dream One":                 9000,
  "Dream World City":          4370,
  "Dream Gurukul":             5399,
  "Dream Ananta":              5600,
};

/* Eco City sells flats and bungalows at different rates under the one project name, so the rate
   to check against depends on which the booking is for. Anything else is just the project. */
export function rateKeyFor(project: string | null, haystack: string): string | null {
  if (!project) return null;
  if (project === "Dream Eco City" && /BUNGALOW/i.test(haystack)) return "Dream Eco City Bungalow";
  return project;
}

export function canonicalProject(read: unknown): string | null {
  const t = String(read ?? "").toUpperCase();
  if (!t.trim()) return null;
  let best: { name: string; at: number } | null = null;
  for (const p of PROJECTS) {
    const m = t.match(p.key);
    if (!m || m.index === undefined) continue;
    if (!best || m.index < best.at) best = { name: p.name, at: m.index };
  }
  return best ? best.name : null;
}
