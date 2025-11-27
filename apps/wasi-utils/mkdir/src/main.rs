use std::env;
use std::fs;

fn main() {
    let args: Vec<String> = env::args().collect();
    
    if args.len() < 2 {
        eprintln!("Usage: mkdir <directory>");
        std::process::exit(1);
    }
    
    let path = &args[1];
    
    match fs::create_dir_all(path) {
        Ok(_) => println!("Created directory: {}", path),
        Err(e) => {
            eprintln!("Error creating directory '{}': {}", path, e);
            std::process::exit(1);
        }
    }
}
