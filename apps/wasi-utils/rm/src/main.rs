use std::env;
use std::fs;
use std::path::Path;

fn main() {
    let args: Vec<String> = env::args().collect();
    
    if args.len() < 2 {
        eprintln!("Usage: rm <file|directory>");
        std::process::exit(1);
    }
    
    let path = &args[1];
    let p = Path::new(path);
    
    if !p.exists() {
        eprintln!("Error: Path '{}' does not exist", path);
        std::process::exit(1);
    }
    
    let result = if p.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    
    match result {
        Ok(_) => println!("Removed: {}", path),
        Err(e) => {
            eprintln!("Error removing '{}': {}", path, e);
            std::process::exit(1);
        }
    }
}
