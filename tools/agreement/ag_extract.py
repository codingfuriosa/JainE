# Pulls the agreement's own words out of the signed PDF and cleans up what the extractor mangles,
# so the template carries the text VERBATIM. Nothing here is retyped by hand: this is a contract,
# and a transcription slip in one would be a real problem.
import io, re, json
import pymupdf   # pypdf split words mid-way ("malfunc tioning", "b e repaired"); this does not

SRC = r"C:\Users\Gigabyte\Downloads\F FINAL FINAL COPY Surajit Samanta29-07 -26 (1).pdf"
OUT = ("C:/Users/Gigabyte/AppData/Local/Temp/claude/C--DreamOne/"
       "fd64b2f0-6186-43a0-9b13-638f9a560d8d/scratchpad/")

doc = pymupdf.open(SRC)
pages = []
for i in range(doc.page_count):
    t = doc[i].get_text("text") or ""
    # the extractor renders the curly quotes of the source as a replacement character
    t = t.replace("\ufffd", '"')
    # a leading line that is just the page number
    t = re.sub(r"^\s*%d\s*\n" % (i + 1), "", t)
    # soft hyphens and non-breaking spaces
    t = t.replace("\xad", "").replace("\xa0", " ")
    pages.append(t)

io.open(OUT + "ag_raw.json", "w", encoding="utf-8").write(json.dumps(pages, ensure_ascii=False, indent=1))

# A quick census, so the shape of the document can be seen without printing all of it.
print("pages:", len(pages), " chars:", sum(len(p) for p in pages))
for i, t in enumerate(pages):
    lines = [l.strip() for l in t.split("\n") if l.strip()]
    head = lines[0][:70] if lines else "(blank)"
    print("%2d  %5d chars  %3d lines  | %s" % (i + 1, len(t), len(lines), head))
