// Terminal Bridge for Wednesday AI Assistant
// This module handles communication between Wednesday and the Terminal app

export interface TerminalCommand {
  command: string
  timestamp: Date
}

export interface TerminalOutput {
  output: string
  exitCode: number
  timestamp: Date
}

// Event system for terminal communication
type TerminalEventCallback = (output: TerminalOutput) => void

class TerminalBridge {
  private callbacks: Map<string, TerminalEventCallback> = new Map()
  private commandQueue: TerminalCommand[] = []

  /**
   * Execute a command in the terminal and get the output
   */
  async executeCommand(command: string): Promise<TerminalOutput> {
    return new Promise((resolve) => {
      const commandId = `cmd_${Date.now()}_${Math.random()}`
      
      // Register callback for this command
      this.callbacks.set(commandId, (output) => {
        this.callbacks.delete(commandId)
        resolve(output)
      })

      // Queue the command
      this.commandQueue.push({
        command,
        timestamp: new Date()
      })

      // Dispatch event to terminal
      const event = new CustomEvent('wednesday:execute-command', {
        detail: {
          commandId,
          command,
          timestamp: new Date()
        }
      })
      window.dispatchEvent(event)

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.callbacks.has(commandId)) {
          this.callbacks.delete(commandId)
          resolve({
            output: `Command timeout: ${command}`,
            exitCode: 124,
            timestamp: new Date()
          })
        }
      }, 30000)
    })
  }

  /**
   * Handle output from terminal
   */
  handleTerminalOutput(commandId: string, output: string, exitCode: number = 0) {
    const callback = this.callbacks.get(commandId)
    if (callback) {
      callback({
        output,
        exitCode,
        timestamp: new Date()
      })
    }
  }

  /**
   * Check if terminal is available
   */
  isTerminalAvailable(): boolean {
    return typeof (window as any).__TERMINAL_UI__ !== 'undefined'
  }

  /**
   * Get command history
   */
  getCommandHistory(): TerminalCommand[] {
    return [...this.commandQueue]
  }

  /**
   * Clear command history
   */
  clearHistory() {
    this.commandQueue = []
  }
}

// Singleton instance
export const terminalBridge = new TerminalBridge()

// Listen for terminal output events
if (typeof window !== 'undefined') {
  window.addEventListener('terminal:command-output', ((event: CustomEvent) => {
    const { commandId, output, exitCode } = event.detail
    terminalBridge.handleTerminalOutput(commandId, output, exitCode)
  }) as EventListener)
}

/**
 * Helper function to determine if a command should be executed in terminal
 */
export function isTerminalCommand(command: string): boolean {
  const terminalCommands = [
    // Basic file operations
    'ls', 'cat', 'mkdir', 'rm', 'touch', 'cd', 'pwd', 'cp', 'mv',
    
    // File viewing/editing
    'head', 'tail', 'less', 'more', 'nano', 'vi', 'vim',
    
    // Text processing
    'grep', 'sed', 'awk', 'cut', 'sort', 'uniq', 'wc', 'tr',
    
    // System info
    'whoami', 'date', 'uname', 'hostname', 'uptime', 'ps', 'top',

    // Remote network/tools
    'curl', 'wget', 'nmap', 'dig', 'nslookup', 'traceroute',
    'git', 'npm', 'pnpm', 'apt', 'apt-get',
    
    // File search/info
    'find', 'locate', 'which', 'whereis', 'file', 'stat',
    
    // Archive operations
    'tar', 'zip', 'unzip', 'gzip', 'gunzip',
    
    // Network (if implemented)
    'wget', 'curl', 'ping',
    
    // ZynqOS specific
    'clear', 'help', 'tree', 'run', 'bash', 'sh', 'coreutils',
    
    // Output control
    'echo', 'printf', 'tee'
  ]
  
  const firstWord = command.trim().split(/\s+/)[0].toLowerCase()
  return terminalCommands.includes(firstWord)
}

/**
 * Parse command to extract command name and arguments
 */
export function parseCommand(command: string): { cmd: string; args: string[] } {
  const parts = command.trim().split(/\s+/)
  return {
    cmd: parts[0],
    args: parts.slice(1)
  }
}
