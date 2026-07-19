# Adds a "tags" array to each card in data/cards.json based on keyword matches in its
# name/baseText/upgradedText. Re-run after every re-scrape (before build_cards_js.ps1)
# since it operates on the raw scraped fields and overwrites the tags each time.

param(
    [string]$CardsPath = "$PSScriptRoot\..\data\cards.json"
)

$ErrorActionPreference = "Stop"

# Order doesn't matter; a card can match multiple tags.
$tagRules = [ordered]@{
    "Damage"     = '\bdamage\b'
    "Block"      = '\bblock\b'
    "Draw"       = '\bdraws?\b\s*(\d+\s*)?cards?\b'
    "Strength"   = '\bstrength\b'
    "Dexterity"  = '\bdexterity\b'
    "Energy"     = '\benergy\b'
    "Debuff"     = '\b(weak|vulnerable)\b'
    "Retain"     = '\bretain\b'
    "Exhaust"    = '\bexhaust\b'
    "Ethereal"   = '\bethereal\b'
    # Silent
    "Shiv"       = '\bshivs?\b'
    "Poison"     = '\bpoison\b'
    # Regent
    "Star"       = '\bstar\b'
    "Forge"      = '\bforge\b'
    # Necrobinder
    "Summon"     = '\bsummon\b'
    "Doom"       = '\bdoom\b'
    "Souls"      = '\bsouls?\b'
    # Defect
    "Channel"    = '\bchannel(s|ed|ing)?\b'
    "Evoke"      = '\bevokes?\b'
}

$data = Get-Content $CardsPath -Raw | ConvertFrom-Json

foreach ($card in $data) {
    $haystack = "$($card.name) $($card.baseText) $($card.upgradedText)"
    $tags = New-Object System.Collections.Generic.List[string]
    foreach ($tag in $tagRules.Keys) {
        if ($haystack -match $tagRules[$tag]) {
            $tags.Add($tag)
        }
    }
    $card | Add-Member -NotePropertyName "tags" -NotePropertyValue @($tags) -Force
}

$data | ConvertTo-Json -Depth 5 | Out-File $CardsPath -Encoding utf8
Write-Output "Tagged $($data.Count) cards."
