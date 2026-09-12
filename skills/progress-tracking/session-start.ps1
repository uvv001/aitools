Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$event = [Console]::In.ReadToEnd() | ConvertFrom-Json -ErrorAction Stop
if ($null -eq $event -or $event.sessionId -isnot [string] -or
    [string]::IsNullOrWhiteSpace($event.sessionId)) {
    throw 'sessionStart requires a non-empty sessionId.'
}
if ($event.source -notin @('startup', 'resume', 'new')) {
    throw 'sessionStart requires source startup, resume, or new.'
}

$metadata = [ordered]@{
    sessionId = $event.sessionId
    source = $event.source
} | ConvertTo-Json -Compress

$context = 'Progress tracking: invoke the progress-tracking skill before handling ' +
    'the first request in this primary session, even for brief work. Apply its ' +
    'startup or resumption rules. Session metadata: ' + $metadata

@{ additionalContext = $context } | ConvertTo-Json -Compress
