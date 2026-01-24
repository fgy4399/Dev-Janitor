/**
 * Renderer-side IPC Client
 * 
 * Provides a type-safe interface for communicating with the main process.
 * This module wraps the electronAPI exposed by the preload script and
 * provides convenient methods for all IPC operations.
 * 
 * Validates: Requirements 1.1, 3.1, 4.1, 10.1, 11.1, 13.1, 13.2, 13.3, 13.4
 */

import type { ToolInfo, PackageInfo, RunningService, EnvironmentVariable, PackageManagerStatus } from '@shared/types'

// Re-export IPC timeout utilities
export {
  ipcClientWithTimeout,
  invokeWithTimeout,
  withTimeout,
  createIPCInvoker,
  isIPCTimeoutError,
  getIPCErrorMessage,
  IPCTimeoutError,
  DEFAULT_IPC_TIMEOUT,
  type IPCCallOptions,
} from './ipcClientWithTimeout'

/**
 * Check if running in Electron environment
 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && window.electronAPI !== undefined
}

/**
 * Get the current platform
 */
export function getPlatform(): NodeJS.Platform | 'browser' {
  if (isElectron()) {
    return window.electronAPI.platform
  }
  return 'browser'
}

// ============================================================================
// Tools API
// ============================================================================

/**
 * Detect all installed development tools
 * 
 * @returns Promise resolving to array of ToolInfo
 */
export async function detectAllTools(): Promise<ToolInfo[]> {
  if (!isElectron()) {
    console.warn('detectAllTools: Not running in Electron environment')
    return []
  }
  return window.electronAPI.tools.detectAll()
}

/**
 * Detect a single tool by name
 * 
 * @param toolName The name of the tool to detect
 * @returns Promise resolving to ToolInfo
 */
export async function detectTool(toolName: string): Promise<ToolInfo> {
  if (!isElectron()) {
    console.warn('detectTool: Not running in Electron environment')
    return {
      name: toolName,
      displayName: toolName,
      version: null,
      path: null,
      isInstalled: false,
      category: 'other',
    }
  }
  return window.electronAPI.tools.detectOne(toolName)
}

// ============================================================================
// Packages API
// ============================================================================

/**
 * List globally installed npm packages
 * 
 * @returns Promise resolving to array of PackageInfo
 */
export async function listNpmPackages(): Promise<PackageInfo[]> {
  if (!isElectron()) {
    console.warn('listNpmPackages: Not running in Electron environment')
    return []
  }
  return window.electronAPI.packages.listNpm()
}

/**
 * List installed pip packages
 * 
 * @returns Promise resolving to array of PackageInfo
 */
export async function listPipPackages(): Promise<PackageInfo[]> {
  if (!isElectron()) {
    console.warn('listPipPackages: Not running in Electron environment')
    return []
  }
  return window.electronAPI.packages.listPip()
}

/**
 * List globally installed composer packages
 * 
 * @returns Promise resolving to array of PackageInfo
 */
export async function listComposerPackages(): Promise<PackageInfo[]> {
  if (!isElectron()) {
    console.warn('listComposerPackages: Not running in Electron environment')
    return []
  }
  return window.electronAPI.packages.listComposer()
}

/**
 * Discover available package managers (enhanced)
 */
export async function discoverPackageManagers(): Promise<PackageManagerStatus[]> {
  if (!isElectron()) {
    console.warn('discoverPackageManagers: Not running in Electron environment')
    return []
  }

  if (!window.electronAPI.packages.discoverManagers) {
    console.warn('discoverPackageManagers: API not available')
    return []
  }

  return window.electronAPI.packages.discoverManagers()
}

/**
 * List packages by manager (enhanced)
 */
export async function listPackagesByManager(manager: string): Promise<PackageInfo[]> {
  if (!isElectron()) {
    console.warn('listPackagesByManager: Not running in Electron environment')
    return []
  }

  if (!window.electronAPI.packages.listByManager) {
    console.warn('listPackagesByManager: API not available')
    return []
  }

  return window.electronAPI.packages.listByManager(manager)
}

/**
 * Uninstall a package with enhanced manager support
 */
export async function uninstallEnhancedPackage(
  name: string,
  manager: string,
  options?: { cask?: boolean }
): Promise<{ success: boolean; error?: string }> {
  if (!isElectron()) {
    console.warn('uninstallEnhancedPackage: Not running in Electron environment')
    return { success: false, error: 'Not running in Electron environment' }
  }

  if (!window.electronAPI.packages.uninstallEnhanced) {
    console.warn('uninstallEnhancedPackage: API not available')
    return { success: false, error: 'API not available' }
  }

  return window.electronAPI.packages.uninstallEnhanced(name, manager, options)
}

/**
 * Uninstall a package
 * 
 * @param name The package name to uninstall
 * @param manager The package manager ('npm', 'pip', or 'composer')
 * @returns Promise resolving to true if successful
 */
export async function uninstallPackage(
  name: string,
  manager: 'npm' | 'pip' | 'composer'
): Promise<boolean> {
  if (!isElectron()) {
    console.warn('uninstallPackage: Not running in Electron environment')
    return false
  }
  return window.electronAPI.packages.uninstall(name, manager)
}

// ============================================================================
// Services API
// ============================================================================

/**
 * List running services
 * 
 * @returns Promise resolving to array of RunningService
 */
export async function listServices(): Promise<RunningService[]> {
  if (!isElectron()) {
    console.warn('listServices: Not running in Electron environment')
    return []
  }
  return window.electronAPI.services.list()
}

/**
 * Kill a service by PID
 * 
 * @param pid The process ID to kill
 * @returns Promise resolving to true if successful
 */
export async function killService(pid: number): Promise<boolean> {
  if (!isElectron()) {
    console.warn('killService: Not running in Electron environment')
    return false
  }
  return window.electronAPI.services.kill(pid)
}

/**
 * Subscribe to service updates
 * 
 * @param callback Function to call when services are updated
 * @returns Cleanup function to unsubscribe
 */
export function onServicesUpdated(
  callback: (services: RunningService[]) => void
): () => void {
  if (!isElectron()) {
    console.warn('onServicesUpdated: Not running in Electron environment')
    return () => {}
  }
  return window.electronAPI.services.onUpdated(callback)
}

// ============================================================================
// Environment API
// ============================================================================

/**
 * Get all environment variables
 * 
 * @returns Promise resolving to array of EnvironmentVariable
 */
export async function getAllEnvironmentVariables(): Promise<EnvironmentVariable[]> {
  if (!isElectron()) {
    console.warn('getAllEnvironmentVariables: Not running in Electron environment')
    return []
  }
  return window.electronAPI.env.getAll()
}

/**
 * Get PATH entries
 * 
 * @returns Promise resolving to array of PATH directory strings
 */
export async function getPathEntries(): Promise<string[]> {
  if (!isElectron()) {
    console.warn('getPathEntries: Not running in Electron environment')
    return []
  }
  return window.electronAPI.env.getPath()
}

// ============================================================================
// Settings API
// ============================================================================

/**
 * Get the current language setting
 * 
 * @returns Promise resolving to language code
 */
export async function getLanguage(): Promise<string> {
  if (!isElectron()) {
    console.warn('getLanguage: Not running in Electron environment')
    return 'en-US'
  }
  return window.electronAPI.settings.getLanguage()
}

/**
 * Set the language
 * 
 * @param lang The language code ('zh-CN' or 'en-US')
 */
export async function setLanguage(lang: string): Promise<void> {
  if (!isElectron()) {
    console.warn('setLanguage: Not running in Electron environment')
    return
  }
  return window.electronAPI.settings.setLanguage(lang)
}

/**
 * Subscribe to language changes
 * 
 * @param callback Function to call when language changes
 * @returns Cleanup function to unsubscribe
 */
export function onLanguageChanged(callback: (lang: string) => void): () => void {
  if (!isElectron()) {
    console.warn('onLanguageChanged: Not running in Electron environment')
    return () => {}
  }
  return window.electronAPI.settings.onLanguageChanged(callback)
}

// ============================================================================
// Events API
// ============================================================================

/**
 * Subscribe to detection progress updates
 * 
 * @param callback Function to call with progress (0-100)
 * @returns Cleanup function to unsubscribe
 */
export function onDetectionProgress(callback: (progress: number) => void): () => void {
  if (!isElectron()) {
    console.warn('onDetectionProgress: Not running in Electron environment')
    return () => {}
  }
  return window.electronAPI.events.onDetectionProgress(callback)
}

/**
 * Subscribe to error events
 * 
 * @param callback Function to call with error message
 * @returns Cleanup function to unsubscribe
 */
export function onError(callback: (error: string) => void): () => void {
  if (!isElectron()) {
    console.warn('onError: Not running in Electron environment')
    return () => {}
  }
  return window.electronAPI.events.onError(callback)
}

// ============================================================================
// IPC Client Object (for convenience)
// ============================================================================

/**
 * IPC Client object providing all IPC methods
 */
export const ipcClient = {
  // Utilities
  isElectron,
  getPlatform,

  // Tools
  tools: {
    detectAll: detectAllTools,
    detectOne: detectTool,
  },

  // Packages
  packages: {
    listNpm: listNpmPackages,
    listPip: listPipPackages,
    listComposer: listComposerPackages,
    discoverManagers: discoverPackageManagers,
    listByManager: listPackagesByManager,
    uninstall: uninstallPackage,
    uninstallEnhanced: uninstallEnhancedPackage,
  },

  // Services
  services: {
    list: listServices,
    kill: killService,
    onUpdated: onServicesUpdated,
  },

  // Environment
  env: {
    getAll: getAllEnvironmentVariables,
    getPath: getPathEntries,
  },

  // Settings
  settings: {
    getLanguage,
    setLanguage,
    onLanguageChanged,
  },

  // Events
  events: {
    onDetectionProgress,
    onError,
  },
}

export default ipcClient
