use std::{env, fs};

use zed_extension_api::{
    self as zed, serde_json, settings::LspSettings, LanguageServerInstallationStatus,
};

const PACKAGE_JSON: &str = include_str!("../server/package.json");
const SERVER_FILES: &[(&str, &str)] = &[
    ("grammars.mjs", include_str!("../server/grammars.mjs")),
    ("highlight.mjs", include_str!("../server/highlight.mjs")),
    ("server.mjs", include_str!("../server/server.mjs")),
];

struct EmbeddedLanguages;

impl zed::Extension for EmbeddedLanguages {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        id: &zed::LanguageServerId,
        _: &zed::Worktree,
    ) -> zed::Result<zed::Command> {
        for (path, contents) in SERVER_FILES {
            write_if_changed(path, contents)?;
        }
        write_if_changed(".npmrc", "ignore-scripts=true\n")?;

        let manifest: serde_json::Value =
            serde_json::from_str(PACKAGE_JSON).map_err(|error| error.to_string())?;
        let dependencies = manifest["dependencies"]
            .as_object()
            .ok_or("Missing server dependencies")?;
        let mut installed = true;
        for (package, version) in dependencies {
            let path = format!("node_modules/{package}/package.json");
            let actual = fs::read(&path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
            installed &= actual
                .as_ref()
                .is_some_and(|metadata| metadata["version"] == *version);
        }

        if !installed {
            write_if_changed("package.json", PACKAGE_JSON)?;
            zed::set_language_server_installation_status(
                id,
                &LanguageServerInstallationStatus::Downloading,
            );
            let install = zed::npm_install_package("web-tree-sitter", "0.27.2");
            zed::set_language_server_installation_status(
                id,
                &LanguageServerInstallationStatus::None,
            );
            install?;
        }

        let entrypoint = env::current_dir()
            .map_err(|error| error.to_string())?
            .join("server.mjs");
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![entrypoint.to_string_lossy().into_owned(), "--stdio".into()],
            env: Vec::new(),
        })
    }

    fn language_server_initialization_options(
        &mut self,
        id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<Option<serde_json::Value>> {
        Ok(LspSettings::for_worktree(id.as_ref(), worktree)?.initialization_options)
    }
}

fn write_if_changed(path: &str, contents: &str) -> zed::Result<()> {
    if fs::read_to_string(path).ok().as_deref() == Some(contents) {
        return Ok(());
    }
    fs::write(path, contents).map_err(|error| format!("Cannot write {path}: {error}"))
}

zed::register_extension!(EmbeddedLanguages);
