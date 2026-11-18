import { isAbsolute, resolve } from 'node:path';
import { createConnection, SemanticTokensBuilder, TextDocuments, TextDocumentSyncKind } from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createHighlighter, tokenTypes } from './highlight.mjs';

const connection = createConnection();
const documents = new TextDocuments(TextDocument);
const results = new WeakMap();
let highlighter;

connection.onInitialize(async ({ initializationOptions }) => {
  const options = initializationOptions ?? {};
  const override = options.extensionsDirectory;
  const directory = typeof override === 'string' && isAbsolute(override)
    ? override
    : resolve(import.meta.dirname, '../../installed');
  highlighter = await createHighlighter(directory, options, message => connection.console.warn(message));
  return {
    capabilities: {
      positionEncoding: 'utf-16',
      textDocumentSync: TextDocumentSyncKind.Incremental,
      semanticTokensProvider: {
        legend: { tokenTypes, tokenModifiers: [] },
        full: true,
      },
    },
  };
});

connection.languages.semanticTokens.on(async ({ textDocument }) => {
  const document = documents.get(textDocument.uri);
  if (!document || !highlighter) return { data: [] };
  const cached = results.get(document);
  if (cached?.version === document.version) return cached.promise;

  const snapshot = TextDocument.create(document.uri, document.languageId, document.version, document.getText());
  const promise = buildTokens(snapshot);
  results.set(document, { version: snapshot.version, promise });
  return promise;
});

async function buildTokens(document) {
  const builder = new SemanticTokensBuilder();
  const tokens = await highlighter.highlight(document.languageId, document.getText());
  for (const { start, end, type } of tokens) {
    const { line, character } = document.positionAt(start);
    builder.push(line, character, end - start, type, 0);
  }
  return builder.build();
}

documents.listen(connection);
connection.listen();
