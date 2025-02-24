// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;

#[tauri::command]
async fn install_cli_binary() -> Result<(), String> {
    let version = "0.1.0-beta.1"; // You might want to make this configurable
    
    // Determine platform-specific binary name
    let binary_name = match std::env::consts::OS {
        "windows" => "smithery-windows.exe",
        "linux" => "smithery-linux",
        "macos" => "smithery-darwin",
        _ => return Err("Unsupported platform".into()),
    };

    // Construct GitHub release download URL
    let url = format!(
        "https://github.com/smithery-ai/runner/releases/download/{}/{}",
        version, binary_name
    );

    // Download the binary
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Failed to download binary: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Failed to download binary: HTTP {}", response.status()));
    }

    let bytes = response.bytes()
        .await
        .map_err(|e| format!("Failed to read binary data: {}", e))?;

    // Get installation directory
    let bin_dir = if cfg!(target_os = "windows") {
        PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_else(|_| String::from("C:\\Program Files")))
            .join("Smithery")
            .join("bin")
    } else {
        PathBuf::from("/usr/local/bin")
    };

    // Create directory if it doesn't exist
    std::fs::create_dir_all(&bin_dir)
        .map_err(|e| format!("Failed to create installation directory: {}", e))?;

    let dest_path = bin_dir.join(binary_name);

    // Write binary to disk
    std::fs::write(&dest_path, bytes)
        .map_err(|e| format!("Failed to write binary: {}", e))?;

    // Make executable on Unix systems
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&dest_path)
            .map_err(|e| format!("Failed to get file permissions: {}", e))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&dest_path, perms)
            .map_err(|e| format!("Failed to set file permissions: {}", e))?;
    }

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![install_cli_binary])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
