use std::env;
use std::fs;

fn main() {
    println!("WASI sample — hello from Rust!");
    let args: Vec<String> = env::args().collect();
    println!("args: {:?}", args);

    // Try to read /input.txt if present (demonstrates file access)
    match fs::read_to_string("/input.txt") {
        Ok(s) => {
            println!("Read /input.txt contents:");
            println!("---");
            println!("{}", s);
            println!("---");
        }
        Err(_) => {
            println!("No /input.txt found (that's fine).");
        }
    }

    // demonstrate exit code 0
}
