import { join } from "node:path";
import { builtInGrammars, installedLanguages, loadTarget, makeParser } from "./grammars.mjs";
import { assembleRegions, braceFormatHoles, decodeStringEscapes } from "./strings.mjs";

const grammarPath = (name) => join(import.meta.dirname, "node_modules", builtInGrammars[name]);

const hostStrings = {
  python: ["string"],
  javascript: ["string", "template_string"],
  javascriptreact: ["string", "template_string"],
  typescript: ["string", "template_string"],
  typescriptreact: ["string", "template_string"],
  go: ["interpreted_string_literal", "raw_string_literal"],
  rust: ["string_literal", "raw_string_literal"],
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
const sqlSignature =
  /^(?:(?:--[^\r\n]*(?:\r\n?|\n)|\/\*[\s\S]*?\*\/)\s*)*(?:select\s+(?=\S)(?:[\d*'"]|distinct\b|current_(?:date|time|timestamp|user)\b|[a-z_]\w*\s*\(|[\s\S]+?\bfrom\s+\S)|with\s+(?:recursive\s+)?[\w"]+\s*(?:\([^)]*\)\s*)?as\s*\(|(?:insert|replace)\s+into\s|update\s+\S+\s+set\s|delete\s+from\s|(?:create|drop|alter|truncate)\s+(?:(?:or\s+replace|temporary|temp)\s+)?(?:table|view|database|schema|index|function|trigger|type)\b)/i;
const sqlParameter =
  /--[^\r\n]*|\/\*[\s\S]*?\*\/|(['"\x60])(?:\1\1|\\[\s\S]|(?!\1)[^\\])*\1|\$(\w*)\$[\s\S]*?\$\2\$|::|(%\([a-z_]\w*\)[sdf]|%[sdf]\b|\?\d+\b|(?<![\w$])[:$][a-z_]\w*)/gi;
const htmlVoidTags = /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;
const htmlOptionalEndTags =
  /^(?:colgroup|dd|dt|li|optgroup|option|p|rp|rt|tbody|td|tfoot|th|thead|tr)$/i;
const detectors = [
  ["sql", sqlSignature],
  ["json", /^(?:\{\s*"[\s\S]*\}|\[\s*(?:[["{\d-]|true\b|false\b|null\b)[\s\S]*\])$/],
  [
    "xml",
    /^(?:<!--[\s\S]*?-->\s*)*(?:<\?[a-z_][\w.:-]*(?=[\s?])|<!DOCTYPE\s+(?!html\b)[a-z_:]|<[a-z_][\w.-]*:[\w.-]+(?=[\s/>])|<[a-z_][\w.:-]*(?=[\s/>])[\s\S]*<!\[CDATA\[)/i,
  ],
  ["html", /^(?:<[a-z][\w:-]*(?=[\s/>])|<!--|<!doctype\s+html\b)/i, hasHtmlStructure],
  [
    "scss",
    /^(?:\$[a-z_-][\w-]*\s*:[^;]+;|(?=[\s\S]*\}$)[^{}\r\n]+\{[\s\S]*(?:&[.#:\[]|:\s*\$[a-z_-][\w-]*))/i,
  ],
  ["toml", /^(?:#[^\r\n]*\r?\n\s*)*\[\[[^\r\n]+?\]\][ \t]*(?:#[^\r\n]*)?\r?\n\s*["'\w-][^=\r\n]*=/],
  [
    "nginx",
    /^(?:(?:server|http|events|stream)\s*|(?:location|upstream)[ \t]+[^\s{}][^{}\r\n]*)(?=\{)[\s\S]*?[{;]\s*(?:listen|server_name|proxy_pass|root|worker_connections)[ \t]+[^\s;{}][^;{}\r\n]*;/,
  ],
  [
    "dockerfile",
    /^(?:(?:#|arg[ \t]+)[^\r\n]*\r?\n\s*)*from[ \t]+\S[^\r\n]*\r?\n(?:[ \t]*(?:#[^\r\n]*)?\r?\n)*[ \t]*(?:add|arg|cmd|copy|entrypoint|env|expose|from|healthcheck|label|onbuild|run|shell|stopsignal|user|volume|workdir)[ \t]+\S/i,
  ],
  ["powershell", /^(?:#[^\r\n]*\r?\n\s*)*param\s*\(\s*(?:\[[^\]\r\n]+\]\s*)?\$[a-z_]\w*/i],
];

const captureTypes = {
  attribute: "property",
  boolean: "enumMember",
  character: "string",
  class: "type",
  comment: "comment",
  constant: "enumMember",
  constructor: "type",
  embedded: "string",
  escape: "regexp",
  function: "function",
  keyword: "keyword",
  label: "parameter",
  method: "method",
  module: "namespace",
  namespace: "namespace",
  number: "number",
  operator: "operator",
  parameter: "parameter",
  property: "property",
  punctuation: "operator",
  string: "string",
  tag: "type",
  type: "type",
  variable: "variable",
};
export const tokenTypes = [...new Set(Object.values(captureTypes))];
export const tokenModifiers = ["embeddedJson"];
const jsonCaptureTypes = {
  "property.json_key": "property",
  "string.escape": "regexp",
  boolean: "keyword",
  "constant.builtin": "enumMember",
  "punctuation.delimiter": "operator",
  "punctuation.bracket": "variable",
};

function pythonMarker(node, source) {
  let carrier = node;

  while (
    ["binary_operator", "concatenated_string", "parenthesized_expression"].includes(
      carrier.parent?.type,
    ) &&
    carrier.parent.firstNamedChild?.equals(carrier)
  ) {
    carrier = carrier.parent;
  }

  const attribute = carrier.parent;

  if (
    attribute?.type === "attribute" &&
    attribute.childForFieldName("object")?.equals(carrier) &&
    attribute.childForFieldName("attribute")?.text === "format" &&
    attribute.parent?.type === "call" &&
    attribute.parent.childForFieldName("function")?.equals(attribute)
  ) {
    carrier = attribute.parent;
  }

  if (
    carrier.parent?.type === "assignment" &&
    carrier.parent.childForFieldName("right")?.equals(carrier)
  ) {
    carrier = carrier.parent.parent;
  } else if (carrier.parent?.type !== "argument_list") {
    return undefined;
  }

  if (!carrier) {
    return undefined;
  }

  let comment = carrier.previousNamedSibling;

  if (!comment && carrier.parent?.type === "block") {
    comment = carrier.parent.previousNamedSibling;
  }

  if (comment?.type !== "comment" || source.slice(comment.endIndex, carrier.startIndex).trim()) {
    return undefined;
  }

  if (
    carrier.type === "expression_statement" &&
    comment.startPosition.column !== carrier.startPosition.column
  ) {
    return undefined;
  }

  const value = comment.text.match(/^#[ \t]*(?:language[ \t]*=[ \t]*)?([\w.+-]+)[ \t]*$/i)?.[1];

  // Preserve ordinary comments such as "# TODO" while accepting the documented short SQL marker
  return value && (value.toLowerCase() === "sql" || /language[ \t]*=/i.test(comment.text))
    ? value.toLowerCase()
    : undefined;
}

function explicitMarker(node, source) {
  const line = source.lastIndexOf("\n", node.startIndex - 1);

  if (line < 0) {
    return undefined;
  }

  const previousStart = line ? source.lastIndexOf("\n", line - 1) + 1 : 0;
  const previous = source.slice(previousStart, line).trim();

  return /^(?:#|\/\/|--|;|\/\*|<!--)\s*language\s*=\s*([\w.+ -]+?)\s*(?:\*\/|-->)?$/i
    .exec(previous)?.[1]
    .toLowerCase();
}

function stringRegion(node, source, host) {
  const raw = node.text;
  const delimiter = /^(?:u8|[rbufwld]{0,2}|\$@?|@\$?)("""|'''|"|'|\x60)/i.exec(raw);
  const rustRaw = /^(?:b|c)?r(#{0,255})"/.exec(raw);
  const cppRaw = /^(?:u8|[uUL])?R"([^\s()\\]{0,16})\(/.exec(raw);
  const open = cppRaw?.[0] ?? rustRaw?.[0] ?? delimiter?.[0];
  const close = cppRaw ? ")" + cppRaw[1] + '"' : rustRaw ? '"' + rustRaw[1] : delimiter?.[1];

  if (!open || !raw.endsWith(close) || raw.length <= open.length + close.length) {
    return undefined;
  }

  const start = node.startIndex + open.length;
  const end = node.endIndex - close.length;

  if (end - start > 32768) {
    return undefined;
  }

  const marker =
    (host === "python" ? pythonMarker(node, source) : undefined) ?? explicitMarker(node, source);

  if (!marker && host === "python" && node.parent?.type === "expression_statement") {
    return undefined;
  }

  const text = source.slice(start, end);
  const holes = node.namedChildren
    .filter(
      (child) =>
        child.startIndex >= start &&
        child.endIndex <= end &&
        /(?:interpolation|substitution|escape_expression)$/.test(child.type),
    )
    .map((child) => [child.startIndex - start, child.endIndex - start]);

  if (!holes.length) {
    holes.push(...braceFormatHoles(node, host, text));
  }

  return { start, marker, ...decodeStringEscapes(node, host, open, start, text, holes) };
}

function snippetText(region) {
  let text = region.text;

  for (const [start, end] of region.holes.toReversed()) {
    const placeholder = text
      .slice(start, end)
      .replace(/[^\r\n]/g, " ")
      .replace(/^ /, "x");
    text = text.slice(0, start) + placeholder + text.slice(end);
  }

  return text;
}

function hasHtmlStructure(root) {
  if (root.descendantsOfType("erroneous_end_tag").length) {
    return false;
  }

  return root.namedChildren.some((child) => {
    if (
      child.type === "doctype" ||
      child.lastNamedChild?.type === "end_tag" ||
      child.firstNamedChild?.type === "self_closing_tag"
    ) {
      return true;
    }

    const tag = child.firstNamedChild?.firstNamedChild?.text;

    return (
      child.type === "element" &&
      tag &&
      (htmlVoidTags.test(tag) || (htmlOptionalEndTags.test(tag) && child.namedChildCount > 1))
    );
  });
}

function parsesCleanly(parser, text) {
  const validation = parser.parse(text);

  try {
    return validation?.rootNode.hasError === false;
  } finally {
    validation?.delete();
  }
}

function parsesWithSqlTrim(parser, root, text) {
  // Validate TRIM(... 'pad' FROM value) as a regular two-argument call, then use the original tree for highlighting
  const trim =
    /(trim\s*\(\s*)(?:(?:both|leading|trailing)\s+)?('(?:''|\\[\s\S]|[^'\\])*')\s*from\b/iy;
  const parts = [];
  let offset = 0;

  for (const call of root.descendantsOfType("invocation")) {
    if (!call.hasError || call.startIndex < offset) {
      continue;
    }

    trim.lastIndex = call.startIndex;
    const match = trim.exec(text);

    if (match && trim.lastIndex <= call.endIndex) {
      parts.push(text.slice(offset, call.startIndex), match[1], match[2], ", ");
      offset = trim.lastIndex;
    }
  }

  if (!parts.length) {
    return false;
  }

  parts.push(text.slice(offset));

  return parsesCleanly(parser, parts.join(""));
}

function parsesWithHtmlRecovery(parser, root, text) {
  const parts = [];
  let offset = 0;

  // An ampersand followed by whitespace or a tag is ordinary text in HTML
  for (const node of root.descendantsOfType("ERROR")) {
    if (node.parent?.type !== "element" || node.startIndex < offset) {
      continue;
    }

    const original = text.slice(node.startIndex, node.endIndex);
    const plain = original.replace(/&(?=\s|<|$)/g, "x");
    if (plain !== original) {
      parts.push(text.slice(offset, node.startIndex), plain);
      offset = node.endIndex;
    }
  }

  // This grammar can require an implicit end tag at EOF even when HTML permits omission
  const last = root.lastNamedChild;
  const tag = last?.firstNamedChild?.firstNamedChild?.text;
  const endTag =
    last?.type === "element" &&
    last.hasError &&
    last.lastNamedChild?.type !== "end_tag" &&
    tag &&
    htmlOptionalEndTags.test(tag)
      ? "</" + tag + ">"
      : "";

  if (!parts.length && !endTag) {
    return false;
  }

  parts.push(text.slice(offset), endTag);

  return parsesCleanly(parser, parts.join(""));
}

function parsesWithXmlDoctypeSpacing(parser, root, text) {
  const doctype = root.descendantsOfType("doctypedecl")[0];
  const close = doctype?.children.findLast((child) => child.type === "]");

  // The XML grammar can require whitespace before the end of an internal DTD subset
  return (
    doctype?.hasError &&
    close &&
    parsesCleanly(parser, text.slice(0, close.startIndex) + " " + text.slice(close.startIndex))
  );
}

function acceptsAutomaticParse(target, root, text) {
  if (!root.hasError) {
    // The JSON grammar accepts multiple top-level values, but a single payload has just one
    return (
      target.name !== "json" ||
      root.namedChildren.filter((node) => node.type !== "comment").length === 1
    );
  }

  switch (target.name) {
    case "sql":
      return parsesWithSqlTrim(target.parser, root, text);
    case "html":
      return parsesWithHtmlRecovery(target.parser, root, text);
    case "xml":
      return parsesWithXmlDoctypeSpacing(target.parser, root, text);
    default:
      return false;
  }
}

function tokensFor(target, region, evidence) {
  let text = snippetText(region);

  // The Dockerfile grammar expects a line ending after the final instruction
  if (target.name === "dockerfile" && !text.endsWith("\n")) {
    text += "\n";
  }

  let tree = target.parser.parse(text);

  if (!tree) {
    return [];
  }

  try {
    if (target.name === "sql" && tree.rootNode.hasError) {
      // Only retry unsupported binds and format placeholders, skipping quotes, comments, and casts
      const normalized = text.replace(sqlParameter, (value, _quote, _dollarTag, parameter) =>
        parameter ? "?" + " ".repeat(value.length - 1) : value,
      );
      const retried = normalized !== text ? target.parser.parse(normalized) : undefined;
      if (retried) {
        tree.delete();
        tree = retried;
        text = normalized;
      }
    }

    if (!region.marker && !acceptsAutomaticParse(target, tree.rootNode, text)) {
      return [];
    }

    if (evidence && !evidence(tree.rootNode)) {
      return [];
    }

    const colors = new Int16Array(text.length).fill(-1);
    const captures = target.query
      .captures(tree.rootNode)
      .sort((a, b) => b.node.endIndex - b.node.startIndex - (a.node.endIndex - a.node.startIndex));

    for (const { name, node } of captures) {
      const jsonType = target.name === "json" ? jsonCaptureTypes[name] : undefined;
      const token = tokenTypes.indexOf(jsonType ?? captureTypes[name.split(".")[0]]);

      if (token >= 0) {
        colors.fill(token, node.startIndex, node.endIndex);
      }
    }

    for (const [start, end] of region.holes) {
      colors.fill(-1, start, end);
    }

    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\r" || text[i] === "\n") {
        colors[i] = -1;
      }
    }

    const tokens = [];
    const modifiers = target.name === "json" ? 1 : 0;

    for (const { start: sourceStart, offset, length, sourceOffsets } of region.parts) {
      const limit = offset + length;

      for (let start = offset; start < limit;) {
        const type = colors[start];
        let end = start + 1;

        while (end < limit && colors[end] === type) {
          end++;
        }

        if (type >= 0) {
          tokens.push({
            start: sourceStart + (sourceOffsets?.[start - offset] ?? start - offset),
            end: sourceStart + (sourceOffsets?.[end - offset] ?? end - offset),
            type,
            modifiers,
            target: target.name,
          });
        }

        start = end;
      }
    }

    return tokens;
  } finally {
    tree.delete();
  }
}

function snippetFrom(parts) {
  const region = {
    text: "",
    holes: [],
    parts: [],
    marker: parts.find((part) => part.marker)?.marker,
  };

  for (const part of parts) {
    const offset = region.text.length;
    region.parts.push({
      start: part.start,
      offset,
      length: part.text.length,
      sourceOffsets: part.sourceOffsets,
    });
    region.text += part.text;

    for (const [start, end] of part.holes) {
      region.holes.push([start + offset, end + offset]);
    }
  }

  return region;
}

export async function createHighlighter(extensionsDirectory, options = {}, log = () => {}) {
  const languages = await installedLanguages(extensionsDirectory);
  languages.set("json", { name: "json", grammar: grammarPath("json"), query: jsonQuery });
  const inventory = [...new Set(languages.values())];
  const targets = new Map();
  const hosts = new Map();
  const custom = [];

  for (const rule of Array.isArray(options.autoDetect) ? options.autoDetect : []) {
    if (typeof rule?.language !== "string" || typeof rule.pattern !== "string") {
      continue;
    }

    try {
      custom.push([
        rule.language.toLowerCase(),
        new RegExp(rule.pattern, rule.ignoreCase ? "i" : ""),
      ]);
    } catch (error) {
      log(error.message);
    }
  }

  function targetFor(name) {
    const language = languages.get(name);

    if (!language) {
      return undefined;
    }

    if (!targets.has(language)) {
      targets.set(
        language,
        loadTarget(language).catch((error) => {
          log("Cannot load Zed highlighting for " + language.name + " : " + error.message);

          return undefined;
        }),
      );
    }

    return targets.get(language);
  }

  return {
    async highlight(host, source) {
      host = host.toLowerCase();

      if (source.length > 1000000) {
        return [];
      }

      const grammar =
        languages.get(host)?.grammar ??
        (Object.hasOwn(builtInGrammars, host) ? grammarPath(host) : undefined);

      if (!grammar) {
        return [];
      }

      if (!hosts.has(host)) {
        hosts.set(
          host,
          makeParser(grammar).catch((error) => {
            log("Cannot load host grammar for " + host + " : " + error.message);

            return undefined;
          }),
        );
      }

      const parser = await hosts.get(host);

      if (!parser) {
        return [];
      }

      const configuredNodes = options.hosts?.[host]?.stringNodes;
      const inferredNodes = parser.language.types.filter(
        (name) =>
          typeof name === "string" &&
          /(?:^|_)(?:string|quoted|template)(?:_literal|_expression|_value|$)/i.test(name),
      );
      const stringNodes = Array.isArray(configuredNodes)
        ? configuredNodes.filter((node) => typeof node === "string")
        : (hostStrings[host] ?? [...new Set([...commonStringNodes, ...inferredNodes])]);

      const tree = parser.parse(source);

      if (!tree) {
        return [];
      }

      let regions;

      try {
        const literals = new Map();

        for (const node of tree.rootNode.descendantsOfType(stringNodes)) {
          const region = stringRegion(node, source, host);

          if (region) {
            literals.set(node.id, region);
          }
        }

        regions = assembleRegions(tree.rootNode, literals, host);
      } finally {
        tree.delete();
      }

      const tokens = [];
      let genericChecks = 0;

      async function inspect(parts) {
        const region = snippetFrom(parts);
        const text = snippetText(region).trim();
        const firstLine = text.split(/\r?\n/, 1)[0];
        const candidates = new Map();

        if (region.marker) {
          candidates.set(region.marker, undefined);
        } else {
          for (const [name, signature, evidence] of [...custom, ...detectors]) {
            if (!candidates.has(name) && signature.test(text)) {
              candidates.set(name, evidence);
            }
          }
          for (const language of inventory) {
            if (!candidates.has(language.name) && language.firstLine?.test(firstLine)) {
              candidates.set(language.name, undefined);
            }
          }
        }

        for (const [candidate, evidence] of candidates) {
          const target = await targetFor(candidate);

          if (!target) {
            continue;
          }

          const found = tokensFor(target, region, evidence);

          if (!found.length) {
            continue;
          }

          tokens.push(...found);

          return true;
        }

        if (
          region.marker ||
          candidates.size ||
          text.length > 4096 ||
          genericChecks >= 16 ||
          !looksLikeCode(text)
        ) {
          return false;
        }

        genericChecks++;
        let match;

        for (const language of inventory) {
          const target = await targetFor(language.name);

          if (!target) {
            continue;
          }

          const found = tokensFor(target, region);

          if (!hasSyntaxEvidence(found, source)) {
            continue;
          }

          if (match) {
            return false;
          }

          match = found;
        }

        if (match) {
          tokens.push(...match);

          return true;
        }

        return false;
      }

      for (const parts of regions) {
        if (!(await inspect(parts)) && parts.length > 1) {
          for (const part of parts) {
            await inspect([part]);
          }
        }
      }

      let lastEnd = 0;

      return tokens
        .sort((a, b) => a.start - b.start || a.end - b.end)
        .filter((token) => {
          if (token.start < lastEnd) {
            return false;
          }

          lastEnd = token.end;

          return true;
        });
    },
  };
}

function looksLikeCode(text) {
  return (
    (/[{}]/.test(text) && /[:;=]/.test(text)) ||
    (text.includes("\n") && /(?:=>|:=|=\s*["'\d]|^[\t ]*[-#][\t ]+\w+.*[\[\]{}:])/m.test(text))
  );
}

const meaningfulTypes = new Set(["keyword", "function", "property", "type", "namespace"]);

function hasSyntaxEvidence(tokens, source) {
  return (
    tokens.filter(({ type }) => meaningfulTypes.has(tokenTypes[type])).length >= 2 &&
    new Set(tokens.map(({ type }) => type)).size >= 3 &&
    tokens.some(
      ({ start, end, type }) =>
        tokenTypes[type] === "operator" && /[:=+*<>|&]/.test(source.slice(start, end)),
    )
  );
}
