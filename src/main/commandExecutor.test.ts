/**
 * Tests for CommandExecutor Module
 * 
 * Feature: dev-tools-manager
 * Tests Properties 21 and 22 from the design document
 */

import { describe, it, expect, beforeEach } from 'vitest'
import fc from 'fast-check'
import * as fs from 'fs'
import {
  getPlatform,
  isWindows,
  isMacOS,
  isLinux,
  getWhichCommand,
  normalizePath,
  execute,
  executeSafe,
  executeFileCommand,
  CommandExecutor,
} from './commandExecutor'

describe('CommandExecutor', () => {
  describe('Platform Detection', () => {
    it('should return a valid platform', () => {
      const platform = getPlatform()
      expect(['win32', 'darwin', 'linux']).toContain(platform)
    })

    it('should have consistent platform checks', () => {
      const platform = getPlatform()
      if (platform === 'win32') {
        expect(isWindows()).toBe(true)
        expect(isMacOS()).toBe(false)
        expect(isLinux()).toBe(false)
      } else if (platform === 'darwin') {
        expect(isWindows()).toBe(false)
        expect(isMacOS()).toBe(true)
        expect(isLinux()).toBe(false)
      } else if (platform === 'linux') {
        expect(isWindows()).toBe(false)
        expect(isMacOS()).toBe(false)
        expect(isLinux()).toBe(true)
      }
    })
  })

  describe('getWhichCommand', () => {
    /**
     * Feature: dev-tools-manager, Property 21: Platform-Specific Command Selection
     * **Validates: Requirements 12.4, 12.6**
     * 
     * For any operation requiring system commands, the system should select
     * the appropriate command for the current platform.
     */
    it('should return platform-specific which command', () => {
      const toolName = 'node'
      const command = getWhichCommand(toolName)
      
      if (isWindows()) {
        expect(command).toBe(`where ${toolName}`)
      } else {
        expect(command).toBe(`which ${toolName}`)
      }
    })

    // Property-based test for getWhichCommand
    it('should always include the tool name in the command', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes(' ') && !s.includes('\n')),
          (toolName) => {
            const command = getWhichCommand(toolName)
            return command.includes(toolName)
          }
        ),
        { numRuns: 100 }
      )
    })
  })

  describe('normalizePath', () => {
    /**
     * Feature: dev-tools-manager, Property 22: Platform-Specific Path Handling
     * **Validates: Requirements 12.5**
     * 
     * For any file path returned by system commands, the system should
     * correctly parse it according to the platform's path format.
     */
    it('should handle empty paths', () => {
      expect(normalizePath('')).toBe('')
      expect(normalizePath('   ')).toBe('')
    })

    it('should trim whitespace from paths', () => {
      const path = '  /usr/bin/node  '
      const normalized = normalizePath(path)
      expect(normalized).not.toMatch(/^\s/)
      expect(normalized).not.toMatch(/\s$/)
    })

    // Property-based test for path normalization
    it('should always trim whitespace from paths', () => {
      fc.assert(
        fc.property(
          fc.string(),
          (path) => {
            const normalized = normalizePath(path)
            // Result should be trimmed
            return normalized === normalized.trim()
          }
        ),
        { numRuns: 100 }
      )
    })

    it('should normalize path separators based on platform', () => {
      if (isWindows()) {
        expect(normalizePath('/usr/bin/node')).toBe('\\usr\\bin\\node')
      } else {
        expect(normalizePath('C:\\Program Files\\node')).toBe('C:/Program Files/node')
      }
    })
  })

  describe('execute', () => {
    it('should execute a simple command successfully', async () => {
      // Use a cross-platform command
      const command = isWindows() ? 'echo hello' : 'echo hello'
      const result = await execute(command)
      
      expect(result.success).toBe(true)
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('hello')
    })

    it('should handle command not found', async () => {
      const result = await execute('nonexistent_command_12345')
      
      expect(result.success).toBe(false)
      expect(result.exitCode).not.toBe(0)
    })

    it('should handle timeout', async () => {
      // Use a command that takes time
      const command = isWindows() ? 'ping -n 10 127.0.0.1' : 'sleep 10'
      const result = await execute(command, { timeout: 100 })
      
      expect(result.success).toBe(false)
      expect(result.stderr).toContain('timed out')
    })

    it('should augment PATH for child processes on Unix-like systems', async () => {
      if (isWindows()) return

      const result = await execute('echo $PATH', { env: { PATH: '' } })
      expect(result.success).toBe(true)

      const entries = result.stdout.trim().split(':').filter(Boolean)
      expect(entries).toContain('/usr/bin')
      expect(entries).toContain('/bin')

      if (isMacOS() && fs.existsSync('/opt/homebrew/bin')) {
        expect(entries).toContain('/opt/homebrew/bin')
      }
    })
  })

  describe('executeSafe', () => {
    /**
     * Feature: dev-tools-manager, Property 11: Partial Failure Resilience
     * 
     * executeSafe should never throw and always return a CommandResult
     */
    it('should never throw for any command', async () => {
      const commands = [
        'echo test',
        'nonexistent_command',
        '',
        'node --version',
      ]
      
      for (const cmd of commands) {
        const result = await executeSafe(cmd)
        expect(result).toHaveProperty('stdout')
        expect(result).toHaveProperty('stderr')
        expect(result).toHaveProperty('exitCode')
        expect(result).toHaveProperty('success')
      }
    })

    // Property-based test for executeSafe
    it('should always return a valid CommandResult structure', () => {
      fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 20 }),
          async (command) => {
            const result = await executeSafe(command)
            return (
              typeof result.stdout === 'string' &&
              typeof result.stderr === 'string' &&
              typeof result.exitCode === 'number' &&
              typeof result.success === 'boolean'
            )
          }
        ),
        { numRuns: 10 } // Limited runs due to actual command execution
      )
    })
  })

  describe('executeFileCommand', () => {
    it('should execute command with explicit args successfully', async () => {
      const result = await executeFileCommand(process.execPath, ['--version'])

      expect(result.success).toBe(true)
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toMatch(/^v\d+/)
    })

    it('should not interpret shell metacharacters in args', async () => {
      const script = 'console.log(process.argv[1])'
      const arg = 'hello; rm -rf /'
      const result = await executeFileCommand(process.execPath, ['-e', script, arg])

      expect(result.success).toBe(true)
      expect(result.stdout.trim()).toBe(arg)
    })

    it('should not execute command substitution in args', async () => {
      const script = 'console.log(process.argv[1])'
      const arg = '$(echo injected)'
      const result = await executeFileCommand(process.execPath, ['-e', script, arg])

      expect(result.success).toBe(true)
      expect(result.stdout.trim()).toBe(arg)
    })
  })

  describe('CommandExecutor class', () => {
    let executor: CommandExecutor

    beforeEach(() => {
      executor = new CommandExecutor()
    })

    it('should execute commands', async () => {
      const result = await executor.execute('echo test')
      expect(result.success).toBe(true)
    })

    it('should execute command files', async () => {
      const result = await executor.executeFile(process.execPath, ['--version'])
      expect(result.success).toBe(true)
    })

    it('should get platform', () => {
      const platform = executor.getPlatform()
      expect(['win32', 'darwin', 'linux']).toContain(platform)
    })

    it('should check if Windows', () => {
      expect(typeof executor.isWindows()).toBe('boolean')
    })

    it('should get platform command', () => {
      const cmd = executor.getPlatformCommand('node')
      expect(cmd).toContain('node')
    })
  })
})
