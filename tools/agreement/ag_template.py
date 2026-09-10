# Writes the Dream Gurukul agreement template as a JS asset: the document's own words, taken
# verbatim from the executed copy, with a {{token}} wherever a value belongs and the four tables
# marked so the renderer can draw them as tables rather than as run-together lines.
#
# The legal text is NOT retyped here - it is carried through from the extraction. Only the blocks
# that hold a customer's own particulars are rewritten, and each of those is listed below so the
# change is visible.
import io, json, re

SP = ("C:/Users/Gigabyte/AppData/Local/Temp/claude/C--DreamOne/"
      "fd64b2f0-6186-43a0-9b13-638f9a560d8d/scratchpad/")
OUT = ("C:/Users/Gigabyte/Downloads/Multi System/JainE-testing/.claude/worktrees/"
       "jaine-testing-repo-review-ebe0bf/assets/forms/agreement-gurukul.js")

blocks = json.load(io.open(SP + "ag_blocks.json", encoding="utf-8"))

# ---- the blocks that carry a customer's particulars -----------------------------------------
# index -> the same sentence with tokens where the specimen had Surajit Samanta's values.
PATCH = {
 1: 'This Agreement for Sale (\u201cAGREEMENT\u201d) executed on this {{exec_day}} day of '
    '{{exec_month}} {{exec_year}}',

 # The allottees' own paragraph is built in code - there may be one of them or three, each with
 # their own father, PAN, Aadhaar, age and address - so the whole block is one token.
 7: '{{ALLOTTEES}}',

 76: '1.12 The Allottee has paid a sum of Rs. {{token_figures}} ({{token_words}}) as booking '
     'amount (Booking Amount) being part payment towards the Total Price of the Said Unit on or '
     'before the execution of this agreement, the receipt to which the Promoter hereby '
     'acknowledges and the Allottee hereby agrees to pay the balance of the Total Price of the '
     'Said Unit as prescribed in the Payment Plan mentioned in Schedule C hereunder written.',

 24: 'The Allottee had applied to the Promoter for allotment of a Residential units/ Complex in '
     'the Project vide (\u201cApplication\u201d, details provided in Part IV of Schedule B herein) '
     'on the terms and conditions recorded therein, in pursuance whereof, the Promoter has '
     'provisionally allotted in favour of the Allottee (\u201cAllotment Letter\u201d, details '
     'provided in Part V of Schedule B herein) ALL THAT one residential unit / flat together with '
     'right to use {{park_count}} ({{park_kind}}) car Parking{{park_s}} facility, (hereinafter '
     'collectively referred to as the \u201cSaid Unit\u201d, bearing the name {{flat}} in Block no. '
     '{{block}} more fully and particularly described in Part - I of Schedule B hereunder written) '
     'in accordance with the Specifications, marked as Part III of Schedule B hereto together with '
     'the irrevocable right to use the common areas, parts, portions, installations and facilities '
     'of the Project in common with the remaining allottees of the Project (hereinafter '
     'collectively referred to as the \u201cCommon Areas\u201d, and more particularly described in '
     'Schedule- D hereto).',

 276: 'All That residential units being No. {{flat}} in {{floor_ord}} Floor, In Block {{block}} '
      'having carpet area of {{carpet}} Square feet, exclusive balcony area measuring {{balcony}} '
      'square feet and cupboard area of {{cupboard}} square feet, Total Built up area {{builtup}} '
      'Square Feet, corresponding to Super Built up area {{sba}} square feet, together with right '
      'to use {{park_count}} ({{park_words}}) {{park_kind_word}} parking facility, which would be '
      'allotted post possession by Promoter (hereinafter collectively referred to as the '
      '\u201cSaid Residential Unit\u201d)',

 285: 'Allottee has applied for the said unit being Unit no. {{flat}} vide application No. '
      '{{application_no}}',

 310: 'IN WITNESS WHEREOF parties herein above named have set their respective hands and signed '
      'this Agreement for Sale at {{exec_place}} in the presence of attesting witness, signing as '
      'such on the day, month and year first above written.',
}

# ---- the four tables -------------------------------------------------------------------------
# The specification table is the same on every Dream Gurukul agreement, so it is carried as it is.
SPECS = [
 ["1.",  "Living & Dining Space", "Italian Styled Large sized Vitrified Tiles"],
 ["2.",  "Bedrooms",              "Italian Styled Large sized Vitrified Tiles"],
 ["3.",  "Internal Staircase",    "Italian Styled Large sized Vitrified Tiles"],
 ["4.",  "Roof",                  "Solar Reflective Tiles"],
 ["5.",  "Kitchen",               "Floor Anti-Skid Ceramic Tiles. Counter - Granite Slab with "
                                  "Stainless Steel Sink. Wall Tiles up to 2 ft high all around the "
                                  "wall over the Granite counter. Water Filter point, Exhaust "
                                  "Point, Chimney Point"],
 ["6.",  "Toilet",                "Anti Skid Tiles on floor. Tiles up to 7 ft."],
 ["7.",  "Sanitary Ware",         "Sanitary ware and CP fitting from reputed brand"],
 ["8.",  "Electrical Fittings",   "Superior Quality Concealed Copper Wiring. Modular Switches of "
                                  "Reputed Make, provision for telephone and television point"],
 ["9.",  "Interior",              "POP finish."],
 ["10.", "Exterior",              "Waterproof/Weather coat Exterior Finish"],
 ["11.", "Generator",             "Common DG for entire property"],
]

# Where each table goes, and which run of extracted blocks it replaces.
TABLES = [
 (281, 282, {"t": "table", "id": "specs", "head": ["Sl. No.", "Descriptions", "Material Name"],
             "rows": SPECS, "w": [46, 150, 0]}),
 (294, 294, {"t": "table", "id": "price", "head": ["Sl. No.", "Consideration/Amount Payable Towards", "Rs."],
             "w": [46, 0, 110]}),
 (297, 300, {"t": "table", "id": "plan", "head": ["Sl No.", "Payment Schedule/ Milestone", "", "Amount"],
             "w": [40, 0, 120, 90]}),
]

out = []
skip = set()
for a, b, _t in TABLES:
    for i in range(a, b + 1):
        skip.add(i)

for i, blk in enumerate(blocks):
    for a, _b, t in TABLES:
        if i == a:
            out.append(t)
    if i in skip:
        continue
    text = PATCH.get(i, blk["text"])
    if not text.strip():
        continue
    out.append({"t": "h" if blk.get("heading") else "p", "x": text})

# The EDC table follows the price table; the price block it came from also carried the EDC rows
# run together, so it is emitted separately rather than parsed out of that mess.
for k, blk in enumerate(out):
    if blk.get("id") == "price":
        out.insert(k + 1, {"t": "table", "id": "edc",
                           "head": ["Extra Development Charges (EDC)", "Rs."], "w": [0, 110]})
        break

js = ("/* THE DREAM GURUKUL AGREEMENT FOR SALE, as a template.\n\n"
      "   Every word of the legal text is the executed document's own, carried across from a signed\n"
      "   copy rather than retyped - a transcription slip in a contract is not a typo, it is a\n"
      "   different obligation. What is marked {{like_this}} is the only part that varies: the\n"
      "   allottees' particulars, the unit, the areas, the parking, and the four tables.\n\n"
      "   One project, one template. The other six each word their recitals differently - the land,\n"
      "   the sanction, the RERA registration - so each needs its own file rather than a switch\n"
      "   inside this one.\n\n"
      "   Generated by scratchpad/ag_template.py from the executed copy; edit that, not this. */\n"
      "window.AGREEMENT_GURUKUL = " + json.dumps(
          {"project": "Dream Gurukul", "blocks": out}, ensure_ascii=False, indent=1) + ";\n")

io.open(OUT, "w", encoding="utf-8").write(js)
print("blocks: %d  (%d headings, %d tables)  -> %d bytes"
      % (len(out), sum(1 for b in out if b.get("t") == "h"),
         sum(1 for b in out if b.get("t") == "table"), len(js)))
toks = sorted(set(re.findall(r"\{\{(\w+)\}\}", json.dumps(out))))
print("tokens:", ", ".join(toks))
