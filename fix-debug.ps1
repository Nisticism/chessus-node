$file = "C:\Users\Nistic\Projects\chessus-node\chessus-frontend\src\containers\play\Play.js"
$enc = New-Object System.Text.UTF8Encoding($true)
$content = [System.IO.File]::ReadAllText($file, $enc)

# Find "gameTypesCollapsed ? '" and inspect chars around it
$idx = $content.IndexOf("gameTypesCollapsed ? '")
if ($idx -ge 0) {
    $seg = $content.Substring($idx + "gameTypesCollapsed ? '".Length, 6)
    Write-Host "Chars after gameTypesCollapsed ? ':"
    for ($i = 0; $i -lt $seg.Length; $i++) {
        $cp = [int][char]$seg[$i]
        Write-Host "  [$i] U+$([string]::Format('{0:X4}', $cp)) = '$($seg[$i])'"
    }
} else {
    Write-Host "Not found"
}

# Also check raw bytes at that position
$bytes = [System.IO.File]::ReadAllBytes($file)
# Find byte offset of "gameTypesCollapsed ? '" in the byte array
$search = [System.Text.Encoding]::UTF8.GetBytes("gameTypesCollapsed ? '")
$found = -1
for ($i = 0; $i -lt ($bytes.Length - $search.Length); $i++) {
    $match = $true
    for ($j = 0; $j -lt $search.Length; $j++) {
        if ($bytes[$i + $j] -ne $search[$j]) { $match = $false; break }
    }
    if ($match) { $found = $i; break }
}
if ($found -ge 0) {
    $start = $found + $search.Length
    Write-Host "Bytes after the pattern (first 10):"
    for ($i = $start; $i -lt [Math]::Min($start + 10, $bytes.Length); $i++) {
        Write-Host "  byte[$($i-$start)]: 0x$([string]::Format('{0:X2}', $bytes[$i]))"
    }
}
