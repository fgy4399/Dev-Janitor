/**
 * Preload Script
 * 
 * Exposes secure API to the renderer process via contextBridge.
 * This script runs in a sandboxed environment with access to Node.js APIs
 * but exposes only specific, safe functionality to the renderer.
 * 
 * Security: contextIsolation is enabled, nodeIntegration is disabled
 * 
 * Validates: Requirements 1.1, 3.1, 4.1, 10.1, 11.1, 12.1, 12.2, 12.3, 12.4
 */

import { ipcRenderer, contextBridge } from 'electron'
import type { ToolInfo, PackageInfo, RunningService, EnvironmentVariable, AnalysisResult, AIConfig, AICLITool, CacheScanResult, CleanResult, AICleanupScanResult, AICleanupResult, PackageManagerStatus } from '../shared/types'

/**
 * Preload error logging utility
 * Provides detailed error logging with timestamps and stack traces
 * Validates: Requirements 12.1, 12.4
 */
interface PreloadError {
  apiName: string
  message: string
  stack?: string
  timestamp: string
}

/**
 * Log a preload error with detailed information
 * @param apiName - The name of the API that failed
 * @param error - The error that occurred
 */
function logPreloadError(apiName: string, error: unknown): PreloadError {
  const timestamp = new Date().toISOString()
  const errorMessage = error instanceof Error ? error.message : String(error)
  const errorStack = error instanceof Error ? error.stack : undefined
  
  const preloadError: PreloadError = {
    apiName,
    message: errorMessage,
    stack: errorStack,
    timestamp
  }
  
  // Log detailed error to console
  console.error(`[Preload Error] ${timestamp}`)
  console.error(`  API: ${apiName}`)
  console.error(`  Message: ${errorMessage}`)
  if (errorStack) {
    console.error(`  Stack: ${errorStack}`)
  }
  
  return preloadError
}

/**
 * Preload initialization status
 * Tracks which APIs were successfully exposed
 */
interface PreloadStatus {
  initialized: boolean
  exposedAPIs: string[]
  failedAPIs: PreloadError[]
  degradedMode: boolean
}

const preloadStatus: PreloadStatus = {
  initialized: false,
  exposedAPIs: [],
  failedAPIs: [],
  degradedMode: false
}

/**
 * Type-safe IPC API exposed to renderer
 */
interface ElectronAPI {
  // Platform information
  platform: NodeJS.Platform

  // Preload status (for debugging and degraded mode detection)
  preloadStatus: {
    isInitialized: () => boolean
    isDegradedMode: () => boolean
    getExposedAPIs: () => string[]
    getFailedAPIs: () => PreloadError[]
  }

  // Tools API
  tools: {
    detectAll: () => Promise<ToolInfo[]>
    detectOne: (toolName: string) => Promise<ToolInfo>
    uninstall: (toolName: string) => Promise<{ success: boolean; error?: string; command?: string }>
    getUninstallInfo: (toolName: string) => Promise<{ canUninstall: boolean; command?: string; warning?: string; manualInstructions?: string }>
  }

  // Packages API
  packages: {
    listNpm: () => Promise<PackageInfo[]>
    listPip: () => Promise<PackageInfo[]>
    listComposer: () => Promise<PackageInfo[]>
    listCargo: () => Promise<PackageInfo[]>
    listGem: () => Promise<PackageInfo[]>
    uninstall: (name: string, manager: string) => Promise<boolean>
    update: (name: string, manager: string) => Promise<{ success: boolean; newVersion?: string; error?: string }>
    checkNpmLatestVersion: (packageName: string) => Promise<{ name: string; latest: string; current?: string } | null>
    checkPipLatestVersion: (packageName: string) => Promise<{ name: string; latest: string } | null>
    checkBrewOutdated: (
      packageName?: string,
      options?: { cask?: boolean }
    ) => Promise<{
      success: boolean
      packages: Array<{
        name: string
        installedVersions: string[]
        currentVersion: string
        pinned: boolean
        location: 'formula' | 'cask'
      }>
      error?: string
    }>
    upgradeBrew: (packageName: string, options?: { cask?: boolean }) => Promise<{ success: boolean; error?: string }>
    // Enhanced Package Discovery API
    discoverManagers: () => Promise<PackageManagerStatus[]>
    getManagerStatus: (manager: string) => Promise<PackageManagerStatus | null>
    listByManager: (manager: string) => Promise<PackageInfo[]>
    listAllEnhanced: () => Promise<PackageInfo[]>
    uninstallEnhanced: (name: string, manager: string, options?: { cask?: boolean }) => Promise<{ success: boolean; error?: string }>
    onScanProgress: (callback: (data: { manager: string; status: string }) => void) => () => void
  }

  // Services API
  services: {
    list: () => Promise<RunningService[]>
    kill: (pid: number) => Promise<boolean>
    onUpdated: (callback: (services: RunningService[]) => void) => () => void
  }

  // Environment API
  env: {
    getAll: () => Promise<EnvironmentVariable[]>
    getPath: () => Promise<string[]>
  }

  // Settings API
  settings: {
    getLanguage: () => Promise<string>
    setLanguage: (lang: string) => Promise<void>
    onLanguageChanged: (callback: (lang: string) => void) => () => void
  }

  // AI Assistant API
  ai: {
    analyze: (language?: 'en-US' | 'zh-CN', useCache?: boolean) => Promise<AnalysisResult>
    updateConfig: (config: AIConfig) => Promise<void>
    fetchModels: () => Promise<string[]>
    testConnection: (config: AIConfig) => Promise<{ success: boolean; message: string }>
    onStreamToken: (callback: (token: string) => void) => () => void
  }

  // Shell API (for opening paths, URLs, and executing commands)
  shell: {
    openPath: (path: string) => Promise<void>
    openExternal: (url: string) => Promise<void>
    executeCommand: (command: string) => Promise<{ success: boolean; stdout: string; stderr: string }>
  }

  // Events API
  events: {
    onDetectionProgress: (callback: (progress: number) => void) => () => void
    onError: (callback: (error: string) => void) => () => void
  }

  // AI CLI Tools API
  aiCli: {
    detectAll: () => Promise<AICLITool[]>
    install: (toolName: string) => Promise<{ success: boolean; error?: string }>
    update: (toolName: string) => Promise<{ success: boolean; newVersion?: string; error?: string }>
    uninstall: (toolName: string) => Promise<{ success: boolean; error?: string }>
  }

  // Cache Cleaner API
  cache: {
    scanAll: () => Promise<CacheScanResult>
    clean: (cacheId: string) => Promise<CleanResult>
    cleanMultiple: (cacheIds: string[]) => Promise<CleanResult[]>
  }

  // AI Cleanup API
  aiCleanup: {
    scanAll: (language?: 'en-US' | 'zh-CN') => Promise<AICleanupScanResult>
    scanFullDisk: (language?: 'en-US' | 'zh-CN') => Promise<AICleanupScanResult>
    scanPath: (targetPath: string, language?: 'en-US' | 'zh-CN') => Promise<AICleanupScanResult>
    selectDirectory: () => Promise<string | null>
    delete: (itemId: string) => Promise<AICleanupResult>
    deleteMultiple: (itemIds: string[]) => Promise<AICleanupResult[]>
  }

  // App/Update API
  app: {
    getVersion: () => Promise<string>
    checkForUpdates: () => Promise<{ success: boolean; updateAvailable?: boolean; version?: string; error?: string }>
    downloadUpdate: () => Promise<{ success: boolean; error?: string }>
    installUpdate: () => void
    onUpdateAvailable: (callback: (info: { version: string; releaseDate?: string; releaseNotes?: string }) => void) => () => void
    onUpdateNotAvailable: (callback: (info: { currentVersion: string }) => void) => () => void
    onDownloadProgress: (callback: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => () => void
    onUpdateDownloaded: (callback: (info: { version: string }) => void) => () => void
    onUpdateError: (callback: (error: { message: string }) => void) => () => void
  }
}

/**
 * Create a degraded API that returns error messages for all methods
 * Used when the main API exposure fails
 * Validates: Requirements 12.3
 */
function createDegradedAPI(): ElectronAPI {
  const degradedError = new Error('API not available - preload script failed to initialize')
  
  const createDegradedPromise = <T>(): Promise<T> => {
    return Promise.reject(degradedError)
  }
  
  const createDegradedCallback = (): (() => void) => {
    console.warn('[Preload] Attempted to register callback in degraded mode')
    return () => {} // No-op cleanup function
  }

  return {
    platform: process.platform,
    
    preloadStatus: {
      isInitialized: () => preloadStatus.initialized,
      isDegradedMode: () => preloadStatus.degradedMode,
      getExposedAPIs: () => [...preloadStatus.exposedAPIs],
      getFailedAPIs: () => [...preloadStatus.failedAPIs]
    },

    tools: {
      detectAll: createDegradedPromise,
      detectOne: createDegradedPromise,
      uninstall: createDegradedPromise,
      getUninstallInfo: createDegradedPromise,
    },

    packages: {
      listNpm: createDegradedPromise,
      listPip: createDegradedPromise,
      listComposer: createDegradedPromise,
      listCargo: createDegradedPromise,
      listGem: createDegradedPromise,
      uninstall: createDegradedPromise,
      update: createDegradedPromise,
      checkNpmLatestVersion: createDegradedPromise,
      checkPipLatestVersion: createDegradedPromise,
      checkBrewOutdated: createDegradedPromise,
      upgradeBrew: createDegradedPromise,
      discoverManagers: createDegradedPromise,
      getManagerStatus: createDegradedPromise,
      listByManager: createDegradedPromise,
      listAllEnhanced: createDegradedPromise,
      uninstallEnhanced: createDegradedPromise,
      onScanProgress: createDegradedCallback,
    },

    services: {
      list: createDegradedPromise,
      kill: createDegradedPromise,
      onUpdated: createDegradedCallback,
    },

    env: {
      getAll: createDegradedPromise,
      getPath: createDegradedPromise,
    },

    settings: {
      getLanguage: createDegradedPromise,
      setLanguage: createDegradedPromise,
      onLanguageChanged: createDegradedCallback,
    },

    ai: {
      analyze: createDegradedPromise,
      updateConfig: createDegradedPromise,
      fetchModels: createDegradedPromise,
      testConnection: createDegradedPromise,
      onStreamToken: createDegradedCallback,
    },

    shell: {
      openPath: createDegradedPromise,
      openExternal: createDegradedPromise,
      executeCommand: createDegradedPromise,
    },

    events: {
      onDetectionProgress: createDegradedCallback,
      onError: createDegradedCallback,
    },

    aiCli: {
      detectAll: createDegradedPromise,
      install: createDegradedPromise,
      update: createDegradedPromise,
      uninstall: createDegradedPromise,
    },

    cache: {
      scanAll: createDegradedPromise,
      clean: createDegradedPromise,
      cleanMultiple: createDegradedPromise,
    },

    aiCleanup: {
      scanAll: createDegradedPromise,
      scanFullDisk: createDegradedPromise,
      scanPath: createDegradedPromise,
      selectDirectory: createDegradedPromise,
      delete: createDegradedPromise,
      deleteMultiple: createDegradedPromise,
    },

    app: {
      getVersion: createDegradedPromise,
      checkForUpdates: createDegradedPromise,
      downloadUpdate: createDegradedPromise,
      installUpdate: () => {
        console.warn('[Preload] Attempted to install update in degraded mode')
      },
      onUpdateAvailable: createDegradedCallback,
      onUpdateNotAvailable: createDegradedCallback,
      onDownloadProgress: createDegradedCallback,
      onUpdateDownloaded: createDegradedCallback,
      onUpdateError: createDegradedCallback,
    },
  }
}

/**
 * Create the full API object with all functionality
 */
function createElectronAPI(): ElectronAPI {
  return {
    // Platform information
    platform: process.platform,

    // Preload status API
    preloadStatus: {
      isInitialized: () => preloadStatus.initialized,
      isDegradedMode: () => preloadStatus.degradedMode,
      getExposedAPIs: () => [...preloadStatus.exposedAPIs],
      getFailedAPIs: () => [...preloadStatus.failedAPIs]
    },

    // Tools API
    tools: {
      detectAll: () => ipcRenderer.invoke('tools:detect-all'),
      detectOne: (toolName: string) => ipcRenderer.invoke('tools:detect-one', toolName),
      uninstall: (toolName: string) => ipcRenderer.invoke('tools:uninstall', toolName),
      getUninstallInfo: (toolName: string) => ipcRenderer.invoke('tools:get-uninstall-info', toolName),
    },

    // Packages API
    packages: {
      listNpm: () => ipcRenderer.invoke('packages:list-npm'),
      listPip: () => ipcRenderer.invoke('packages:list-pip'),
      listComposer: () => ipcRenderer.invoke('packages:list-composer'),
      listCargo: () => ipcRenderer.invoke('packages:list-cargo'),
      listGem: () => ipcRenderer.invoke('packages:list-gem'),
      uninstall: async (name: string, manager: string) => {
        const result = await ipcRenderer.invoke('packages:uninstall', name, manager)
        if (typeof result === 'boolean') return result
        if (result && typeof result === 'object' && 'success' in (result as Record<string, unknown>)) {
          return Boolean((result as { success?: unknown }).success)
        }
        return false
      },
      update: (name: string, manager: string) =>
        ipcRenderer.invoke('packages:update', name, manager),
      checkNpmLatestVersion: (packageName: string) =>
        ipcRenderer.invoke('packages:check-npm-latest', packageName),
      checkPipLatestVersion: (packageName: string) =>
        ipcRenderer.invoke('packages:check-pip-latest', packageName),
      checkBrewOutdated: (packageName?: string, options?: { cask?: boolean }) =>
        ipcRenderer.invoke('packages:check-brew-outdated', packageName, options),
      upgradeBrew: (packageName: string, options?: { cask?: boolean }) =>
        ipcRenderer.invoke('packages:upgrade-brew', packageName, options),
      // Enhanced Package Discovery API
      discoverManagers: () => ipcRenderer.invoke('packages:discover-managers'),
      getManagerStatus: (manager: string) => ipcRenderer.invoke('packages:get-manager-status', manager),
      listByManager: (manager: string) => ipcRenderer.invoke('packages:list-by-manager', manager),
      listAllEnhanced: () => ipcRenderer.invoke('packages:list-all-enhanced'),
      uninstallEnhanced: (name: string, manager: string, options?: { cask?: boolean }) =>
        ipcRenderer.invoke('packages:uninstall-enhanced', name, manager, options),
      onScanProgress: (callback: (data: { manager: string; status: string }) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: { manager: string; status: string }) => {
          callback(data)
        }
        ipcRenderer.on('packages:scan-progress', handler)
        return () => {
          ipcRenderer.removeListener('packages:scan-progress', handler)
        }
      },
    },

    // Services API
    services: {
      list: () => ipcRenderer.invoke('services:list'),
      kill: (pid: number) => ipcRenderer.invoke('services:kill', pid),
      onUpdated: (callback: (services: RunningService[]) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, services: RunningService[]) => {
          callback(services)
        }
        ipcRenderer.on('services:updated', handler)
        // Return cleanup function
        return () => {
          ipcRenderer.removeListener('services:updated', handler)
        }
      },
    },

    // Environment API
    env: {
      getAll: () => ipcRenderer.invoke('env:get-all'),
      getPath: () => ipcRenderer.invoke('env:get-path'),
    },

    // Settings API
    settings: {
      getLanguage: () => ipcRenderer.invoke('settings:get-language'),
      setLanguage: (lang: string) => ipcRenderer.invoke('settings:set-language', lang),
      onLanguageChanged: (callback: (lang: string) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, lang: string) => {
          callback(lang)
        }
        ipcRenderer.on('settings:language-changed', handler)
        // Return cleanup function
        return () => {
          ipcRenderer.removeListener('settings:language-changed', handler)
        }
      },
    },

    // AI Assistant API
    ai: {
      analyze: (language?: 'en-US' | 'zh-CN', useCache: boolean = false) => ipcRenderer.invoke('ai:analyze', language, useCache),
      updateConfig: (config: AIConfig) => ipcRenderer.invoke('ai:update-config', config),
      fetchModels: () => ipcRenderer.invoke('ai:fetch-models'),
      testConnection: (config: AIConfig) => ipcRenderer.invoke('ai:test-connection', config),
      onStreamToken: (callback: (token: string) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, token: string) => callback(token)
        ipcRenderer.on('ai:stream-token', handler)
        return () => {
          ipcRenderer.removeListener('ai:stream-token', handler)
        }
      }
    },

    // Shell API
    shell: {
      openPath: async (path: string) => {
        const result = await ipcRenderer.invoke('shell:open-path', path)
        if (typeof result === 'string' && result.trim() !== '') {
          throw new Error(result)
        }
      },
      openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
      executeCommand: (command: string) => ipcRenderer.invoke('shell:execute-command', command),
    },

    // Events API
    events: {
      onDetectionProgress: (callback: (progress: number) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, progress: number) => {
          callback(progress)
        }
        ipcRenderer.on('detection:progress', handler)
        // Return cleanup function
        return () => {
          ipcRenderer.removeListener('detection:progress', handler)
        }
      },
      onError: (callback: (error: string) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, error: string) => {
          callback(error)
        }
        ipcRenderer.on('error', handler)
        // Return cleanup function
        return () => {
          ipcRenderer.removeListener('error', handler)
        }
      },
    },

    // AI CLI Tools API
    aiCli: {
      detectAll: () => ipcRenderer.invoke('ai-cli:detect-all'),
      install: (toolName: string) => ipcRenderer.invoke('ai-cli:install', toolName),
      update: (toolName: string) => ipcRenderer.invoke('ai-cli:update', toolName),
      uninstall: (toolName: string) => ipcRenderer.invoke('ai-cli:uninstall', toolName),
    },

    // Cache Cleaner API
    cache: {
      scanAll: () => ipcRenderer.invoke('cache:scan-all'),
      clean: (cacheId: string) => ipcRenderer.invoke('cache:clean', cacheId),
      cleanMultiple: (cacheIds: string[]) => ipcRenderer.invoke('cache:clean-multiple', cacheIds),
    },

    // AI Cleanup API
    aiCleanup: {
      scanAll: (language?: 'en-US' | 'zh-CN') => ipcRenderer.invoke('ai-cleanup:scan-all', language),
      scanFullDisk: (language?: 'en-US' | 'zh-CN') => ipcRenderer.invoke('ai-cleanup:scan-full-disk', language),
      scanPath: (targetPath: string, language?: 'en-US' | 'zh-CN') => ipcRenderer.invoke('ai-cleanup:scan-path', targetPath, language),
      selectDirectory: () => ipcRenderer.invoke('ai-cleanup:select-directory'),
      delete: (itemId: string) => ipcRenderer.invoke('ai-cleanup:delete', itemId),
      deleteMultiple: (itemIds: string[]) => ipcRenderer.invoke('ai-cleanup:delete-multiple', itemIds),
    },

    // App/Update API
    app: {
      getVersion: () => ipcRenderer.invoke('app:version'),
      checkForUpdates: () => ipcRenderer.invoke('update:check'),
      downloadUpdate: () => ipcRenderer.invoke('update:download'),
      installUpdate: () => ipcRenderer.invoke('update:install'),
      onUpdateAvailable: (callback: (info: { version: string; releaseDate?: string; releaseNotes?: string }) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, info: { version: string; releaseDate?: string; releaseNotes?: string }) => {
          callback(info)
        }
        ipcRenderer.on('update:available', handler)
        return () => {
          ipcRenderer.removeListener('update:available', handler)
        }
      },
      onUpdateNotAvailable: (callback: (info: { currentVersion: string }) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, info: { currentVersion: string }) => {
          callback(info)
        }
        ipcRenderer.on('update:not-available', handler)
        return () => {
          ipcRenderer.removeListener('update:not-available', handler)
        }
      },
      onDownloadProgress: (callback: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => {
          callback(progress)
        }
        ipcRenderer.on('update:download-progress', handler)
        return () => {
          ipcRenderer.removeListener('update:download-progress', handler)
        }
      },
      onUpdateDownloaded: (callback: (info: { version: string }) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, info: { version: string }) => {
          callback(info)
        }
        ipcRenderer.on('update:downloaded', handler)
        return () => {
          ipcRenderer.removeListener('update:downloaded', handler)
        }
      },
      onUpdateError: (callback: (error: { message: string }) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, error: { message: string }) => {
          callback(error)
        }
        ipcRenderer.on('update:error', handler)
        return () => {
          ipcRenderer.removeListener('update:error', handler)
        }
      },
    },
  }
}

/**
 * Initialize and expose the API to the renderer process
 * Uses try-catch to handle errors and provide degraded functionality
 * Validates: Requirements 12.1, 12.2, 12.3, 12.4
 */
function initializePreload(): void {
  const timestamp = new Date().toISOString()
  console.log(`[Preload] Initializing at ${timestamp}`)
  
  try {
    // Create the full API object
    const electronAPI = createElectronAPI()
    
    // Attempt to expose the API to the renderer process
    // Validates: Requirements 12.2 - wrap in try-catch
    try {
      contextBridge.exposeInMainWorld('electronAPI', electronAPI)
      
      // Mark as successfully initialized
      preloadStatus.initialized = true
      preloadStatus.exposedAPIs.push('electronAPI')
      preloadStatus.degradedMode = false
      
      console.log(`[Preload] Successfully exposed electronAPI at ${new Date().toISOString()}`)
    } catch (exposeError) {
      // Validates: Requirements 12.1, 12.4 - log detailed error
      const error = logPreloadError('electronAPI', exposeError)
      preloadStatus.failedAPIs.push(error)
      
      // Validates: Requirements 12.3 - provide degraded functionality
      console.warn('[Preload] Falling back to degraded mode')
      preloadStatus.degradedMode = true
      
      try {
        // Attempt to expose degraded API
        const degradedAPI = createDegradedAPI()
        contextBridge.exposeInMainWorld('electronAPI', degradedAPI)
        preloadStatus.initialized = true
        preloadStatus.exposedAPIs.push('electronAPI (degraded)')
        console.log('[Preload] Exposed degraded electronAPI')
      } catch (degradedError) {
        // Even degraded mode failed - log and continue
        logPreloadError('electronAPI (degraded)', degradedError)
        preloadStatus.initialized = false
        console.error('[Preload] Failed to expose even degraded API - renderer will have no API access')
      }
    }
  } catch (initError) {
    // Catch any errors during API object creation
    const error = logPreloadError('preload-initialization', initError)
    preloadStatus.failedAPIs.push(error)
    preloadStatus.initialized = false
    preloadStatus.degradedMode = true
    
    console.error('[Preload] Critical initialization error - attempting minimal degraded mode')
    
    // Last resort: try to expose a minimal status API
    try {
      contextBridge.exposeInMainWorld('electronAPI', createDegradedAPI())
      preloadStatus.exposedAPIs.push('electronAPI (minimal)')
      console.log('[Preload] Exposed minimal degraded API')
    } catch (minimalError) {
      logPreloadError('electronAPI (minimal)', minimalError)
      console.error('[Preload] Complete failure - no API will be available to renderer')
    }
  }
  
  // Log final status
  console.log(`[Preload] Initialization complete:`)
  console.log(`  - Initialized: ${preloadStatus.initialized}`)
  console.log(`  - Degraded Mode: ${preloadStatus.degradedMode}`)
  console.log(`  - Exposed APIs: ${preloadStatus.exposedAPIs.join(', ') || 'none'}`)
  console.log(`  - Failed APIs: ${preloadStatus.failedAPIs.length}`)
}

// Initialize the preload script
initializePreload()

// Type declarations for the renderer process
declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export type { ElectronAPI, PreloadError, PreloadStatus }
