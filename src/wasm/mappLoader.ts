import JSZip from 'jszip'
import { writeFile } from '../vfs/fs'

export async function loadMapp(blob: Blob) {
  const zip = await JSZip.loadAsync(blob)
  const manifestEntry = zip.file('manifest.json')
  if (!manifestEntry) throw new Error('manifest.json not found inside .mapp')
  const manifest = JSON.parse(await manifestEntry.async('string'))
  for (const filename of Object.keys(zip.files)) {
    if (filename === 'manifest.json') continue
    const file = zip.file(filename)
    if (!file) continue
    const data = await file.async('uint8array')
    // store under /apps/{manifest.name}/{filename}
    const targetPath = `/apps/${manifest.name}/${filename}`
    await writeFile(targetPath, data)
  }
  return manifest
}
