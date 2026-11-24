# `zed-embedded-languages` changelog

## v1.1.0

✨ feat : register Goose, Rd and Zamak as host languages  
🛠️ ci : run the test suites, build release assets on demand and check the Zed Marketplace for new host languages every week

## v1.0.0

📦 chore : Zed downloads the companion server and its dependencies as a separate versioned release asset and reuses the local installation on subsequent starts

## v0.3.0

### Changes

✨ feat : detect SQL after leading comments, recursive CTEs and simple `SELECT` expressions without `FROM`  
✨ feat : recognize nested JSON arrays, more HTML & XML fragments and distinctive SCSS, TOML, nginx, Dockerfile & PowerShell syntax  
🐛 fix : recover SQL highlighting for MariaDB's directional `TRIM` inside nested calls and `CASE` expressions and for SQLite bind parameters  
🐛 fix : handle literal ampersands and omitted end tags in HTML, XML internal DTD subsets and Dockerfiles without a final newline  
🐛 fix : decode common host escapes and Python f-string braces while mapping highlights to the original literal ranges and preserving raw strings and interpolation  
🐛 fix : require a single JSON value for automatic detection  
📚 docs : add setup, detection and troubleshooting guides with examples organized by host language  
✅ tests : cover grammar recovery, split strings with escapes, UTF-16 source ranges and ordinary text that should stay plain

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
