/**
 * File type detection utilities for ZynqOS VFS
 */

// Text file extensions that should be treated as editable text
const TEXT_EXTENSIONS = [
  // Documents
  '.txt', '.md', '.markdown', '.rst', '.adoc',
  
  // Web
  '.html', '.htm', '.xml', '.svg', '.css', '.scss', '.sass', '.less',
  
  // JavaScript/TypeScript
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  
  // Configuration
  '.json', '.jsonc', '.json5', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.config',
  
  // Shell/Scripts
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  
  // Programming Languages
  '.py', '.pyw', '.rs', '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx',
  '.java', '.kt', '.kts', '.go', '.rb', '.php', '.sql', '.r', '.R',
  '.swift', '.m', '.mm', '.cs', '.vb', '.fs', '.fsx', '.dart', '.lua',
  '.pl', '.pm', '.perl', '.scala', '.clj', '.cljs', '.edn',
  
  // Data
  '.csv', '.tsv', '.log', '.env', '.properties',
  
  // Others
  '.vim', '.gitignore', '.gitattributes', '.dockerignore', '.editorconfig',
  '.htaccess', '.nginx', '.Makefile', '.make',
]

// Binary file extensions that should NOT be treated as text
const BINARY_EXTENSIONS = [
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg', '.tiff', '.tif',
  
  // Audio
  '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.wma',
  
  // Video
  '.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm',
  
  // Archives
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar', '.xz', '.zst',
  
  // Executables
  '.exe', '.dll', '.so', '.dylib', '.wasm', '.bin',
  
  // Documents (binary formats)
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  
  // Databases
  '.db', '.sqlite', '.sqlite3', '.mdb',
  
  // Fonts
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
]

/**
 * Check if a file should be treated as text based on extension
 */
export function isTextFile(filename: string): boolean {
  const lower = filename.toLowerCase()
  
  // Check text extensions
  if (TEXT_EXTENSIONS.some(ext => lower.endsWith(ext))) {
    return true
  }
  
  // Check if it's a known binary format
  if (BINARY_EXTENSIONS.some(ext => lower.endsWith(ext))) {
    return false
  }
  
  // Files without extensions or unknown extensions - check content
  return false // Default to binary for safety
}

/**
 * Check if file content appears to be text by inspecting bytes
 */
export function isTextContent(data: Uint8Array): boolean {
  // Check first 512 bytes for null bytes and control characters
  const checkLength = Math.min(512, data.length)
  let nullBytes = 0
  let controlChars = 0
  
  for (let i = 0; i < checkLength; i++) {
    const byte = data[i]
    
    // Null bytes are strong indicator of binary
    if (byte === 0) {
      nullBytes++
    }
    
    // Control characters (except common ones like tab, newline, carriage return)
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      controlChars++
    }
  }
  
  // If more than 1% null bytes or control chars, likely binary
  const threshold = checkLength * 0.01
  return nullBytes < threshold && controlChars < threshold * 2
}

/**
 * Detect MIME type based on file extension
 */
export function getMimeType(filename: string): string {
  const lower = filename.toLowerCase()
  
  // Text formats
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html'
  if (lower.endsWith('.css')) return 'text/css'
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'text/javascript'
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.xml')) return 'application/xml'
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown'
  if (lower.endsWith('.csv')) return 'text/csv'
  if (lower.endsWith('.txt')) return 'text/plain'
  
  // Programming languages
  if (lower.endsWith('.py')) return 'text/x-python'
  if (lower.endsWith('.rs')) return 'text/x-rust'
  if (lower.endsWith('.go')) return 'text/x-go'
  if (lower.endsWith('.java')) return 'text/x-java'
  if (lower.endsWith('.c') || lower.endsWith('.h')) return 'text/x-c'
  if (lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.hpp')) return 'text/x-c++src'
  
  // Binary formats
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.zip')) return 'application/zip'
  if (lower.endsWith('.wasm')) return 'application/wasm'
  
  // Default
  return isTextFile(filename) ? 'text/plain' : 'application/octet-stream'
}

/**
 * Get a human-readable file type description
 */
export function getFileTypeDescription(filename: string): string {
  const lower = filename.toLowerCase()
  
  // Web
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'HTML Document'
  if (lower.endsWith('.css')) return 'CSS Stylesheet'
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'JavaScript'
  if (lower.endsWith('.ts')) return 'TypeScript'
  if (lower.endsWith('.jsx')) return 'React JavaScript'
  if (lower.endsWith('.tsx')) return 'React TypeScript'
  
  // Data
  if (lower.endsWith('.json')) return 'JSON Data'
  if (lower.endsWith('.xml')) return 'XML Document'
  if (lower.endsWith('.csv')) return 'CSV Data'
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'YAML Configuration'
  
  // Documents
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'Markdown Document'
  if (lower.endsWith('.txt')) return 'Text File'
  
  // Programming
  if (lower.endsWith('.py')) return 'Python Script'
  if (lower.endsWith('.rs')) return 'Rust Source'
  if (lower.endsWith('.go')) return 'Go Source'
  if (lower.endsWith('.java')) return 'Java Source'
  if (lower.endsWith('.c')) return 'C Source'
  if (lower.endsWith('.cpp') || lower.endsWith('.cc')) return 'C++ Source'
  if (lower.endsWith('.h') || lower.endsWith('.hpp')) return 'C/C++ Header'
  if (lower.endsWith('.sh') || lower.endsWith('.bash')) return 'Shell Script'
  
  // Binary
  if (lower.endsWith('.wasm')) return 'WebAssembly Binary'
  if (lower.endsWith('.png')) return 'PNG Image'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'JPEG Image'
  if (lower.endsWith('.gif')) return 'GIF Image'
  if (lower.endsWith('.pdf')) return 'PDF Document'
  if (lower.endsWith('.zip')) return 'ZIP Archive'
  
  // Generic
  if (isTextFile(filename)) return 'Text File'
  return 'Binary File'
}

/**
 * Check if file should be editable in text editor
 */
export function isEditable(filename: string, content?: Uint8Array): boolean {
  // Check by extension first
  if (isTextFile(filename)) {
    return true
  }
  
  // If content provided, check if it's text
  if (content && isTextContent(content)) {
    return true
  }
  
  return false
}

/**
 * Try to decode content as text with fallback
 */
export function tryDecodeText(data: Uint8Array): string | null {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    return decoder.decode(data)
  } catch {
    // Not valid UTF-8, might be binary
    if (isTextContent(data)) {
      // Try with latin1 fallback
      try {
        const decoder = new TextDecoder('latin1')
        return decoder.decode(data)
      } catch {
        return null
      }
    }
    return null
  }
}
