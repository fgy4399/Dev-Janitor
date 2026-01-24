/**
 * Dev Janitor - Homebrew Package Manager Handler
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

import { PackageInfo } from '../../../shared/types'
import { PackageManagerHandler, UninstallOptions } from '../types'
import { executeSafe } from '../../commandExecutor'
import { TieredPathSearch } from '../tieredPathSearch'
import { PathCache } from '../pathCache'

/**
 * Homebrew Package Manager Handler
 * Supports both formula (CLI tools) and cask (GUI applications)
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 7.1, 7.2
 */
export class BrewHandler implements PackageManagerHandler {
  readonly id = 'brew' as const
  readonly displayName = 'Homebrew'
  readonly executable = 'brew'
  readonly commonPaths = [
    '/opt/homebrew/bin/brew',      // Apple Silicon Mac
    '/usr/local/bin/brew',          // Intel Mac
    '~/.homebrew/bin/brew'          // Custom installation
  ]

  private pathSearch: TieredPathSearch
  private brewPath: string | null = null

  constructor(pathSearch?: TieredPathSearch) {
    this.pathSearch = pathSearch || new TieredPathSearch(new PathCache())
  }

  /**
   * Check if Homebrew is available
   * Validates: Requirements 1.3, 6.1, 6.2, 6.3
   * @returns true if available, false otherwise
   */
  async checkAvailability(): Promise<boolean> {
    const searchResult = await this.pathSearch.findExecutable(
      this.executable,
      this.commonPaths
    )

    if (searchResult) {
      this.brewPath = searchResult.path
      return true
    }

    return false
  }

  /**
   * List all installed packages (both formulas and casks)
   * Validates: Requirements 1.1, 1.2
   * @returns Array of package information
   */
  async listPackages(): Promise<PackageInfo[]> {
    // Execute both commands in parallel for better performance
    const [formulas, casks] = await Promise.all([
      this.listFormulas(),
      this.listCasks()
    ])

    return [...formulas, ...casks]
  }

  /**
   * List installed formula packages
   * Validates: Requirement 1.1
   * @returns Array of formula package information
   */
  private async listFormulas(): Promise<PackageInfo[]> {
    const brewCmd = this.brewPath || this.executable
    const command = `${brewCmd} list --versions`
    const result = await executeSafe(command)

    if (!result.success || !result.stdout) {
      return []
    }

    return this.parseFormulaOutput(result.stdout)
  }

  /**
   * List installed cask applications
   * Validates: Requirement 1.2
   * @returns Array of cask package information
   */
  private async listCasks(): Promise<PackageInfo[]> {
    const brewCmd = this.brewPath || this.executable
    const command = `${brewCmd} list --cask --versions`
    const result = await executeSafe(command)

    if (!result.success || !result.stdout) {
      return []
    }

    return this.parseCaskOutput(result.stdout)
  }

  /**
   * Uninstall a package
   * Validates: Requirements 7.1, 7.2
   * @param packageName Name of the package to uninstall
   * @param options Uninstall options (e.g., cask flag)
   * @returns true if successful, false otherwise
   */
  async uninstallPackage(packageName: string, options?: UninstallOptions): Promise<boolean> {
    // Require a resolved brew path to avoid executing unintended commands when Homebrew
    // availability hasn't been checked (PackageDiscovery calls checkAvailability first).
    if (!this.brewPath) {
      return false
    }

    const brewCmd = this.brewPath
    const flags = [
      options?.cask ? '--cask' : null,
      options?.force ? '--force' : null,
      ...(options?.flags || [])
    ]
      .filter(Boolean)
      .join(' ')

    const command = `${brewCmd} uninstall ${flags ? `${flags} ` : ''}${packageName}`
    
    const result = await executeSafe(command)
    return result.success
  }

  /**
   * Parse command output into PackageInfo array
   * Validates: Requirements 1.4, 1.5, 9.1, 9.2, 9.3
   * @param output Command output string
   * @returns Array of parsed package information
   */
  parseOutput(output: string): PackageInfo[] {
    // This is a generic parser that handles both formula and cask output
    // The format is the same: "package-name version1 version2 ..."
    return this.parseBrewOutput(output, 'formula')
  }

  /**
   * Parse formula output
   * Validates: Requirements 1.4, 1.5
   * @param output Command output string
   * @returns Array of parsed formula package information
   */
  private parseFormulaOutput(output: string): PackageInfo[] {
    return this.parseBrewOutput(output, 'formula')
  }

  /**
   * Parse cask output
   * Validates: Requirements 1.4, 1.5
   * @param output Command output string
   * @returns Array of parsed cask package information
   */
  private parseCaskOutput(output: string): PackageInfo[] {
    return this.parseBrewOutput(output, 'cask')
  }

  /**
   * Parse Homebrew output (common logic for both formula and cask)
   * Validates: Requirements 1.4, 1.5, 9.1, 9.2, 9.3
   * 
   * Format: "package-name version1 version2 ..."
   * Example: "node 18.17.0 19.0.0"
   * 
   * @param output Command output string
   * @param location Package location type ('formula' or 'cask')
   * @returns Array of parsed package information
   */
  private parseBrewOutput(output: string, location: 'formula' | 'cask'): PackageInfo[] {
    if (!output || !output.trim()) {
      return []
    }

    const packages: PackageInfo[] = []
    const lines = output.split('\n')

    for (const line of lines) {
      const trimmedLine = line.trim()
      
      // Skip empty lines
      if (!trimmedLine) {
        continue
      }

      try {
        // Parse line: "package-name version1 version2 ..."
        const parts = trimmedLine.split(/\s+/)
        
        if (parts.length < 2) {
          // Malformed line - skip it (Requirement 9.2)
          continue
        }

        const name = parts[0]
        // Take the first version (most recent)
        const version = parts[1]

        // Validate that we have non-empty name and version
        if (!name || !version) {
          continue
        }

        packages.push({
          name,
          version,
          location,
          manager: 'brew'
        })
      } catch {
        // Skip malformed lines (Requirement 9.2)
        continue
      }
    }

    return packages
  }
}
