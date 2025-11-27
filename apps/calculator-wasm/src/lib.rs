use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn calculate(a: i32, b: i32) -> i32 {
    a + b
}

#[wasm_bindgen]
pub fn concat_operands(a: i32, b: i32) -> String {
    format!("{} + {} = {}", a, b, a + b)
}
