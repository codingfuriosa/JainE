param([string]$Xlsx, [string]$OutDir)
# Reads an .xlsx as DATA (unzips it, parses the XML) and writes each sheet as a tab-separated text file.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$tmp = Join-Path $OutDir "unz"
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
[System.IO.Compression.ZipFile]::ExtractToDirectory($Xlsx, $tmp)
$ss = @()
$ssPath = Join-Path $tmp "xl\sharedStrings.xml"
if (Test-Path $ssPath) {
  [xml]$x = Get-Content -Raw -Encoding UTF8 $ssPath
  foreach ($si in $x.sst.si) {
    if ($si.t -is [string]) { $ss += $si.t }
    elseif ($si.t -and $si.t.'#text') { $ss += $si.t.'#text' }
    else { $ss += (($si.r | ForEach-Object { if ($_.t -is [string]) { $_.t } else { $_.t.'#text' } }) -join '') }
  }
}
[xml]$wb = Get-Content -Raw -Encoding UTF8 (Join-Path $tmp "xl\workbook.xml")
$names = @($wb.workbook.sheets.sheet | ForEach-Object { $_.name })
$sheets = Get-ChildItem (Join-Path $tmp "xl\worksheets") -Filter "sheet*.xml" | Sort-Object { [int]($_.BaseName -replace '\D','') }
$i = 0
foreach ($f in $sheets) {
  [xml]$s = Get-Content -Raw -Encoding UTF8 $f.FullName
  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($row in $s.worksheet.sheetData.row) {
    $cells = @()
    foreach ($c in $row.c) {
      $v = $c.v
      if ($c.t -eq 's' -and $v -ne $null) { $v = $ss[[int]$v] }
      elseif ($c.t -eq 'inlineStr') { $v = $c.is.t }
      $col = ($c.r -replace '\d','')
      $cells += ("[" + $col + "] " + (("" + $v) -replace "[\r\n\t]+", " "))
    }
    if ($cells.Count) { $lines.Add(("R" + $row.r + "`t" + ($cells -join "`t"))) }
  }
  $out = Join-Path $OutDir ("sheet" + ($i+1) + "_" + ($names[$i] -replace '[^\w]','_') + ".txt")
  [System.IO.File]::WriteAllLines($out, $lines, [System.Text.Encoding]::UTF8)
  Write-Output ("wrote " + $out + " (" + $lines.Count + " rows)")
  $i++
}
