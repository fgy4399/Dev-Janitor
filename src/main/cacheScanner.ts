/**
 * Cache Scanner Module
 * 
 * Scans and manages package manager cache directories.
 * Supports: npm, yarn, pnpm, pip, Composer, Cargo, Homebrew
 * 
 * ⚠️ WARNING: Cache cleaning operations are destructive and irreversible.
 * Users must understand the implications before proceeding.
 */

import { promises as fs } from 'fs'
import * as path from 'path'
import * as os from 'os'
import { executeFileCommand } from './commandExecutor'
import { inputValidator } from './security'

export interface CacheInfo {
  id: string                    // Unique identifier (e.g., 'npm', 'yarn')
  name: string                  // Display name
  path: string                  // Cache directory path
  size: number                  // Size in bytes
  sizeFormatted: string         // Human-readable size
  exists: boolean               // Whether the directory exists
  lastModified?: Date           // Last modification time
  description: string           // Description of what this cache contains
  cleanCommand?: string         // Native clean command if available
  riskLevel: 'low' | 'medium' | 'high'  // Risk level for cleaning
}

export interface CleanResult {
  id: string
  success: boolean
  freedSpace: number            // Bytes freed
  freedSpaceFormatted: string
  error?: string
}

export interface CacheScanResult {
  caches: CacheInfo[]
  totalSize: number
  totalSizeFormatted: string
  scanTime: number              // Scan duration in ms
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

/**
 * Get directory size recursively with timeout and optimization
 */
async function getDirectorySize(dirPath: string, maxDepth: number = 10): Promise<number> {
  let totalSize = 0
  
  async function scanDir(currentPath: string, depth: number): Promise<number> {
    if (depth > maxDepth) return 0
    
    let size = 0
    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true })
      
      // Process in batches for better performance
      const batchSize = 100
      for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize)
        const results = await Promise.all(
          batch.map(async (entry) => {
            const fullPath = path.join(currentPath, entry.name)
            try {
              if (entry.isDirectory()) {
                return await scanDir(fullPath, depth + 1)
              } else if (entry.isFile()) {
                const stats = await fs.stat(fullPath)
                return stats.size
              }
            } catch {
              // Skip inaccessible files
            }
            return 0
          })
        )
        size += results.reduce((a, b) => a + b, 0)
      }
    } catch {
      return 0
    }
    return size
  }
  
  try {
    const stats = await fs.stat(dirPath)
    if (!stats.isDirectory()) {
      return stats.size
    }
    totalSize = await scanDir(dirPath, 0)
  } catch {
    return 0
  }
  
  return totalSize
}

/**
 * Quick size estimation using du command (much faster)
 */
async function getDirectorySizeFast(dirPath: string): Promise<number> {
  try {
    // Use native commands for speed
    const isWin = process.platform === 'win32'
    
    if (isWin) {
      // Windows: use PowerShell for faster calculation
      const result = await executeFileCommand(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          '(Get-ChildItem -LiteralPath $args[0] -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum',
          dirPath,
        ],
        { timeout: 10000 }
      )
      if (!result.success) throw new Error(result.stderr || 'PowerShell size command failed')
      const size = parseInt(result.stdout.trim(), 10)
      return isNaN(size) ? 0 : size
    } else {
      // Unix: use du command
      // NOTE: GNU du supports "-b" (bytes) but macOS/BSD du doesn't.
      // Use "-k" on macOS and convert KiB -> bytes for compatibility.
      const isMac = process.platform === 'darwin'
      const result = await executeFileCommand(
        'du',
        [isMac ? '-sk' : '-sb', dirPath],
        { timeout: 10000 }
      )
      if (!result.success) throw new Error(result.stderr || 'du size command failed')
      const rawSize = parseInt(result.stdout.trim().split(/\s+/)[0], 10)
      if (isNaN(rawSize)) return 0
      return isMac ? rawSize * 1024 : rawSize
    }
  } catch {
    // Fallback to manual calculation with limited depth
    return await getDirectorySize(dirPath, 3)
  }
}

/**
 * Delete directory recursively
 */
async function deleteDirectory(dirPath: string, allowedRoot: string): Promise<void> {
  try {
    const linkStats = await fs.lstat(dirPath)
    if (linkStats.isSymbolicLink()) {
      throw new Error('Refusing to delete symbolic link target')
    }

    const validation = await inputValidator.validateResolvedPath(dirPath, {
      allowedRoots: [allowedRoot],
      mustExist: true,
    })

    if (!validation.valid) {
      throw new Error(validation.error || 'Unsafe delete target')
    }

    await fs.rm(validation.value!.realPath, { recursive: true, force: true })
  } catch (error) {
    throw new Error(`Failed to delete ${dirPath}: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

function splitCleanCommand(command: string): { command: string; args: string[] } {
  const parts = command.trim().split(/\s+/).filter(Boolean)
  return {
    command: parts[0],
    args: parts.slice(1),
  }
}

/**
 * Get cache directory configurations based on OS
 */
function getCacheConfigs(): Array<Omit<CacheInfo, 'size' | 'sizeFormatted' | 'exists' | 'lastModified'>> {
  const homeDir = os.homedir()
  const isWindows = process.platform === 'win32'
  const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local')
  
  const configs: Array<Omit<CacheInfo, 'size' | 'sizeFormatted' | 'exists' | 'lastModified'>> = [
    {
      id: 'npm',
      name: 'npm Cache',
      path: isWindows 
        ? path.join(localAppData, 'npm-cache')
        : path.join(homeDir, '.npm', '_cacache'),
      description: 'npm package download cache. Safe to clean - packages will be re-downloaded when needed.',
      cleanCommand: 'npm cache clean --force',
      riskLevel: 'low',
    },
    {
      id: 'yarn',
      name: 'Yarn Cache',
      path: isWindows
        ? path.join(localAppData, 'Yarn', 'Cache')
        : path.join(homeDir, '.yarn', 'cache'),
      description: 'Yarn package cache. Safe to clean - packages will be re-downloaded.',
      cleanCommand: 'yarn cache clean',
      riskLevel: 'low',
    },
    {
      id: 'pnpm',
      name: 'pnpm Store',
      path: isWindows
        ? path.join(localAppData, 'pnpm-store')
        : path.join(homeDir, '.pnpm-store'),
      description: 'pnpm content-addressable store. Cleaning may require re-downloading packages for all projects.',
      cleanCommand: 'pnpm store prune',
      riskLevel: 'medium',
    },
    {
      id: 'pip',
      name: 'pip Cache',
      path: isWindows
        ? path.join(localAppData, 'pip', 'cache')
        : path.join(homeDir, '.cache', 'pip'),
      description: 'Python pip package cache. Safe to clean - packages will be re-downloaded.',
      cleanCommand: 'pip cache purge',
      riskLevel: 'low',
    },
    {
      id: 'composer',
      name: 'Composer Cache',
      path: isWindows
        ? path.join(localAppData, 'Composer', 'cache')
        : path.join(homeDir, '.composer', 'cache'),
      description: 'PHP Composer package cache. Safe to clean.',
      cleanCommand: 'composer clear-cache',
      riskLevel: 'low',
    },
    {
      id: 'cargo',
      name: 'Cargo Registry Cache',
      path: path.join(homeDir, '.cargo', 'registry', 'cache'),
      description: 'Rust Cargo registry cache. Safe to clean - crates will be re-downloaded.',
      riskLevel: 'low',
    },
    {
      id: 'cargo-git',
      name: 'Cargo Git Cache',
      path: path.join(homeDir, '.cargo', 'git', 'db'),
      description: 'Cargo git dependency cache. Cleaning may slow down builds temporarily.',
      riskLevel: 'medium',
    },
    {
      id: 'gradle',
      name: 'Gradle Cache',
      path: path.join(homeDir, '.gradle', 'caches'),
      description: 'Gradle build cache. May significantly slow down first build after cleaning.',
      riskLevel: 'medium',
    },
    {
      id: 'maven',
      name: 'Maven Repository',
      path: path.join(homeDir, '.m2', 'repository'),
      description: '⚠️ Maven local repository. Contains downloaded dependencies - cleaning will require re-downloading ALL dependencies.',
      riskLevel: 'high',
    },
    {
      id: 'nuget',
      name: 'NuGet Cache',
      path: isWindows
        ? path.join(localAppData, 'NuGet', 'v3-cache')
        : path.join(homeDir, '.nuget', 'packages'),
      description: '.NET NuGet package cache. Safe to clean.',
      cleanCommand: 'dotnet nuget locals all --clear',
      riskLevel: 'low',
    },
  ]
  
  // Add macOS-specific caches
  if (process.platform === 'darwin') {
    configs.push({
      id: 'homebrew',
      name: 'Homebrew Cache',
      path: path.join(homeDir, 'Library', 'Caches', 'Homebrew'),
      description: 'Homebrew download cache. Safe to clean.',
      cleanCommand: 'brew cleanup -s',
      riskLevel: 'low',
    })
    configs.push({
      id: 'cocoapods',
      name: 'CocoaPods Cache',
      path: path.join(homeDir, 'Library', 'Caches', 'CocoaPods'),
      description: 'iOS CocoaPods cache. Safe to clean.',
      cleanCommand: 'pod cache clean --all',
      riskLevel: 'low',
    })
  }
  
  return configs
}

class CacheScanner {
  /**
   * Scan all cache directories and return their sizes
   */
  async scanAllCaches(): Promise<CacheScanResult> {
    const startTime = Date.now()
    const configs = getCacheConfigs()
    let totalSize = 0
    
    // Scan caches in parallel for better performance
    const scanPromises = configs.map(async (config) => {
      try {
        const stats = await fs.stat(config.path)
        const exists = stats.isDirectory()
        
        if (exists) {
          // Use fast size calculation
          const size = await getDirectorySizeFast(config.path)
          
          return {
            ...config,
            size,
            sizeFormatted: formatBytes(size),
            exists: true,
            lastModified: stats.mtime,
          }
        }
      } catch {
        // Directory doesn't exist or can't be accessed
      }
      
      return {
        ...config,
        size: 0,
        sizeFormatted: '0 B',
        exists: false,
      }
    })
    
    const results = await Promise.all(scanPromises)
    
    // Calculate total and filter
    for (const cache of results) {
      if (cache.exists) {
        totalSize += cache.size
      }
    }
    
    // Filter to only show existing caches with size > 0, sorted by size descending
    const existingCaches = results
      .filter(cache => cache.exists && cache.size > 0)
      .sort((a, b) => b.size - a.size)
    
    return {
      caches: existingCaches,
      totalSize,
      totalSizeFormatted: formatBytes(totalSize),
      scanTime: Date.now() - startTime,
    }
  }
  
  /**
   * Clean a specific cache directory
   * @param cacheId The cache identifier
   * @param useNativeCommand Whether to use the native clean command if available
   */
  async cleanCache(cacheId: string, useNativeCommand: boolean = true): Promise<CleanResult> {
    const configs = getCacheConfigs()
    const config = configs.find(c => c.id === cacheId)
    
    if (!config) {
      return {
        id: cacheId,
        success: false,
        freedSpace: 0,
        freedSpaceFormatted: '0 B',
        error: `Unknown cache: ${cacheId}`,
      }
    }
    
    try {
      // Get current size before cleaning
      const sizeBefore = await getDirectorySize(config.path)
      
      // Try native command first if available and requested
      if (useNativeCommand && config.cleanCommand) {
        try {
          const nativeCommand = splitCleanCommand(config.cleanCommand)
          const result = await executeFileCommand(nativeCommand.command, nativeCommand.args, { timeout: 60000 })
          if (!result.success) {
            throw new Error(result.stderr || 'Native clean command failed')
          }
        } catch {
          if (config.riskLevel === 'high') {
            throw new Error('Native clean command failed; high-risk cache will not be removed manually')
          }
          // Native command failed, fall back to manual deletion
          await deleteDirectory(config.path, config.path)
        }
      } else {
        // Manual deletion
        await deleteDirectory(config.path, config.path)
      }
      
      // Get size after cleaning
      const sizeAfter = await getDirectorySize(config.path)
      const freedSpace = sizeBefore - sizeAfter
      
      return {
        id: cacheId,
        success: true,
        freedSpace,
        freedSpaceFormatted: formatBytes(freedSpace),
      }
    } catch (error) {
      return {
        id: cacheId,
        success: false,
        freedSpace: 0,
        freedSpaceFormatted: '0 B',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
  
  /**
   * Clean multiple caches
   */
  async cleanMultipleCaches(cacheIds: string[]): Promise<CleanResult[]> {
    const results: CleanResult[] = []
    
    // Clean sequentially to avoid overwhelming the system
    for (const id of cacheIds) {
      const result = await this.cleanCache(id)
      results.push(result)
    }
    
    return results
  }
  
  /**
   * Get a single cache info
   */
  async getCacheInfo(cacheId: string): Promise<CacheInfo | null> {
    const configs = getCacheConfigs()
    const config = configs.find(c => c.id === cacheId)
    
    if (!config) {
      return null
    }
    
    try {
      const stats = await fs.stat(config.path)
      const size = await getDirectorySize(config.path)
      
      return {
        ...config,
        size,
        sizeFormatted: formatBytes(size),
        exists: true,
        lastModified: stats.mtime,
      }
    } catch {
      return {
        ...config,
        size: 0,
        sizeFormatted: '0 B',
        exists: false,
      }
    }
  }
}

export const cacheScanner = new CacheScanner()
export default cacheScanner
