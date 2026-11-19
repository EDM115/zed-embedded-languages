import { join } from "node:path";
import { builtInGrammars, installedLanguages, loadTarget, makeParser } from "./grammars.mjs";
import { assembleRegions, braceFormatHoles } from "./strings.mjs";

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
  /^(?:select\s+(?:(?:[\d*'"]|distinct\b)|[\s\S]+?\bfrom\s+\S)|with\s+[\w"]+\s*(?:\([^)]*\)\s*)?as\s*\(|(?:insert|replace)\s+into\s|update\s+\S+\s+set\s|delete\s+from\s|(?:create|drop|alter|truncate)\s+(?:(?:or\s+replace|temporary|temp)\s+)?(?:table|view|database|schema|index|function|trigger|type)\b)/i;
const detectors = [
  ["sql", sqlSignature],
  ["json", /^(?:\{\s*"[^"]+"[\s\S]*\}|\[\s*(?:[{"\d-]|true\b|false\b|null\b)[\s\S]*\])$/],
  ["xml", /^<\?xml\s+version=/i],
  [
    "html",
    /^<(?:!doctype\s+html\b|[a-z][\w-]*(?:\s+[^<>]+)?\s*\/>|(?:br|hr|img|input|meta|link)(?:\s+[^<>]+)?>)|^<([a-z][\w-]*)\b[^<>]*>[\s\S]*<\/\1\s*>$/i,
  ],
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

  return { start, text, holes, marker };
}

function snippetText(region, target) {
  let text = region.text;

  for (const [start, end] of region.holes.toReversed()) {
    const placeholder = text
      .slice(start, end)
      .replace(/[^\r\n]/g, " ")
      .replace(/^ /, "x");
    text = text.slice(0, start) + placeholder + text.slice(end);
  }

  if (target === "sql") {
    text = text.replace(
      /%\([A-Za-z_]\w*\)[sdf]|%[sdf]\b/g,
      (value) => "?" + " ".repeat(value.length - 1),
    );
  }

  return text;
}

function tokensFor(target, region) {
  const text = snippetText(region, target.name);
  const tree = target.parser.parse(text);

  if (!tree) {
    return [];
  }

  try {
    if (!region.marker && tree.rootNode.hasError) {
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

    for (const { start: sourceStart, offset, length } of region.parts) {
      const limit = offset + length;

      for (let start = offset; start < limit;) {
        const type = colors[start];
        let end = start + 1;

        while (end < limit && colors[end] === type) {
          end++;
        }

        if (type >= 0) {
          tokens.push({
            start: sourceStart + start - offset,
            end: sourceStart + end - offset,
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
    region.parts.push({ start: part.start, offset, length: part.text.length });
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
        const candidates = region.marker
          ? [region.marker]
          : [
              ...new Set(
                [...custom, ...detectors]
                  .filter(([, signature]) => signature.test(text))
                  .map(([name]) => name)
                  .concat(
                    inventory
                      .filter((language) => language.firstLine?.test(firstLine))
                      .map((language) => language.name),
                  ),
              ),
            ];

        for (const candidate of candidates) {
          const target = await targetFor(candidate);

          if (!target) {
            continue;
          }

          const found = tokensFor(target, region);

          if (!found.length) {
            continue;
          }

          tokens.push(...found);

          return true;
        }

        if (
          region.marker ||
          candidates.length ||
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
