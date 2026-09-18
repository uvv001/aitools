<#
.SYNOPSIS
    Regenerates the dashboard of a review report.

.DESCRIPTION
    The findings are the source of truth; the dashboard is derived. This
    script reads the finding headers of a report written per
    report-format.md, tallies state and severity, enumerates the rounds that
    moved a finding, and rewrites everything between the "## Dashboard"
    heading and the next "## " heading. Lines inside fenced code blocks are
    ignored, so quoted examples never count as findings.

    Parsed shapes, both defined in report-format.md:
      header  ### <state> <severity> <ID> <em dash> <title>
      update  - yyyy-mm-dd hh:mm <em dash> Round <n>: ... <old> -> <new> ...
    Only update entries carrying both a round tag and a state arrow feed the
    rounds enumeration.

    Heading links follow the GitHub heading-slug rule: lower-cased, every
    character outside [a-z0-9 _-] dropped, spaces turned into hyphens.

.PARAMETER Path
    The report file, rewritten in place.

.EXAMPLE
    pwsh -File Update-Dashboard.ps1 -Path docs/2026-09-16_pr157_review.md
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-Glyph {
    param([string]$Hex)
    [char]::ConvertFromUtf32([Convert]::ToInt32($Hex, 16))
}

function Get-Slug {
    param([string]$Text)
    $s = $Text.ToLowerInvariant()
    $s = [regex]::Replace($s, '[^a-z0-9 _-]', '')
    $s.Replace(' ', '-')
}

$emDash = Get-Glyph '2014'
$arrow = Get-Glyph '2192'
$dot = Get-Glyph 'B7'

$states = @(
    @{ Hex = '23F3'; Label = 'awaiting triage' }
    @{ Hex = '2753'; Label = 'unverified' }
    @{ Hex = '2705'; Label = 'approved' }
    @{ Hex = '1F527'; Label = 'fixed' }
    @{ Hex = '274C'; Label = 'discarded' }
    @{ Hex = '1F4CC'; Label = 'deferred' }
    @{ Hex = '1F500'; Label = 'improvement' }
)
$severities = @(
    @{ Hex = '1F534'; Label = 'high' }
    @{ Hex = '1F7E1'; Label = 'medium' }
    @{ Hex = '26AA'; Label = 'low' }
)
foreach ($entry in @($states) + @($severities)) { $entry.Glyph = Get-Glyph $entry.Hex }

if (-not (Test-Path -LiteralPath $Path)) { throw "Report not found: $Path" }
$raw = [System.IO.File]::ReadAllText($Path)
$newline = if ($raw -match "`r`n") { "`r`n" } else { "`n" }
$lines = $raw -split "`r?`n"

$headerRx = '^###\s+(?<state>\S+)\s+(?<sev>\S+)\s+(?<id>[A-Za-z0-9-]+)\s+\u2014\s+(?<title>.+?)\s*$'
$updateRx = '^\s*-\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+\u2014\s+(?<body>.+?)\s*$'
$roundRx = '^Round\s+(?<n>\d+)\s*:'
$markers = ($states | ForEach-Object { [regex]::Escape($_.Glyph) }) -join '|'
$moveRx = "(?<from>$markers)\s*\u2192\s*(?<to>$markers)"
$fenceRx = '^\s*(?<marker>`{3,}|~{3,})'

$findings = New-Object System.Collections.Generic.List[object]
$entries = New-Object System.Collections.Generic.List[object]
$current = $null
$pending = $null
$fence = $null
$dashboardStart = -1
$dashboardEnd = -1

for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]

    $fenceMatch = [regex]::Match($line, $fenceRx)
    if ($fenceMatch.Success) {
        $marker = $fenceMatch.Groups['marker'].Value
        if ($null -eq $fence) { $fence = $marker; continue }
        if ($marker[0] -eq $fence[0] -and $marker.Length -ge $fence.Length) { $fence = $null }
        continue
    }
    if ($null -ne $fence) { continue }

    if ($line -match '^##\s') {
        if ($line -match '^##\s+Dashboard\s*$') { $dashboardStart = $i }
        elseif ($dashboardStart -ge 0 -and $dashboardEnd -lt 0) { $dashboardEnd = $i }
    }

    $headerMatch = [regex]::Match($line, $headerRx)
    if ($headerMatch.Success) {
        $current = [pscustomobject]@{
            Id       = $headerMatch.Groups['id'].Value
            State    = $headerMatch.Groups['state'].Value
            Severity = $headerMatch.Groups['sev'].Value
            Anchor   = Get-Slug ($line -replace '^###\s', '')
            Moves    = @()
        }
        $findings.Add($current)
        $pending = $null
        continue
    }

    if ($null -eq $current) { continue }
    $updateMatch = [regex]::Match($line, $updateRx)
    if ($updateMatch.Success) {
        $pending = [pscustomobject]@{ Owner = $current; Body = $updateMatch.Groups['body'].Value }
        $entries.Add($pending)
        continue
    }
    if ($null -eq $pending) { continue }

    # An entry wraps across lines; its continuations are indented text.
    if ($line -match '^\s*$' -or $line -match '^#{1,6}\s' -or $line -match '^\s*[-*+]\s') {
        $pending = $null
    }
    else {
        $pending.Body += ' ' + $line.Trim()
    }
}

foreach ($entry in $entries) {
    $roundMatch = [regex]::Match($entry.Body, $roundRx)
    $moveMatch = [regex]::Match($entry.Body, $moveRx)
    if ($roundMatch.Success -and $moveMatch.Success) {
        $entry.Owner.Moves += [pscustomobject]@{
            Round = [int]$roundMatch.Groups['n'].Value
            From  = $moveMatch.Groups['from'].Value
            To    = $moveMatch.Groups['to'].Value
        }
    }
}

if ($dashboardStart -lt 0) { throw "No '## Dashboard' heading in $Path" }
if ($dashboardEnd -lt 0) { $dashboardEnd = $lines.Count }

$block = New-Object System.Collections.Generic.List[string]
$block.Add('## Dashboard')
$block.Add('')
$block.Add("<!-- generated by Update-Dashboard.ps1 at $(Get-Date -Format 'yyyy-MM-dd HH:mm') $emDash do not edit by hand -->")
$block.Add('')

if ($findings.Count -eq 0) {
    $block.Add("**No findings** $emDash the review raised none.")
}
else {
    $stateParts = foreach ($state in $states) {
        $count = @($findings | Where-Object { $_.State -eq $state.Glyph }).Count
        "$($state.Glyph) $count $($state.Label)"
    }
    $severityParts = foreach ($severity in $severities) {
        $count = @($findings | Where-Object { $_.Severity -eq $severity.Glyph }).Count
        "$($severity.Glyph) $count $($severity.Label)"
    }
    $block.Add("**$($findings.Count) findings** $emDash " + ($stateParts -join " $dot "))
    $block.Add('')
    $block.Add("**Severity** $emDash " + ($severityParts -join " $dot "))

    $rounds = $findings | ForEach-Object { $_.Moves } | Sort-Object Round -Unique | Select-Object -ExpandProperty Round
    if ($rounds) {
        $block.Add('')
        $block.Add('**Rounds**')
        $block.Add('')
        foreach ($round in $rounds) {
            $moved = foreach ($finding in $findings) {
                foreach ($move in @($finding.Moves | Where-Object { $_.Round -eq $round })) {
                    "[$($finding.Id)](#$($finding.Anchor)) $($move.From) $arrow $($move.To)"
                }
            }
            $block.Add("- Round $round $emDash " + ($moved -join ', '))
        }
    }
}
$block.Add('')

$updated = @()
if ($dashboardStart -gt 0) { $updated += $lines[0..($dashboardStart - 1)] }
$updated += $block
if ($dashboardEnd -lt $lines.Count) { $updated += $lines[$dashboardEnd..($lines.Count - 1)] }

[System.IO.File]::WriteAllText($Path, ($updated -join $newline), (New-Object System.Text.UTF8Encoding($false)))
Write-Output "Dashboard updated: $($findings.Count) findings in $Path"
