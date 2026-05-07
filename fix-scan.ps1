$file = "C:\Users\Nistic\Projects\chessus-node\chessus-frontend\src\containers\play\Play.js"
$enc = New-Object System.Text.UTF8Encoding($true)
$content = [System.IO.File]::ReadAllText($file, $enc)

# Find all characters with codepoints > 127 (non-ASCII)
$nonAscii = @()
for ($i = 0; $i -lt $content.Length; $i++) {
    $cp = [int][char]$content[$i]
    if ($cp -gt 127) {
        # Get line number (count newlines up to $i)
        $lineNum = ($content.Substring(0, $i).Split("`n")).Length
        $start = [Math]::Max(0, $i - 20)
        $end = [Math]::Min($content.Length, $i + 20)
        $ctx = $content.Substring($start, $end - $start) -replace "`r", "" -replace "`n", " "
        $nonAscii += "Line ~$lineNum, U+$([string]::Format('{0:X4}', $cp)) = '$([char]$cp)' | Context: $ctx"
    }
}

Write-Host "Total non-ASCII chars: $($nonAscii.Length)"
# Group by codepoint to show unique chars
$byCodepoint = @{}
for ($i = 0; $i -lt $content.Length; $i++) {
    $cp = [int][char]$content[$i]
    if ($cp -gt 127) {
        if (-not $byCodepoint.ContainsKey($cp)) { $byCodepoint[$cp] = 0 }
        $byCodepoint[$cp]++
    }
}
Write-Host "Unique non-ASCII codepoints:"
$byCodepoint.GetEnumerator() | Sort-Object Key | ForEach-Object {
    Write-Host "  U+$([string]::Format('{0:X4}', $_.Key)) = '$([char]$_.Key)' x$($_.Value)"
}
