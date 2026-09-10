# Turns the extracted lines back into paragraphs. A PDF gives one line per printed line, broken
# wherever the original happened to wrap; the agreement has to re-wrap to its own page width, so
# the sentences have to be whole again first.
#
# Nothing here rewrites the agreement's words. It only decides where one paragraph ends and the
# next begins, and normalises the spacing artefacts the extractor introduces ("Proje ct",
# "S h a n k a r", double spaces).
import io, json, re

SP = ("C:/Users/Gigabyte/AppData/Local/Temp/claude/C--DreamOne/"
      "fd64b2f0-6186-43a0-9b13-638f9a560d8d/scratchpad/")
pages = json.load(io.open(SP + "ag_raw.json", encoding="utf-8"))

# A line that begins one of these starts a new block rather than continuing the last.
STARTS = re.compile(r"""^(
    \d+\.\d+(\.\d+)*\s          |   # 11.5.1, 7.3
    \d+\.\s*[A-Z]               |   # 16. COMPLIANCE
    [A-Z]\.\s                   |   # A. The Promoter
    \([ivxlcdm]+\)\s            |   # (viii)
    \([a-z]\)\s                 |   # (a) "Act" means...
    \(\d+\)\s                   |
    [a-z]\.\s                   |   # g. Goods and Service Tax
    SCHEDULE                    |
    Part\s*[-\u2013]?\s*[IVX]+  |
    PART-\s?[IVX]+              |
    WHEREAS                     |
    DEFINITIONS                 |
    IN\ WITNESS\ WHEREOF        |
    SIGNED\ SEALED
)""", re.X)

# Lines that are headings in their own right.
HEADING = re.compile(r"^\s*(AGREEMENT FOR SALE|BY AND BETWEEN|AND|SCHEDULE\s*[-\u2013]\s*\"?[A-D]\"?"
                     r"|SCHEDULE-D|Part\s*[-\u2013]?\s*[IVX]+.*|PART-[IVX]+|\([A-Z][A-Z \u2013-]+\))\s*$")

def tidy(s):
    s = s.replace("\ufffd", '"')
    # Letters spaced out one by one - "S h a n k a r  S a h" - are rejoined. The run has to start
    # at a space or at the beginning: without that, "S/O S h a n k a r" matched from the O of S/O
    # and came out "S/OShankar", losing a space the sentence needs.
    s = re.sub(r"(?:(?<=\s)|^)(?:[A-Za-z] ){2,}[A-Za-z]\b",
               lambda m: m.group(0).replace(" ", ""), s)
    s = re.sub(r"[ \t]+", " ", s).strip()
    return s

blocks = []
for pno, text in enumerate(pages, 1):
    lines = [l.rstrip() for l in text.split("\n")]
    buf = []
    def flush():
        global buf
        if buf:
            t = tidy(" ".join(buf))
            if t: blocks.append({"page": pno, "text": t})
        buf = []
    for raw in lines:
        l = raw.strip()
        if not l:
            flush(); continue
        if HEADING.match(l):
            flush(); blocks.append({"page": pno, "text": tidy(l), "heading": True}); continue
        if STARTS.match(l):
            flush()
        buf.append(l)
    flush()

# A paragraph that runs over a page break comes back as two blocks. Rejoin when the first does
# not end a sentence and the second does not start something new - the page number is not a
# boundary in the document, only in the print.
joined = []
for b in blocks:
    prev = joined[-1] if joined else None
    if (prev and not prev.get("heading") and not b.get("heading")
            and prev["page"] == b["page"] - 1
            and not re.search(r"[.:;)\"”]\s*$", prev["text"])
            and not STARTS.match(b["text"])):
        prev["text"] = tidy(prev["text"] + " " + b["text"])
        continue
    joined.append(b)
blocks = joined

io.open(SP + "ag_blocks.json", "w", encoding="utf-8").write(
    json.dumps(blocks, ensure_ascii=False, indent=1))

print("blocks:", len(blocks))
print("longest:", max(len(b["text"]) for b in blocks))
print("headings:", sum(1 for b in blocks if b.get("heading")))
print()
for b in blocks[:14]:
    print(("H " if b.get("heading") else "  ") + "p%-2d " % b["page"] + b["text"][:110])
