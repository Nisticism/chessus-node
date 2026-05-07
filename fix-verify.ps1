$file = "C:\Users\Nistic\Projects\chessus-node\chessus-frontend\src\containers\play\Play.js"
$enc = New-Object System.Text.UTF8Encoding($true)
$content = [System.IO.File]::ReadAllText($file, $enc)

function Count-Occurrences($text, $pattern) {
    if ($pattern.Length -eq 0) { return 0 }
    return ($text.Length - $text.Replace($pattern, "").Length) / $pattern.Length
}

$down_tri  = [char]0x00E2 + [char]0x2013 + [char]0x00BC
$lightning = [char]0x00E2 + [char]0x0161 + [char]0x00A1
$mailbox   = [char]0x00F0 + [char]0x0178 + [char]0x201C + [char]0x00AC
$clock     = [char]0x00F0 + [char]0x0178 + [char]0x2022 + [char]0x0090
$emdash    = [char]0x00E2 + [char]0x20AC + [char]0x201D

Write-Host "em-dash matches: $(Count-Occurrences $content $emdash)"
Write-Host "lightning matches: $(Count-Occurrences $content $lightning)"
Write-Host "mailbox matches: $(Count-Occurrences $content $mailbox)"
Write-Host "clock matches: $(Count-Occurrences $content $clock)"
Write-Host "down-tri matches: $(Count-Occurrences $content $down_tri)"
