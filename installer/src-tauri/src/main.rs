// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;

#[tauri::command]
async fn install_cli_binary() -> Result<(), String> {
    let bin_dir = std::path::PathBuf::from("/usr/local/bin");
    let binary_name = "smithery";
    let dest_path = bin_dir.join(binary_name);
    let source_path = std::path::PathBuf::from("/Users/arjun/Documents/github/runner/dist/smithery-mac");

    // Use osascript to prompt for sudo permission and execute cp command
    let script = format!(
        "do shell script \"cp '{}' '{}' && chmod 755 '{}'\" with administrator privileges",
        source_path.display(),
        dest_path.display(),
        dest_path.display()
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("Failed to execute osascript: {}", e))?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to install binary: {}", error));
    }

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![install_cli_binary])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
