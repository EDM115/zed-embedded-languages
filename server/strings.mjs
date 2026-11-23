const wrappers = new Set([
  "expression_statement",
  "lexical_declaration",
  "variable_declaration",
  "var_declaration",
  "parenthesized_expression",
  "expression_list",
  "local_declaration_statement",
]);
const assignments = new Set([
  "assignment",
  "augmented_assignment",
  "assignment_expression",
  "augmented_assignment_expression",
  "variable_declarator",
  "short_var_declaration",
  "assignment_statement",
  "var_spec",
  "let_declaration",
  "compound_assignment_expr",
  "init_declarator",
  "operator_assignment",
  "variable_assignment",
]);
const binaries = new Set(["binary_operator", "binary_expression", "binary_expr"]);
const bindingNodes = new Set(["identifier", "variable_name"]);
const assignmentOperators = new Set(["=", "+=", ".=", ":="]);
const expressionOperators = new Set([...assignmentOperators, "+", ".", "%"]);
const escapedStringHosts = new Set([
  "python",
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
  "tsx",
  "go",
  "rust",
]);
const escapeValues = new Map([
  ["\\n", "\n"],
  ["\\r", "\r"],
  ["\\t", "\t"],
  ["\\\\", "\\"],
  ['\\"', '"'],
  ["\\'", "'"],
  ["{{", "{"],
  ["}}", "}"],
]);

export function decodeStringEscapes(node, host, opening, start, text, holes) {
  const parent = node.parent;
  const rawPython = host === "python" && /^[a-z]*r/i.test(opening);

  if (
    !escapedStringHosts.has(host) ||
    (node.type === "template_string" &&
      parent?.type === "call_expression" &&
      parent.childForFieldName("arguments")?.equals(node))
  ) {
    return { text, holes };
  }

  const children = node.namedChildren.flatMap((child) =>
    child.type === "string_content" ? child.namedChildren : [child],
  );
  const escapes = [];

  for (const child of children) {
    if (
      (!rawPython && child.type === "escape_sequence") ||
      (host === "python" && child.type === "escape_interpolation")
    ) {
      const value = escapeValues.get(child.text);
      if (value) {
        escapes.push({ startIndex: child.startIndex, endIndex: child.endIndex, value });
      }
    }
  }

  if (!escapes.length) {
    return { text, holes };
  }

  // Each decoded boundary maps to an offset in the original literal, including the full escape
  const sourceOffsets = [0];
  let decoded = "";
  let cursor = 0;

  for (const escape of escapes) {
    const offset = escape.startIndex - start;
    decoded += text.slice(cursor, offset) + escape.value;
    while (cursor < offset) {
      sourceOffsets.push(++cursor);
    }
    cursor = escape.endIndex - start;
    sourceOffsets.push(cursor);
  }

  decoded += text.slice(cursor);
  while (cursor < text.length) {
    sourceOffsets.push(++cursor);
  }

  let index = 0;
  const decodedHoles = holes.map(([start, end]) => {
    while (sourceOffsets[index] < start) {
      index++;
    }
    const decodedStart = index;
    while (sourceOffsets[index] < end) {
      index++;
    }

    return [decodedStart, index];
  });

  return { text: decoded, holes: decodedHoles, sourceOffsets };
}

const field = (node, ...names) => {
  for (const name of names) {
    const child = node.childForFieldName(name);

    if (child) {
      return child;
    }
  }
};

function unwrap(node) {
  while (node) {
    if (wrappers.has(node.type) && node.namedChildCount === 1) {
      node = node.firstNamedChild;
    } else if (
      ["declaration", "local_variable_declaration", "variable_declaration"].includes(node.type)
    ) {
      const declarations = node.namedChildren.filter((child) => assignments.has(child.type));

      if (declarations.length !== 1) {
        break;
      }

      node = declarations[0];
    } else {
      break;
    }
  }
  return node;
}

function operator(node) {
  return (
    field(node, "operator")?.text ??
    node.children.find((child) => !child.isNamed && expressionOperators.has(child.type))?.type
  );
}

function formatTemplate(node, host) {
  if (host === "python" && node.type === "call") {
    const call = field(node, "function");

    if (call?.type === "attribute" && field(call, "attribute")?.text === "format") {
      return field(call, "object");
    }
  }

  if (
    host === "go" &&
    node.type === "call_expression" &&
    field(node, "function")?.text === "fmt.Sprintf"
  ) {
    return field(node, "arguments")?.firstNamedChild;
  }

  if (
    host === "rust" &&
    node.type === "macro_invocation" &&
    field(node, "macro")?.text.split("::").at(-1) === "format"
  ) {
    return node.namedChildren.find((child) => child.type === "token_tree")?.firstNamedChild;
  }
}

export function braceFormatHoles(node, host, text) {
  if (host !== "python" && host !== "rust") {
    return [];
  }

  let carrier = node;

  while (
    ["concatenated_string", "parenthesized_expression", "attribute", "token_tree"].includes(
      carrier.parent?.type,
    )
  ) {
    carrier = carrier.parent;
  }

  const template = carrier.parent && formatTemplate(carrier.parent, host);

  if (!template || node.startIndex < template.startIndex || node.endIndex > template.endIndex) {
    return [];
  }

  const holes = [];

  for (let index = 0; index < text.length; index++) {
    if (text[index] !== "{") {
      continue;
    }

    if (text[index + 1] === "{") {
      index++;

      continue;
    }

    let depth = 1;
    let end = index + 1;

    while (end < text.length && depth) {
      if (text[end] === "{") {
        depth++;
      }

      if (text[end] === "}") {
        depth--;
      }

      end++;
    }

    if (depth) {
      break;
    }

    holes.push([index, end]);
    index = end - 1;
  }

  return holes;
}

function staticParts(node, regions, host, depth = 0) {
  node = unwrap(node);

  if (!node || depth > 40) {
    return [];
  }

  const literal = regions.get(node.id);

  if (literal) {
    return [literal];
  }

  const template = formatTemplate(node, host);

  if (template) {
    return staticParts(template, regions, host, depth + 1);
  }

  if (node.type === "concatenated_string") {
    const parts = node.namedChildren.map((child) => staticParts(child, regions, host, depth + 1));

    return parts.every((part) => part.length) ? parts.flat() : [];
  }

  if (binaries.has(node.type)) {
    const op = operator(node);
    const left = field(node, "left");

    if (op === "%" && host === "python") {
      return staticParts(left, regions, host, depth + 1);
    }

    if (op === "+" || (host === "php" && op === ".")) {
      const first = staticParts(left, regions, host, depth + 1);
      const last = staticParts(field(node, "right"), regions, host, depth + 1);

      return first.length && last.length ? [...first, ...last] : [];
    }
  }

  if (
    host === "rust" &&
    node.type === "call_expression" &&
    field(node, "function")?.text === "String::from"
  ) {
    const args = field(node, "arguments");

    if (args?.namedChildCount === 1) {
      return staticParts(args.firstNamedChild, regions, host, depth + 1);
    }
  }

  return [];
}

function assignmentParts(statement, regions, host) {
  const node = unwrap(statement);

  if (!assignments.has(node?.type)) {
    return;
  }

  const name = unwrap(field(node, "left", "name", "pattern", "declarator"));

  if (!bindingNodes.has(name?.type)) {
    return;
  }

  const op = operator(node);

  if (op && !assignmentOperators.has(op)) {
    return;
  }

  const value =
    field(node, "right", "value") ??
    (node.type === "variable_declarator" && node.namedChildCount === 2
      ? node.lastNamedChild
      : undefined);

  if (!value) {
    return;
  }

  const parts = staticParts(value, regions, host);

  if (parts.length) {
    return { name: name.text, append: op === "+=" || op === ".=", parts };
  }
}

export function assembleRegions(root, regions, host) {
  const pending = [root];
  const groups = [];
  const grouped = new Set();

  function add(parts) {
    if (parts.length < 2 || parts.some((part) => grouped.has(part))) {
      return;
    }

    if (parts.reduce((length, part) => length + part.text.length, 0) > 32768) {
      return;
    }

    for (const part of parts) {
      grouped.add(part);
    }

    groups.push(parts);
  }

  while (pending.length) {
    const parent = pending.pop();
    const children = parent.namedChildren;
    let chain;

    for (const child of children) {
      if (child.type === "comment") {
        continue;
      }

      const assignment = assignmentParts(child, regions, host);

      if (
        assignment?.append &&
        chain?.name === assignment.name &&
        assignment.parts.every((part) => !part.marker)
      ) {
        chain.parts.push(...assignment.parts);

        continue;
      }

      if (chain) {
        add(chain.parts);
      }

      chain = assignment;
    }

    if (chain) {
      add(chain.parts);
    }

    if (binaries.has(parent.type) || parent.type === "concatenated_string") {
      add(staticParts(parent, regions, host));
    }

    for (let i = children.length - 1; i >= 0; i--) {
      pending.push(children[i]);
    }
  }

  return [
    ...groups,
    ...[...regions.values()].filter((part) => !grouped.has(part)).map((part) => [part]),
  ];
}
