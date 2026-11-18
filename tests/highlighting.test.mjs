import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { createHighlighter, tokenTypes } from '../server/highlight.mjs';

const extensions = process.env.ZED_TEST_EXTENSIONS_DIR;
const highlighter = await createHighlighter(extensions);
const hasGrammar = name => extensions && existsSync(join(extensions, name, 'grammars', name + '.wasm'));

async function highlights(language, source, instance = highlighter) {
  return (await instance.highlight(language, source)).map(({ start, end, type, target }) => ({
    text: source.slice(start, end),
    start,
    type: tokenTypes[type],
    target,
  }));
}

test('detects structured JSON with UTF-16 offsets and leaves prose alone', async () => {
  const source = 'title = "A 🌈"\r\npayload = \'{"emoji": "🌈", "count": 123}\'\r\nhelp = """Select a file from your computer."""';
  const tokens = await highlights('python', source);
  assert(tokens.length > 0);
  assert(tokens.every(token => token.target === 'json'));
  assert(tokens.some(token => token.text === '123' && token.start === source.indexOf('123')));
  assert((await highlights('python', '"""{"this": "is a docstring"}"""')).length === 0);
});

test('ignores SQL if its Zed grammar is unavailable', async () => {
  const empty = await createHighlighter('does-not-exist');
  assert.deepEqual(await highlights('python', 'query = "SELECT id FROM users"', empty), []);
});

test('gives embedded JSON the same classifications as standalone JSON', async () => {
  const source = "payload = r'{\"key\": [\"a\\nb\", true, null, 2]}'";
  const tokens = await highlights('python', source);
  for (const [text, type] of [['"key"', 'property'], ['{', 'variable'], [':', 'operator'], ['[', 'variable'], ['true', 'keyword'], ['null', 'enumMember'], ['2', 'number'], ['\\n', 'regexp'], [']}', 'variable']]) {
    assert(tokens.some(token => token.text === text && token.type === type), text + ' should be ' + type);
  }
  const rawTokens = await highlighter.highlight('python', source);
  assert(rawTokens.every(token => token.modifiers === 1));
});

test('honors SQL markers in the first statement of a block', { skip: !hasGrammar('sql') }, async () => {
  const source = [
    '# sql', 'top = "SELECT top_column"',
    'if ready:', '    # SQL', '    first = "SELECT first_column"',
    'else:', '    #sql', '    second = "SELECT second_column"',
    'class Queries:', '    # sql', '    third = "SELECT third_column"',
    'def query():', '    # sql', '    fourth = "SELECT fourth_column"',
    '    pass', '    # sql', '    later = "SELECT later_column"',
    'call( # sql', '    "SELECT call_column",', '    "ordinary string",', ')',
  ].join('\n');
  const tokens = await highlights('python', source);
  for (const column of ['top', 'first', 'second', 'third', 'fourth', 'later', 'call']) {
    assert(tokens.some(token => token.text === column + '_column' && token.target === 'sql'), column);
  }
  assert(tokens.every(token => !token.text.includes('ordinary')));
});

test('detects uncommented SQL, including placeholders, and preserves interpolation', { skip: !hasGrammar('sql') }, async () => {
  const source = [
    'if ready:', '    q = f"SELECT {field} FROM users WHERE id = %(id)s"',
    'message = "Select a file from your computer."',
    'comment = "# sql"', 'ordinary = "hello"',
  ].join('\n');
  const tokens = await highlights('python', source);
  assert(tokens.some(token => token.text === 'SELECT' && token.type === 'keyword'));
  assert(tokens.some(token => token.text === 'users'));
  assert(tokens.every(token => token.start < source.indexOf('message')));
  assert(tokens.every(token => !/[{}]|field/.test(token.text)));
});

test('works across host languages', { skip: !hasGrammar('sql') }, async () => {
  for (const [language, source] of [
    ['javascript', 'const q = \`SELECT id FROM users WHERE id = \${id}\`;'],
    ['typescript', 'const q: string = \`SELECT id FROM users\`;'],
    ['typescriptreact', 'const q: string = \`SELECT id FROM users\`;'],
    ['go', 'package example\nvar q = \`SELECT id FROM users\`'],
    ['rust', 'fn main() { let q = r#"SELECT id FROM users"#; }'],
  ]) {
    assert((await highlights(language, source)).some(t => t.text === 'SELECT' && t.target === 'sql'), language);
  }
});

test('uses an installed grammar as a host', { skip: !(hasGrammar('sql') && hasGrammar('toml')) }, async () => {
  const tokens = await highlights('toml', 'query = "SELECT id FROM users"');
  assert(tokens.some(t => t.text === 'SELECT' && t.target === 'sql'));
});

test('detects HTML via the installed HTML extension', { skip: !hasGrammar('html') }, async () => {
  const tokens = await highlights('python', 'page = "<h1>Hello</h1>"');
  assert(tokens.some(t => t.text === 'h1' && t.target === 'html'));
});

test('prioritizes a configured detector for an installed target', { skip: !hasGrammar('xml') }, async () => {
  const source = 'config = \'<configuration id="nightly" />\'';
  const instance = await createHighlighter(extensions, {
    autoDetect: [{ language: 'xml', pattern: '^<configuration\\b' }],
  });
  const tokens = await highlights('python', source, instance);
  assert(tokens.some(t => t.text === 'configuration' && t.target === 'xml'));
});
