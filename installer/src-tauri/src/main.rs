// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use std::io::Write;
// Import the Manager trait to access path methods
use tauri::Manager;

#[tauri::command]
async fn debug_tauri_version() -> String {
    format!("Tauri version: {}", tauri::VERSION)
}

#[tauri::command]
async fn install_cli_binary(app_handle: tauri::AppHandle) -> Result<(), String> {
    // Platform-specific configuration
    #[cfg(target_os = "macos")]
    {
        // Use /usr/local/bin as the symlink location (standard location)
        let bin_dir = std::path::PathBuf::from("/usr/local/bin");
        
        let binary_name = "smithery";
        let symlink_path = bin_dir.join(binary_name);
        
        // Get the resource path where the binary is located
        let binary_path = app_handle
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource directory: {}", e))?
            .join("resources/smithery-macos");
        
        println!("Binary path: {}", binary_path.display());
        println!("Binary exists: {}", binary_path.exists());
        println!("Symlink path: {}", symlink_path.display());
        
        // Try to create the symlink with elevated privileges
        let output = Command::new("osascript")
            .arg("-e")
            .arg(format!(
                "do shell script \"ln -sf '{}' '{}' || exit 1\" with administrator privileges",
                binary_path.display(), symlink_path.display()
            ))
            .output()
            .map_err(|e| format!("Failed to execute osascript: {}", e))?;
        
        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            println!("Failed to create symlink with admin privileges: {}", error);
            
            // Fall back to user's bin directory if admin privileges fail
            let home_dir = dirs::home_dir()
                .ok_or_else(|| "Could not find home directory".to_string())?;
            let user_bin_dir = home_dir.join("bin");
            
            // Create bin directory if it doesn't exist
            if !user_bin_dir.exists() {
                std::fs::create_dir_all(&user_bin_dir)
                    .map_err(|e| format!("Failed to create bin directory: {}", e))?;
                
                // Add bin directory to PATH if it's not already there
                let shell_profile = home_dir.join(".zshrc");
                if shell_profile.exists() {
                    std::fs::OpenOptions::new()
                        .append(true)
                        .open(shell_profile)
                        .map_err(|e| format!("Failed to open shell profile: {}", e))?
                        .write_all(b"\n# Added by Smithery installer\nexport PATH=\"$HOME/bin:$PATH\"\n")
                        .map_err(|e| format!("Failed to update shell profile: {}", e))?;
                }
            }
            
            let user_symlink_path = user_bin_dir.join(binary_name);
            
            // Remove existing symlink if it exists
            if user_symlink_path.exists() {
                std::fs::remove_file(&user_symlink_path)
                    .map_err(|e| format!("Failed to remove existing symlink: {}", e))?;
            }
            
            // Create symlink in user directory
            std::os::unix::fs::symlink(&binary_path, &user_symlink_path)
                .map_err(|e| format!("Failed to create symlink: {}", e))?;
            
            println!("Successfully created symlink at {} (fallback location)", user_symlink_path.display());
        } else {
            println!("Successfully created symlink at {} with admin privileges", symlink_path.display());
        }
    }

    #[cfg(target_os = "windows")]
    {
        // For Windows, we'll try to use Program Files first, then fall back to user directory
        let program_files = std::env::var("ProgramFiles")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| std::path::PathBuf::from("C:\\Program Files"));
        
        let bin_dir = program_files.join("Smithery").join("bin");
        let binary_name = "smithery.exe";
        let symlink_path = bin_dir.join(binary_name);
        
        let binary_path = app_handle
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource directory: {}", e))?
            .join("resources/smithery-win.exe");

        // Try to create directory and symlink with elevated privileges
        // This is a simplified approach - in a real app, you might want to use a proper installer
        let create_dir_cmd = format!("if not exist \"{}\" mkdir \"{}\"", bin_dir.display(), bin_dir.display());
        let create_symlink_cmd = format!("mklink \"{}\" \"{}\"", symlink_path.display(), binary_path.display());
        
        // Use PowerShell to run as admin
        let ps_command = format!(
            "Start-Process cmd.exe -ArgumentList '/c {} && {}' -Verb RunAs -Wait",
            create_dir_cmd, create_symlink_cmd
        );
        
        let output = Command::new("powershell")
            .arg("-Command")
            .arg(&ps_command)
            .output();
        
        // If admin installation fails, fall back to user directory
        if output.is_err() || !output.unwrap().status.success() {
            let user_bin_dir = std::env::var("USERPROFILE")
                .map(std::path::PathBuf::from)
                .map_err(|e| format!("Failed to get user profile directory: {}", e))?
                .join("AppData")
                .join("Local")
                .join("smithery")
                .join("bin");
            
            // Create directory if it doesn't exist
            std::fs::create_dir_all(&user_bin_dir)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
                
            let user_symlink_path = user_bin_dir.join(binary_name);
            
            // Remove existing symlink if it exists
            if user_symlink_path.exists() {
                std::fs::remove_file(&user_symlink_path)
                    .map_err(|e| format!("Failed to remove existing symlink: {}", e))?;
            }
            
            // Create symlink
            let output = Command::new("cmd")
                .args(&["/C", "mklink"])
                .arg(&user_symlink_path)
                .arg(&binary_path)
                .output()
                .map_err(|e| format!("Failed to create symlink: {}", e))?;
                
            if !output.status.success() {
                let error = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Failed to create symlink: {}", error));
            }
            
            // Add to PATH if needed
            let path_entry = format!("{};", user_bin_dir.display());
            let output = Command::new("cmd")
                .args(&["/C", "setx", "PATH", &format!("{}{}", path_entry, std::env::var("PATH").unwrap_or_default())])
                .output()
                .map_err(|e| format!("Failed to update PATH: {}", e))?;
                
            if !output.status.success() {
                let error = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Failed to update PATH: {}", error));
            }
            
            println!("Successfully created symlink at {} (fallback location)", user_symlink_path.display());
        } else {
            println!("Successfully created symlink at {} with admin privileges", symlink_path.display());
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Try /usr/local/bin first (standard location)
        let bin_dir = std::path::PathBuf::from("/usr/local/bin");
        let binary_name = "smithery";
        let symlink_path = bin_dir.join(binary_name);
        
        let binary_path = app_handle
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource directory: {}", e))?
            .join("resources/smithery-linux");

        // Make sure the binary is executable
        let output = Command::new("chmod")
            .arg("755")
            .arg(&binary_path)
            .output()
            .map_err(|e| format!("Failed to set permissions: {}", e))?;
            
        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to set permissions: {}", error));
        }

        // Try to create the symlink with sudo
        let output = Command::new("pkexec")
            .arg("ln")
            .arg("-sf")
            .arg(&binary_path)
            .arg(&symlink_path)
            .output();
        
        // If sudo installation fails, fall back to user directory
        if output.is_err() || !output.unwrap().status.success() {
            // Use ~/.local/bin for user-level installation
            let home_dir = dirs::home_dir()
                .ok_or_else(|| "Could not find home directory".to_string())?;
            let user_bin_dir = home_dir.join(".local").join("bin");
            
            // Create bin directory if it doesn't exist
            if !user_bin_dir.exists() {
                std::fs::create_dir_all(&user_bin_dir)
                    .map_err(|e| format!("Failed to create bin directory: {}", e))?;
            }
            
            let user_symlink_path = user_bin_dir.join(binary_name);
            
            // Remove existing symlink if it exists
            if user_symlink_path.exists() {
                std::fs::remove_file(&user_symlink_path)
                    .map_err(|e| format!("Failed to remove existing symlink: {}", e))?;
            }
            
            // Create symlink
            std::os::unix::fs::symlink(&binary_path, &user_symlink_path)
                .map_err(|e| format!("Failed to create symlink: {}", e))?;
            
            println!("Successfully created symlink at {} (fallback location)", user_symlink_path.display());
        } else {
            println!("Successfully created symlink at {} with admin privileges", symlink_path.display());
        }
    }

    Ok(())
}

#[tauri::command]
async fn check_podman_installed() -> Result<String, String> {
    println!("Checking if Podman is installed...");
    
    let output = Command::new("podman")
        .arg("--version")
        .output()
        .map_err(|e| {
            println!("Podman check error: {}", e);
            "Podman is not installed".to_string()
        })?;
    
    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).to_string();
        println!("Podman is installed: {}", version);
        Ok(version)
    } else {
        let error = String::from_utf8_lossy(&output.stderr).to_string();
        println!("Podman check failed: {}", error);
        Err("Podman is not installed".to_string())
    }
}

#[tauri::command]
async fn install_podman() -> Result<(), String> {
    println!("Attempting to install Podman...");
    
    // Platform-specific installation
    #[cfg(target_os = "macos")]
    {
        println!("Detected macOS, using Homebrew to install Podman");
        // Try to install with Homebrew
        let output = Command::new("brew")
            .arg("install")
            .arg("podman")
            .output();
        
        if output.is_err() || !output.unwrap().status.success() {
            println!("Failed to install Podman with Homebrew");
            return Err("Failed to install Podman. Please install manually with: brew install podman".to_string());
        }
        println!("Successfully installed Podman with Homebrew");
    }

    #[cfg(target_os = "windows")]
    {
        // Try with winget first
        let output = Command::new("winget")
            .arg("install")
            .arg("RedHat.Podman")
            .output();
            
        if output.is_err() || !output.unwrap().status.success() {
            // Try with chocolatey as fallback
            let choco_output = Command::new("choco")
                .arg("install")
                .arg("podman")
                .arg("-y")
                .output();
                
            if choco_output.is_err() || !choco_output.unwrap().status.success() {
                return Err("Failed to install Podman. Please install manually from https://github.com/containers/podman/releases".to_string());
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Try to detect the package manager and install
        let package_managers = [
            ("apt-get", vec!["install", "-y", "podman"]),
            ("dnf", vec!["install", "-y", "podman"]),
            ("yum", vec!["install", "-y", "podman"]),
            ("pacman", vec!["-S", "--noconfirm", "podman"]),
            ("zypper", vec!["install", "-y", "podman"]),
        ];
        
        let mut installed = false;
        
        for (pm, args) in package_managers.iter() {
            let check_output = Command::new("which")
                .arg(pm)
                .output();
                
            if check_output.is_ok() && check_output.unwrap().status.success() {
                // Use pkexec to get admin privileges
                let mut cmd_args = vec![pm];
                cmd_args.extend(args);
                
                let install_output = Command::new("pkexec")
                    .args(&cmd_args)
                    .output();
                    
                if install_output.is_ok() && install_output.unwrap().status.success() {
                    installed = true;
                    break;
                }
            }
        }
        
        if !installed {
            return Err("Failed to install Podman. Please install manually using your distribution's package manager.".to_string());
        }
    }

    Ok(())
}

fn main() {
    println!("Starting application with Tauri version: {}", tauri::VERSION);
    
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            install_cli_binary, 
            debug_tauri_version,
            check_podman_installed,
            install_podman
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
