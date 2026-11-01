# Upload the SUNDIAL archives from a disc copy into the private R2 bucket, under sundial/<name>.
# Run only after the login gate (Cloudflare Access) is confirmed on the private site.
#   powershell -File tools/sundial/upload-r2.ps1 -Disc C:\path\to\disc [-Bucket backroom-pack] [-Music 30] [-Chr]
# Keeps a done-list next to the disc copy so a rerun skips what already went up; each object retries 4 times.
param(
  [Parameter(Mandatory = $true)][string]$Disc,
  [string]$Bucket = 'backroom-pack',
  [int]$Music = 30,
  [switch]$Chr
)
$files = @()
foreach ($n in 'GUN.PAK', 'SOUNDS.PAK', 'ANIM.PAK', 'FE_ANIM.PAK') { $files += @{ key = $n.ToLower(); path = Join-Path $Disc "PAK\$n" } }
$files += @{ key = 'l_103.pak'; path = Join-Path $Disc 'PAK\ARCADE\L_103.PAK' }
if ($Chr) { $files += @{ key = 'chr.pak'; path = Join-Path $Disc 'PAK\CHR.PAK' } }
Get-ChildItem (Join-Path $Disc 'PAK\ARCADE') -Filter 'L_*_AR.PAK' | ForEach-Object { $files += @{ key = $_.Name.ToLower(); path = $_.FullName } }
Get-ChildItem (Join-Path $Disc 'PAK\STORY') -Filter 'L_*_ST.PAK' | ForEach-Object { $files += @{ key = $_.Name.ToLower(); path = $_.FullName } }
Get-ChildItem (Join-Path $Disc 'MUSIC\MUSIC1') -Filter '*.MIB' | Sort-Object Name | Select-Object -First $Music | ForEach-Object { $files += @{ key = $_.Name.ToLower(); path = $_.FullName } }
$doneFile = Join-Path $Disc 'r2-uploaded.txt'
$done = @{}
if (Test-Path $doneFile) { Get-Content $doneFile | ForEach-Object { $done[$_] = $true } }
$total = ($files | ForEach-Object { (Get-Item $_.path).Length } | Measure-Object -Sum).Sum
Write-Host ("{0} files, {1:N0} MB, {2} already up" -f $files.Count, ($total / 1MB), $done.Count)
$i = 0
foreach ($f in $files) {
  $i++
  if ($done[$f.key]) { continue }
  $ok = $false
  for ($try = 1; $try -le 4 -and -not $ok; $try++) {
    Write-Host ("[{0}/{1}] {2} (try {3})" -f $i, $files.Count, $f.key, $try)
    npx wrangler r2 object put "$Bucket/sundial/$($f.key)" --file $f.path --remote 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $ok = $true } else { Start-Sleep -Seconds (5 * $try) }
  }
  if (-not $ok) { throw "upload failed after retries: $($f.key)" }
  Add-Content $doneFile $f.key
}
Write-Host 'done'
