#Requires -Version 7.4
[CmdletBinding()]
param(
    [string] $Revision = 'main',
    [switch] $Check
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$cache = Join-Path $root '.tmp/zed-language-registry'
New-Item -ItemType Directory -Path $cache -Force | Out-Null

$commit = Invoke-RestMethod "https://api.github.com/repos/zed-industries/extensions/commits/$Revision"
$index = Join-Path $cache 'extensions.toml'
Invoke-WebRequest "https://raw.githubusercontent.com/zed-industries/extensions/$($commit.sha)/extensions.toml" -OutFile $index
$catalog = @(
    (Invoke-RestMethod 'https://api.zed.dev/extensions?provides=languages&limit=1000&max_schema_version=1').data
    (Invoke-RestMethod 'https://api.zed.dev/extensions?provides=language-servers&limit=1000&max_schema_version=1').data
    (Invoke-RestMethod 'https://api.zed.dev/extensions?provides=grammars&limit=1000&max_schema_version=1').data
) | Sort-Object id,version -Unique

$files = $catalog | ForEach-Object -ThrottleLimit 16 -Parallel {
    $ErrorActionPreference = 'Stop'
    $item = $_
    $path = Join-Path $using:cache "$($item.id)-$($item.version).json"
    if (-not (Test-Path -LiteralPath $path)) {
        try {
            $response = Invoke-WebRequest "https://api.zed.dev/extensions/$($item.id)/$($item.version)/download" -TimeoutSec 45 -MaximumRetryCount 2 -RetryIntervalSec 2
            $stream = [IO.MemoryStream]::new($response.Content)
            $gzip = [IO.Compression.GZipStream]::new($stream, [IO.Compression.CompressionMode]::Decompress)
            $archive = [System.Formats.Tar.TarReader]::new($gzip)
            try {
                $entries = @{}
                for ($entry = $archive.GetNextEntry(); $null -ne $entry; $entry = $archive.GetNextEntry()) {
                    $name = $entry.Name -replace '^\./', ''
                    if ($entry.DataStream -and ($name -eq 'extension.toml' -or $name -match '^languages/.+/config\.toml$')) {
                        $reader = [IO.StreamReader]::new($entry.DataStream, [Text.Encoding]::UTF8, $true, 4096, $true)
                        try { $entries[$name] = $reader.ReadToEnd() } finally { $reader.Dispose() }
                    }
                }
                @{ id = $item.id; version = $item.version; entries = $entries } | ConvertTo-Json -Depth 4 -Compress | Set-Content -LiteralPath $path
            } finally {
                $archive.Dispose()
                $gzip.Dispose()
                $stream.Dispose()
            }
        } catch {
            Write-Warning ("{0} {1} - {2}" -f $item.id, $item.version, $_.Exception.Message)
            return
        }
    }
    $path
}
if ($files.Count -ne $catalog.Count) {
    throw "Read $($files.Count) of $($catalog.Count) extension archives. Rerun to retry missing contributions."
}

$list = Join-Path $cache 'catalog-files.json'
ConvertTo-Json -InputObject @($files) | Set-Content -LiteralPath $list
$options = @('--registry', $index, '--archives', $list, '--revision', $commit.sha, '--manifest', (Join-Path $root 'extension.toml'), '--report', (Join-Path $cache 'audit.json'))
if ($Check) { $options += '--check' }
node (Join-Path $root 'server/update-manifest.mjs') @options
if ($Check) { exit $LASTEXITCODE }
if ($LASTEXITCODE -ne 0) { throw 'Language manifest update failed' }
