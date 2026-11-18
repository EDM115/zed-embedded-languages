import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { Language, Parser, Query } from 'web-tree-sitter';

export const parserReady = Parser.init();

export const builtInGrammars = {
  python: 'tree-sitter-python/tree-sitter-python.wasm',
  javascript: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
  typescript: 'tree-sitter-typescript/tree-sitter-typescript.wasm',
  typescriptreact: 'tree-sitter-typescript/tree-sitter-tsx.wasm',
  go: 'tree-sitter-go/tree-sitter-go.wasm',
  rust: 'tree-sitter-rust/tree-sitter-rust.wasm',
  json: 'tree-sitter-json/tree-sitter-json.wasm',
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
    if (byte < 128) return [value, offset];
    factor *= 128;
  }
  throw new Error('Invalid WASM section length');
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
  // Zed's WASI grammars can name libc.so. Emscripten resolves the supported C symbols from its main module
  const [size, start] = readLeb(bytes, 9);
  const end = start + size;
  const name = Buffer.from([8, ...Buffer.from('dylink.0')]);
  if (bytes[8] !== 0 || end > bytes.length || !bytes.subarray(start, start + name.length).equals(name)) return bytes;

  const libc = Buffer.from([1, 7, ...Buffer.from('libc.so')]);
  let cursor = start + name.length;
  while (cursor < end) {
    const [length, data] = readLeb(bytes, cursor + 1);
    const next = data + length;
    if (next > end) return bytes;
    if (bytes[cursor] === 2 && bytes.subarray(data, next).equals(libc)) {
      return Buffer.concat([bytes.subarray(0, 9), encodeLeb(size - (next - cursor)), bytes.subarray(start, cursor), bytes.subarray(next)]);
    }
    cursor = next;
  }
  return bytes;
}

async function entries(directory) {
  return readdir(directory, { withFileTypes: true }).catch(() => []);
}

export async function installedLanguages(directory) {
  const languages = new Map();
  function register(language, names) {
    for (const name of names) {
      const key = name.toLowerCase();
      if (!languages.has(key)) languages.set(key, language);
    }
  }

  const extensions = (await entries(directory)).sort((a, b) => a.name.localeCompare(b.name));
  for (const extension of extensions) {
    const root = join(directory, extension.name);
    const folders = (await entries(join(root, 'languages'))).sort((a, b) => a.name.localeCompare(b.name));
    for (const folder of folders) {
      try {
        const langDir = join(root, 'languages', folder.name);
        const config = parse(await readFile(join(langDir, 'config.toml'), 'utf8'));
        if (config.hidden || typeof config.name !== 'string' || typeof config.grammar !== 'string') continue;
        if (!/^[\w-]+$/.test(config.grammar)) continue;
        const language = {
          name: config.name.toLowerCase(),
          grammar: join(root, 'grammars', config.grammar + '.wasm'),
          highlights: join(langDir, 'highlights.scm'),
        };
        register(language, [config.name]);
        register(language, [config.grammar, ...(config.path_suffixes ?? []).filter(name => typeof name === 'string')]);
      } catch {
        // An extension may have no usable language definition
      }
    }
  }
  return languages;
}

export async function loadTarget(language) {
  const highlights = language.query ?? await readFile(language.highlights, 'utf8');
  const parser = await makeParser(language.grammar);
  try {
    const query = new Query(parser.language, highlights);
    for (let index = 0; index < query.patternCount(); index++) {
      // Keep web-tree-sitter's built-in predicates and skip patterns that need Zed's custom predicates
      if (query.predicatesForPattern(index).length) query.disablePattern(index);
    }
    return { parser, query, name: language.name };
  } catch (error) {
    parser.delete();
    throw error;
  }
}
