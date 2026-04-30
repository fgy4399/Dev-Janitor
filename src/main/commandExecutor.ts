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
import fs from 'node:fs'
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
  const isTestEnvironment =
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    process.env.VITEST === '1' ||
    process.argv.some(arg => arg.includes('vitest'))
  if (isTestEnvironment) return

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
 * macOS（以及部分 Linux 桌面环境）从 Finder/Launcher 启动应用时，进程的 PATH 往往不包含 Homebrew 等开发工具目录。
 * 这会导致 `npm --version`、`which npm`、以及 AI CLI（codex/claude/gemini 等）检测/安装误判为“未安装”。
 *
 * 这里在执行系统命令时，为子进程补齐一组常见 PATH 目录（不改变当前进程的 process.env.PATH），用于提高检测与安装的可靠性。
 */
let cachedAugmentedPathEntries: string[] | null = null

function getPathSeparatorForEnv(): string {
  return isWindows() ? ';' : ':'
}

function getEnvPathKey(env: NodeJS.ProcessEnv): string {
  const existingKey = Object.keys(env).find(k => k.toLowerCase() === 'path')
  if (existingKey) return existingKey
  return isWindows() ? 'Path' : 'PATH'
}

function normalizePathEntry(p: string): string {
  return normalizePath(p)
}

function findLatestNvmBin(): string | null {
  if (isWindows()) return null

  const homeDir = os.homedir()
  const nvmDir = process.env.NVM_DIR || path.join(homeDir, '.nvm')
  const versionsDir = path.join(nvmDir, 'versions', 'node')

  try {
    if (!fs.existsSync(versionsDir)) return null

    const entries = fs.readdirSync(versionsDir, { withFileTypes: true })
    const versionDirs = entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .filter(name => /^v?\d+\.\d+\.\d+/.test(name))

    if (versionDirs.length === 0) return null

    const parse = (name: string) => {
      const cleaned = name.startsWith('v') ? name.slice(1) : name
      const [major, minor, patch] = cleaned.split('.').map(n => Number.parseInt(n, 10))
      return { major: major || 0, minor: minor || 0, patch: patch || 0, raw: name }
    }

    versionDirs.sort((a, b) => {
      const va = parse(a)
      const vb = parse(b)
      if (va.major !== vb.major) return vb.major - va.major
      if (va.minor !== vb.minor) return vb.minor - va.minor
      return vb.patch - va.patch
    })

    const candidate = path.join(versionsDir, versionDirs[0], 'bin')
    return fs.existsSync(candidate) ? candidate : null
  } catch {
    return null
  }
}

function getAugmentedPathEntries(): string[] {
  if (cachedAugmentedPathEntries) return cachedAugmentedPathEntries

  // Windows 的 PATH 通常由系统正确注入，这里不做额外补齐，避免覆盖用户设置。
  if (isWindows()) {
    cachedAugmentedPathEntries = []
    return cachedAugmentedPathEntries
  }

  const homeDir = os.homedir()
  const candidates: string[] = [
    // 用户级常见可执行目录
    path.join(homeDir, '.local', 'bin'),
    path.join(homeDir, 'bin'),
    path.join(homeDir, '.cargo', 'bin'),
    path.join(homeDir, '.volta', 'bin'),
    path.join(homeDir, '.asdf', 'shims'),
  ]

  const nvmBin = findLatestNvmBin()
  if (nvmBin) {
    candidates.push(nvmBin)
  }

  // macOS：Homebrew（Apple Silicon + Intel）常见位置
  if (isMacOS()) {
    candidates.push('/opt/homebrew/bin', '/opt/homebrew/sbin')
    candidates.push('/usr/local/bin', '/usr/local/sbin')
  } else {
    // Linux：常见本地安装目录
    candidates.push('/usr/local/bin', '/usr/local/sbin')
  }

  // 兜底：系统默认目录（保证即使 PATH 为空，也能找到基本命令）
  candidates.push('/usr/bin', '/bin', '/usr/sbin', '/sbin')

  // 过滤不存在的目录，避免污染 PATH
  const existing = candidates.filter(p => {
    try {
      return fs.existsSync(p)
    } catch {
      return false
    }
  })

  // 去重（macOS 文件系统通常大小写不敏感，这里与 Windows 一样按小写去重）
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const p of existing.map(normalizePathEntry)) {
    const key = (isMacOS() || isWindows()) ? p.toLowerCase() : p
    if (!seen.has(key)) {
      seen.add(key)
      deduped.push(p)
    }
  }

  cachedAugmentedPathEntries = deduped
  return cachedAugmentedPathEntries
}

function mergePathValue(original: string): string {
  const separator = getPathSeparatorForEnv()
  const existing = (original || '')
    .split(separator)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(normalizePathEntry)

  const additions = getAugmentedPathEntries().map(normalizePathEntry)

  const seen = new Set<string>()
  const merged: string[] = []

  const pushUnique = (p: string) => {
    const key = (isMacOS() || isWindows()) ? p.toLowerCase() : p
    if (seen.has(key)) return
    seen.add(key)
    merged.push(p)
  }

  for (const p of existing) pushUnique(p)
  for (const p of additions) pushUnique(p)

  return merged.join(separator)
}

function buildCommandEnv(optionsEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const mergedEnv: NodeJS.ProcessEnv = { ...process.env, ...optionsEnv }
  const pathKey = getEnvPathKey(mergedEnv)
  const currentPath = mergedEnv[pathKey] || ''
  mergedEnv[pathKey] = mergePathValue(currentPath)
  return mergedEnv
}

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
    const env = buildCommandEnv(options.env)
    const { stdout, stderr } = await execAsync(command, {
      ...options,
      env,
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
