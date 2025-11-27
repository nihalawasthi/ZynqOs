use std::fs;
use std::env;

fn main() {
    let args: Vec<String> = env::args().collect();
    let path = if args.len() > 1 { &args[1] } else { "." };
    
    match fs::read_dir(path) {
        Ok(entries) => {
            println!("Listing: {}", path);
            for entry in entries {
                match entry {
                    Ok(e) => {
                        let file_type = if e.path().is_dir() { "DIR " } else { "FILE" };
                        println!("[{}] {}", file_type, e.path().display());
                    }
                    Err(e) => eprintln!("Error reading entry: {}", e),
                }
            }
        }
        Err(e) => {
            eprintln!("Error reading directory '{}': {}", path, e);
            std::process::exit(1);
        }
    }
}
