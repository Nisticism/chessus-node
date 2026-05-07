$file = "C:\Users\Nistic\Projects\chessus-node\chessus-frontend\src\containers\play\Play.js"
$enc = New-Object System.Text.UTF8Encoding($true)
$content = [System.IO.File]::ReadAllText($file, $enc)

$down_tri  = [char]0x00E2 + [char]0x2013 + [char]0x00BC
$lightning = [char]0x00E2 + [char]0x0161 + [char]0x00A1
$mailbox   = [char]0x00F0 + [char]0x0178 + [char]0x201C + [char]0x00AC
$clock     = [char]0x00F0 + [char]0x0178 + [char]0x2022 + [char]0x0090
$emdash    = [char]0x00E2 + [char]0x20AC + [char]0x201D
$em_char   = [char]0x2014
$backtick  = [char]0x60
$dollar    = [char]0x24

# 1. ALL em dashes -> actual em dash char (safe in all JS/JSX contexts)
$content = $content.Replace($emdash, $em_char)

# 2. down-tri in JSX span text (line 2242)
$content = $content.Replace(">" + $down_tri + "</span>", ">{'\u25BC'}</span>")

# 3. lightning in JSX button (line 2087, try both CRLF and LF)
$content = $content.Replace("                " + $lightning + " Live`r`n              </button>", "                {'\u26A1'} Live`r`n              </button>")
$content = $content.Replace("                " + $lightning + " Live`n              </button>", "                {'\u26A1'} Live`n              </button>")

# 4. lightning in JS string ternary (line 2517)
$content = $content.Replace("' : '" + $lightning + "'}", "' : '\u26A1'}")

# 5. mailbox in template literal (line 795)
$content = $content.Replace($backtick + $mailbox + " " + $dollar + "{days}", $backtick + "\uD83D\uDCEC " + $dollar + "{days}")

# 6. mailbox in JSX button text (line 2094, both CRLF and LF)
$content = $content.Replace("                " + $mailbox + " Correspondence`r`n              </button>", "                {'\uD83D\uDCEC'} Correspondence`r`n              </button>")
$content = $content.Replace("                " + $mailbox + " Correspondence`n              </button>", "                {'\uD83D\uDCEC'} Correspondence`n              </button>")

# 7. mailbox in JS string ternary (line 2516)
$content = $content.Replace("'correspondence' ? '" + $mailbox + "' :", "'correspondence' ? '\uD83D\uDCEC' :")

# 8. clock in JS string ternary (line 2517)
$content = $content.Replace("'open' ? '" + $clock + "' :", "'open' ? '\uD83D\uDD50' :")

[System.IO.File]::WriteAllText($file, $content, $enc)

function Count-Occurrences($text, $pattern) {
    if ($pattern.Length -eq 0) { return 0 }
    return ($text.Length - $text.Replace($pattern, "").Length) / $pattern.Length
}
$after = [System.IO.File]::ReadAllText($file, $enc)
Write-Host "After length: $($after.Length)"
Write-Host "Remaining em-dash: $(Count-Occurrences $after $emdash)"
Write-Host "Remaining lightning: $(Count-Occurrences $after $lightning)"
Write-Host "Remaining mailbox: $(Count-Occurrences $after $mailbox)"
Write-Host "Remaining clock: $(Count-Occurrences $after $clock)"
Write-Host "Remaining down-tri: $(Count-Occurrences $after $down_tri)"
