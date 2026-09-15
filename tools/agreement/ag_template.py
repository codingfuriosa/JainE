# Writes the Dream Gurukul agreement template as a JS asset: the document's own words, taken
# verbatim from the executed copy, with a {{token}} wherever a value belongs and the tables marked
# so the renderer draws them as tables rather than as run-together lines.
#
# THE LEGAL TEXT IS NOT RETYPED HERE. It is carried through from the extraction. Only the blocks
# holding a customer's own particulars are rewritten, and each of those is listed below, so any
# change to the wording is visible in this one file.
#
# EVERY BLOCK IS FOUND BY A SNIPPET OF ITS OWN TEXT, never by position. Keyed by index, a change
# to the paragraph splitter silently moved the patches onto the wrong blocks; a snippet that no
# longer matches stops the build instead.
import io, json, re

SP = ("C:/Users/Gigabyte/AppData/Local/Temp/claude/C--DreamOne/"
      "fd64b2f0-6186-43a0-9b13-638f9a560d8d/scratchpad/")
OUT = ("C:/Users/Gigabyte/Downloads/Multi System/JainE-testing/.claude/worktrees/"
       "jaine-testing-repo-review-ebe0bf/assets/forms/agreement-gurukul.js")

blocks = json.load(io.open(SP + "ag_blocks.json", encoding="utf-8"))

def find(snippet):
    hits = [i for i, b in enumerate(blocks) if snippet in b["text"]]
    if len(hits) != 1:
        raise SystemExit("FAIL: %d blocks contain %r (expected exactly 1)" % (len(hits), snippet[:60]))
    return hits[0]

# ---- the blocks that carry a customer's particulars -----------------------------------------
# a snippet of the source block  ->  the same sentence with tokens for the specimen's values
PATCH = {
 "executed on this":
    'This Agreement for Sale (\u201cAGREEMENT\u201d) executed on this {{exec_day}} day of '
    '{{exec_month}} {{exec_year}}',

 # The allottee's paragraph is built in code - salutation, father, PAN, age, address - so the
 # whole block is one token.
 "Mr Surajit Samanta": '{{ALLOTTEES}}',

 "The Allottee had applied to the Promoter":
    'The Allottee had applied to the Promoter for allotment of a Residential units/ Complex in '
    'the Project vide (\u201cApplication\u201d, details provided in Part IV of Schedule B herein) '
    'on the terms and conditions recorded therein, in pursuance whereof, the Promoter has '
    'provisionally allotted in favour of the Allottee (\u201c Allotment Letter\u201d),details '
    'provided in Part V of Schedule B herein) ALL THAT one residential unit / flat together with '
    'right to use {{park_count}} ({{park_kind}}) car Parking{{park_s}} facility,( hereinafter '
    'collectively referred to as the \u201cSaid Unit\u201d, bearing the name {{flat}} in Block no. '
    '{{block}} more fully and particularly described in Part - I of Schedule B hereunder written) '
    'in accordance with the Specifications, marked as Part III of Schedule B hereto together with '
    'the irrevocable right to use the common areas, parts, portions, installations and facilities '
    'of the Project in common with the remaining allottees of the Project (hereinafter '
    'collectively referred to as the \u201cCommon Areas\u201d, and more particularly described in '
    'Schedule- D hereto).',

 "has paid a sum of Rs.":
    '1.12 The Allottee has paid a sum of Rs. {{token_figures}} ({{token_words}}) as booking '
    'amount (Booking Amount) being part payment towards the Total Price of the Said Unit on or '
    'before the execution of this agreement, the receipt to which the Promoter hereby '
    'acknowledges and the Allottee hereby agrees to pay the balance of the Total Price of the '
    'Said Unit as prescribed in the Payment Plan mentioned in Part II of Schedule-C as may be '
    'demanded by the Promoter within the time and in the manner specified therein:',

 "All That residential units being No.":
    'All That residential units being No. {{flat}} in {{floor_ord}} Floor, In Block {{block}} '
    'having carpet area of {{carpet}} Square feet, exclusive balcony area measuring {{balcony}} '
    'square feet and cupboard area of {{cupboard}} square feet, Total Built up area {{builtup}} '
    'Square Feet, corresponding to Super Built up area {{sba}} square feet, together with right '
    'to use {{park_count}} ({{park_words}}){{park_kind_word}} parking facility, which would be '
    'allotted post possession by Promoter ( hereinafter collectively referred to as the '
    '\u201cSaid Residential Unit\u201d',

 "vide application No.":
    'Allottee has applied for the said unit being Unit no. {{flat}} vide application No. '
    '{{application_no}}',

 "IN WITNESS WHEREOF":
    'IN WITNESS WHEREOF parties herein above named have set their respective hands and signed '
    'this Agreement for Sale at {{exec_place}} in the presence of attesting witness, signing as '
    'such on the day, month and year first above written.',
}

# The three SIGNED SEALED lines are drawn by the renderer instead, with a rule under each to sign
# on. Left as paragraphs they printed as flowing prose on one page and again, properly set, on the
# next. The words are unchanged; only where they are drawn from.
DROP = ["SIGNED SEALED AND DELIVERED BY THE WITHIN NAMED OWNERS",
        "SIGNED SEALED AND DELIVERED BY THE WITHIN NAMED PROMOTER",
        "SIGNED SEALED AND DELIVERED BY THE WITHIN NAMED ALLOTTEE"]

# Two deposits rows are printed at the foot of the source's page 29, after Schedule D has begun,
# but they belong to the Part-I deposits list. Split off that tail and put it where it belongs -
# WORD FOR WORD as the source prints it, punctuation and all.
STRAY_SNIP = "Underground water reservoir for Fire"
STRAY_KEEP = ("(viii) Underground water reservoir for Fire and other common fire safety system "
              "as per the WBFES rules and norms.")
STRAY_ROWS = [["Association Formation Charges", "Rs . 15000/-Plus 18% GST"],
              ["Municipal Taxes and Deposits", "N/A"]]

# The specification table is the same on every Dream Gurukul agreement, so it is carried as it is,
# in the source's own words - odd spacing included, because it is not mine to tidy.
SPECS = [
 ["1.",  "Living & Dining Space", "Italian Styled Large sized Vitrified Tiles"],
 ["2.",  "Bedrooms",              "Italian Styled Large sized Vitrified Tiles"],
 ["3.",  "Internal Staircase",    "Italian Styled Large sized Vitrified Tiles"],
 ["4.",  "Roof",                  "Solar Reflective Tiles"],
 ["5.",  "Kitchen",               "Floor Anti-Skid Ceramic Tiles. Counter- Granite Slab with "
                                  "Stainless Steel Sink Wall Tiles- up to 2 ft high all around "
                                  "the wall over the Granite counter. Water Filter point, "
                                  "Exhaust Point, Chimney Point"],
 ["6.",  "Toilet",                "Anti Skid Tiles on floor . Tiles up to 7 ft."],
 ["7.",  "Sanitary Ware",         "Sanitary ware and CP fitting from reputed brand"],
 ["8.",  "Electrical Fittings",   "Superior Quality Concealed Copper Wiring. Modular Switches of "
                                  "Reputed Make provision for telephone and television point"],
 ["9.",  "Interior",              "POP finish."],
 ["10.", "Exterior",              "Waterproof/Weather coat Exterior Finish"],
 ["11.", "Generator",             "Common DG for entire property"],
]

# Each table replaces the run of blocks the extractor made of it: (first snippet, last snippet).
TABLES = [
 ("Sl.N o Descriptions Material Name", "11. Generator Common DG for entire property",
  {"t": "table", "id": "specs", "head": ["Sl.N o", "Descriptions", "Material Name"],
   "rows": SPECS, "w": [46, 150, 0]}),
 ("Deposits in Lumpsum Value", "Deposits in Lumpsum Value",
  {"t": "table", "id": "price",
   "head": ["Sl.No.", "Consideration/Amount Payable Towards", "Rs."], "w": [46, 0, 110]}),
 ("Sl No. Payment Schedule/ Milestone", "Commencement of Foundation",
  {"t": "table", "id": "plan",
   "head": ["Sl No.", "Payment Schedule/ Milestone", "", "Amount"], "w": [40, 0, 120, 90]}),
]

patch_at = {find(k): v for k, v in PATCH.items()}
drop_at = {find(k) for k in DROP}
stray_at = find(STRAY_SNIP)
spans = []
for a_snip, b_snip, tbl in TABLES:
    a, b = find(a_snip), find(b_snip)
    if b < a:
        raise SystemExit("FAIL: the %s table's span runs backwards" % tbl["id"])
    spans.append((a, b, tbl))
skip = {i for a, b, _t in spans for i in range(a, b + 1)}

out = []
for i, blk in enumerate(blocks):
    for a, _b, t in spans:
        if i == a:
            out.append(t)
    if i in skip or i in drop_at:
        continue
    text = STRAY_KEEP if i == stray_at else patch_at.get(i, blk["text"])
    if not text.strip():
        continue
    out.append({"t": "h" if blk.get("heading") else "p", "x": text})

# The EDC and deposits tables follow the price table, which the extractor ran together with them.
for k, blk in enumerate(list(out)):
    if blk.get("id") == "price":
        out.insert(k + 1, {"t": "table", "id": "edc", "head": ["EDC", "Rs."], "w": [0, 110]})
        out.insert(k + 2, {"t": "table", "id": "deposits",
                           "head": ["Deposits in Lumpsum Value", "Rs."],
                           "rows": STRAY_ROWS, "w": [0, 170]})
        break

js = ("/* THE DREAM GURUKUL AGREEMENT FOR SALE, as a template.\n\n"
      "   Every word of the legal text is the executed document's own, carried across from a signed\n"
      "   copy rather than retyped - a transcription slip in a contract is not a typo, it is a\n"
      "   different obligation. What is marked {{like_this}} is the only part that varies.\n\n"
      "   tools/agreement/verify_words.py checks this file's words back against the signed PDF and\n"
      "   lists every difference; run it after any change to the template or the extractor.\n\n"
      "   One project, one template. The other six each word their recitals differently - the land,\n"
      "   the sanction, the RERA registration - so each needs its own file rather than a switch\n"
      "   inside this one.\n\n"
      "   Generated by tools/agreement/ag_template.py from the executed copy; edit that, not this. */\n"
      "window.AGREEMENT_GURUKUL = " + json.dumps(
          {"project": "Dream Gurukul", "blocks": out}, ensure_ascii=False, indent=1) + ";\n")

io.open(OUT, "w", encoding="utf-8").write(js)
print("blocks: %d  (%d headings, %d tables)  -> %d bytes"
      % (len(out), sum(1 for b in out if b.get("t") == "h"),
         sum(1 for b in out if b.get("t") == "table"), len(js)))
print("tokens:", ", ".join(sorted(set(re.findall(r"\{\{(\w+)\}\}", json.dumps(out))))))
