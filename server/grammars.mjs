import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { scanInstalled } from "./registry.mjs";
import { Language, Parser, Query } from "web-tree-sitter";

export const parserReady = Parser.init();

const vscodeGrammar = (name) => "@vscode/tree-sitter-wasm/wasm/tree-sitter-" + name + ".wasm";

export const builtInGrammars = {
  bash: vscodeGrammar("bash"),
  c: vscodeGrammar("cpp"),
  cpp: vscodeGrammar("cpp"),
  "c-sharp": vscodeGrammar("c-sharp"),
  css: vscodeGrammar("css"),
  ini: vscodeGrammar("ini"),
  java: vscodeGrammar("java"),
  php: vscodeGrammar("php"),
  powershell: vscodeGrammar("powershell"),
  regex: vscodeGrammar("regex"),
  ruby: vscodeGrammar("ruby"),
  python: "tree-sitter-python/tree-sitter-python.wasm",
  javascript: "tree-sitter-javascript/tree-sitter-javascript.wasm",
  javascriptreact: "tree-sitter-javascript/tree-sitter-javascript.wasm",
  typescript: "tree-sitter-typescript/tree-sitter-typescript.wasm",
  typescriptreact: "tree-sitter-typescript/tree-sitter-tsx.wasm",
  tsx: "tree-sitter-typescript/tree-sitter-tsx.wasm",
  go: "tree-sitter-go/tree-sitter-go.wasm",
  rust: "tree-sitter-rust/tree-sitter-rust.wasm",
  json: "tree-sitter-json/tree-sitter-json.wasm",
};

export async function makeParser(grammar) {
  await parserReady;
  const bytes = await readFile(grammar);
  const parser = new Parser();

  try {
    const language = await Language.load(withoutWasiLibcDependency(bytes));
    parser.setLanguage(language);

    return parser;
  } catch (error) {
    parser.delete();

    throw error;
  }
}

function readLeb(bytes, offset) {
  let value = 0;
  let factor = 1;

  while (offset < bytes.length && factor <= 2 ** 28) {
    const byte = bytes[offset++];
    value += (byte & 127) * factor;

    if (byte < 128) {
      return [value, offset];
    }

    factor *= 128;
  }

  throw new Error("Invalid WASM section length");
}

function encodeLeb(value) {
  const bytes = [];

  do {
    const byte = value % 128;
    value = Math.floor(value / 128);
    bytes.push(byte | (value ? 128 : 0));
  } while (value);

  return Buffer.from(bytes);
}

function withoutWasiLibcDependency(bytes) {
  // Zed's WASI grammars can name libc.so, Emscripten resolves the supported C symbols from its main module
  const [size, start] = readLeb(bytes, 9);
  const end = start + size;
  const name = Buffer.from([8, ...Buffer.from("dylink.0")]);

  if (
    bytes[8] !== 0 ||
    end > bytes.length ||
    !bytes.subarray(start, start + name.length).equals(name)
  ) {
    return bytes;
  }

  const libc = Buffer.from([1, 7, ...Buffer.from("libc.so")]);
  let cursor = start + name.length;

  while (cursor < end) {
    const [length, data] = readLeb(bytes, cursor + 1);
    const next = data + length;

    if (next > end) {
      return bytes;
    }

    if (bytes[cursor] === 2 && bytes.subarray(data, next).equals(libc)) {
      return Buffer.concat([
        bytes.subarray(0, 9),
        encodeLeb(size - (next - cursor)),
        bytes.subarray(start, cursor),
        bytes.subarray(next),
      ]);
    }

    cursor = next;
  }

  return bytes;
}

export async function installedLanguages(directory) {
  const languages = new Map();
  const { configs, grammars } = await scanInstalled(directory);
  const aliases = [];

  for (const { config, langDir, grammar: ownedGrammar } of configs) {
    const packagedGrammar = builtInGrammars[config.grammar];
    const grammar =
      ownedGrammar ??
      grammars.get(config.grammar) ??
      (typeof packagedGrammar === "string"
        ? join(import.meta.dirname, "node_modules", packagedGrammar)
        : undefined);

    if (!grammar) {
      continue;
    }

    const name = config.name.toLowerCase();
    const language = { name, grammar, highlights: join(langDir, "highlights.scm") };

    if (typeof config.first_line_pattern === "string") {
      try {
        const ignoreCase = config.first_line_pattern.startsWith("(?i)");
        language.firstLine = new RegExp(
          ignoreCase ? config.first_line_pattern.slice(4) : config.first_line_pattern,
          ignoreCase ? "i" : "",
        );
      } catch {
        // Ignore language patterns that need Rust-regex features
      }
    }

    if (!languages.has(name)) {
      languages.set(name, language);
    }

    for (const alias of [
      config.grammar,
      ...(Array.isArray(config.path_suffixes) ? config.path_suffixes : []),
    ]) {
      if (typeof alias === "string") {
        aliases.push([alias.toLowerCase(), language]);
      }
    }
  }

  for (const [alias, language] of aliases) {
    if (!languages.has(alias)) {
      languages.set(alias, language);
    }
  }

  return languages;
}

export async function loadTarget(language) {
  const highlights = language.query ?? (await readFile(language.highlights, "utf8"));
  const parser = await makeParser(language.grammar);

  try {
    const query = new Query(parser.language, highlights);

    for (let index = 0; index < query.patternCount(); index++) {
      // Keep web-tree-sitter's built-in predicates and skip patterns that need Zed's custom predicates
      if (query.predicatesForPattern(index).length) {
        query.disablePattern(index);
      }
    }

    return { parser, query, name: language.name };
  } catch (error) {
    parser.delete();

    throw error;
  }
}
