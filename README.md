# Embedded Languages LSP for Zed

Highlight code inside string literals as you type. SQL can be the first statement of a Python block, with or without a `# sql` comment.

```python
if ready:
    query = """
        SELECT id, display_name
        FROM users
        WHERE active = true
    """
```

- **Hosts** are registered from the published Zed language extension catalog. The server discovers compatible installed grammars at startup and includes parser fallbacks for common built-in languages. A registration can produce highlights when a compatible grammar is available and its string syntax is recognized.
- **Automatic detection** recognizes SQL statements, structured JSON, HTML, and XML with an XML declaration. It also checks installed language signatures and can choose a single installed grammar when a code-shaped snippet parses cleanly with distinctive highlight captures.
- **Explicit markers** include `# sql` for Python and `language=...` in a comment above the string's line. A marker is useful for ambiguous fragments such as `SELECT display_name`. In Python, the SQL marker can also precede a string argument.

Literal concatenations and consecutive assignments to the same variable can extend a snippet. Python supports `"%s" % value`, `"{}".format(value)`, and f-strings. JavaScript and TypeScript template literals, C# interpolated strings, Rust `format!`, and Go `fmt.Sprintf` also have coverage. The extension uses the template source and keeps the host expressions out of the embedded highlighting.

```python
query = "UPDATE contratvpla "
query += "SET qte_eng = qte_eng + %s " % amount
query += "WHERE contratv = %s" % reference
```

## Install on Windows

1. If you installed 0.1.x, uninstall that extension from Zed's Extensions page first. Version 0.2.0 uses the extension ID `embedded-languages-lsp`. Extract the ZIP and quit Zed.
2. From the extracted folder containing `extension.toml`, run this in PowerShell to install the prebuilt extension.

   ```powershell
   $target = Join-Path $env:LOCALAPPDATA 'Zed\extensions\installed\embedded-languages-lsp'
   New-Item -ItemType Directory -Path $target -Force | Out-Null
   Copy-Item -LiteralPath '.\extension.toml', '.\extension.wasm' -Destination $target
   (Get-Item -LiteralPath (Split-Path -Parent $target)).LastWriteTimeUtc = [DateTime]::UtcNow
   ```

3. Reopen Zed. Merge [zed-settings.json](zed-settings.json) into your existing settings. The example enables combined semantic tokens globally. The language-server ID is still `embedded-languages`. Where you use an explicit `language_servers` list, keep your existing entries and append `"embedded-languages"` last so the snippet tokens have priority where ranges overlap.

   ```json
   {
     "languages": {
       "Python": {
         "semantic_tokens": "combined",
         "language_servers": ["...", "embedded-languages"]
       }
     }
   }
   ```

   Merge the supplied `global_lsp_settings.semantic_token_rules` to use your theme's native JSON styles for keys, delimiters, brackets, booleans, null, and escapes. These rules apply only to embedded JSON. Keep the SQL extension installed for SQL highlighting. The companion server uses Zed's Node runtime and fetches its npm dependencies on first launch.

4. Open [examples/example.py](examples/example.py) or [examples/example.ts](examples/example.ts). If you updated the settings while a file was open, run **editor: restart language server**.

When replacing a prebuilt `extension.wasm`, quit Zed first. On Windows, Zed 1.29.2 can stop the running companion when the file changes and leave it absent from the lightning menu. If that happens, focus a source file configured to use `embedded-languages` and run **editor: restart language server** from the command palette. Open the lightning menu to confirm that `embedded-languages` is running.

To build from source on any Zed platform, install Rust and run `rustup target add wasm32-wasip2`, then choose **zed: install dev extension** and select this folder. [Zed's extension development guide](https://zed.dev/docs/extensions/developing-extensions)

## Add a detector for another installed language

The server matches detector patterns against the trimmed string body and tries custom rules first. The target can be an installed extension language name, grammar name, or file suffix. A candidate must parse cleanly before automatic highlighting is applied.

This example identifies XML configuration fragments without an XML declaration. Keep the Zed XML extension installed.

```json
{
  "lsp": {
    "embedded-languages": {
      "initialization_options": {
        "autoDetect": [{ "language": "xml", "pattern": "^<configuration\\b" }]
      }
    }
  }
}
```

A rule can set `"ignoreCase": true`. Restart the language server after changing detection settings or installing a new target grammar.

## Refresh host registrations

Installing an extension whose host is already registered requires no manifest change. Restart the language server to pick up newly installed target grammars. Zed reads the host list from `extension.toml`, so brand-new language names need a refreshed manifest and a Zed restart.

From a source checkout with `npm ci --prefix server --ignore-scripts` completed, update the dev extension's manifest with the language extensions you have installed.

```powershell
$installed = Join-Path $env:LOCALAPPDATA 'Zed\extensions\installed'
node server/update-manifest.mjs --installed $installed
```

For a prebuilt install, run the same updater from the companion's work directory after the companion has started at least once. Quit Zed before updating its installed manifest.

```powershell
$data = Join-Path $env:LOCALAPPDATA 'Zed\extensions'
$installed = Join-Path $data 'installed'
$updater = Join-Path $data 'work\embedded-languages-lsp\update-manifest.mjs'
$manifest = Join-Path $installed 'embedded-languages-lsp\extension.toml'
node $updater --installed $installed --manifest $manifest
```

Maintainers can refresh the published catalog with `pwsh -File scripts/update-language-registry.ps1`. It checks the [official registry](https://github.com/zed-industries/extensions/blob/main/extensions.toml) and reads language metadata from the marketplace archives. The audit is written to `.tmp/zed-language-registry/audit.json`. For a grammar with unusual string node names, set `initialization_options.hosts.<languageId>.stringNodes` to an array of node names.

## How it works

Zed starts a companion language server for the host buffer. Tree-sitter finds string literal ranges, and the server parses likely snippets and sends LSP semantic tokens in the host's coordinates. Template interpolation remains highlighted as host code. Zed combines those tokens with its regular syntax highlighting. The JSON captures follow [Zed's native JSON query](https://github.com/zed-industries/zed/blob/e8bc16acee5ae1937600d571d441c4b5d7b0d288/crates/grammars/src/json/highlights.scm).

The regular expressions identify likely target languages, literal delimiters, and formatting placeholders. The target parser and its highlight query determine the token ranges. Zed's extension API starts this companion process, but provides no way for it to send a virtual document to another installed language server or fetch that server's tokens. [Zed extension API](https://github.com/zed-industries/zed/blob/main/crates/extension_api/src/extension_api.rs) · [Embedded language-server discussion](https://github.com/zed-industries/zed/discussions/60178)

String assembly follows the syntax tree. It groups adjacent literal expressions and recognized assignments in a single block, then maps the combined snippet's tokens back to their original literals. Calls, intervening statements, and branch boundaries stop an assignment chain. Detection can leave incomplete or ambiguous snippets plain. Installed grammars and queries need to load in the companion's Tree-sitter runtime.

## Verify from source

```powershell
npm ci --prefix server --ignore-scripts
$env:ZED_TEST_EXTENSIONS_DIR = Join-Path $env:LOCALAPPDATA 'Zed\extensions\installed'
node --test tests/*.test.mjs
cargo build --locked --release --target wasm32-wasip2
```

Tests for individual installed grammars skip when those grammars are absent.
