# Upload the SUNDIAL archives from a disc copy into the private R2 bucket, under sundial/<name>.
# Run only after the login gate (Cloudflare Access) is confirmed on the private site.
#   powershell -File tools/sundial/upload-r2.ps1 -Disc C:\path\to\disc [-Bucket backroom-pack] [-Music 30]
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
$total = ($files | ForEach-Object { (Get-Item $_.path).Length } | Measure-Object -Sum).Sum
Write-Host ("{0} files, {1:N0} MB" -f $files.Count, ($total / 1MB))
$i = 0
foreach ($f in $files) {
  $i++
  Write-Host ("[{0}/{1}] {2}" -f $i, $files.Count, $f.key)
  npx wrangler r2 object put "$Bucket/sundial/$($f.key)" --file $f.path --remote | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "upload failed: $($f.key)" }
}
Write-Host 'done'
