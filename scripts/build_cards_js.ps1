$root = Resolve-Path "$PSScriptRoot\.."
$json = Get-Content "$root\data\cards.json" -Raw
"const CARD_DATA = $json;" | Out-File "$root\data\cards.js" -Encoding utf8
Write-Output "Wrote data/cards.js"
