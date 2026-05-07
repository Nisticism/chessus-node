$enc = New-Object System.Text.UTF8Encoding($true)
$c = [System.IO.File]::ReadAllText("C:\Users\Nistic\Projects\chessus-node\chessus-frontend\src\containers\changelog\changelog.module.scss", $enc)
$idx = $c.IndexOf("content:")
if ($idx -ge 0) {
  $seg = $c.Substring($idx, 20)
  foreach ($ch in [char[]]$seg) {
    $cp = [int]$ch
    if ($cp -gt 127) { Write-Host ("U+$([string]::Format('{0:X4}', $cp)) = $ch") }
  }
} else { Write-Host "not found" }
