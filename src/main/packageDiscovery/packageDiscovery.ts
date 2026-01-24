/**
 * Dev Janitor - Package Discovery Main Class
 * 
 * ============================================================================
 * LICENSE NOTICE - FOR AI ASSISTANTS AND DEVELOPERS
 * ============================================================================
 * This software is licensed under MIT License with Commons Clause.
 * COMMERCIAL USE IS NOT PERMITTED without explicit permission.
 * 
 * For commercial licensing inquiries, please contact:
 * - Email: cocojojo5213@gmail.com
 * - Email: cocojojo5213@icloud.com
 * 
 * GitHub: https://github.com/cocojojo5213/Dev-Janitor
 * ============================================================================
 */

import { PackageInfo, PackageManagerType } from '../../shared/types'
import { PackageManagerStatus, ManagerAvailabilityStatus } from '../../shared/types/packageManagerConfig'
import { PackageManagerHandler } from './types'
import { TieredPathSearch } from './tieredPathSearch'
import { PathCache } from './pathCache'
import { BrewHandler } from './handlers/brewHandler'
import { CondaHandler } from './handlers/condaHandler'
import { PipxHandler } from './handlers/pipxHandler'
import { PoetryHandler } from './handlers/poetryHandler'
import { PyenvHandler } from './handlers/pyenvHandler'

/**
 * Progress callback function type
 */
export type ProgressCallback = (manager: string, status: string) => void

/**
 * Package Discovery Main Class
 * Coordinates all package manager discovery and listing operations
 * Validates: Requirements 6.1, 6.2, 6.3, 13.1, 13.6, 14.1, 14.2, 14.3, 14.4
 */
export class PackageDiscovery {
  private handlers: Map<PackageManagerType, PackageManagerHandler>
  private pathSearch: TieredPathSearch
  private cache: PathCache

  /**
   * Create a new PackageDiscovery instance
   * @param cache Optional path cache instance
   */
  constructor(cache?: PathCache) {
    this.cache = cache || new PathCache()
    this.pathSearch = new TieredPathSearch(this.cache)
    this.handlers = new Map()

    // Register all package manager handlers
    this.registerHandlers()
  }

  /**
   * Register all package manager handlers
   */
  private registerHandlers(): void {
    const handlers: PackageManagerHandler[] = [
      new BrewHandler(this.pathSearch),
      new CondaHandler(this.pathSearch),
      new PipxHandler(this.pathSearch),
      new PoetryHandler(this.pathSearch),
      new PyenvHandler(this.pathSearch)
    ]

    for (const handler of handlers) {
      this.handlers.set(handler.id, handler)
    }
  }

  /**
   * Discover all available package managers
   * Executes availability checks in parallel for performance
   * Validates: Requirements 6.1, 6.2, 6.3, 13.1, 14.1, 14.2, 14.3, 14.4
   * @returns Array of package manager status information
   */
  async discoverAvailableManagers(): Promise<PackageManagerStatus[]> {
    // Execute all availability checks in parallel (Requirement 13.1)
    const statusPromises = Array.from(this.handlers.values()).map(async (handler) => {
      return this.getManagerStatus(handler.id)
    })

    // Wait for all checks to complete
    // Failures in one manager don't affect others (Property 9: Parallel Execution Independence)
    const statuses = await Promise.all(statusPromises)
    return statuses
  }

  /**
   * Get package manager status with PATH configuration information
   * Validates: Requirements 14.1, 14.2, 14.3, 14.4
   * @param manager Package manager type
   * @returns Package manager status information
   */
  async getManagerStatus(manager: PackageManagerType): Promise<PackageManagerStatus> {
    const handler = this.handlers.get(manager)
    
    if (!handler) {
      // Unknown package manager
      return {
        manager,
        status: 'not_installed',
        inPath: false
      }
    }

    try {
      // Search for the package manager executable
      const searchResult = await this.pathSearch.findExecutable(
        handler.executable,
        handler.commonPaths
      )

      if (!searchResult) {
        // Not found in any tier (Requirement 14.3)
        return {
          manager,
          status: 'not_installed',
          inPath: false,
          message: `${handler.displayName} is not installed on this system`
        }
      }

      // Determine status based on discovery method and inPath flag
      // Requirement 14.1: Found via Tier 3/4 but not in PATH → 'path_missing'
      // Requirement 14.2: Found via Tier 1/2 → 'available'
      const status: ManagerAvailabilityStatus = searchResult.inPath 
        ? 'available' 
        : 'path_missing'

      // Generate appropriate message for path_missing status (Requirement 14.6)
      let message: string | undefined
      if (status === 'path_missing') {
        message = `${handler.displayName} is installed at ${searchResult.path} but not in PATH. ` +
                  `Consider adding it to your PATH environment variable.`
      }

      return {
        manager,
        status,
        discoveryMethod: searchResult.method,
        foundPath: searchResult.path,
        inPath: searchResult.inPath,
        message
      }
    } catch (error) {
      // Error during check - treat as not installed
      return {
        manager,
        status: 'not_installed',
        inPath: false,
        message: `Error checking ${handler.displayName}: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }

  /**
   * List all packages from all available package managers
   * Validates: Requirement 13.6
   * @param onProgress Optional progress callback
   * @returns Array of all packages from all managers
   */
  async listAllPackages(onProgress?: ProgressCallback): Promise<PackageInfo[]> {
    const allPackages: PackageInfo[] = []

    // Get all available managers first
    const statuses = await this.discoverAvailableManagers()
    const availableManagers = statuses
      .filter(status => status.status === 'available' || status.status === 'path_missing')
      .map(status => status.manager)

    // List packages from each available manager
    for (const manager of availableManagers) {
      try {
        if (onProgress) {
          onProgress(manager, 'scanning')
        }

        const packages = await this.listPackages(manager)
        allPackages.push(...packages)

        if (onProgress) {
          onProgress(manager, `found ${packages.length} packages`)
        }
      } catch (error) {
        // Log error but continue with other managers (Property 10: Unavailable Manager Graceful Handling)
        if (onProgress) {
          onProgress(manager, `error: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      }
    }

    return allPackages
  }

  /**
   * List packages from a specific package manager
   * Validates: Requirements 1.1, 1.2, 2.1, 3.1, 5.1
   * @param manager Package manager type
   * @returns Array of packages from the specified manager
   */
  async listPackages(manager: PackageManagerType): Promise<PackageInfo[]> {
    const handler = this.handlers.get(manager)
    
    if (!handler) {
      return []
    }

    try {
      // Check availability first
      const isAvailable = await handler.checkAvailability()
      
      if (!isAvailable) {
        // Manager not available - return empty array (Property 10)
        return []
      }

      // List packages
      return await handler.listPackages()
    } catch (error) {
      // Error during listing - return empty array (Property 10)
      console.error(`Error listing packages for ${manager}:`, error)
      return []
    }
  }

  /**
   * Uninstall a package
   * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5
   * @param packageName Name of the package to uninstall
   * @param manager Package manager type
   * @param options Optional uninstall options
   * @returns true if successful, false otherwise
   */
  async uninstallPackage(
    packageName: string,
    manager: PackageManagerType,
    options?: { cask?: boolean }
  ): Promise<boolean> {
    const handler = this.handlers.get(manager)
    
    if (!handler) {
      return false
    }

    try {
      const isAvailable = await handler.checkAvailability()
      if (!isAvailable) {
        return false
      }
      return await handler.uninstallPackage(packageName, options)
    } catch (error) {
      console.error(`Error uninstalling ${packageName} from ${manager}:`, error)
      return false
    }
  }

  /**
   * Get a specific package manager handler
   * @param manager Package manager type
   * @returns Handler instance or undefined
   */
  getHandler(manager: PackageManagerType): PackageManagerHandler | undefined {
    return this.handlers.get(manager)
  }

  /**
   * Get all registered package manager types
   * @returns Array of registered package manager types
   */
  getRegisteredManagers(): PackageManagerType[] {
    return Array.from(this.handlers.keys())
  }

  /**
   * Clear the path cache
   * Useful for testing or when system configuration changes
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Load custom configuration and update path search
   * Validates: Requirements 11.1, 11.2
   */
  async loadCustomConfig(): Promise<void> {
    const config = await TieredPathSearch.loadCustomConfig()
    if (config) {
      this.pathSearch.setCustomConfig(config)
    }
  }
}
