# Turns ops.json into SQL-ready chunks small enough to hand to the database one call at a time.
# Short keys and dropped empties, because every byte here is a byte I have to carry across.
param(
  [string]$In  = "$PSScriptRoot\ops.json",
  [string]$Dir = "$PSScriptRoot\chunks",
  [int]$MaxBytes = 11000
)
$m = Get-Content $In -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
Get-ChildItem $Dir -Filter *.txt -ErrorAction SilentlyContinue | Remove-Item

$compact = @()
$mi = 0
foreach ($x in $m) {
  $mi++
  $o = [ordered]@{ n=$mi; d=$x.date; k=$x.kind }
  if ($x.note)            { $o.t = $x.note }
  if ($x.attendees.Count) { $o.a = @($x.attendees) }
  $items = @()
  foreach ($it in $x.items) {
    $r = [ordered]@{ i = $it.item }
    if ($it.project) { $r.p = $it.project }
    if ($it.owner)   { $r.o = $it.owner }
    if ($it.due)     { $r.u = $it.due }
    if ($it.due_raw) { $r.ur = $it.due_raw }
    if ($it.comment) { $r.c = $it.comment }
    if ($it.extra)   { $r.e = $it.extra }
    $r.s = $it.status
    $r.rw = $it.row
    $items += $r
  }
  $o.it = $items
  $compact += $o
}

# One meeting per line keeps a chunk boundary from ever splitting a meeting in half.
$lines = $compact | ForEach-Object { $_ | ConvertTo-Json -Depth 6 -Compress }

$chunks = @(); $buf = @(); $len = 0
foreach ($l in $lines) {
  if ($len + $l.Length + 2 -gt $MaxBytes -and $buf.Count) { $chunks += ,@($buf); $buf = @(); $len = 0 }
  $buf += $l; $len += $l.Length + 2
}
if ($buf.Count) { $chunks += ,@($buf) }

$i = 0
foreach ($ch in $chunks) {
  $i++
  $json = '[' + ($ch -join ',') + ']'
  $f = Join-Path $Dir ("chunk{0:d2}.txt" -f $i)
  [System.IO.File]::WriteAllText($f, $json, [System.Text.UTF8Encoding]::new($false))
  "{0}  meetings={1,-2} bytes={2}" -f (Split-Path $f -Leaf), $ch.Count, $json.Length
}
"total chunks: $($chunks.Count)"
