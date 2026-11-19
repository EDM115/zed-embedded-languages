import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createHighlighter, tokenTypes } from "../server/highlight.mjs";

const extensions = process.env.ZED_TEST_EXTENSIONS_DIR;
const highlighter = await createHighlighter(extensions);
const hasGrammar = (name) =>
  extensions && existsSync(join(extensions, name, "grammars", name + ".wasm"));

async function highlights(language, source, instance = highlighter) {
  return (await instance.highlight(language, source)).map(({ start, end, type, target }) => ({
    text: source.slice(start, end),
    start,
    type: tokenTypes[type],
    target,
  }));
}

test("detects structured JSON with UTF-16 offsets and leaves prose alone", async () => {
  const source =
    'title = "A 🌈"\r\npayload = \'{"emoji": "🌈", "count": 123}\'\r\nhelp = """Select a file from your computer."""';
  const tokens = await highlights("python", source);
  assert(tokens.length > 0);
  assert(tokens.every((token) => token.target === "json"));
  assert(tokens.some((token) => token.text === "123" && token.start === source.indexOf("123")));
  assert((await highlights("python", '"""{"this": "is a docstring"}"""')).length === 0);
});

test("ignores SQL if its Zed grammar is unavailable", async () => {
  const empty = await createHighlighter("does-not-exist");
  assert.deepEqual(await highlights("python", 'query = "SELECT id FROM users"', empty), []);
});

test("gives embedded JSON the same classifications as standalone JSON", async () => {
  const source = 'payload = r\'{"key": ["a\\nb", true, null, 2]}\'';
  const tokens = await highlights("python", source);
  for (const [text, type] of [
    ['"key"', "property"],
    ["{", "variable"],
    [":", "operator"],
    ["[", "variable"],
    ["true", "keyword"],
    ["null", "enumMember"],
    ["2", "number"],
    ["\\n", "regexp"],
    ["]}", "variable"],
  ]) {
    assert(
      tokens.some((token) => token.text === text && token.type === type),
      text + " should be " + type,
    );
  }
  const rawTokens = await highlighter.highlight("python", source);
  assert(rawTokens.every((token) => token.modifiers === 1));
});

test(
  "honors SQL markers in the first statement of a block",
  { skip: !hasGrammar("sql") },
  async () => {
    const source = [
      "# sql",
      'top = "SELECT top_column"',
      "if ready:",
      "    # SQL",
      '    first = "SELECT first_column"',
      "else:",
      "    #sql",
      '    second = "SELECT second_column"',
      "class Queries:",
      "    # sql",
      '    third = "SELECT third_column"',
      "def query():",
      "    # sql",
      '    fourth = "SELECT fourth_column"',
      "    pass",
      "    # sql",
      '    later = "SELECT later_column"',
      "call( # sql",
      '    "SELECT call_column",',
      '    "ordinary string",',
      ")",
    ].join("\n");
    const tokens = await highlights("python", source);
    for (const column of ["top", "first", "second", "third", "fourth", "later", "call"]) {
      assert(
        tokens.some((token) => token.text === column + "_column" && token.target === "sql"),
        column,
      );
    }
    assert(tokens.every((token) => !token.text.includes("ordinary")));
  },
);

test(
  "detects uncommented SQL, including placeholders, and preserves interpolation",
  { skip: !hasGrammar("sql") },
  async () => {
    const source = [
      "if ready:",
      '    q = f"SELECT {field} FROM users WHERE id = %(id)s"',
      'message = "Select a file from your computer."',
      'comment = "# sql"',
      'ordinary = "hello"',
    ].join("\n");
    const tokens = await highlights("python", source);
    assert(tokens.some((token) => token.text === "SELECT" && token.type === "keyword"));
    assert(tokens.some((token) => token.text === "users"));
    assert(tokens.every((token) => token.start < source.indexOf("message")));
    assert(tokens.every((token) => !/[{}]|field/.test(token.text)));
  },
);

test("works across host languages", { skip: !hasGrammar("sql") }, async () => {
  for (const [language, source] of [
    ["javascript", "const q = \`SELECT id FROM users WHERE id = \${id}\`;"],
    ["typescript", "const q: string = \`SELECT id FROM users\`;"],
    ["typescriptreact", "const q: string = \`SELECT id FROM users\`;"],
    ["go", "package example\nvar q = \`SELECT id FROM users\`"],
    ["rust", 'fn main() { let q = r#"SELECT id FROM users"#; }'],
  ]) {
    assert(
      (await highlights(language, source)).some((t) => t.text === "SELECT" && t.target === "sql"),
      language,
    );
  }
});

test(
  "uses an installed grammar as a host",
  { skip: !(hasGrammar("sql") && hasGrammar("toml")) },
  async () => {
    const tokens = await highlights("toml", 'query = "SELECT id FROM users"');
    assert(tokens.some((t) => t.text === "SELECT" && t.target === "sql"));
  },
);

test("detects HTML via the installed HTML extension", { skip: !hasGrammar("html") }, async () => {
  const tokens = await highlights("python", 'page = "<h1>Hello</h1>"');
  assert(tokens.some((t) => t.text === "h1" && t.target === "html"));
});

test(
  "prioritizes a configured detector for an installed target",
  { skip: !hasGrammar("xml") },
  async () => {
    const source = "config = '<configuration id=\"nightly\" />'";
    const instance = await createHighlighter(extensions, {
      autoDetect: [{ language: "xml", pattern: "^<configuration\\b" }],
    });
    const tokens = await highlights("python", source, instance);
    assert(tokens.some((t) => t.text === "configuration" && t.target === "xml"));
  },
);

test(
  "highlighting spans consecutive SQL assignments without crossing branches or reassignments",
  { skip: !hasGrammar("sql") },
  async () => {
    const source = [
      'insertTiAl = "INSERT INTO tiersalerte (tiers_apporteur, famille, cereale, "',
      'insertTiAl += "mois_ech, pu_rend, pu_dep, date_alerte, heure_alerte, "',
      'insertTiAl += "date_creation, heure_creation, ligne, mobile, pu_alerter, "',
      "insertTiAl += \"pu_alerted, maj, campagne) VALUES('%s', '%s', '%s', '%s', '%s', '%s', '%s', \"",
      "insertTiAl += \"'%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s') \"",
      "for elem in rep2:",
      '    ordre = "UPDATE contratvpla "',
      '    ordre += "set qte_eng = qte_eng + %s " % elem[6]',
      '    ordre += "WHERE contratv = %s " % elem[2]',
      "    if ok:",
      "        print(ordre)",
      '        ordre += "AND false"',
      "    else:",
      '        ordre = "INSERT INTO contratvpla (contratv, mois, "',
      '        ordre += "qte_eng, qte_liv, qte_res, no_execution, flag) "',
      '        ordre += "VALUES (%s, " % elem[2]',
      "        ordre += \"'%s', \" % agDateAMJ(datej)[0:7]",
      "        ordre += \"%s, 0, 0, '', NULL)\" % elem[6]",
      '    ordre = "message"',
      '    ordre += "WHERE plain text"',
    ].join("\n");
    const tokens = await highlights("python", source);
    for (const value of [
      "mois_ech",
      "campagne",
      "VALUES",
      "set",
      "WHERE",
      "qte_eng",
      "no_execution",
      "NULL",
    ]) {
      assert(
        tokens.some((token) => token.target === "sql" && token.text === value),
        value,
      );
    }
    assert(tokens.every((token) => !/elem|agDateAMJ|\"/.test(token.text)));
    assert(tokens.every((token) => token.start < source.indexOf('ordre = "message"')));
    assert(tokens.every((token) => token.text !== "false"));
  },
);

test(
  "joins literal expressions and consecutive appends across supported syntaxes",
  { skip: !hasGrammar("sql") },
  async () => {
    for (const [host, source] of [
      ["python", 'query = ("SELECT " "id" + " FROM ")\nquery += "users"'],
      ["typescript", 'let query = "SELECT " + "id"; query += " FROM users";'],
      ["go", 'package foo\nfunc q(){ query := "SELECT " + "id"; query += " FROM users" }'],
      ["rust", 'fn q(){ let mut query = String::from("SELECT id"); query += " FROM users"; }'],
    ]) {
      const tokens = await highlights(host, source);
      for (const value of ["SELECT", "FROM", "users"]) {
        assert(
          tokens.some((token) => token.target === "sql" && token.text === value),
          host + ": " + value,
        );
      }
      assert(
        tokens.every((token) => !token.text.includes('"')),
        host,
      );
    }
  },
);

test(
  "supports raw C++ strings via a bundled fallback and PowerShell via its installed grammar",
  { skip: !hasGrammar("sql") },
  async () => {
    for (const [host, source] of [
      ["cpp", 'const char* q = R"sql(SELECT id FROM users)sql";'],
      ["powershell", '$q = "SELECT id FROM users"'],
    ]) {
      const tokens = await highlights(host, source);
      assert(
        tokens.some((token) => token.target === "sql" && token.text === "SELECT"),
        host,
      );
      assert(
        tokens.every((token) => !token.text.includes('"')),
        host,
      );
    }
  },
);

test(
  "uses structural evidence to detect SCSS without a built-in SCSS detector",
  { skip: !hasGrammar("scss") },
  async () => {
    const tokens = await highlights("python", "style = '.x { color: $c; background: #fff; }'");
    assert(tokens.some((token) => token.text === "background" && token.target === "scss"));
    assert.deepEqual(await highlights("python", "text = 'Use { brackets }; here'"), []);
  },
);

test(
  "maps a token split across literals back to both host ranges",
  { skip: !hasGrammar("sql") },
  async () => {
    const source = 'query = "SE"\r\nquery += "LECT id FROM users"';
    const tokens = await highlights("python", source);
    assert(tokens.some((token) => token.text === "SE" && token.type === "keyword"));
    assert(tokens.some((token) => token.text === "LECT" && token.type === "keyword"));
  },
);

test(
  "highlights percent, brace, and interpolated SQL templates without coloring host expressions",
  { skip: !hasGrammar("sql") },
  async () => {
    const samples = [
      [
        "python",
        'query = "SELECT id FROM users "\nquery += "WHERE amount > %s " % limit\nquery += "AND category = {kind!r:>{width}} ".format(kind=category, width=12)\nquery += f"AND active = {flag}"',
      ],
      ["javascript", "const query = `SELECT id FROM users WHERE id = ${userId}`;"],
      ["typescript", "const query: string = `SELECT id FROM users WHERE id = ${userId}`;"],
      [
        "go",
        'package demo\nfunc f(){ query := fmt.Sprintf("SELECT %s FROM users ", column); query += "WHERE id = 4" }',
      ],
      [
        "rust",
        'fn f(){ let mut query = format!("SELECT {} FROM {table}", column); query += " WHERE active = true"; }',
      ],
      ["c-sharp", 'class X { string q = $"SELECT {column} FROM users WHERE id = 4"; }'],
    ];
    for (const [host, source] of samples) {
      const tokens = await highlights(host, source);
      for (const text of ["SELECT", "FROM", "WHERE"]) {
        assert(
          tokens.some((token) => token.text === text && token.target === "sql"),
          host + ": " + text,
        );
      }
      assert(
        tokens.every((token) => !/[{}]|column|userId|kind|width|flag/.test(token.text)),
        host,
      );
    }
  },
);
