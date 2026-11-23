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

test("decodes host escapes and maps JSON tokens back to their full source ranges", async () => {
  const source = String.raw`payload = "{\n\"café 🌈\": \"a\\\"b\", \"enabled\": true\n}"`;
  const tokens = await highlights("python", source);
  for (const [text, type] of [
    [String.raw`\"café 🌈\"`, "property"],
    [String.raw`\\\"`, "regexp"],
    ["true", "keyword"],
  ]) {
    assert(
      tokens.some(
        (token) =>
          token.text === text && token.type === type && token.start === source.indexOf(text),
      ),
      text,
    );
  }
  assert(tokens.every((token) => !token.text.includes(String.raw`\n`)));

  for (const [host, raw] of [
    ["python", String.raw`payload = r'{"newline": "\n"}'`],
    ["javascript", 'const payload = String.raw`{"newline": "\\n"}`;'],
  ]) {
    assert(
      (await highlights(host, raw)).some(
        ({ text, type }) => text === String.raw`\n` && type === "regexp",
      ),
      host,
    );
  }
});

test("detects nested JSON arrays and requires a single structured value", async () => {
  const source = "payload = '[[1], [\"second\"]]'";
  const tokens = await highlights("python", source);
  assert(tokens.some(({ text, target }) => text === '"second"' && target === "json"));
  const plain = [
    'values = "[1][2]"',
    'label = "[]"',
    "invalid = '[[1],]'",
    'multiple = \'/* generated */ {"x": 1}{"y": 2}\'',
  ].join("\n");
  assert.deepEqual(await highlights("python", plain), []);
});

test("decodes literal f-string braces without consuming interpolation or raw escapes", async () => {
  const source = String.raw`payload = rf'{{"message": "line\n{user}", "enabled": true}}'`;
  const tokens = await highlights("python", source);
  for (const [word, type] of [
    ["{{", "variable"],
    ["}}", "variable"],
    [String.raw`\n`, "regexp"],
    ["true", "keyword"],
  ]) {
    assert(
      tokens.some(
        ({ text, type: actual, start, target }) =>
          text === word && actual === type && start === source.indexOf(word) && target === "json",
      ),
      word,
    );
  }
  const field = source.indexOf("{user}");
  assert(
    tokens.every(
      ({ text, start }) => start + text.length <= field || start >= field + "{user}".length,
    ),
  );
});

test(
  "maps tokens across escaped literals joined around an interpolation",
  { skip: !hasGrammar("sql") },
  async () => {
    const source = [String.raw`query = ("SEL" f"ECT\n {field} FROM ")`, 'query += "widgets"'].join(
      "\n",
    );
    const tokens = await highlights("python", source);
    for (const word of ["SEL", "ECT", "FROM", "widgets"]) {
      assert(
        tokens.some(
          ({ text, start, target }) =>
            text === word && start === source.indexOf(word) && target === "sql",
        ),
        word,
      );
    }
    const field = source.indexOf("{field}");
    assert(
      tokens.every(
        ({ text, start }) => start + text.length <= field || start >= field + "{field}".length,
      ),
    );
  },
);

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

test(
  "auto-detects SQL with directional TRIM inside nested calls and CASE",
  { skip: !hasGrammar("sql") },
  async () => {
    const source = [
      "if summarize:",
      '    query = """',
      "SELECT REPLACE(TRIM(TRAILING '.' FROM",
      "    TRIM(TRAILING '0' FROM CAST(remaining AS CHAR))), '.', ',')",
      "FROM totals;",
      '    """',
      "else:",
      '    query = """',
      "SELECT CASE WHEN amount = 0 THEN '0' ELSE TRIM(",
      "    TRAILING '0' FROM CAST(amount AS CHAR)) END",
      "FROM orders;",
      '    """',
      "malformed = \"SELECT TRIM(TRAILING '0' FROM amount) FROM ;\"",
    ].join("\n");
    const tokens = await highlights("python", source);

    assert(
      tokens.every(({ start, target }) => start < source.indexOf("malformed") && target === "sql"),
    );
    assert.equal(
      tokens.filter(({ text, type }) => text === "SELECT" && type === "keyword").length,
      2,
    );
    for (const table of ["totals", "orders"]) {
      assert(
        tokens.some(({ text, start }) => text === table && start === source.indexOf(table)),
        table,
      );
    }
  },
);

test(
  "detects SQL after comments, recursive CTEs, and SELECT expressions without FROM",
  { skip: !hasGrammar("sql") },
  async () => {
    const source = [
      'query = """-- counts',
      '/* for the report */ SELECT id FROM widgets;"""',
      'cte = "WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 3) SELECT n FROM seq;"',
      'value = "SELECT CURRENT_TIMESTAMP;"',
      'call = "SELECT ABS(-1);"',
      'message = "Select a file from your computer."',
    ].join("\n");
    const tokens = await highlights("python", source);
    for (const word of ["widgets", "RECURSIVE", "CURRENT_TIMESTAMP", "ABS"]) {
      assert(
        tokens.some(
          ({ text, start, target }) =>
            text === word && start === source.indexOf(word) && target === "sql",
        ),
        word,
      );
    }
    assert(tokens.every(({ start }) => start < source.indexOf("message")));
  },
);

test(
  "detects SQL with SQLite bind parameters while preserving quoted text and PostgreSQL casts",
  { skip: !hasGrammar("sql") },
  async () => {
    const source = [
      'query = """SELECT id::text FROM widgets',
      'WHERE id = :named AND rank = ?12 AND kind = $kind AND label = \':literal ?34 $untouched\';"""',
      'invalid = "SELECT id FROM widgets WHERE id = :named AND ;"',
      'bare = "SELECT id FROM widgets WHERE id = :;"',
    ].join("\n");
    const tokens = await highlights("python", source);
    for (const word of ["widgets", "text", "rank", "label", "':literal ?34 $untouched'"]) {
      assert(
        tokens.some(
          ({ text, start, target }) =>
            text === word && start === source.indexOf(word) && target === "sql",
        ),
        word,
      );
    }
    assert(tokens.every(({ start }) => start < source.indexOf("invalid")));
    assert(tokens.every(({ text }) => !["named", "12"].includes(text)));
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
  "detects HTML with sibling elements, comments, void tags, and literal ampersands",
  { skip: !hasGrammar("html") },
  async () => {
    for (const [host, source, tags] of [
      ["python", 'view = "<!-- header --><h1>One & Two</h1><p>Three</p><!-- end -->"', ["h1", "p"]],
      ["python", "fragment = '<source src=\"movie.mp4\">'", ["source", "src"]],
      ["python", 'fragment = "<p>One<p>Two"', ["p"]],
      ["javascript", String.raw`const field = "<input type=\"email\" />";`, ["input", "type"]],
    ]) {
      const tokens = await highlights(host, source);
      for (const tag of tags) {
        assert(
          tokens.some(
            ({ text, start, target }) =>
              text === tag &&
              start === source.indexOf(tag, source.indexOf("<")) &&
              target === "html",
          ),
          source,
        );
      }
    }
    for (const plain of ["<username>", "<h1>Bad & worse</h2>", "Use <div> for layout."]) {
      assert.deepEqual(await highlights("python", 'text = "' + plain + '"'), [], plain);
    }
  },
);

test(
  "gives XML-specific syntax priority over HTML for declarationless fragments",
  { skip: !(hasGrammar("xml") && hasGrammar("html")) },
  async () => {
    for (const [xml, tag] of [
      ["<document><![CDATA[<inner> & text]]></document>", "document"],
      ["<!DOCTYPE note [<!ELEMENT note (#PCDATA)>]><note>Hi</note>", "note"],
      ['<x:header xmlns:x="urn:example"><x:item/></x:header>', "x:header"],
    ]) {
      const tokens = await highlights("python", "value = r'''" + xml + "'''");
      assert(
        tokens.some(({ text, target }) => text === tag && target === "xml"),
        xml,
      );
      assert(
        tokens.every(({ target }) => target === "xml"),
        xml,
      );
    }
    assert.deepEqual(
      await highlights(
        "python",
        'value = "<!DOCTYPE note [<!ELEMENT note (#PCDATA)>]><note>Hi</wrong>"',
      ),
      [],
    );
  },
);

test(
  "recognizes SCSS-only syntax without requiring generic code-shape evidence",
  { skip: !hasGrammar("scss") },
  async () => {
    const source =
      "theme = '''$tone: #fff;\n$gap: 1rem;'''\nstyle = '.panel { &:hover { color: $tone } }'";
    const tokens = await highlights("python", source);
    for (const word of ["$tone", "$gap", "color"]) {
      assert(
        tokens.some(
          ({ text, start, target }) =>
            text === word && start === source.indexOf(word) && target === "scss",
        ),
        word,
      );
    }
    assert.deepEqual(await highlights("python", "text = 'Shipping: $cost;'"), []);
  },
);

test(
  "detects TOML array-of-tables with a boolean value",
  { skip: !hasGrammar("toml") },
  async () => {
    const source = 'config = """[[servers]]\nenabled = true"""';
    const tokens = await highlights("python", source);
    assert(
      tokens.some(
        ({ text, start, target }) =>
          text === "enabled" && start === source.indexOf("enabled") && target === "toml",
      ),
    );
    assert.deepEqual(await highlights("python", 'label = "[[servers]]"'), []);
  },
);

test(
  "detects Dockerfile instructions without a final newline",
  { skip: !hasGrammar("dockerfile") },
  async () => {
    const source =
      'build = """# build image\nARG BASE=alpine\nFROM ${BASE}:3.19\nCOPY . .\nRUN true"""';
    const tokens = await highlights("python", source);
    for (const word of ["FROM", "COPY", "RUN"]) {
      assert(
        tokens.some(
          ({ text, start, target }) =>
            text === word && start === source.indexOf(word) && target === "dockerfile",
        ),
        word,
      );
    }
    assert.deepEqual(await highlights("python", 'text = "From readers"'), []);
  },
);

test(
  "detects nginx blocks with recognizable directives and leaves prose-like blocks plain",
  { skip: !hasGrammar("nginx") },
  async () => {
    const source = 'config = """server {\n  listen 8080;\n  server_name example.com;\n}"""';
    const tokens = await highlights("python", source);
    for (const word of ["listen", "8080", "server_name"]) {
      assert(
        tokens.some(
          ({ text, start, target }) =>
            text === word && start === source.indexOf(word) && target === "nginx",
        ),
        word,
      );
    }
    assert.deepEqual(await highlights("python", 'text = "server { text prose here; }"'), []);
  },
);

test(
  "detects PowerShell script fragments starting with a param block",
  { skip: !hasGrammar("powershell") },
  async () => {
    const source = 'script = """param([string]$Name)\nWrite-Output $Name"""';
    const tokens = await highlights("python", source);
    assert(
      tokens.some(
        ({ text, start, target }) =>
          text === "Write-Output" &&
          start === source.indexOf("Write-Output") &&
          target === "powershell",
      ),
    );
    assert.deepEqual(await highlights("python", 'text = "param(name) tells it what to use"'), []);
  },
);

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
  "uses structural evidence to detect SCSS without a matching signature",
  { skip: !hasGrammar("scss") },
  async () => {
    const tokens = await highlights("python", "style = '.x { margin: 0; @include rounded; }'");
    assert(
      tokens.some(
        (token) => token.text === "rounded" && token.type === "function" && token.target === "scss",
      ),
    );
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
