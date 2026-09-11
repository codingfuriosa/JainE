# THE WATCHER. It notices, and it calls Claude. That is all it does.
#
# Farvision lives at 192.168.1.5 - an address that exists only inside the office - so whatever
# does the ERP entry has to run on a machine in there. Nothing out on the internet can reach
# this PC either, which is why this ASKS rather than waiting to be told: every 30 seconds it
# asks JAIN-E whether a booking is waiting for an ERP entry. Asking survives a reboot, a dropped
# connection and a machine switched off for the night - it simply asks again.
#
# There is no cleverness in here on purpose. It claims one job, starts Claude, and writes down
# what Claude said. Claude does the actual work in the browser.
#
#   Run it:      powershell -ExecutionPolicy Bypass -File watch-erp.ps1
#   Try it once: powershell -ExecutionPolicy Bypass -File watch-erp.ps1 -Once
#   Live:        add -Live. WITHOUT IT CLAUDE FILLS THE FORM AND STOPS BEFORE SAVING.

param(
  [switch]$Once,      # take one job and stop - for trying it out
  [switch]$Live,      # actually save in Farvision. Off by default, deliberately.
  [int]$EverySeconds = 30
)

$ErrorActionPreference = 'Stop'

# ---- where JAIN-E is -------------------------------------------------------------------------
$SUPABASE = 'https://rkxsgtauigjrpcjkmccu.supabase.co'
$ANONKEY  = 'sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n'
# The queue's own secret. It can do nothing except claim and finish ERP jobs, and can be changed
# in acc.job_secrets without touching anything else. Keep it off screen shares.
$SECRET   = $env:JAINE_ERP_SECRET
if (-not $SECRET) { $SECRET = 'TBFp0c7391awLqIsvI2AN5krABIBY0RNQJk2IUNyh3Q' }

# ---- which browser -----------------------------------------------------------------------------
# Temporarily pinned to one Chrome, as asked. Claude is told this id and must use that browser
# and no other; if it is not connected, the job fails and says so rather than driving whichever
# browser happens to answer - on a live accounting system that is not a mistake worth risking.
$BROWSER_ID = 'e1ebe563-7a2f-4576-b39d-a5191ea94617'
$ERP_HOME   = 'http://192.168.1.5/fv/csm/home'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile = Join-Path $here 'watch-erp.log'

function Write-Log([string]$msg) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Host $line
  Add-Content -Path $logFile -Value $line -Encoding utf8
}

function Invoke-Rpc([string]$fn, $body) {
  $headers = @{ apikey = $ANONKEY; Authorization = "Bearer $ANONKEY"
                'Content-Type' = 'application/json'; 'Content-Profile' = 'acc' }
  Invoke-RestMethod -Method Post -Uri "$SUPABASE/rest/v1/rpc/$fn" -Headers $headers `
                    -Body ($body | ConvertTo-Json -Compress)
}

function Claim-Job {
  try { return Invoke-Rpc 'erp_job_claim' @{ p_secret = $SECRET } }
  catch { Write-Log "could not reach JAIN-E: $($_.Exception.Message)"; return $null }
}

function Finish-Job([int64]$jobId, [bool]$ok, [string]$note) {
  try {
    if ($note.Length -gt 4000) { $note = $note.Substring(0, 4000) }
    Invoke-Rpc 'erp_job_finish' @{ p_secret = $SECRET; p_job_id = $jobId
                                   p_ok = $ok; p_note = $note } | Out-Null
  } catch { Write-Log "could not write the result back: $($_.Exception.Message)" }
}

# ---- what Claude is told -----------------------------------------------------------------------
# Kept in a file beside this one so the instructions can be edited without touching the watcher,
# and so what Claude was asked is on the record next to what it did.
function Build-Prompt([int]$caseNo, [int64]$caseId) {
  $tmpl = Get-Content (Join-Path $here 'erp-entry-prompt.md') -Raw
  $mode = if ($Live) { 'SAVE the entry once every field is filled and checked.' }
          else { 'DO NOT SAVE. Fill the form, take a screenshot, and stop. This is a dry run.' }
  $tmpl.Replace('{{CASE_NO}}',  "$caseNo").
        Replace('{{CASE_ID}}',  "$caseId").
        Replace('{{BROWSER}}',  $BROWSER_ID).
        Replace('{{ERP_HOME}}', $ERP_HOME).
        Replace('{{MODE}}',     $mode)
}

function Run-Claude([string]$prompt) {
  $claude = (Get-Command claude -ErrorAction SilentlyContinue)
  if (-not $claude) { throw 'Claude Code is not installed on this machine (no "claude" command).' }
  $inFile  = Join-Path $env:TEMP ("erp-prompt-{0}.txt" -f [guid]::NewGuid())
  $outFile = Join-Path $env:TEMP ("erp-out-{0}.txt"    -f [guid]::NewGuid())
  Set-Content -Path $inFile -Value $prompt -Encoding utf8
  try {
    # -p runs Claude once and exits, which is what makes it callable from a script at all.
    $p = Start-Process -FilePath $claude.Source `
                       -ArgumentList @('-p', '--output-format', 'text') `
                       -RedirectStandardInput $inFile -RedirectStandardOutput $outFile `
                       -NoNewWindow -Wait -PassThru
    $out = if (Test-Path $outFile) { Get-Content $outFile -Raw } else { '' }
    return @{ code = $p.ExitCode; out = $out }
  } finally {
    Remove-Item $inFile, $outFile -ErrorAction SilentlyContinue
  }
}

# ---- the loop ------------------------------------------------------------------------------------
Write-Log ("watching for ERP jobs every {0}s  ({1})" -f $EverySeconds,
           $(if ($Live) { 'LIVE - entries will be saved' } else { 'dry run - nothing will be saved' }))

while ($true) {
  $job = Claim-Job
  if ($job -and $job.Count -gt 0) {
    $j = $job[0]
    Write-Log ("booking {0} (case {1}) - starting Claude" -f $j.case_no, $j.case_id)
    try {
      $r = Run-Claude (Build-Prompt $j.case_no $j.case_id)
      $ok = ($r.code -eq 0) -and ($r.out -notmatch '(?i)\bSTOPPED\b')
      Write-Log ("booking {0} - {1}" -f $j.case_no, $(if ($ok) { 'done' } else { 'stopped, left for a person' }))
      Finish-Job $j.job_id $ok $r.out
    } catch {
      Write-Log ("booking {0} - could not run: {1}" -f $j.case_no, $_.Exception.Message)
      Finish-Job $j.job_id $false $_.Exception.Message
    }
  }
  if ($Once) { break }
  Start-Sleep -Seconds $EverySeconds
}
