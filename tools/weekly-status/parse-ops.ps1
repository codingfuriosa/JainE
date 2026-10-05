# Parses the OPS weekly meeting sheet (first tab) into meetings / attendees / action items.
#
# The sheet was kept by hand for 20 months and its shape changed three times:
#   era 1  "Minutes of Meeting : OPS MEETING (11th feb'25)" on its own row, then a
#          Project | Task | Assigned To | Deadline | Comments header, task text in column B.
#   era 2  the date moved INTO the header row (col A), project names became section headings
#          sitting alone in column A, task text stayed in column B.
#   era 3  task text moved to column A and column B went empty; some meetings are narrative
#          minutes with no owner at all.
# All three are read here rather than normalising the sheet, because the sheet is still the
# place people type and it will keep changing shape.

param(
  [string]$Csv = "$PSScriptRoot\ops.csv",
  [string]$Out = "$PSScriptRoot\ops.json"
)

$cols = 0..16 | ForEach-Object { "c$_" }
$rows = Import-Csv -Path $Csv -Header $cols

function Clean([string]$s) {
  if ($null -eq $s) { return '' }
  # The sheet is full of trailing newlines inside cells (attendee blocks especially) and
  # non-breaking spaces pasted from mail.
  $s = $s -replace "Â ", ' '
  $s = $s -replace "\s+", ' '
  return $s.Trim()
}

# ---- date normalisation -----------------------------------------------------------------
# Everything here is Indian day-first. "12/2/25" is 12 February, not 2 December.
$months = @{
  jan=1; feb=2; mar=3; apr=4; may=5; jun=6; jul=7; aug=8; sep=9; oct=10; nov=11; dec=12
  january=1; february=2; march=3; april=4; june=6; july=7; august=8
  september=9; october=10; november=11; december=12
}
function NormDate([string]$raw, [int]$hintYear) {
  $t = Clean $raw
  if ($t -eq '') { return $null }
  $t = $t -replace "^(date|dated)\s*[:\-]\s*", ''
  $t = $t.ToLower()

  # 21.09.2026 / 21-09-2026 / 21/09/2026  (and 2-digit years)
  if ($t -match '(?<d>\d{1,2})\s*[./\-]\s*(?<m>\d{1,2})\s*[./\-]\s*(?<y>\d{2,4})') {
    $d=[int]$Matches.d; $m=[int]$Matches.m; $y=[int]$Matches.y
    if ($y -lt 100) { $y += 2000 }
    if ($d -ge 1 -and $d -le 31 -and $m -ge 1 -and $m -le 12) {
      try { return (Get-Date -Year $y -Month $m -Day $d).ToString('yyyy-MM-dd') } catch { return $null }
    }
    return $null
  }
  # 16th April'25 / 11th feb'25 / 19th Aug / 30th June
  if ($t -match "(?<d>\d{1,2})\s*(st|nd|rd|th)?\s*(of\s+)?(?<mon>[a-z]{3,9})\s*'?\s*(?<y>\d{2,4})?") {
    $mon = $Matches.mon
    if ($months.ContainsKey($mon)) {
      $d=[int]$Matches.d; $m=$months[$mon]
      $y = if ($Matches.y) { [int]$Matches.y } else { $hintYear }
      if ($y -lt 100) { $y += 2000 }
      if ($y -eq 0) { return $null }
      try { return (Get-Date -Year $y -Month $m -Day $d).ToString('yyyy-MM-dd') } catch { return $null }
    }
  }
  # April'25 with no day -> first of the month, better than losing the month entirely
  if ($t -match "^(?<mon>[a-z]{3,9})\s*'?\s*(?<y>\d{2,4})$") {
    $mon=$Matches.mon
    if ($months.ContainsKey($mon)) {
      $y=[int]$Matches.y; if ($y -lt 100) { $y += 2000 }
      try { return (Get-Date -Year $y -Month $months[$mon] -Day 1).ToString('yyyy-MM-dd') } catch { return $null }
    }
  }
  return $null
}

# ---- status derivation ------------------------------------------------------------------
# The Deadline column is overloaded: it holds a date OR a completion word, and the Comments
# column carries its own verdict. Both are read, and the raw text of both is kept on the row
# so nobody has to trust this function - the dashboard shows what the sheet actually says.
function DeriveStatus([string]$deadline, [string]$comment, [string]$extra) {
  # Column F is era 1's actual "Status" column - its own header row says so - and later becomes
  # "Problem solver", a name. Reading all three is right either way: a person's name matches none
  # of the patterns below, while "DONE" sitting in F was the only record that a dozen 2025 items
  # were ever finished.
  $t = ((Clean $deadline) + ' ' + (Clean $comment) + ' ' + (Clean $extra)).ToLower()
  if ($t -match '\bnot\s+done\b|\bnot\s+started\b|\bnot\s+complete') { return 'not_done' }
  if ($t -match '\d+\s*%')                                          { return 'in_progress' }
  if ($t -match '\bwip\b|in\s+progress|ongoing|going\s+on')          { return 'in_progress' }
  # "competed" is a recurring typo for completed and appears on real rows
  if ($t -match '\bdone\b|\bcompleted\b|\bcomplete\b|\bcompeted\b')  { return 'done' }
  return 'open'
}

# ---- walk -------------------------------------------------------------------------------
$meetings = New-Object System.Collections.ArrayList
$cur = $null
$curProject = ''
$rowNo = 0
$lastYear = 2025

foreach ($r in $rows) {
  $rowNo++
  $a = Clean $r.c0; $b = Clean $r.c1; $c = Clean $r.c2
  $d = Clean $r.c3; $e = Clean $r.c4; $f = Clean $r.c5

  $isHeader = ($a -match '^Minutes of ') -or ($b -match '^Minutes of ')
  if ($isHeader) {
    # The date lives in col A, either on its own ("01-09-2025", "OPS & Purchase Meeting : 03.09.26")
    # or inside the brackets of the col-A title ("OPS MEETING (11th feb'25)").
    $titleRaw = if ($a -match '^Minutes of ') { $a } else { $a }
    $dateSrc  = $titleRaw
    if ($titleRaw -match '\(([^)]*)\)') { $dateSrc = $Matches[1] }
    $iso = NormDate $dateSrc $lastYear
    if ($iso) { $lastYear = [int]($iso.Substring(0,4)) }
    # Where it was held / what it was, taken only from the bracketed note on the col-B header
    # ("(HO)", "(Gurukul Site Visit)"). Deriving it from the text before the colon instead gave
    # "Date" and "OPS" as meeting kinds, which are not kinds of anything.
    $note = ''
    if ($b -match '\(([^)]*)\)') { $note = $Matches[1] }
    elseif ($a -match 'Minutes of [A-Za-z ]*:\s*(.+)$') { $note = $Matches[1] }
    elseif ($b -match 'Minutes of [A-Za-z ]*:\s*(.+)$') { $note = $Matches[1] }
    # era 1 put the title itself after the colon ("OPS MEETING (11th feb'25)"), which repeats the
    # date and says nothing a reader does not already have.
    if ($note -match '^OPS\s+MEETING') { $note = '' }
    # Who was in the room is what actually distinguishes these: OPS alone, OPS with Purchase, or
    # the whole group including Marketing. Read from the title, which has said so consistently.
    $whole = "$a $b"
    $kind = if ($whole -match 'site\s+visit')  { 'Site Visit' }
            elseif ($whole -match 'marketing') { 'OPS, Marketing & Purchase' }
            elseif ($whole -match 'purchase')  { 'OPS & Purchase' }
            else                               { 'OPS' }
    # Same meeting, two header rows (19-01-26 is written twice in the sheet) - continue the one
    # already open rather than splitting its items across two cards on the dashboard.
    # ...but 19-12-2025 is a site visit AND a meeting, both titled only by their date, so the kind
    # and the bracketed note have to match too or two real meetings collapse into one.
    $noteClean = Clean ($note -replace '\s*\.\s*$','')
    $prev = if ($meetings.Count) { $meetings[$meetings.Count-1] } else { $null }
    if ($prev -and $prev.date -eq $iso -and $prev.kind -eq $kind -and $prev.note -eq $noteClean) {
      $cur = $prev; $curProject = ''; continue
    }
    $cur = [ordered]@{
      title = if ($titleRaw -ne '') { $titleRaw } else { $b }
      date  = $iso
      kind  = $kind
      note  = $noteClean
      row   = $rowNo
      attendees = New-Object System.Collections.ArrayList
      items = New-Object System.Collections.ArrayList
    }
    [void]$meetings.Add($cur)
    $curProject = ''
    continue
  }

  if ($null -eq $cur) { continue }

  # Attendees can sit in column A or column B, with or without the "Attendees:" label split
  # across the two cells.
  if ($a -match '^Attendees' -or $b -match '^Attendees' -or ($a -eq 'Attendees' -and $b -ne '')) {
    $names = if ($a -match '^Attendees') { $a } else { $b }
    if ($a -eq 'Attendees' -and $b -ne '') { $names = $b }
    $names = $names -replace '^Attendees\s*[:\-]?\s*', ''
    foreach ($n in ($names -split ',')) {
      $n = Clean $n
      $n = $n -replace '\.$',''
      if ($n -ne '' -and $n.Length -lt 60) { [void]$cur.attendees.Add($n) }
    }
    continue
  }

  # Column headers, which differ by era and would otherwise be filed as action items:
  #   era 1   Project | Task | Assigned To | ...
  #   Dec'25  Task | ... | Person Responsible | Done/Not Done
  if ($a -eq 'Project' -and $b -eq 'Task') { continue }
  if ($a -eq 'Task' -and ($f -match 'Person Responsible' -or $b -eq '')) { continue }
  if ($c -eq 'Assigned To' -and $d -eq 'Deadline') { continue }
  if ($a -eq '' -and $b -eq '' -and $c -eq '' -and $d -eq '' -and $e -eq '') { continue }

  $hasDetail = ($c -ne '' -or $d -ne '' -or $e -ne '' -or $f -ne '')

  if ($b -ne '' -and -not $hasDetail -and $a -eq '' -and $b -match ':\s*$' -and $b.Length -le 45) {
    # a project heading that happens to sit in column B rather than column A (27.10.25 onwards)
    $curProject = $b; continue
  }
  if ($b -ne '') {
    # era 1 / 2: the task is in column B; a project in column A applies to this row
    if ($a -ne '') { $curProject = $a }
    $task = $b
  }
  elseif ($hasDetail) {
    # era 3: the task is in column A
    $task = $a
  }
  else {
    # column A alone. A short line is a project heading; a long one is a minute nobody was
    # assigned - still worth recording, because that is most of the recent meetings.
    # A bullet is never a heading however short it is - "- Roof water seepage" was being read as
    # a project and then collecting the rows under it.
    $words = ($a -split '\s+').Count
    $isBullet = $a -match '^\s*[-â€“â€¢]'
    if (-not $isBullet -and $a.Length -le 45 -and $words -le 6) { $curProject = $a; continue }
    $task = $a
  }

  # Most rows from late 2025 on are typed as bullet lines ("- Entrance gate to Club..."); the
  # dash is the sheet's own bullet, not part of what was agreed.
  $task = $task -replace '^\s*[-â€“â€¢]\s*',''
  $task = $task -replace '\s*:\s*$',''
  if ($task -eq '') { continue }

  $due = NormDate $d $lastYear
  [void]$cur.items.Add([ordered]@{
    project  = ($curProject -replace '\s*:\s*$','')
    item     = $task
    owner    = $c
    due      = $due
    due_raw  = $d
    comment  = $e
    extra    = $f
    status   = DeriveStatus $d $e $f
    row      = $rowNo
  })
}

$meetings | ConvertTo-Json -Depth 6 -Compress | Set-Content -Path $Out -Encoding utf8

$itemCount = ($meetings | ForEach-Object { $_.items.Count } | Measure-Object -Sum).Sum
$withOwner = ($meetings | ForEach-Object { $_.items } | Where-Object { $_.owner -ne '' }).Count
$noDate    = ($meetings | Where-Object { -not $_.date }).Count
"meetings      : $($meetings.Count)"
"  no date     : $noDate"
"action items  : $itemCount"
"  with owner  : $withOwner"
"attendee rows : $(($meetings | ForEach-Object { $_.attendees.Count } | Measure-Object -Sum).Sum)"
"json bytes    : $((Get-Item $Out).Length)"
""
"status split:"
$meetings | ForEach-Object { $_.items } | Group-Object status | Sort-Object Count -Descending |
  ForEach-Object { "  {0,-12} {1}" -f $_.Name, $_.Count }

