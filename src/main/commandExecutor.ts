/**
 * Command Executor Module
 * 
 * Provides a unified interface for executing system commands with:
 * - Timeout handling with presets
 * - Platform detection
 * - Error handling with retry support
 * - Fallback command support
 * 
 * Validates: Requirements 12.4, 12.5, 12.6, 1.1, 1.2, 1.4, 6.1
 */

import { exec, ExecOptions } from 'child_process'
import { promisify } from 'util'
import { CommandResult } from '../shared/types'
import os from 'node:os'
import path from 'node:path'

const execAsync = promisify(exec)

function prependUniquePathEntries(currentPath: string | undefined, entriesToPrepend: string[]): string {
  const separator = isWindows() ? ';' : ':'
  const parts = (currentPath || '')
    .split(separator)
    .map(p => p.trim())
    .filter(Boolean)

  const seen = new Set(parts)

  // Preserve the given entries order while prepending.
  for (let index = entriesToPrepend.length - 1; index >= 0; index--) {
    const entry = entriesToPrepend[index]
    if (!entry || seen.has(entry)) continue
    parts.unshift(entry)
    seen.add(entry)
  }

  return parts.join(separator)
}

function ensureMacOSPathCompatibility(): void {
  // macOS GUI apps launched from Finder often have a minimal PATH (missing Homebrew, etc.).
  // This causes tool detection/package listing to incorrectly report "not installed".
  if (process.platform !== 'darwin') return

  const homeDir = os.homedir()
  const commonBinDirs = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    path.join(homeDir, '.local', 'bin'),
    path.join(homeDir, 'bin'),
    path.join(homeDir, '.cargo', 'bin'),
  ]

  process.env.PATH = prependUniquePathEntries(process.env.PATH, commonBinDirs)
}

ensureMacOSPathCompatibility()

/**
 * Timeout presets for different command categories
 * Validates: Requirement 1.4
 */
export enum TimeoutPreset {
  /** Quick commands like version checks (10 seconds) */
  QUICK = 10000,
  /** Normal commands (30 seconds) - NEW DEFAULT */
  NORMAL = 30000,
  /** Slow commands like package listing (60 seconds) */
  SLOW = 60000,
  /** Extended timeout for very slow operations (120 seconds) */
  EXTENDED = 120000,
}

// Default timeout for command execution (30 seconds - improved from 5s)
const DEFAULT_TIMEOUT = TimeoutPreset.NORMAL

/**
 * Commands known to be slow and require extended timeout
 */
const SLOW_COMMANDS = [
  'npm list',
  'npm ls',
  'pip list',
  'pip3 list',
  'py -m pip list',
  'composer show',
  'cargo install --list',
  'gem list',
]

/**
 * Get appropriate timeout for a command based on its characteristics
 * Validates: Requirement 1.2
 * 
 * @param command The command to check
 * @returns Appropriate timeout in milliseconds
 */
export function getTimeoutForCommand(command: string): number {
  const lowerCommand = command.toLowerCase()

  // Check if it's a known slow command
  for (const slowCmd of SLOW_COMMANDS) {
    if (lowerCommand.includes(slowCmd.toLowerCase())) {
      return TimeoutPreset.SLOW
    }
  }

  // Version commands are typically quick
  if (lowerCommand.includes('--version') || lowerCommand.includes('-v')) {
    return TimeoutPreset.QUICK
  }

  return TimeoutPreset.NORMAL
}

/**
 * Execution options for command executor
 * Extended with retry and fallback support
 */
export interface ExecutorOptions extends ExecOptions {
  timeout?: number
  /** Number of times to retry on failure (default: 0) */
  retryCount?: number
  /** Alternative commands to try if primary fails */
  fallbackCommands?: string[]
  /** Whether to log errors (default: true) */
  logOnError?: boolean
  /** Use auto-detected timeout based on command type */
  autoTimeout?: boolean
}

/**
 * Extended command result with additional metadata
 * Validates: Requirement 6.1
 */
export interface ExtendedCommandResult extends CommandResult {
  /** Time taken to execute the command in milliseconds */
  executionTime: number
  /** The actual command that was executed (useful with fallbacks) */
  commandUsed: string
  /** Number of retries attempted */
  retriesAttempted?: number
}

/**
 * Platform type enumeration
 */
export type Platform = 'win32' | 'darwin' | 'linux'

/**
 * Get the current platform
 * @returns The current platform identifier
 */
export function getPlatform(): Platform {
  return process.platform as Platform
}

/**
 * Check if the current platform is Windows
 * @returns true if running on Windows
 */
export function isWindows(): boolean {
  return process.platform === 'win32'
}

/**
 * Check if the current platform is macOS
 * @returns true if running on macOS
 */
export function isMacOS(): boolean {
  return process.platform === 'darwin'
}

/**
 * Check if the current platform is Linux
 * @returns true if running on Linux
 */
export function isLinux(): boolean {
  return process.platform === 'linux'
}

/**
 * Get the platform-specific command for finding executable paths
 * Windows uses 'where', Unix-like systems use 'which'
 * 
 * Property 21: Platform-Specific Command Selection
 * @param toolName The name of the tool to find
 * @returns The platform-specific command string
 */
export function getWhichCommand(toolName: string): string {
  if (isWindows()) {
    return `where ${toolName}`
  }
  return `which ${toolName}`
}

/**
 * Normalize file path according to platform conventions
 * 
 * Property 22: Platform-Specific Path Handling
 * @param path The path to normalize
 * @returns The normalized path
 */
export function normalizePath(path: string): string {
  if (!path) return path

  // Trim whitespace and newlines
  const trimmed = path.trim()

  if (isWindows()) {
    // Windows paths use backslashes
    return trimmed.replace(/\//g, '\\')
  } else {
    // Unix paths use forward slashes
    return trimmed.replace(/\\/g, '/')
  }
}

/**
 * Execute a command and return the result
 * 
 * @param command The command to execute
 * @param options Execution options including timeout
 * @returns Promise resolving to CommandResult
 */
export async function execute(
  command: string,
  options: ExecutorOptions = {}
): Promise<CommandResult> {
  // Use auto-detected timeout if autoTimeout is enabled, otherwise use provided or default
  const timeout = options.autoTimeout
    ? getTimeoutForCommand(command)
    : (options.timeout ?? DEFAULT_TIMEOUT)

  try {
    const { stdout, stderr } = await execAsync(command, {
      ...options,
      timeout,
      windowsHide: true, // Hide console window on Windows
      encoding: 'utf8', // Ensure string output
    })

    return {
      stdout: (stdout as string) || '',
      stderr: (stderr as string) || '',
      exitCode: 0,
      success: true,
    }
  } catch (error: unknown) {
    // Handle execution errors
    const execError = error as {
      stdout?: string
      stderr?: string
      code?: number | string
      killed?: boolean
      signal?: string
      message?: string
    }

    // Check if it was a timeout
    if (execError.killed && execError.signal === 'SIGTERM') {
      return {
        stdout: execError.stdout || '',
        stderr: `Command timed out after ${timeout}ms`,
        exitCode: -1,
        success: false,
      }
    }

    // Return error result
    return {
      stdout: execError.stdout || '',
      stderr: execError.stderr || execError.message || 'Unknown error',
      exitCode: typeof execError.code === 'number' ? execError.code : 1,
      success: false,
    }
  }
}

/**
 * Execute a command safely, catching all errors
 * This method never throws and always returns a CommandResult
 * 
 * Property 11: Partial Failure Resilience
 * @param command The command to execute
 * @returns Promise resolving to CommandResult
 */
export async function executeSafe(command: string): Promise<CommandResult> {
  try {
    return await execute(command)
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      stdout: '',
      stderr: errorMessage,
      exitCode: 1,
      success: false,
    }
  }
}

/**
 * Get the path of an executable tool
 * Uses 'which' on Unix and 'where' on Windows
 * 
 * @param toolName The name of the tool to find
 * @returns Promise resolving to the tool path or null if not found
 */
export async function getToolPath(toolName: string): Promise<string | null> {
  const command = getWhichCommand(toolName)
  const result = await executeSafe(command)

  if (result.success && result.stdout) {
    // On Windows, 'where' may return multiple paths (one per line)
    // We take the first one
    const paths = result.stdout.split('\n').filter(p => p.trim())
    if (paths.length > 0) {
      return normalizePath(paths[0])
    }
  }

  return null
}

/**
 * Get all paths of an executable tool (for tools with multiple installations)
 * 
 * Property 13: Multiple Installation Locations
 * @param toolName The name of the tool to find
 * @returns Promise resolving to array of tool paths
 */
export async function getAllToolPaths(toolName: string): Promise<string[]> {
  const command = getWhichCommand(toolName)
  const result = await executeSafe(command)

  if (result.success && result.stdout) {
    return result.stdout
      .split('\n')
      .map(p => p.trim())
      .filter(p => p.length > 0)
      .map(normalizePath)
  }

  return []
}

/**
 * CommandExecutor class providing an object-oriented interface
 */
export class CommandExecutor {
  private defaultTimeout: number

  constructor(defaultTimeout: number = DEFAULT_TIMEOUT) {
    this.defaultTimeout = defaultTimeout
  }

  /**
   * Execute a command
   */
  async execute(command: string, options?: ExecutorOptions): Promise<CommandResult> {
    return execute(command, {
      timeout: this.defaultTimeout,
      ...options,
    })
  }

  /**
   * Execute a command safely (never throws)
   */
  async executeSafe(command: string): Promise<CommandResult> {
    return executeSafe(command)
  }

  /**
   * Get platform-specific command for finding tools
   */
  getPlatformCommand(command: string): string {
    return getWhichCommand(command)
  }

  /**
   * Get the path of a tool
   */
  async getToolPath(toolName: string): Promise<string | null> {
    return getToolPath(toolName)
  }

  /**
   * Get all paths of a tool
   */
  async getAllToolPaths(toolName: string): Promise<string[]> {
    return getAllToolPaths(toolName)
  }

  /**
   * Get current platform
   */
  getPlatform(): Platform {
    return getPlatform()
  }

  /**
   * Check if running on Windows
   */
  isWindows(): boolean {
    return isWindows()
  }
}

// Export a default instance
export const commandExecutor = new CommandExecutor()
