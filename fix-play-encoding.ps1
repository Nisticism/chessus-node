$file = "C:\Users\Nistic\Projects\chessus-node\chessus-frontend\src\containers\play\Play.js"
$enc = New-Object System.Text.UTF8Encoding($true)
$content = [System.IO.File]::ReadAllText($file, $enc)

# Build mojibake char sequences from Unicode codepoints
# Each char was mis-read as Windows-1252, producing the mojibake Unicode chars we see
$down_tri  = [char]0x00E2 + [char]0x2013 + [char]0x00BC   # â–¼ = ▼ (U+25BC)
$right_tri = [char]0x00E2 + [char]0x2013 + [char]0x00B6   # â–¶ = ▶ (U+25B6)
$cross     = [char]0x00C3 + [char]0x2014                   # Ã— = × (U+00D7)
$bullet    = [char]0x00E2 + [char]0x20AC + [char]0x00A2   # â€¢ = • (U+2022)
$rarr      = [char]0x00E2 + [char]0x2020 + [char]0x2019   # â†' = → (U+2192)
$larr      = [char]0x00E2 + [char]0x2020 + [char]0x0090   # â†  = ← (U+2190)
$sqplus    = [char]0x00E2 + [char]0x0160 + [char]0x017E   # âŠž = ⊞ (U+229E)
$swords    = [char]0x00E2 + [char]0x0161 + [char]0x201D   # âš" = ⚔ (U+2694)
$pawn      = [char]0x00E2 + [char]0x2122 + [char]0x0178   # â™Ÿ = ♟ (U+265F)
$emdash    = [char]0x00E2 + [char]0x20AC + [char]0x201D   # â€" = — (U+2014)
$trash6    = [char]0x00F0 + [char]0x0178 + [char]0x2014 + [char]0x2018 + [char]0x00EF + [char]0x00B8
$swords_v  = $swords + [char]0x00EF + [char]0x00B8         # ⚔️ (with variation selector)
$close_x   = [char]0x00E2 + [char]0x0153 + [char]0x2022   # âœ• = ✕ (U+2715)

$before = $content.Length
Write-Host "File length before: $before"

# 1. Collapse toggles (▶/▼ in JS string literals)
$content = $content.Replace("'" + $right_tri + "'", "'\u25B6'")
$content = $content.Replace("'" + $down_tri + "'", "'\u25BC'")

# 2. × in dismiss button text node (CRLF and LF variants)
$content = $content.Replace($cross + "`r`n          </button>", "{'\u00D7'}`r`n          </button>")
$content = $content.Replace($cross + "`n          </button>", "{'\u00D7'}`n          </button>")

# 3. × in board dimensions JSX expression
$content = $content.Replace("}" + $cross + "{", "}{'\u00D7'}{")

# 4. • in game type list item JSX text
$content = $content.Replace($bullet + " {game.player_count", "{'\u2022'} {game.player_count")

# 5. Stat icon spans
$content = $content.Replace(">" + $sqplus + "</span>", ">{'\u229E'}</span>")
$content = $content.Replace(">" + $swords + "</span>", ">{'\u2694'}</span>")
$content = $content.Replace(">" + $pawn + "</span>", ">{'\u265F'}</span>")
$content = $content.Replace(">" + $bullet + "</span>", ">{'\u2022'}</span>")

# 6. Bullet stat-divider with surrounding space expressions
$content = $content.Replace("{' '}" + $bullet + "{' '}", "{'\u2022'}")

# 7. Prev/Next pagination (multi-line, indented 6 spaces inside pagination div)
$content = $content.Replace("      " + $larr + " Prev`r`n", "      {'\u2190'} Prev`r`n")
$content = $content.Replace("      " + $larr + " Prev`n", "      {'\u2190'} Prev`n")
$content = $content.Replace("      Next " + $rarr + "`r`n", "      Next {'\u2192'}`r`n")
$content = $content.Replace("      Next " + $rarr + "`n", "      Next {'\u2192'}`n")

# 8. Compact single-line pagination (publicBotGames - closes the tag right away)
$content = $content.Replace(">" + $larr + " Prev</button>", ">{'\u2190'} Prev</button>")
$content = $content.Replace(">Next " + $rarr + "</button>", ">Next {'\u2192'}</button>")

# 9. Em dash in JSX paragraph text (specific phrases only — skip comments)
$content = $content.Replace("instead of Live " + $emdash + " unless", "instead of Live {'\u2014'} unless")
$content = $content.Replace("anonymous games " + $emdash + " any", "anonymous games {'\u2014'} any")

# 10. Delete/trash emoji (try with and without trailing W1252 undefined 0x8F control char)
$content = $content.Replace('"' + $trash6 + [char]0x008F + '"', "'\uD83D\uDDD1\uFE0F'")
$content = $content.Replace('"' + $trash6 + '"', "'\uD83D\uDDD1\uFE0F'")

# 11. Challenge indicator sword emoji ⚔️ in JSX text
$content = $content.Replace($swords_v + [char]0x008F + " Private challenge", "{'\u2694\uFE0F'} Private challenge")
$content = $content.Replace($swords_v + " Private challenge", "{'\u2694\uFE0F'} Private challenge")

# 12. Close/remove button ✕
$content = $content.Replace($close_x, "{'\u2715'}")

[System.IO.File]::WriteAllText($file, $content, $enc)
Write-Host "Done. File length after: $($content.Length)"
