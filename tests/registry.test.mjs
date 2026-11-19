import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseConfig } from "../server/registry.mjs";

test("refreshing registrations adds new installed languages without changing unrelated settings", async (t) => {
  const scratch = fileURLToPath(new URL("../.tmp/", import.meta.url));
  await mkdir(scratch, { recursive: true });
  const fixture = await mkdtemp(join(scratch, "registry-test-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const extensions = join(fixture, "installed");
  const language = join(extensions, "another-extension", "grammar-configs", "example");
  await mkdir(language, { recursive: true });
  await writeFile(
    join(language, "config.toml"),
    'name = "Example Future Language"\ngrammar = "example"\n',
  );
  await writeFile(
    join(extensions, "another-extension", "extension.toml"),
    'languages = ["grammar-configs/example"]\n',
  );
  const draft = join(fixture, "extension.toml");
  await writeFile(
    draft,
    [
      'id = "embedded-languages-lsp"',
      "[language_servers.embedded-languages]",
      'name = "Embedded Languages"',
      'languages = ["Python"]',
      "[language_servers.embedded-languages.language_ids]",
      'Python = "python"',
      "[grammars.example]",
      'repository = "https://example.invalid/parser"',
    ].join("\n"),
  );

  const entry = fileURLToPath(new URL("../server/update-manifest.mjs", import.meta.url));
  function refresh() {
    const result = spawnSync(
      process.execPath,
      [entry, "--installed", extensions, "--manifest", draft],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  }
  refresh();
  const first = await readFile(draft, "utf8");
  const output = parseConfig(first);
  assert.deepEqual(output.language_servers["embedded-languages"].languages, [
    "Example Future Language",
    "Python",
  ]);
  assert.equal(
    output.language_servers["embedded-languages"].language_ids["Example Future Language"],
    "example future language",
  );
  assert.equal(output.grammars.example.repository, "https://example.invalid/parser");
  refresh();
  assert.equal(await readFile(draft, "utf8"), first);
});
