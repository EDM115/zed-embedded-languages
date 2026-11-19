import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { compareNames, parseConfig, scanInstalled } from "./registry.mjs";

const { values } = parseArgs({
  options: {
    manifest: { type: "string", default: "extension.toml" },
    installed: { type: "string" },
    registry: { type: "string" },
    archives: { type: "string" },
    revision: { type: "string" },
    report: { type: "string" },
  },
});
const original = await readFile(values.manifest, "utf8");
const server = parseConfig(original).language_servers["embedded-languages"];
const bundledIds = {
  C: "c",
  "C++": "cpp",
  "C#": "c-sharp",
  CSS: "css",
  Go: "go",
  Java: "java",
  JavaScript: "javascript",
  "JavaScript React": "javascriptreact",
  JSX: "javascriptreact",
  JSON: "json",
  JSONC: "json",
  PHP: "php",
  PowerShell: "powershell",
  Python: "python",
  Ruby: "ruby",
  Rust: "rust",
  "Shell Script": "bash",
  TOML: "toml",
  TypeScript: "typescript",
  TSX: "typescriptreact",
};
const names = new Set(values.registry ? Object.keys(bundledIds) : server.languages);
const originalIds = server.language_ids ?? {};
const managedIds = new Map(Object.entries(originalIds));
const audit = { revision: values.revision, extensions: [], namesWithoutPackage: [] };

for (const [name, id] of Object.entries(bundledIds)) {
  managedIds.set(name, id);
}

function addLanguage(name) {
  if (typeof name !== "string" || !name.trim()) {
    return;
  }

  names.add(name);

  if (!managedIds.has(name)) {
    managedIds.set(name, name.toLowerCase());
  }
}

if (values.registry && values.archives) {
  const index = parseConfig(await readFile(values.registry, "utf8"));
  const archives = JSON.parse(await readFile(values.archives, "utf8"));

  for (const path of archives) {
    const { id, version, entries } = JSON.parse(await readFile(path, "utf8"));

    if (!Object.hasOwn(index, id)) {
      audit.namesWithoutPackage.push(id);
    }

    const fromExtension = new Set();
    const manifest = parseConfig(entries["extension.toml"]);

    for (const entry of Object.values(
      manifest.language_servers ?? manifest["language-servers"] ?? {},
    )) {
      for (const name of entry.languages?.length ? entry.languages : [entry.language]) {
        if (typeof name === "string") {
          fromExtension.add(name);
        }
      }
    }

    for (const [name, text] of Object.entries(entries)) {
      if (!name.endsWith("/config.toml")) {
        continue;
      }

      const config = parseConfig(text);

      if (!config.hidden && typeof config.name === "string") {
        fromExtension.add(config.name);
      }
    }

    for (const name of fromExtension) {
      addLanguage(name);
    }

    audit.extensions.push({
      id,
      version,
      registryVersion: index[id]?.version,
      languages: [...fromExtension].sort(compareNames),
    });
  }
} else if (!values.installed) {
  throw new Error(
    "Pass --installed <Zed installed extensions directory> or run scripts/update-language-registry.ps1",
  );
}

if (values.installed) {
  const { configs } = await scanInstalled(resolve(values.installed));

  for (const { config } of configs) {
    addLanguage(config.name);
  }
}

const sorted = [...names].sort(compareNames);
const table = "[language_servers.embedded-languages.language_ids]";
const endMarker = "# End generated language registrations";
const generated = [
  "languages = [",
  ...sorted.map((name) => "  " + JSON.stringify(name) + ","),
  "]",
  "",
  table,
  ...sorted.map(
    (name) =>
      JSON.stringify(name) + " = " + JSON.stringify(managedIds.get(name) ?? name.toLowerCase()),
  ),
  endMarker,
].join("\n");
const section = original.indexOf("\n[language_servers.embedded-languages]");
const location = section === -1 ? -1 : original.indexOf("\nlanguages = ", section);
const tableStart = original.indexOf(table, location);

if (location === -1 || tableStart === -1) {
  throw new Error("Could not find the managed language declarations");
}

const oldEndMarker = original.indexOf(endMarker, tableStart);
const nextSection = original.slice(tableStart + table.length).search(/^\s*\[[^\r\n]+\]/m);
const end =
  oldEndMarker >= 0
    ? oldEndMarker + endMarker.length
    : nextSection >= 0
      ? tableStart + table.length + nextSection
      : original.trimEnd().length;
const eol = original.includes("\r\n") ? "\r\n" : "\n";
const suffix = original.slice(end);
const updated =
  original.slice(0, location + 1) +
  generated.replaceAll("\n", eol) +
  (suffix.startsWith("\n") || suffix.startsWith("\r") ? suffix : eol + suffix);

if (updated !== original) {
  await writeFile(values.manifest, updated);

  // Zed compares the extension index with the parent installed directory on startup
  if (values.installed && resolve(values.manifest) !== resolve("extension.toml")) {
    const { utimes } = await import("node:fs/promises");
    const now = new Date();
    await utimes(resolve(values.installed), now, now);
  }
}

if (values.report) {
  await writeFile(values.report, JSON.stringify(audit, null, 2));
}

console.log(
  sorted.length +
    " host registrations from " +
    audit.extensions.length +
    " published registry extensions",
);

if (audit.namesWithoutPackage.length) {
  console.log(
    "Marketplace entries absent from the pinned registry : " + audit.namesWithoutPackage.join(", "),
  );
}
