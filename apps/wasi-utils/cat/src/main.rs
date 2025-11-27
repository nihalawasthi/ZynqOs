use std::fs;
use std::env;
use std::io::{self, Read};

fn main() {
    let args: Vec<String> = env::args().collect();
    
    if args.len() < 2 {
        eprintln!("Usage: cat <file>");
        std::process::exit(1);
    }
    
    let path = &args[1];
    
    match fs::File::open(path) {
        Ok(mut file) => {
            let mut contents = String::new();
            match file.read_to_string(&mut contents) {
                Ok(_) => print!("{}", contents),
                Err(e) => {
                    eprintln!("Error reading file: {}", e);
                    std::process::exit(1);
                }
            }
        }
        Err(e) => {
            eprintln!("Error opening file '{}': {}", path, e);
            std::process::exit(1);
        }
    }
}
