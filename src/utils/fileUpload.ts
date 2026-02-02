/**
 * Centralized file upload utilities for ZynqOS
 * Handles both text and binary files correctly
 */

import { writeFile } from '../vfs/fs'

/**
 * Check if a file should be treated as text based on extension or MIME type
 */
export function isTextFile(fileName: string, mimeType?: string): boolean {
  const textExtensions = [
    'txt', 'md', 'json', 'js', 'ts', 'tsx', 'jsx', 'css', 'html', 'xml', 'svg',
    'py', 'sh', 'bash', 'yml', 'yaml', 'toml', 'ini', 'conf', 'cfg', 'log',
    'csv', 'tsv', 'sql', 'c', 'cpp', 'h', 'hpp', 'java', 'rs', 'go', 'php',
    'rb', 'pl', 'lua', 'r', 'dart', 'swift', 'kt', 'scala', 'clj', 'hs',
    'ml', 'elm', 'ex', 'exs', 'erl', 'vim', 'gitignore', 'dockerfile'
  ]
  
  const ext = fileName.split('.').pop()?.toLowerCase()
  
  // Check extension
  if (ext && textExtensions.includes(ext)) {
    return true
  }
  
  // Check MIME type
  if (mimeType) {
    return mimeType.startsWith('text/') || 
           mimeType === 'application/json' ||
           mimeType === 'application/javascript' ||
           mimeType === 'application/xml'
  }
  
  return false
}

/**
 * Check if a file is binary based on extension
 */
export function isBinaryFile(fileName: string): boolean {
  const binaryExtensions = [
    'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tiff',
    'zip', 'tar', 'gz', 'bz2', 'rar', '7z', 'xz',
    'mp3', 'mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ogg', 'wav',
    'exe', 'dll', 'so', 'dylib', 'a', 'o',
    'wasm', 'bin', 'dat', 'db', 'sqlite', 'mdb',
    'ttf', 'otf', 'woff', 'woff2', 'eot',
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'class', 'jar', 'war', 'ear', 'pyc', 'pyo'
  ]
  
  const ext = fileName.split('.').pop()?.toLowerCase()
  return ext ? binaryExtensions.includes(ext) : false
}

/**
 * Upload a single file to the VFS with automatic text/binary detection
 * @param file - The File object to upload
 * @param targetPath - Target path in VFS (e.g., '/home/test.pdf')
 * @returns Promise that resolves when upload is complete
 */
export async function uploadFile(file: File, targetPath: string): Promise<void> {
  const isText = isTextFile(file.name, file.type)
  const isBinary = isBinaryFile(file.name)
  
  if (isBinary || !isText) {
    // Store binary files as Uint8Array
    const arrayBuffer = await file.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    await writeFile(targetPath, uint8Array)
  } else {
    // Store text files as strings
    const text = await file.text()
    await writeFile(targetPath, text)
  }
}

/**
 * Upload multiple files to a directory
 * @param files - FileList or array of Files to upload
 * @param targetDir - Target directory in VFS (e.g., '/home/imports')
 * @param onProgress - Optional callback for progress updates
 * @returns Promise that resolves with array of uploaded file paths
 */
export async function uploadFiles(
  files: FileList | File[],
  targetDir: string,
  onProgress?: (current: number, total: number, fileName: string) => void
): Promise<string[]> {
  const fileArray = Array.from(files)
  const uploadedPaths: string[] = []
  
  // Ensure target directory exists by creating a .gitkeep file
  const dirMarker = `${targetDir}/.gitkeep`
  try {
    await writeFile(dirMarker, '')
  } catch (e) {
    console.debug('Directory marker creation skipped:', e)
  }
  
  for (let i = 0; i < fileArray.length; i++) {
    const file = fileArray[i]
    const fileName = file.name
    const filePath = `${targetDir}/${fileName}`
    
    onProgress?.(i + 1, fileArray.length, fileName)
    
    await uploadFile(file, filePath)
    uploadedPaths.push(filePath)
  }
  
  return uploadedPaths
}

/**
 * Read a file from VFS and prepare it for download
 * @param vfsPath - Path in VFS to read
 * @returns Blob suitable for download
 */
export async function prepareFileForDownload(vfsPath: string): Promise<Blob> {
  const { readFile } = await import('../vfs/fs')
  const content = await readFile(vfsPath)
  
  if (typeof content === 'string') {
    return new Blob([content], { type: 'text/plain' })
  } else if (content instanceof Uint8Array) {
    // Create a new Uint8Array with standard ArrayBuffer for Blob compatibility
    const buffer = new Uint8Array(content)
    return new Blob([buffer], { type: 'application/octet-stream' })
  } else {
    throw new Error('Invalid file content type')
  }
}

/**
 * Trigger browser download for a VFS file
 * @param vfsPath - Path in VFS to download
 * @param downloadName - Optional custom filename for download
 */
export async function downloadFile(vfsPath: string, downloadName?: string): Promise<void> {
  const blob = await prepareFileForDownload(vfsPath)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = downloadName || vfsPath.split('/').pop() || 'download'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
