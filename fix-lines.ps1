$file = "C:\Users\Nistic\Projects\chessus-node\chessus-frontend\src\containers\play\Play.js"
$enc = New-Object System.Text.UTF8Encoding($true)
$content = [System.IO.File]::ReadAllText($file, $enc)
$lines = $content.Split("`n")

for ($i = 0; $i -lt $lines.Length; $i++) {
    $line = $lines[$i]
    $hasNonAscii = $false
    foreach ($ch in [char[]]$line) {
        if ([int]$ch -gt 127) { $hasNonAscii = $true; break }
    }
    if ($hasNonAscii) {
        $chars = ""
        foreach ($ch in [char[]]$line) {
            if ([int]$ch -gt 127) { $chars += " U+$([string]::Format('{0:X4}', [int]$ch))" }
        }
        Write-Host "Line $($i+1):$chars | $($line.Trim())"
    }
}
