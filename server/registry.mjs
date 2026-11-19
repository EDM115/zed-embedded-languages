import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "smol-toml";

export const compareNames = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function parseConfig(text) {
  return parse(text.replace(/^\uFEFF/, ""));
}

async function namesAt(directory) {
  return (await readdir(directory).catch(() => [])).sort(compareNames);
}

export async function scanInstalled(directory) {
  if (!directory) {
    return { configs: [], grammars: new Map() };
  }

  const configs = [];
  const grammars = new Map();

  for (const id of await namesAt(directory)) {
    const root = join(directory, id);
    const grammarDir = join(root, "grammars");
    const ownedGrammars = new Map();

    for (const file of await namesAt(grammarDir)) {
      if (!file.endsWith(".wasm")) {
        continue;
      }

      const name = file.slice(0, -5);
      const path = join(grammarDir, file);
      ownedGrammars.set(name, path);

      if (!grammars.has(name)) {
        grammars.set(name, path);
      }
    }

    const folders = (await namesAt(join(root, "languages"))).map((folder) => "languages/" + folder);
    const manifest = await readFile(join(root, "extension.toml"), "utf8")
      .then(parseConfig)
      .catch(() => undefined);

      for (const folder of Array.isArray(manifest?.languages) ? manifest.languages : []) {
      if (
        typeof folder === "string" &&
        folder.split("/").every((part) => /^[\w. -]+$/.test(part) && part !== "." && part !== "..")
      ) {
        folders.push(folder);
      }
    }

    for (const folder of new Set(folders)) {
      const langDir = join(root, folder);

      try {
        const config = parseConfig(await readFile(join(langDir, "config.toml"), "utf8"));

        if (!config.hidden && typeof config.name === "string") {
          configs.push({ config, langDir, grammar: ownedGrammars.get(config.grammar) });
        }
      } catch {
        // An extension can be removed or updated while its language definitions are being read
      }
    }
  }

  return { configs, grammars };
}
