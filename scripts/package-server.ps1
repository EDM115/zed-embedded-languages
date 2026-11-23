$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$server = Join-Path $root 'server'
$staging = Join-Path $root 'target/server-package'
$versionPattern = '(?m)^version\s*=\s*"([^"]+)"'
$version = [regex]::Match((Get-Content -LiteralPath (Join-Path $root 'Cargo.toml') -Raw), $versionPattern).Groups[1].Value
$manifestVersion = [regex]::Match((Get-Content -LiteralPath (Join-Path $root 'extension.toml') -Raw), $versionPattern).Groups[1].Value
if (!$version -or $version -cne $manifestVersion) {
    throw 'Cargo.toml and extension.toml must have the same version'
}

New-Item -ItemType Directory -Path $staging -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $server 'package.json'), (Join-Path $server 'package-lock.json') -Destination $staging
npm ci --prefix $staging --ignore-scripts --no-bin-links --omit=dev --no-audit --no-fund
if ($LASTEXITCODE -ne 0) {
    throw 'Companion dependency installation failed'
}

$asset = Join-Path $root "target/embedded-languages-server-$version.tar.gz"
$modules = @(Get-ChildItem -LiteralPath $server -File -Filter '*.mjs' | Select-Object -ExpandProperty Name)
# The grammar packages are loaded from their WASM assets
$exclude = @(
    '--exclude=node_modules/.package-lock.json'
    '--exclude=node_modules/tree-sitter-*/bindings'
    '--exclude=node_modules/tree-sitter-*/prebuilds'
    '--exclude=node_modules/tree-sitter-*/src'
)
tar -czf $asset @exclude -C $root LICENSE -C $server @modules -C $staging node_modules
if ($LASTEXITCODE -ne 0) {
    throw 'Companion archive creation failed'
}
Get-Item -LiteralPath $asset
