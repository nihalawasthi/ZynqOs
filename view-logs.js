#!/usr/bin/env node

/**
 * Quick utility to view GitHub API logs
 * 
 * Usage:
 *   node view-logs.js [lines=100]
 * 
 * Or via API:
 *   curl http://localhost:3000/api?route=logs&type=github&lines=50
 */

import fs from 'fs'
import path from 'path'

const LOG_DIR = process.env.LOG_DIR || './logs'
const GITHUB_LOG_FILE = path.join(LOG_DIR, 'github-api.log')
const API_LOG_FILE = path.join(LOG_DIR, 'api.log')

function readLogs(filePath, numLines = 100) {
  try {
    if (!fs.existsSync(filePath)) {
      return `Log file not found: ${filePath}\nLogs will be created when GitHub API calls are made.`
    }
    
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n').filter(l => l.trim())
    
    // Show last N lines
    const selectedLines = lines.slice(-numLines)
    
    // Pretty print JSON logs
    const formatted = selectedLines.map((line, idx) => {
      try {
        const obj = JSON.parse(line)
        return `[${idx + 1}] ${JSON.stringify(obj, null, 2)}`
      } catch {
        return `[${idx + 1}] ${line}`
      }
    }).join('\n' + '='.repeat(80) + '\n')
    
    return `\n${'='.repeat(80)}\nShowing last ${Math.min(numLines, selectedLines.length)} entries from ${path.basename(filePath)}\n${'='.repeat(80)}\n\n${formatted}`
  } catch (e) {
    return `Error reading logs: ${e instanceof Error ? e.message : String(e)}`
  }
}

function main() {
  const numLines = Number(process.argv[2] || 100)
  const logType = process.argv[3] || 'github' // 'github' or 'api'
  
  const filePath = logType === 'api' ? API_LOG_FILE : GITHUB_LOG_FILE
  const output = readLogs(filePath, numLines)
  
  console.log(output)
  
  // Also show file path info
  console.log('\n' + '='.repeat(80))
  console.log(`Log file: ${filePath}`)
  console.log('Usage: node view-logs.js [lines] [type]')
  console.log('Examples:')
  console.log('  node view-logs.js 50          # Last 50 GitHub API logs')
  console.log('  node view-logs.js 20 api      # Last 20 API event logs')
  console.log('  node view-logs.js 100 github  # Last 100 GitHub API logs')
}

main()
