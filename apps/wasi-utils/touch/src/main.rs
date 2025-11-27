use std::env;
use std::fs::OpenOptions;
use std::io::Write;

fn main() {
    let args: Vec<String> = env::args().collect();
    
    if args.len() < 2 {
        eprintln!("Usage: touch <file>");
        std::process::exit(1);
    }
    
    let path = &args[1];
    
    match OpenOptions::new()
        .create(true)
        .write(true)
        .open(path)
    {
        Ok(mut file) => {
            // Optionally write empty content to ensure file exists
            let _ = file.write_all(b"");
            println!("Created/updated: {}", path);
        }
        Err(e) => {
            eprintln!("Error touching file '{}': {}", path, e);
            std::process::exit(1);
        }
    }
}
