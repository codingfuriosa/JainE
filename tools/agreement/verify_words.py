# PROVES THE TEMPLATE'S WORDS ARE THE SIGNED DOCUMENT'S WORDS.
#
# The diff test shows two generated agreements differ only where data differs. That is only half
# the assurance: the other half is that the fixed text is the executed copy's own and was not
# altered on the way in. So every word of the template is checked back against the source PDF.
#
# Compared as a stream of words with spacing and case ignored, because the template re-wraps the
# lines - the question is whether the WORDS are the same, not where they break.
import io, json, re, difflib

SP = ("C:/Users/Gigabyte/AppData/Local/Temp/claude/C--DreamOne/"
      "fd64b2f0-6186-43a0-9b13-638f9a560d8d/scratchpad/")
TPL = ("C:/Users/Gigabyte/Downloads/Multi System/JainE-testing/.claude/worktrees/"
       "jaine-testing-repo-review-ebe0bf/assets/forms/agreement-gurukul.js")

source = "".join(json.load(io.open(SP + "ag_raw.json", encoding="utf-8")))

js = io.open(TPL, encoding="utf-8").read()
data = json.loads(js[js.index("{", js.index("window.AGREEMENT_GURUKUL")):].rstrip().rstrip(";"))

def words(t):
    t = (t.replace("\u201c", '"').replace("\u201d", '"').replace("\u2018", "'")
          .replace("\u2019", "'").replace("\u2013", "-").replace("\u2014", "-"))
    t = re.sub(r"\{\{\w+\}\}", " \u25a0 ", t)          # a token stands for whatever fills it
    return re.findall(r"[A-Za-z0-9]+", t.lower())

src_words = words(source)
tpl_words = []
for b in data["blocks"]:
    if b.get("t") == "table":
        for r in b.get("rows", []):
            for c in r: tpl_words += words(c)
        continue
    tpl_words += words(b.get("x", ""))

# The page numbers the extractor stripped, and the specimen's own values that became tokens, are
# the only things expected to be missing. Everything else must appear, in order.
sm = difflib.SequenceMatcher(None, src_words, tpl_words, autojunk=False)
added, dropped = [], []
for tag, i1, i2, j1, j2 in sm.get_opcodes():
    if tag == "equal": continue
    if tag in ("replace", "insert"):
        added.append(" ".join(tpl_words[j1:j2])[:160])
    if tag in ("replace", "delete"):
        dropped.append(" ".join(src_words[i1:i2])[:160])

print("source words:   %d" % len(src_words))
print("template words: %d" % len(tpl_words))
print("matching:       %.2f%%" % (100.0 * sm.ratio()))
print()
print("=== words IN THE TEMPLATE that are not in the signed copy (%d runs) ===" % len(added))
for a in added:
    if a.strip(): print("  +", a)
print()
print("=== words in the signed copy NOT in the template (%d runs) ===" % len(dropped))
for d in dropped:
    if d.strip(): print("  -", d)

# An ordered diff also flags text that merely MOVED - the deposits rows relocated to the section
# they belong to, the specification rows now inside a drawn table. A multiset comparison tells
# moving apart from changing: if no word was added or removed, only its position differs.
from collections import Counter
ca, cb = Counter(src_words), Counter(tpl_words)
gained = cb - ca
lost = ca - cb
print()
print("=== WORD COUNTS, ignoring order ===")
print("words the template has that the signed copy does not:")
for w, n in sorted(gained.items()):
    print("   +%-4d %s" % (n, w))
print("words the signed copy has that the template does not (the specimen's own values,")
print("the page numbers, and the table text now drawn rather than flowed):")
shown = 0
for w, n in sorted(lost.items(), key=lambda x: -x[1]):
    print("   -%-4d %s" % (n, w)); shown += 1
    if shown >= 40: print("   ... and %d more" % (len(lost) - shown)); break
