/**
 * IPC Handlers Module
 * 
 * Registers all IPC handlers for communication between main and renderer processes.
 * Handles channels for:
 * - Tools detection
 * - Package management
 * - Service monitoring
 * - Environment scanning
 * - Settings management
 * 
 * Validates: Requirements 1.1, 1.3, 2.1, 2.2, 2.3, 2.4, 3.1, 4.1, 10.1, 11.1
 */

import { ipcMain, BrowserWindow, shell, app, dialog } from 'electron'
import os from 'node:os'
import { detectionEngine } from './detectionEngine'
import { packageManager, PackageDiscovery } from './packageManager'
import { serviceMonitor } from './serviceMonitor'
import { environmentScanner } from './environmentScanner'
import { aiAssistant } from './aiAssistant'
import { commandExecutor } from './commandExecutor'
import { cacheScanner } from './cacheScanner'
import { aiCleanupScanner } from './aiCleanupScanner'
import { commandValidator, inputValidator, validateIPCSender } from './security'
import type { ToolInfo, PackageInfo, RunningService, EnvironmentVariable, AnalysisResult, AIConfig, AICLITool, CacheScanResult, CleanResult, AICleanupScanResult, AICleanupResult, PackageManagerStatus } from '../shared/types'

// Store for language preference
let currentLanguage = 'en-US'

// Track if IPC handlers are registered to prevent duplicate registration
// Validates: Requirement 11.4 - Prevent duplicate IPC handler registration
let ipcHandlersRegistered = false

// Cache for environment data to allow re-analysis without re-scanning
let cachedEnvironmentData: {
  tools: ToolInfo[]
  packages: PackageInfo[]
  environment: EnvironmentVariable[]
  services: RunningService[]
} | null = null

// Enhanced package discovery instance
let packageDiscovery: PackageDiscovery | null = null

/**
 * Get or create the package discovery instance
 */
function getPackageDiscovery(): PackageDiscovery {
  if (!packageDiscovery) {
    packageDiscovery = new PackageDiscovery()
  }
  return packageDiscovery
}

/**
 * Send event to all renderer windows
 * @param channel The event channel name
 * @param data The data to send
 */
function sendToAllWindows(channel: string, data: unknown): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  }
}

/**
 * Register all IPC handlers for tools detection
 * 
 * Validates: Requirement 1.1 (System starts, Detection_Engine scans)
 */
function registerToolsHandlers(): void {
  // Detect all tools
  ipcMain.handle('tools:detect-all', async (): Promise<ToolInfo[]> => {
    try {
      const tools = await detectionEngine.detectAllTools()
      return tools
    } catch (error) {
      console.error('Error detecting tools:', error)
      sendToAllWindows('error', `Failed to detect tools: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return []
    }
  })

  // Detect a single tool by name
  ipcMain.handle('tools:detect-one', async (_event, toolName: string): Promise<ToolInfo> => {
    try {
      const tool = await detectionEngine.detectTool(toolName)
      return tool
    } catch (error) {
      console.error(`Error detecting tool ${toolName}:`, error)
      sendToAllWindows('error', `Failed to detect ${toolName}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return {
        name: toolName,
        displayName: toolName,
        version: null,
        path: null,
        isInstalled: false,
        category: 'other',
      }
    }
  })

  // Uninstall a tool
  ipcMain.handle('tools:uninstall', async (event, toolName: string): Promise<{ success: boolean; error?: string; command?: string }> => {
    try {
      // Validate IPC sender
      if (!validateIPCSender(event)) {
        console.warn('Security warning: IPC message from untrusted sender for tools:uninstall')
        return { success: false, error: 'Untrusted sender' }
      }

      // Validate tool name
      if (!toolName || typeof toolName !== 'string' || toolName.length > 100) {
        return { success: false, error: 'Invalid tool name' }
      }

      const result = await detectionEngine.uninstallTool(toolName)
      return result
    } catch (error) {
      console.error(`Error uninstalling tool ${toolName}:`, error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Get uninstall info for a tool
  ipcMain.handle('tools:get-uninstall-info', async (_event, toolName: string): Promise<{ canUninstall: boolean; command?: string; warning?: string; manualInstructions?: string }> => {
    try {
      return await detectionEngine.getUninstallInfo(toolName)
    } catch (error) {
      console.error(`Error getting uninstall info for ${toolName}:`, error)
      return { canUninstall: false, manualInstructions: 'Unable to determine uninstall method' }
    }
  })
}

/**
 * Register all IPC handlers for package management
 * 
 * Validates: Requirements 3.1, 4.1
 */
function registerPackagesHandlers(): void {
  // List npm global packages
  ipcMain.handle('packages:list-npm', async (): Promise<PackageInfo[]> => {
    try {
      const packages = await packageManager.listNpmPackages()
      return packages
    } catch (error) {
      console.error('Error listing npm packages:', error)
      sendToAllWindows('error', `Failed to list npm packages: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return []
    }
  })

  // List pip packages
  ipcMain.handle('packages:list-pip', async (): Promise<PackageInfo[]> => {
    try {
      const packages = await packageManager.listPipPackages()
      return packages
    } catch (error) {
      console.error('Error listing pip packages:', error)
      sendToAllWindows('error', `Failed to list pip packages: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return []
    }
  })

  // List composer global packages
  ipcMain.handle('packages:list-composer', async (): Promise<PackageInfo[]> => {
    try {
      const packages = await packageManager.listComposerPackages()
      return packages
    } catch (error) {
      console.error('Error listing composer packages:', error)
      sendToAllWindows('error', `Failed to list composer packages: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return []
    }
  })

  // List cargo packages
  ipcMain.handle('packages:list-cargo', async (): Promise<PackageInfo[]> => {
    try {
      const packages = await packageManager.listCargoPackages()
      return packages
    } catch (error) {
      console.error('Error listing cargo packages:', error)
      sendToAllWindows('error', `Failed to list cargo packages: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return []
    }
  })

  // List gem packages
  ipcMain.handle('packages:list-gem', async (): Promise<PackageInfo[]> => {
    try {
      const packages = await packageManager.listGemPackages()
      return packages
    } catch (error) {
      console.error('Error listing gem packages:', error)
      sendToAllWindows('error', `Failed to list gem packages: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return []
    }
  })

  // Enhanced Package Discovery: Discover all available package managers
  // Validates: Requirements 14.5, 14.6
  ipcMain.handle('packages:discover-managers', async (): Promise<PackageManagerStatus[]> => {
    try {
      const discovery = getPackageDiscovery()
      const statuses = await discovery.discoverAvailableManagers()
      return statuses
    } catch (error) {
      console.error('Error discovering package managers:', error)
      sendToAllWindows('error', `Failed to discover package managers: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return []
    }
  })

  // Enhanced Package Discovery: Get status for a specific package manager
  // Validates: Requirements 14.5, 14.6
  ipcMain.handle('packages:get-manager-status', async (_event, manager: string): Promise<PackageManagerStatus | null> => {
    try {
      const discovery = getPackageDiscovery()
      const status = await discovery.getManagerStatus(manager as any)
      return status
    } catch (error) {
      console.error(`Error getting status for ${manager}:`, error)
      return null
    }
  })

  // Enhanced Package Discovery: List packages from a specific manager
  ipcMain.handle('packages:list-by-manager', async (_event, manager: string): Promise<PackageInfo[]> => {
    try {
      const discovery = getPackageDiscovery()
      const packages = await discovery.listPackages(manager as any)
      return packages
    } catch (error) {
      console.error(`Error listing packages for ${manager}:`, error)
      sendToAllWindows('error', `Failed to list ${manager} packages: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return []
    }
  })

  // Enhanced Package Discovery: List all packages from all available managers
  ipcMain.handle('packages:list-all-enhanced', async (_event): Promise<PackageInfo[]> => {
    try {
      const discovery = getPackageDiscovery()
      const packages = await discovery.listAllPackages((manager, status) => {
        // Send progress updates to renderer
        sendToAllWindows('packages:scan-progress', { manager, status })
      })
      return packages
    } catch (error) {
      console.error('Error listing all packages:', error)
      sendToAllWindows('error', `Failed to list all packages: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return []
    }
  })

  // Enhanced Package Discovery: Uninstall package with enhanced support
  ipcMain.handle('packages:uninstall-enhanced', async (event, name: string, manager: string, options?: { cask?: boolean }): Promise<{ success: boolean; error?: string }> => {
    try {
      // Validate IPC sender
      if (!validateIPCSender(event)) {
        console.warn('Security warning: IPC message from untrusted sender for packages:uninstall-enhanced')
        return { success: false, error: 'Untrusted sender' }
      }

      // Validate package name format
      const nameValidation = inputValidator.validatePackageName(name)
      if (!nameValidation.valid) {
        return { success: false, error: nameValidation.error }
      }

      const discovery = getPackageDiscovery()
      const success = await discovery.uninstallPackage(nameValidation.value!, manager as any, options)
      return { success }
    } catch (error) {
      console.error(`Error uninstalling package ${name}:`, error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Uninstall a package (legacy support)
  ipcMain.handle('packages:uninstall', async (event, name: string, manager: string): Promise<{ success: boolean; error?: string }> => {
    try {
      // Validate IPC sender (Requirement 1.3 - security logging)
      if (!validateIPCSender(event)) {
        console.warn('Security warning: IPC message from untrusted sender for packages:uninstall');
        return { success: false, error: 'Untrusted sender' };
      }

      // Validate package name format (Requirement 2.1)
      const nameValidation = inputValidator.validatePackageName(name);
      if (!nameValidation.valid) {
        return { success: false, error: nameValidation.error };
      }

      if (manager !== 'npm' && manager !== 'pip' && manager !== 'composer') {
        return { success: false, error: `Invalid package manager: ${manager}` };
      }
      const success = await packageManager.uninstallPackage(nameValidation.value!, manager);
      return { success };
    } catch (error) {
      console.error(`Error uninstalling package ${name}:`, error);
      sendToAllWindows('error', `Failed to uninstall ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  })

  // Check npm package latest version from registry
  ipcMain.handle('packages:check-npm-latest', async (_event, packageName: string): Promise<{ name: string; latest: string } | null> => {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout

      const response = await fetch(`https://registry.npmjs.org/${packageName}/latest`, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        return null
      }
      const data = await response.json()
      return {
        name: packageName,
        latest: data.version
      }
    } catch (error) {
      console.error(`Error checking latest version for ${packageName}:`, error)
      return null
    }
  })

  // Check pip package latest version from PyPI
  ipcMain.handle('packages:check-pip-latest', async (_event, packageName: string): Promise<{ name: string; latest: string } | null> => {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout

      const response = await fetch(`https://pypi.org/pypi/${packageName}/json`, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        return null
      }
      const data = await response.json()
      return {
        name: packageName,
        latest: data.info?.version || null
      }
    } catch (error) {
      console.error(`Error checking latest version for ${packageName}:`, error)
      return null
    }
  })

  // Update a package to the latest version
  ipcMain.handle('packages:update', async (_event, name: string, manager: string): Promise<{ success: boolean; newVersion?: string; error?: string }> => {
    try {
      // Validate package name format (Requirement 2.1)
      const nameValidation = inputValidator.validatePackageName(name);
      if (!nameValidation.valid) {
        return { success: false, error: nameValidation.error };
      }

      if (manager !== 'npm' && manager !== 'pip') {
        return { success: false, error: `Package update not supported for ${manager}` }
      }
      const result = await packageManager.updatePackage(nameValidation.value!, manager)
      return result
    } catch (error) {
      console.error(`Error updating package ${name}:`, error)
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }
    }
  })
}

/**
 * Register all IPC handlers for service monitoring
 * 
 * Validates: Requirement 11.1
 */
function registerServicesHandlers(): void {
  // List running services
  ipcMain.handle('services:list', async (): Promise<RunningService[]> => {
    try {
      const services = await serviceMonitor.listRunningServices()
      return services
    } catch (error) {
      console.error('Error listing services:', error)
      sendToAllWindows('error', `Failed to list services: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return []
    }
  })

  // Kill a service by PID
  ipcMain.handle('services:kill', async (event, pid: number): Promise<boolean> => {
    try {
      // Validate IPC sender (Requirement 1.3 - security logging)
      if (!validateIPCSender(event)) {
        console.warn('Security warning: IPC message from untrusted sender for services:kill');
        return false;
      }

      // Validate PID as positive integer (Requirement 2.2)
      const pidValidation = inputValidator.validatePID(pid);
      if (!pidValidation.valid) {
        console.warn(`Security warning: Invalid PID validation failed: ${pidValidation.error}`);
        return false;
      }

      const success = await serviceMonitor.killService(pidValidation.value!)
      return success
    } catch (error) {
      console.error(`Error killing service ${pid}:`, error)
      sendToAllWindows('error', `Failed to kill service: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return false
    }
  })
}

/**
 * Register all IPC handlers for environment scanning
 * 
 * Validates: Requirement 10.1
 */
function registerEnvironmentHandlers(): void {
  // Get all environment variables
  ipcMain.handle('env:get-all', async (): Promise<EnvironmentVariable[]> => {
    try {
      const variables = environmentScanner.getAllEnvironmentVariables()
      return variables
    } catch (error) {
      console.error('Error getting environment variables:', error)
      sendToAllWindows('error', `Failed to get environment variables: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return []
    }
  })

  // Get PATH entries
  ipcMain.handle('env:get-path', async (): Promise<string[]> => {
    try {
      const pathEntries = environmentScanner.getPathEntries()
      return pathEntries
    } catch (error) {
      console.error('Error getting PATH entries:', error)
      sendToAllWindows('error', `Failed to get PATH entries: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return []
    }
  })
}

/**
 * Register all IPC handlers for settings
 */
function registerSettingsHandlers(): void {
  // Get current language
  ipcMain.handle('settings:get-language', async (): Promise<string> => {
    return currentLanguage
  })

  // Set language
  ipcMain.handle('settings:set-language', async (_event, lang: string): Promise<void> => {
    if (lang === 'zh-CN' || lang === 'en-US') {
      currentLanguage = lang
      // Notify all windows of language change
      sendToAllWindows('settings:language-changed', lang)
      // Also update AI assistant language
      aiAssistant.setLanguage(lang)
    }
  })
}

/**
 * Register all IPC handlers for AI assistant
 */
function registerAIHandlers(): void {
  // Analyze environment
  ipcMain.handle('ai:analyze', async (_event, language?: 'en-US' | 'zh-CN', useCache: boolean = false): Promise<AnalysisResult> => {
    try {
      // Update language only (don't override other config)
      if (language) {
        aiAssistant.setLanguage(language)
      }
      
      let tools: ToolInfo[]
      let packages: PackageInfo[]
      let services: RunningService[]
      let environment: EnvironmentVariable[]

      // Use cached data if requested and available
      if (useCache && cachedEnvironmentData) {
        ({ tools, packages, services, environment } = cachedEnvironmentData)
      } else {
        // Gather all data in parallel for better performance
        const [
          toolsResult,
          npmPackages,
          pipPackages,
          composerPackages,
          servicesResult,
        ] = await Promise.all([
          detectionEngine.detectAllTools(),
          packageManager.listNpmPackages(),
          packageManager.listPipPackages(),
          packageManager.listComposerPackages(),
          serviceMonitor.listRunningServices(),
        ])

        tools = toolsResult
        packages = [...npmPackages, ...pipPackages, ...composerPackages]
        services = servicesResult
        environment = environmentScanner.getAllEnvironmentVariables()

        // Update cache
        cachedEnvironmentData = { tools, packages, environment, services }
      }
      
      // Perform analysis
      const onToken = (token: string) => {
        _event.sender.send('ai:stream-token', token)
      }
      
      const result = await aiAssistant.analyze(tools, packages, environment, services, onToken)
      return result
    } catch (error) {
      console.error('Error analyzing environment:', error)
      const isZhCN = language === 'zh-CN'
      return {
        summary: isZhCN ? '分析失败' : 'Analysis failed',
        issues: [],
        suggestions: [],
        insights: [`${isZhCN ? '错误' : 'Error'}: ${error instanceof Error ? error.message : 'Unknown error'}`]
      }
    }
  })

  // Update AI configuration
  ipcMain.handle('ai:update-config', async (_event, config: AIConfig): Promise<void> => {
    try {
      aiAssistant.updateConfig(config)
    } catch (error) {
      console.error('Error updating AI config:', error)
      sendToAllWindows('error', `Failed to update AI config: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  })

  // Fetch AI models
  ipcMain.handle('ai:fetch-models', async (): Promise<string[]> => {
    try {
      return await aiAssistant.fetchModels()
    } catch (error) {
      console.error('Error fetching AI models:', error)
      return []
    }
  })

  // Test AI connection
  ipcMain.handle('ai:test-connection', async (_event, config: AIConfig): Promise<{ success: boolean; message: string }> => {
    try {
      return await aiAssistant.testConnection(config)
    } catch (error) {
      console.error('Error testing AI connection:', error)
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })
}

/**
 * Register all IPC handlers for AI CLI tools management
 */
function registerAICLIHandlers(): void {
  // Detect all AI CLI tools
  ipcMain.handle('ai-cli:detect-all', async (): Promise<AICLITool[]> => {
    try {
      const tools = await detectionEngine.detectAICLITools()
      return tools
    } catch (error) {
      console.error('Error detecting AI CLI tools:', error)
      sendToAllWindows('error', `Failed to detect AI CLI tools: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return []
    }
  })

  // Install an AI CLI tool
  ipcMain.handle('ai-cli:install', async (_event, toolName: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await detectionEngine.installAICLITool(toolName)
      return result
    } catch (error) {
      console.error(`Error installing AI CLI tool ${toolName}:`, error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Update an AI CLI tool
  ipcMain.handle('ai-cli:update', async (_event, toolName: string): Promise<{ success: boolean; newVersion?: string; error?: string }> => {
    try {
      const result = await detectionEngine.updateAICLITool(toolName)
      return result
    } catch (error) {
      console.error(`Error updating AI CLI tool ${toolName}:`, error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Uninstall an AI CLI tool
  ipcMain.handle('ai-cli:uninstall', async (_event, toolName: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await detectionEngine.uninstallAICLITool(toolName)
      return result
    } catch (error) {
      console.error(`Error uninstalling AI CLI tool ${toolName}:`, error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })
}

/**
 * Register all IPC handlers for app info and updates
 * These handlers are always registered, regardless of auto-updater status
 */
function registerAppHandlers(): void {
  // Get current version - always available
  ipcMain.handle('app:version', () => {
    return app.getVersion()
  })

  // Update handlers - return appropriate responses when auto-updater is disabled
  ipcMain.handle('update:check', async () => {
    return {
      success: false,
      error: 'Auto-updater is not available in this build'
    }
  })

  ipcMain.handle('update:download', async () => {
    return {
      success: false,
      error: 'Auto-updater is not available in this build'
    }
  })

  ipcMain.handle('update:install', () => {
    console.log('Update install requested but auto-updater is not available')
  })
}

/**
 * Register all IPC handlers for shell operations
 */
function registerShellHandlers(): void {
  const expandUserPath = (inputPath: string): string => {
    const trimmed = inputPath.trim()
    const homeDir = os.homedir()

    let expanded = trimmed

    // Expand leading ~ (Unix-like home shorthand)
    if (expanded === '~') {
      expanded = homeDir
    } else if (expanded.startsWith('~/') || expanded.startsWith('~\\')) {
      expanded = `${homeDir}${expanded.slice(1)}`
    }

    // Expand common home env vars
    expanded = expanded.replace(/%USERPROFILE%/gi, homeDir)
    expanded = expanded.replace(/\$\{HOME\}/g, homeDir)
    expanded = expanded.replace(/\$HOME\b/g, homeDir)

    return expanded
  }

  // Open a path in file explorer
  ipcMain.handle('shell:open-path', async (_event, path: string): Promise<string> => {
    try {
      // Validate raw path doesn't contain path traversal (Requirement 2.3)
      const rawValidation = inputValidator.validatePath(path);
      if (!rawValidation.valid) {
        console.warn(`Security warning: Path validation failed: ${rawValidation.error}`);
        return rawValidation.error!;
      }

      const expandedPath = expandUserPath(rawValidation.value!)

      // Validate expanded path as well (defense-in-depth)
      const expandedValidation = inputValidator.validatePath(expandedPath);
      if (!expandedValidation.valid) {
        console.warn(`Security warning: Expanded path validation failed: ${expandedValidation.error}`);
        return expandedValidation.error!;
      }

      return await shell.openPath(expandedValidation.value!)
    } catch (error) {
      console.error('Error opening path:', error)
      return error instanceof Error ? error.message : 'Unknown error'
    }
  })

  // Open external URL in default browser
  ipcMain.handle('shell:open-external', async (_event, url: string): Promise<void> => {
    try {
      // Validate URL to prevent malicious schemes
      if (!url || typeof url !== 'string') {
        throw new Error('Invalid URL provided')
      }

      // Only allow http and https protocols
      const urlLower = url.toLowerCase().trim()
      if (!urlLower.startsWith('http://') && !urlLower.startsWith('https://')) {
        throw new Error('Only HTTP and HTTPS URLs are allowed')
      }

      // Additional validation: parse URL to ensure it's valid
      try {
        new URL(url)
      } catch {
        throw new Error('Malformed URL')
      }

      await shell.openExternal(url)
    } catch (error) {
      console.error('Error opening external URL:', error)
      throw error
    }
  })

  // Execute a shell command
  ipcMain.handle('shell:execute-command', async (event, command: string): Promise<{ success: boolean; stdout: string; stderr: string }> => {
    try {
      // Validate IPC sender (Requirement 1.3 - security logging)
      if (!validateIPCSender(event)) {
        console.warn('Security warning: IPC message from untrusted sender for shell:execute-command');
        return { success: false, stdout: '', stderr: 'Untrusted sender' };
      }

      // Validate command before execution (Requirement 1.1)
      const validationResult = commandValidator.validateCommand(command);
      if (!validationResult.valid) {
        console.warn('Security warning: Command validation failed:', validationResult.error);
        return { success: false, stdout: '', stderr: validationResult.error! };
      }

      const result = await commandExecutor.execute(validationResult.sanitizedCommand!, { timeout: 60000 }) // 60 second timeout
      return {
        success: result.success,
        stdout: result.stdout,
        stderr: result.stderr
      }
    } catch (error) {
      console.error('Error executing command:', error)
      return {
        success: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })
}

/**
 * Start service monitoring and send updates to renderer
 * 
 * Validates: Requirement 11.6 (refresh every 5 seconds)
 */
function startServiceMonitoring(): void {
  // Add listener for service updates
  serviceMonitor.addListener((services) => {
    sendToAllWindows('services:updated', services)
  })
  
  // Start monitoring with 5 second interval
  serviceMonitor.startMonitoring(5000)
}

/**
 * Stop service monitoring
 */
function stopServiceMonitoring(): void {
  serviceMonitor.stopMonitoring()
}

/**
 * Send detection progress to renderer
 * @param progress Progress percentage (0-100)
 */
export function sendDetectionProgress(progress: number): void {
  sendToAllWindows('detection:progress', progress)
}

/**
 * Send error to renderer
 * @param error Error message
 */
export function sendError(error: string): void {
  sendToAllWindows('error', error)
}

/**
 * Check if IPC handlers are already registered
 * Validates: Requirement 11.4 - Prevent duplicate registration
 * @returns true if handlers are registered, false otherwise
 */
export function areIPCHandlersRegistered(): boolean {
  return ipcHandlersRegistered
}

/**
 * Register all IPC handlers for cache cleaning
 * 
 * ⚠️ WARNING: These operations are destructive and irreversible
 */
function registerCacheHandlers(): void {
  // Scan all caches
  ipcMain.handle('cache:scan-all', async (): Promise<CacheScanResult> => {
    try {
      const result = await cacheScanner.scanAllCaches()
      return result
    } catch (error) {
      console.error('Error scanning caches:', error)
      sendToAllWindows('error', `Failed to scan caches: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return {
        caches: [],
        totalSize: 0,
        totalSizeFormatted: '0 B',
        scanTime: 0,
      }
    }
  })

  // Clean a single cache
  ipcMain.handle('cache:clean', async (event, cacheId: string): Promise<CleanResult> => {
    try {
      // Validate IPC sender
      if (!validateIPCSender(event)) {
        console.warn('Security warning: IPC message from untrusted sender for cache:clean')
        return { id: cacheId, success: false, freedSpace: 0, freedSpaceFormatted: '0 B', error: 'Untrusted sender' }
      }

      // Validate cache ID
      if (!cacheId || typeof cacheId !== 'string' || cacheId.length > 50) {
        return { id: cacheId, success: false, freedSpace: 0, freedSpaceFormatted: '0 B', error: 'Invalid cache ID' }
      }

      const result = await cacheScanner.cleanCache(cacheId)
      return result
    } catch (error) {
      console.error(`Error cleaning cache ${cacheId}:`, error)
      return {
        id: cacheId,
        success: false,
        freedSpace: 0,
        freedSpaceFormatted: '0 B',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  })

  // Clean multiple caches
  ipcMain.handle('cache:clean-multiple', async (event, cacheIds: string[]): Promise<CleanResult[]> => {
    try {
      // Validate IPC sender
      if (!validateIPCSender(event)) {
        console.warn('Security warning: IPC message from untrusted sender for cache:clean-multiple')
        return cacheIds.map(id => ({ id, success: false, freedSpace: 0, freedSpaceFormatted: '0 B', error: 'Untrusted sender' }))
      }

      // Validate cache IDs
      if (!Array.isArray(cacheIds) || cacheIds.length === 0 || cacheIds.length > 20) {
        return [{ id: 'unknown', success: false, freedSpace: 0, freedSpaceFormatted: '0 B', error: 'Invalid cache IDs' }]
      }

      const results = await cacheScanner.cleanMultipleCaches(cacheIds)
      return results
    } catch (error) {
      console.error('Error cleaning multiple caches:', error)
      return cacheIds.map(id => ({
        id,
        success: false,
        freedSpace: 0,
        freedSpaceFormatted: '0 B',
        error: error instanceof Error ? error.message : 'Unknown error',
      }))
    }
  })
}

/**
 * Register all IPC handlers for AI cleanup
 * 
 * Scans and cleans junk files created by AI coding assistants
 */
function registerAICleanupHandlers(): void {
  // Scan all common directories for AI junk files
  ipcMain.handle('ai-cleanup:scan-all', async (_event, language?: 'en-US' | 'zh-CN'): Promise<AICleanupScanResult> => {
    try {
      if (language) {
        aiCleanupScanner.setLanguage(language)
      }
      const result = await aiCleanupScanner.scanAll()
      return result
    } catch (error) {
      console.error('Error scanning for AI junk files:', error)
      sendToAllWindows('error', `Failed to scan for AI junk files: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return {
        files: [],
        totalSize: 0,
        totalSizeFormatted: '0 B',
        scanTime: 0,
        scannedPaths: [],
      }
    }
  })

  // Scan full disk for AI junk files (deep scan)
  ipcMain.handle('ai-cleanup:scan-full-disk', async (_event, language?: 'en-US' | 'zh-CN'): Promise<AICleanupScanResult> => {
    try {
      if (language) {
        aiCleanupScanner.setLanguage(language)
      }
      const result = await aiCleanupScanner.scanFullDisk()
      return result
    } catch (error) {
      console.error('Error scanning full disk for AI junk files:', error)
      sendToAllWindows('error', `Failed to scan full disk: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return {
        files: [],
        totalSize: 0,
        totalSizeFormatted: '0 B',
        scanTime: 0,
        scannedPaths: [],
      }
    }
  })

  // Scan a specific path for AI junk files
  ipcMain.handle('ai-cleanup:scan-path', async (_event, targetPath: string, language?: 'en-US' | 'zh-CN'): Promise<AICleanupScanResult> => {
    try {
      if (language) {
        aiCleanupScanner.setLanguage(language)
      }
      
      // Validate path
      const pathValidation = inputValidator.validatePath(targetPath)
      if (!pathValidation.valid) {
        console.warn(`Security warning: Path validation failed: ${pathValidation.error}`)
        return {
          files: [],
          totalSize: 0,
          totalSizeFormatted: '0 B',
          scanTime: 0,
          scannedPaths: [],
        }
      }
      
      const result = await aiCleanupScanner.scanPath(pathValidation.value!)
      return result
    } catch (error) {
      console.error('Error scanning path for AI junk files:', error)
      return {
        files: [],
        totalSize: 0,
        totalSizeFormatted: '0 B',
        scanTime: 0,
        scannedPaths: [],
      }
    }
  })

  // Select a directory for AI cleanup scan
  ipcMain.handle('ai-cleanup:select-directory', async (event): Promise<string | null> => {
    try {
      if (!validateIPCSender(event)) {
        console.warn('Security warning: IPC message from untrusted sender for ai-cleanup:select-directory')
        return null
      }

      const window = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow()
      const options = { properties: ['openDirectory'] as Array<'openDirectory'> }
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)

      if (result.canceled || result.filePaths.length === 0) {
        return null
      }

      return result.filePaths[0]
    } catch (error) {
      console.error('Error selecting directory for AI cleanup:', error)
      return null
    }
  })

  // Delete a single AI junk file
  ipcMain.handle('ai-cleanup:delete', async (event, itemId: string): Promise<AICleanupResult> => {
    try {
      // Validate IPC sender
      if (!validateIPCSender(event)) {
        console.warn('Security warning: IPC message from untrusted sender for ai-cleanup:delete')
        return { id: itemId, success: false, freedSpace: 0, freedSpaceFormatted: '0 B', error: 'Untrusted sender' }
      }

      // Validate item ID (base64 encoded path)
      if (!itemId || typeof itemId !== 'string' || itemId.length > 1000) {
        return { id: itemId, success: false, freedSpace: 0, freedSpaceFormatted: '0 B', error: 'Invalid item ID' }
      }

      const result = await aiCleanupScanner.deleteItem(itemId)
      return result
    } catch (error) {
      console.error(`Error deleting AI junk file:`, error)
      return {
        id: itemId,
        success: false,
        freedSpace: 0,
        freedSpaceFormatted: '0 B',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  })

  // Delete multiple AI junk files
  ipcMain.handle('ai-cleanup:delete-multiple', async (event, itemIds: string[]): Promise<AICleanupResult[]> => {
    try {
      // Validate IPC sender
      if (!validateIPCSender(event)) {
        console.warn('Security warning: IPC message from untrusted sender for ai-cleanup:delete-multiple')
        return itemIds.map(id => ({ id, success: false, freedSpace: 0, freedSpaceFormatted: '0 B', error: 'Untrusted sender' }))
      }

      // Validate item IDs
      if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.length > 100) {
        return [{ id: 'unknown', success: false, freedSpace: 0, freedSpaceFormatted: '0 B', error: 'Invalid item IDs' }]
      }

      const results = await aiCleanupScanner.deleteMultiple(itemIds)
      return results
    } catch (error) {
      console.error('Error deleting multiple AI junk files:', error)
      return itemIds.map(id => ({
        id,
        success: false,
        freedSpace: 0,
        freedSpaceFormatted: '0 B',
        error: error instanceof Error ? error.message : 'Unknown error',
      }))
    }
  })
}

/**
 * Register all IPC handlers
 * Call this function during app initialization
 * Validates: Requirement 11.4 - Prevent duplicate registration
 */
export function registerAllIPCHandlers(): void {
  // Prevent duplicate registration (Requirement 11.4)
  if (ipcHandlersRegistered) {
    console.warn('IPC handlers already registered, skipping duplicate registration')
    return
  }

  registerToolsHandlers()
  registerPackagesHandlers()
  registerServicesHandlers()
  registerEnvironmentHandlers()
  registerSettingsHandlers()
  registerAIHandlers()
  registerAICLIHandlers()
  registerCacheHandlers()
  registerAICleanupHandlers()
  registerAppHandlers()
  registerShellHandlers()
  
  // Start service monitoring
  startServiceMonitoring()
  
  ipcHandlersRegistered = true
  console.log('All IPC handlers registered')
}

/**
 * Cleanup IPC handlers and stop monitoring
 * Call this function during app shutdown
 * Validates: Requirements 11.2, 11.3 - Clean up IPC handlers on quit
 */
export function cleanupIPCHandlers(): void {
  // Only cleanup if handlers were registered
  if (!ipcHandlersRegistered) {
    console.log('IPC handlers not registered, skipping cleanup')
    return
  }

  stopServiceMonitoring()
  
  // Remove all handlers using ipcMain.removeHandler()
  ipcMain.removeHandler('tools:detect-all')
  ipcMain.removeHandler('tools:detect-one')
  ipcMain.removeHandler('tools:uninstall')
  ipcMain.removeHandler('tools:get-uninstall-info')
  ipcMain.removeHandler('packages:list-npm')
  ipcMain.removeHandler('packages:list-pip')
  ipcMain.removeHandler('packages:list-composer')
  ipcMain.removeHandler('packages:list-cargo')
  ipcMain.removeHandler('packages:list-gem')
  ipcMain.removeHandler('packages:discover-managers')
  ipcMain.removeHandler('packages:get-manager-status')
  ipcMain.removeHandler('packages:list-by-manager')
  ipcMain.removeHandler('packages:list-all-enhanced')
  ipcMain.removeHandler('packages:uninstall-enhanced')
  ipcMain.removeHandler('packages:uninstall')
  ipcMain.removeHandler('packages:update')
  ipcMain.removeHandler('packages:check-npm-latest')
  ipcMain.removeHandler('packages:check-pip-latest')
  ipcMain.removeHandler('services:list')
  ipcMain.removeHandler('services:kill')
  ipcMain.removeHandler('env:get-all')
  ipcMain.removeHandler('env:get-path')
  ipcMain.removeHandler('settings:get-language')
  ipcMain.removeHandler('settings:set-language')
  ipcMain.removeHandler('ai:analyze')
  ipcMain.removeHandler('ai:update-config')
  ipcMain.removeHandler('ai:fetch-models')
  ipcMain.removeHandler('ai:test-connection')
  ipcMain.removeHandler('app:version')
  ipcMain.removeHandler('update:check')
  ipcMain.removeHandler('update:download')
  ipcMain.removeHandler('update:install')
  ipcMain.removeHandler('shell:open-path')
  ipcMain.removeHandler('shell:open-external')
  ipcMain.removeHandler('shell:execute-command')
  ipcMain.removeHandler('ai-cli:detect-all')
  ipcMain.removeHandler('ai-cli:install')
  ipcMain.removeHandler('ai-cli:update')
  ipcMain.removeHandler('ai-cli:uninstall')
  ipcMain.removeHandler('cache:scan-all')
  ipcMain.removeHandler('cache:clean')
  ipcMain.removeHandler('cache:clean-multiple')
  ipcMain.removeHandler('ai-cleanup:scan-all')
  ipcMain.removeHandler('ai-cleanup:scan-full-disk')
  ipcMain.removeHandler('ai-cleanup:scan-path')
  ipcMain.removeHandler('ai-cleanup:select-directory')
  ipcMain.removeHandler('ai-cleanup:delete')
  ipcMain.removeHandler('ai-cleanup:delete-multiple')
  
  ipcHandlersRegistered = false
  console.log('All IPC handlers cleaned up')
}

export default {
  registerAllIPCHandlers,
  cleanupIPCHandlers,
  areIPCHandlersRegistered,
  sendDetectionProgress,
  sendError,
}
