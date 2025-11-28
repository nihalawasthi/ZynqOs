use std::io::{self, Write};
use std::fs;
use std::env;

fn main() {
    println!("ZynqOS Kernel Shell v0.1");
    println!("Type 'help' for available commands");
    println!();

    // Get args - if provided, execute single command and exit
    let args: Vec<String> = env::args().collect();
    if args.len() > 1 {
        let command = args[1..].join(" ");
        execute_command(&command);
        return;
    }

    // Interactive mode would need stdin support
    // For now, just show help
    show_help();
}

fn execute_command(input: &str) {
    let parts: Vec<&str> = input.trim().split_whitespace().collect();
    if parts.is_empty() {
        return;
    }

    match parts[0] {
        "help" => show_help(),
        "ls" => cmd_ls(&parts[1..]),
        "cat" => cmd_cat(&parts[1..]),
        "pwd" => cmd_pwd(),
        "echo" => cmd_echo(&parts[1..]),
        "stat" => cmd_stat(&parts[1..]),
        "version" => cmd_version(),
        _ => println!("Unknown command: {}. Type 'help' for available commands.", parts[0]),
    }
}

fn show_help() {
    println!("Available commands:");
    println!("  help          - Show this help message");
    println!("  ls [path]     - List directory contents");
    println!("  cat <file>    - Display file contents");
    println!("  pwd           - Print working directory");
    println!("  echo <text>   - Echo text to stdout");
    println!("  stat <path>   - Show file/directory information");
    println!("  version       - Show kernel version");
}

fn cmd_ls(args: &[&str]) {
    let path = if args.is_empty() { "." } else { args[0] };
    
    match fs::read_dir(path) {
        Ok(entries) => {
            println!("Directory listing: {}", path);
            println!("{:<40} {:<10} {}", "Name", "Type", "Size");
            println!("{}", "-".repeat(60));
            
            for entry in entries {
                match entry {
                    Ok(e) => {
                        let path = e.path();
                        let file_type = if path.is_dir() { "DIR" } else { "FILE" };
                        let size = if path.is_file() {
                            fs::metadata(&path)
                                .map(|m| m.len().to_string())
                                .unwrap_or_else(|_| "?".to_string())
                        } else {
                            "-".to_string()
                        };
                        println!("{:<40} {:<10} {}", 
                            path.display(), 
                            file_type, 
                            size
                        );
                    }
                    Err(e) => eprintln!("Error reading entry: {}", e),
                }
            }
        }
        Err(e) => eprintln!("Error reading directory '{}': {}", path, e),
    }
}

fn cmd_cat(args: &[&str]) {
    if args.is_empty() {
        eprintln!("Usage: cat <file>");
        return;
    }

    let path = args[0];
    match fs::read_to_string(path) {
        Ok(contents) => print!("{}", contents),
        Err(e) => eprintln!("Error reading file '{}': {}", path, e),
    }
}

fn cmd_pwd() {
    match env::current_dir() {
        Ok(path) => println!("{}", path.display()),
        Err(e) => eprintln!("Error getting current directory: {}", e),
    }
}

fn cmd_echo(args: &[&str]) {
    println!("{}", args.join(" "));
}

fn cmd_stat(args: &[&str]) {
    if args.is_empty() {
        eprintln!("Usage: stat <path>");
        return;
    }

    let path = args[0];
    match fs::metadata(path) {
        Ok(metadata) => {
            println!("File: {}", path);
            println!("Type: {}", if metadata.is_dir() { "Directory" } else { "File" });
            println!("Size: {} bytes", metadata.len());
            println!("Read-only: {}", metadata.permissions().readonly());
        }
        Err(e) => eprintln!("Error stat'ing '{}': {}", path, e),
    }
}

fn cmd_version() {
    println!("ZynqOS Kernel Shell");
    println!("Version: 0.1.0");
    println!("Target: wasm32-wasip1");
    println!("Build: Release");
}
