import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createProtocolConnection, StreamMessageReader, StreamMessageWriter } from '../server/node_modules/vscode-languageserver/node.js';

test('the stdio server advertises semantic tokens and updates after an incremental edit', async t => {
  const entry = fileURLToPath(new URL('../server/server.mjs', import.meta.url));
  const child = spawn(process.execPath, [entry, '--stdio'], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  const conn = createProtocolConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
  t.after(() => {
    conn.dispose();
    child.kill();
  });

  conn.listen();
  const initialized = await conn.sendRequest('initialize', { processId: process.pid, rootUri: null, capabilities: {} });
  await conn.sendNotification('initialized', {});
  const numberType = initialized.capabilities.semanticTokensProvider.legend.tokenTypes.indexOf('number');
  assert(numberType >= 0);
  const jsonModifier = initialized.capabilities.semanticTokensProvider.legend.tokenModifiers.indexOf('embeddedJson');
  assert(jsonModifier >= 0);
  const uri = 'file:///fixture.py';
  const text = 'label = "🌈"; payload = \'{"id": 12}\'';
  await conn.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'python', version: 1, text } });
  const first = await conn.sendRequest('textDocument/semanticTokens/full', { textDocument: { uri } });
  const actual = [];
  let column = 0;
  for (let i = 0; i < first.data.length; i += 5) {
    const [line, delta, length, type, modifiers] = first.data.slice(i, i + 5);
    assert.equal(line, 0);
    column += delta;
    actual.push({ column, length, type, modifiers });
  }
  assert(actual.some(t => t.column === text.indexOf('12') && t.length === 2 && t.type === numberType));
  assert(actual.every(t => t.modifiers === 1 << jsonModifier));

  await conn.sendNotification('textDocument/didChange', {
    textDocument: { uri, version: 2 },
    contentChanges: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: text.length } }, text: 'payload = "ordinary prose"' }],
  });
  assert.deepEqual((await conn.sendRequest('textDocument/semanticTokens/full', { textDocument: { uri } })).data, []);
  await conn.sendRequest('shutdown');
  await conn.sendNotification('exit');
});
