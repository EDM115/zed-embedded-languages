use std::{
    env, fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

use zed_extension_api::{
    self as zed, DownloadedFileType, LanguageServerInstallationStatus, serde_json,
    settings::LspSettings,
};

const VERSION: &str = env!("CARGO_PKG_VERSION");
const RELEASES: &str = "https://github.com/EDM115/zed-embedded-languages/releases/download";

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
        let installation = PathBuf::from(format!("server-{VERSION}"));
        let entrypoint = install_server(&installation, |staging| {
            zed::set_language_server_installation_status(
                id,
                &LanguageServerInstallationStatus::Downloading,
            );
            let url = format!("{RELEASES}/{VERSION}/embedded-languages-server-{VERSION}.tar.gz");
            let result = zed::download_file(
                &url,
                &staging.to_string_lossy(),
                DownloadedFileType::GzipTar,
            );
            zed::set_language_server_installation_status(
                id,
                &LanguageServerInstallationStatus::None,
            );
            result.map_err(|error| format!("Cannot download the companion from {url} : {error}"))
        })?;

        let entrypoint = env::current_dir()
            .map_err(|error| error.to_string())?
            .join(entrypoint);
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

fn install_server(
    directory: &Path,
    download: impl FnOnce(&Path) -> zed::Result<()>,
) -> zed::Result<PathBuf> {
    let entrypoint = directory.join("server.mjs");
    if server_is_present(directory) {
        return Ok(entrypoint);
    }

    let staging = directory.with_file_name(format!(".server-{VERSION}.download"));
    remove_incomplete_installation(&staging)?;
    download(&staging)?;
    if !server_is_present(&staging) {
        return Err("The companion archive is missing its entry point or parser runtime".into());
    }

    remove_incomplete_installation(directory)?;
    fs::rename(&staging, directory)
        .map_err(|error| format!("Cannot activate the companion directory : {error}"))?;
    Ok(entrypoint)
}

fn server_is_present(directory: &Path) -> bool {
    directory.join("server.mjs").is_file()
        && directory
            .join("node_modules/web-tree-sitter/web-tree-sitter.wasm")
            .is_file()
}

fn remove_incomplete_installation(directory: &Path) -> zed::Result<()> {
    match fs::remove_dir_all(directory) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Cannot remove {} : {error}", directory.display())),
    }
}

zed::register_extension!(EmbeddedLanguages);

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn retries_a_partial_download_and_reuses_the_complete_installation() -> zed::Result<()> {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = env::temp_dir().join(format!("embedded-languages-{nonce}"));
        let directory = root.join(format!("server-{VERSION}"));

        let error = install_server(&directory, |staging| {
            fs::create_dir_all(staging).unwrap();
            fs::write(staging.join("server.mjs"), "").unwrap();
            Err("interrupted download".into())
        })
        .unwrap_err();
        assert_eq!(error, "interrupted download");
        assert!(!directory.exists());

        let entrypoint = install_server(&directory, |staging| {
            assert!(!staging.exists());
            let parser = staging.join("node_modules/web-tree-sitter");
            fs::create_dir_all(&parser).unwrap();
            fs::write(parser.join("web-tree-sitter.wasm"), "").unwrap();
            fs::write(staging.join("server.mjs"), "").unwrap();
            Ok(())
        })?;
        assert_eq!(entrypoint, directory.join("server.mjs"));
        assert!(entrypoint.is_file());
        assert_eq!(
            install_server(&directory, |_| panic!("The cached server should be reused"))?,
            entrypoint
        );

        fs::remove_dir_all(root).unwrap();
        Ok(())
    }
}
