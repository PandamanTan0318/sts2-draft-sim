param(
    [string]$SitemapPath = "$PSScriptRoot\..\data\sitemap_cards.xml",
    [string]$OutPath = "$PSScriptRoot\..\data\cards.json",
    [string]$ProgressPath = "$PSScriptRoot\..\data\cards.partial.json",
    [int]$DelayMs = 200
)

$ErrorActionPreference = "Stop"

[xml]$sitemap = Get-Content $SitemapPath -Raw
$ns = New-Object System.Xml.XmlNamespaceManager($sitemap.NameTable)
$ns.AddNamespace("s", "http://www.sitemaps.org/schemas/sitemap/0.9")
$ns.AddNamespace("image", "http://www.google.com/schemas/sitemap-image/1.1")
$urlNodes = $sitemap.SelectNodes("//s:url", $ns)

$slugArt = @{}
foreach ($u in $urlNodes) {
    $loc = $u.SelectSingleNode("s:loc", $ns).InnerText
    if ($loc -match '^https://sts2\.untapped\.gg/en/cards/([a-z0-9\-]+)$') {
        $slug = $matches[1]
        $imgNodes = $u.SelectNodes("image:image/image:loc", $ns)
        $arts = @()
        foreach ($n in $imgNodes) { $arts += $n.InnerText }
        $slugArt[$slug] = $arts
    }
}

$slugs = $slugArt.Keys | Sort-Object
Write-Output "Total slugs to fetch: $($slugs.Count)"

# Card text sometimes conveys a resource quantity (e.g. "Regent Energy" / "Star") as N repeated
# icon <img> tags with no numeric text at all (e.g. "Gain [icon][icon]." means "Gain 2 Regent Energy.").
# Expand these runs into "<count> <resource name>" text before generic tag-stripping, so the
# quantity isn't silently lost.
$energyIconPattern = '(?:<img alt="([^"]*Energy)"[^>]*?/>)+'
$energyIconEvaluator = {
    param($m)
    $count = $m.Groups[1].Captures.Count
    $alt = $m.Groups[1].Captures[0].Value
    "$count $alt"
}

function ExpandAndStripHtml($innerHtml) {
    $expanded = [regex]::Replace($innerHtml, $energyIconPattern, $energyIconEvaluator)
    $stripped = [regex]::Replace($expanded, '<[^>]+>', '')
    $decoded = [System.Net.WebUtility]::HtmlDecode($stripped).Trim()
    # Safety net for any other icon types that still leave gaps/double-spaces.
    $decoded = [regex]::Replace($decoded, '\s+', ' ')
    $decoded = [regex]::Replace($decoded, '\s+\.', '.')
    return $decoded
}

$results = New-Object System.Collections.Generic.List[object]
$excludedCount = 0
$failedSlugs = New-Object System.Collections.Generic.List[string]
$i = 0

foreach ($slug in $slugs) {
    $i++
    $url = "https://sts2.untapped.gg/en/cards/$slug"
    $html = $null
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20
            $html = $resp.Content
            break
        } catch {
            Start-Sleep -Milliseconds (500 * $attempt)
        }
    }

    if (-not $html) {
        $failedSlugs.Add($slug)
        Write-Warning "FAILED after retries: $slug"
        continue
    }

    $name      = if ($html -match '<h1>([^<]+)</h1>') { $matches[1] } else { $null }
    $character = if ($html -match '<dt>Character</dt><dd>([^<]*)</dd>') { $matches[1] } else { $null }
    if ($character -eq 'N/A' -or [string]::IsNullOrWhiteSpace($character)) { $character = 'Colorless' }
    $type      = if ($html -match '<dt>Type</dt><dd>([^<]*)</dd>') { $matches[1] } else { $null }
    $cost      = if ($html -match '<dt>Cost</dt><dd>([^<]*)</dd>') { $matches[1] } else { $null }
    $rarity    = if ($html -match '<dt>Rarity</dt><dd>([^<]*)</dd>') { $matches[1] } else { $null }

    $baseText = $null
    if ($html -match '__description">(.*?)</div>') {
        $baseText = ExpandAndStripHtml $matches[1]
    }

    $upgradedText = $null
    if ($html -match '__upgradeDetails">(.*?)</div>') {
        $upgradedText = ExpandAndStripHtml $matches[1]
    }

    # Per user request: omit Ancient, Curse, and Status cards from the draft-usable database
    if ($rarity -eq 'Ancient' -or $type -eq 'Curse' -or $type -eq 'Status') {
        $excludedCount++
        Write-Output "[$i/$($slugs.Count)] EXCLUDED $slug (rarity=$rarity type=$type)"
        Start-Sleep -Milliseconds $DelayMs
        continue
    }

    $arts = $slugArt[$slug]
    $record = [PSCustomObject]@{
        slug         = $slug
        name         = $name
        class        = $character
        type         = $type
        cost         = $cost
        rarity       = $rarity
        baseText     = $baseText
        upgradedText = $upgradedText
        artBase      = if ($arts.Count -ge 1) { $arts[0] } else { $null }
        artUpgraded  = if ($arts.Count -ge 2) { $arts[1] } else { $null }
    }
    $results.Add($record)

    if ($i % 25 -eq 0) {
        Write-Output "[$i/$($slugs.Count)] progress: $($results.Count) kept, $excludedCount excluded, $($failedSlugs.Count) failed"
        $results | ConvertTo-Json -Depth 5 | Out-File $ProgressPath -Encoding utf8
    }

    Start-Sleep -Milliseconds $DelayMs
}

$results | ConvertTo-Json -Depth 5 | Out-File $OutPath -Encoding utf8

Write-Output "DONE. Kept: $($results.Count)  Excluded: $excludedCount  Failed: $($failedSlugs.Count)"
if ($failedSlugs.Count -gt 0) {
    Write-Output "Failed slugs: $($failedSlugs -join ', ')"
}
