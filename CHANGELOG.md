# `zed-embedded-languages` changelog

## v0.2.0

### Breaking changes

💥 📦 chore : the Zed extension ID is now `embedded-languages-lsp`. Remove the 0.1.x extension before upgrading. The language server ID in Zed settings is still `embedded-languages`

### Changes

✨ feat : register host languages from Zed's published language, grammar and language server extensions. Refresh the local manifest to add hosts released after this version.  
✨ feat : reuse compatible installed Tree-sitter grammars and queries as both hosts and targets, with bundled parsers for additional common host languages  
✨ feat : parse consecutive string assignments and `+=` chains as a single snippet in supported languages, with Python `%` formatting, `.format()` and f-strings, JavaScript and TypeScript templates, Rust `format!` and Go `fmt.Sprintf`  
✨ feat : try installed grammars for code-shaped strings when language-specific detection has no match. Require clear syntax evidence from a single grammar.  
🐛 fix : use the public Node entry point in LSP SDK v11 and its exports in the stdio tests  
✅ tests : cover fragmented SQL, scope boundaries, C++ raw strings, PowerShell, SCSS detection and refreshing newly installed hosts

## v0.1.1

🐛 fix : match Zed's standalone JSON styles for embedded keys, punctuation, booleans, null and escapes  
✅ tests : check embedded highlights alongside the Python and TypeScript language servers

## v0.1.0

✨ feat : initial release with automatic SQL, JSON, HTML and XML highlights inside supported host strings  
🐛 fix : highlight a `# sql`-marked first statement in Python blocks  
✨ feat : preserve host interpolation and use compatible installed Zed grammars
