// Terminal Integration for Wednesday AI Assistant
// Add this code to src/apps/terminal/ui.tsx to enable Wednesday integration

/**
 * Add this useEffect hook to the TerminalWasi component to listen for
 * commands from Wednesday AI Assistant
 */

/*
useEffect(() => {
  const handleWednesdayCommand = async (event: CustomEvent) => {
    const { commandId, command, timestamp } = event.detail
    
    if (!xtermRef.current) {
      // Send error if terminal not ready
      const errorEvent = new CustomEvent('terminal:command-output', {
        detail: {
          commandId,
          output: 'Terminal not initialized',
          exitCode: 1
        }
      })
      window.dispatchEvent(errorEvent)
      return
    }

    // Write command to terminal display
    const term = xtermRef.current
    term.writeln(`\r\n\x1b[36m[Wednesday]\x1b[0m $ ${command}`)
    
    try {
      // Execute the command using existing terminal infrastructure
      // This will vary based on your terminal implementation
      
      // For WASI commands - use existing command execution logic
      const output = await executeCommandInternal(command)
      
      // Send output back to Wednesday
      const outputEvent = new CustomEvent('terminal:command-output', {
        detail: {
          commandId,
          output: output.trim() || '(Command completed)',
          exitCode: 0
        }
      })
      window.dispatchEvent(outputEvent)
      
      // Also display in terminal
      if (output.trim()) {
        term.writeln(output)
      }
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      
      // Send error to Wednesday
      const errorEvent = new CustomEvent('terminal:command-output', {
        detail: {
          commandId,
          output: `Error: ${errorMsg}`,
          exitCode: 1
        }
      })
      window.dispatchEvent(errorEvent)
      
      // Display error in terminal
      term.writeln(`\x1b[31mError: ${errorMsg}\x1b[0m`)
    }
  }
  
  window.addEventListener('wednesday:execute-command', handleWednesdayCommand as EventListener)
  
  return () => {
    window.removeEventListener('wednesday:execute-command', handleWednesdayCommand as EventListener)
  }
}, [])
*/

/**
 * Helper function to execute commands internally
 * This should integrate with your existing command execution logic
 */

/*
async function executeCommandInternal(cmdLine: string): Promise<string> {
  const parts = cmdLine.trim().split(/\s+/)
  const cmd = parts[0]
  const args = parts.slice(1)
  
  // Use existing VFS and WASI infrastructure
  // This is a simplified example - adapt to your terminal's implementation
  
  let outputLines: string[] = []
  
  switch (cmd) {
    case 'ls':
      // Use existing ls implementation
      const path = args[0] || currentDirRef.current
      const entries = await listDirectory(path)
      outputLines = entries
      break
      
    case 'cat':
      // Use existing cat implementation
      if (!args[0]) throw new Error('cat: missing file operand')
      const content = await readFile(args[0])
      outputLines = [content]
      break
      
    case 'pwd':
      outputLines = [currentDirRef.current]
      break
      
    case 'echo':
      outputLines = [args.join(' ')]
      break
      
    // Add other commands as needed
    // For bash/coreutils commands, use wasmer integration
    
    default:
      // Try executing via bash/coreutils
      if (wasmerReadyRef.current && bashSessionRef.current) {
        const result = await runBashCommand(cmdLine, bashSessionRef.current)
        outputLines = [result.output]
      } else {
        throw new Error(`Command not found: ${cmd}`)
      }
  }
  
  return outputLines.join('\n')
}
*/

// INTEGRATION CHECKLIST:
// [ ] Add the useEffect hook to TerminalWasi component
// [ ] Implement executeCommandInternal() or adapt to your existing command execution
// [ ] Test with basic commands: ls, pwd, echo
// [ ] Test with complex commands: grep, find, cat
// [ ] Verify error handling
// [ ] Test with non-existent commands
// [ ] Verify output formatting

// EXAMPLE USAGE FROM WEDNESDAY:
// User types in Wednesday: "ls /home"
// 1. Wednesday detects it's a terminal command
// 2. Wednesday dispatches 'wednesday:execute-command' event
// 3. Terminal receives event and executes 'ls /home'
// 4. Terminal dispatches 'terminal:command-output' with results
// 5. Wednesday displays the output in chat

// DEBUGGING TIPS:
// - Check browser console for event dispatching
// - Verify event listeners are registered
// - Check commandId matching between request and response
// - Test terminal commands independently first
// - Use console.log in both Wednesday and Terminal for debugging
