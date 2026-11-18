import { join } from 'node:path';
import { builtInGrammars, installedLanguages, loadTarget, makeParser } from './grammars.mjs';

const grammarPath = name => join(import.meta.dirname, 'node_modules', builtInGrammars[name]);

const hostStrings = {
  python: ['string'],
  javascript: ['string', 'template_string'],
  typescript: ['string', 'template_string'],
  typescriptreact: ['string', 'template_string'],
  go: ['interpreted_string_literal', 'raw_string_literal'],
  rust: ['string_literal', 'raw_string_literal'],
};
const commonStringNodes = [...new Set(Object.values(hostStrings).flat())];
const jsonQuery = `
  (comment) @comment
  (string) @string
  (escape_sequence) @string.escape
  (pair key: (string) @property.json_key)
  (number) @number
  [(true) (false)] @boolean
  (null) @constant.builtin
  ["," ":"] @punctuation.delimiter
  ["{" "}" "[" "]"] @punctuation.bracket
`;
const sqlSignature = /^(?:select\s+(?:(?:[\d*'"]|distinct\b)|[\s\S]+?\bfrom\s+\S)|with\s+[\w"]+\s*(?:\([^)]*\)\s*)?as\s*\(|(?:insert|replace)\s+into\s|update\s+\S+\s+set\s|delete\s+from\s|(?:create|drop|alter|truncate)\s+(?:(?:or\s+replace|temporary|temp)\s+)?(?:table|view|database|schema|index|function|trigger|type)\b)/i;
const detectors = [
  ['sql', sqlSignature],
  ['json', /^(?:\{\s*"[^"]+"[\s\S]*\}|\[\s*(?:[{"\d-]|true\b|false\b|null\b)[\s\S]*\])$/],
  ['xml', /^<\?xml\s+version=/i],
  ['html', /^<(?:!doctype\s+html\b|[a-z][\w-]*(?:\s+[^<>]+)?\s*\/>|(?:br|hr|img|input|meta|link)(?:\s+[^<>]+)?>)|^<([a-z][\w-]*)\b[^<>]*>[\s\S]*<\/\1\s*>$/i],
];

const captureTypes = {
  attribute: 'property', boolean: 'enumMember', character: 'string', comment: 'comment',
  constant: 'enumMember', constructor: 'type', embedded: 'string', escape: 'regexp', function: 'function',
  keyword: 'keyword', label: 'parameter', method: 'method', module: 'namespace', namespace: 'namespace',
  number: 'number', operator: 'operator', parameter: 'parameter', property: 'property',
  punctuation: 'operator', string: 'string', tag: 'type', type: 'type', variable: 'variable',
};
export const tokenTypes = [...new Set(Object.values(captureTypes))];
export const tokenModifiers = ['embeddedJson'];
const jsonCaptureTypes = {
  'property.json_key': 'property',
  'string.escape': 'regexp',
  boolean: 'keyword',
  'constant.builtin': 'enumMember',
  'punctuation.delimiter': 'operator',
  'punctuation.bracket': 'variable',
};

function pythonMarker(node, source) {
  let carrier = node;
  if (node.parent?.type === 'assignment' && node.parent.childForFieldName('right')?.equals(node)) {
    carrier = node.parent.parent;
  } else if (node.parent?.type !== 'argument_list') {
    return undefined;
  }
  if (!carrier) return undefined;

  let comment = carrier.previousNamedSibling;
  if (!comment && carrier.parent?.type === 'block') comment = carrier.parent.previousNamedSibling;
  if (comment?.type !== 'comment' || source.slice(comment.endIndex, carrier.startIndex).trim()) return undefined;
  if (carrier.type === 'expression_statement' && comment.startPosition.column !== carrier.startPosition.column) return undefined;
  const value = comment.text.match(/^#[ \t]*(?:language[ \t]*=[ \t]*)?([\w.+-]+)[ \t]*$/i)?.[1];
  // Preserve ordinary comments such as "# TODO" while accepting the documented short SQL marker
  return value && (value.toLowerCase() === 'sql' || /language[ \t]*=/i.test(comment.text)) ? value.toLowerCase() : undefined;
}

function stringRegion(node, source, host) {
  const raw = node.text;
  const delimiter = /^(?:[rbuf]{0,2})("""|'''|"|'|\x60)/i.exec(raw);
  const rustRaw = /^(?:b|c)?r(#{0,255})"/.exec(raw);
  const open = rustRaw?.[0] ?? delimiter?.[0];
  const close = rustRaw ? '"' + rustRaw[1] : delimiter?.[1];
  if (!open || !raw.endsWith(close) || raw.length <= open.length + close.length) return undefined;
  const start = node.startIndex + open.length;
  const end = node.endIndex - close.length;
  if (end - start > 32768) return undefined;
  const marker = host === 'python' ? pythonMarker(node, source) : undefined;
  if (!marker && host === 'python' && node.parent?.type === 'expression_statement') return undefined;
  const holes = node.namedChildren
    .filter(child => child.type === 'interpolation' || child.type === 'template_substitution')
    .map(child => [child.startIndex - start, child.endIndex - start]);
  return { start, text: source.slice(start, end), holes, marker };
}

function snippetText(region, target) {
  let text = region.text;
  for (const [start, end] of region.holes.toReversed()) {
    const placeholder = text.slice(start, end).replace(/[^\r\n]/g, ' ').replace(/^ /, 'x');
    text = text.slice(0, start) + placeholder + text.slice(end);
  }
  if (target === 'sql') {
    text = text.replace(/%\([A-Za-z_]\w*\)[sdf]|%[sdf]\b/g, value => '?' + ' '.repeat(value.length - 1));
  }
  return text;
}

function tokensFor(target, region) {
  const text = snippetText(region, target.name);
  const tree = target.parser.parse(text);
  if (!tree) return [];
  try {
    if (!region.marker && tree.rootNode.hasError) return [];

    const colors = new Int16Array(text.length).fill(-1);
    const captures = target.query.captures(tree.rootNode)
      .sort((a, b) => (b.node.endIndex - b.node.startIndex) - (a.node.endIndex - a.node.startIndex));
    for (const { name, node } of captures) {
      const jsonType = target.name === 'json' ? jsonCaptureTypes[name] : undefined;
      const token = tokenTypes.indexOf(jsonType ?? captureTypes[name.split('.')[0]]);
      if (token >= 0) colors.fill(token, node.startIndex, node.endIndex);
    }
    for (const [start, end] of region.holes) colors.fill(-1, start, end);
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\r' || text[i] === '\n') colors[i] = -1;
    }
    const tokens = [];
    const modifiers = target.name === 'json' ? 1 : 0;
    for (let start = 0; start < text.length;) {
      const type = colors[start];
      let end = start + 1;
      while (end < text.length && colors[end] === type) end++;
      if (type >= 0) tokens.push({ start: region.start + start, end: region.start + end, type, modifiers, target: target.name });
      start = end;
    }
    return tokens;
  } finally {
    tree.delete();
  }
}

export async function createHighlighter(extensionsDirectory, options = {}, log = () => {}) {
  const languages = await installedLanguages(extensionsDirectory ?? '');
  languages.set('json', { name: 'json', grammar: grammarPath('json'), query: jsonQuery });
  const targets = new Map();
  const hosts = new Map();
  const custom = [];
  for (const rule of Array.isArray(options.autoDetect) ? options.autoDetect : []) {
    if (typeof rule?.language !== 'string' || typeof rule.pattern !== 'string') continue;
    try {
      custom.push([rule.language.toLowerCase(), new RegExp(rule.pattern, rule.ignoreCase ? 'i' : '')]);
    } catch (error) {
      log(error.message);
    }
  }

  function targetFor(name) {
    const language = languages.get(name);
    if (!language) return undefined;
    if (!targets.has(language)) {
      targets.set(language, loadTarget(language).catch(error => {
        log('Cannot load Zed highlighting for ' + language.name + ': ' + error.message);
        return undefined;
      }));
    }
    return targets.get(language);
  }

  return {
    async highlight(host, source) {
      if (source.length > 1000000) return [];
      const builtInHost = Object.hasOwn(hostStrings, host);
      const grammar = builtInHost ? grammarPath(host) : languages.get(host)?.grammar;
      if (!grammar) return [];
      const configuredNodes = options.hosts?.[host]?.stringNodes;
      const stringNodes = builtInHost ? hostStrings[host] : Array.isArray(configuredNodes)
        ? configuredNodes.filter(node => typeof node === 'string')
        : commonStringNodes;
      if (!hosts.has(host)) {
        hosts.set(host, makeParser(grammar).catch(error => {
          log('Cannot load host grammar for ' + host + ': ' + error.message);
          return undefined;
        }));
      }
      const parser = await hosts.get(host);
      if (!parser) return [];
      const tree = parser.parse(source);
      if (!tree) return [];
      let regions;
      try {
        regions = tree.rootNode.descendantsOfType(stringNodes)
          .map(node => stringRegion(node, source, host)).filter(Boolean);
      } finally {
        tree.delete();
      }

      const tokens = [];
      for (const region of regions) {
        const text = snippetText(region).trim();
        const candidates = region.marker ? [region.marker] : [...custom, ...detectors]
          .filter(([_, signature]) => signature.test(text)).map(([name]) => name);
        for (const candidate of candidates) {
          const target = await targetFor(candidate);
          if (!target) continue;
          const found = tokensFor(target, region);
          if (!found.length) continue;
          tokens.push(...found);
          break;
        }
      }
      return tokens.sort((a, b) => a.start - b.start);
    },
  };
}
