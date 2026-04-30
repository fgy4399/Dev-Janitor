/**
 * Service Monitor Module
 * 
 * Provides functionality to monitor running services and processes:
 * - List running services on specified ports
 * - Identify common development servers
 * - Kill/stop services by PID
 * - Auto-refresh monitoring
 * 
 * Validates: Requirements 11.1-11.7
 * Properties: 19 (Running Service Information), 20 (Service Stop Action Availability)
 */

import { RunningService } from '../shared/types'
import {
  isWindows,
  executeFileSafe,
} from './commandExecutor'
import { BoundedLRUCache, CLEANUP_INTERVAL } from './utils/cacheManager'

/**
 * Debounce configuration constants
 * Validates: Requirements 6.1, 6.3
 */
export const DEBOUNCE_MS = 500
export const BACKGROUND_INTERVAL = 30000 // Window not visible: 30 seconds
export const FOREGROUND_INTERVAL = 5000  // Window visible: 5 seconds

/**
 * Common development service ports to monitor
 */
export const COMMON_DEV_PORTS = [
  3000,  // React, Next.js, Express
  3001,  // React alternate
  4000,  // GraphQL, various
  4200,  // Angular
  5000,  // Flask, ASP.NET
  5173,  // Vite
  5174,  // Vite alternate
  8000,  // Django, PHP
  8080,  // Tomcat, various
  8081,  // Various
  8888,  // Jupyter
  9000,  // PHP-FPM, various
  9229,  // Node.js debugger
]

/**
 * Parse Windows netstat output to extract port and PID
 * Format: "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       12345"
 * 
 * @param line A line from netstat output
 * @returns Object with port and pid, or null if not a listening connection
 */
export function parseNetstatLine(line: string): { port: number; pid: number } | null {
  if (!line || !line.includes('LISTENING')) {
    return null
  }
  
  // Match TCP/UDP lines with LISTENING state
  // Format: TCP    0.0.0.0:PORT    ...    LISTENING    PID
  const parts = line.trim().split(/\s+/)
  
  if (parts.length < 5) {
    return null
  }
  
  // Extract local address (second column)
  const localAddress = parts[1]
  if (!localAddress) return null
  
  // Extract port from address (e.g., "0.0.0.0:3000" or "[::]:3000")
  const portMatch = localAddress.match(/:(\d+)$/)
  if (!portMatch) return null
  
  const port = parseInt(portMatch[1], 10)
  if (isNaN(port)) return null
  
  // PID is the last column
  const pid = parseInt(parts[parts.length - 1], 10)
  if (isNaN(pid)) return null
  
  return { port, pid }
}

/**
 * Parse Unix lsof output to extract port and PID
 * Format: "node      12345 user   23u  IPv4 0x1234      0t0  TCP *:3000 (LISTEN)"
 * 
 * @param line A line from lsof output
 * @returns Object with port, pid, and name, or null if not valid
 */
export function parseLsofLine(line: string): { port: number; pid: number; name: string } | null {
  if (!line || !line.includes('LISTEN')) {
    return null
  }
  
  const parts = line.trim().split(/\s+/)
  
  if (parts.length < 9) {
    return null
  }
  
  // Process name is first column
  const name = parts[0]
  
  // PID is second column
  const pid = parseInt(parts[1], 10)
  if (isNaN(pid)) return null
  
  // Find the port in the TCP column (e.g., "*:3000" or "localhost:3000")
  const tcpInfo = parts.find(p => p.includes(':') && (p.includes('*:') || /:\d+/.test(p)))
  if (!tcpInfo) return null
  
  const portMatch = tcpInfo.match(/:(\d+)/)
  if (!portMatch) return null
  
  const port = parseInt(portMatch[1], 10)
  if (isNaN(port)) return null
  
  return { port, pid, name }
}

// Cache for process info with LRU eviction (max 1000 entries, 5 min expiration)
const processInfoCache = new BoundedLRUCache<number, { name: string; command: string }>(1000, 300000)

type ProcessMetrics = { cpu?: number; memory?: number }

function getValidPid(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null
  return String(pid)
}

function getValidPidList(pids: number[]): string | null {
  const uniquePids = Array.from(new Set(pids.filter(pid => Number.isInteger(pid) && pid > 0)))
  if (uniquePids.length === 0) return null
  return uniquePids.join(',')
}

/**
 * Get process information by PID on Unix using ps
 * 
 * @param pid Process ID
 * @returns Promise resolving to process info or null
 */
async function getUnixProcessInfo(pid: number): Promise<{ name: string; command: string } | null> {
  const validPid = getValidPid(pid)
  if (!validPid) return null

  const result = await executeFileSafe('ps', ['-p', validPid, '-o', 'comm=,args='])
  
  if (!result.success || !result.stdout) {
    return null
  }
  
  const output = result.stdout.trim()
  if (!output) return null
  
  // First word is the command name, rest is the full command
  const parts = output.split(/\s+/)
  const name = parts[0] || ''
  const command = output
  
  return { name, command }
}

export function parseTasklistMemoryMB(raw: string): number | null {
  if (!raw) return null
  const kbValue = parseInt(raw.replace(/[^\d]/g, ''), 10)
  if (Number.isNaN(kbValue)) return null
  return kbValue / 1024
}

export function parsePsMetricsLine(line: string): { pid: number; cpu?: number; memory?: number } | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  const parts = trimmed.split(/\s+/)
  if (parts.length < 3) return null

  const pid = parseInt(parts[0], 10)
  if (Number.isNaN(pid)) return null

  const cpu = parseFloat(parts[1])
  const rssKb = parseInt(parts[2], 10)

  const metrics: ProcessMetrics = {}
  if (!Number.isNaN(cpu)) metrics.cpu = cpu
  if (!Number.isNaN(rssKb)) metrics.memory = rssKb / 1024

  if (metrics.cpu === undefined && metrics.memory === undefined) return null
  return { pid, ...metrics }
}

async function getUnixProcessMetrics(pids: number[]): Promise<Map<number, ProcessMetrics>> {
  const metricsByPid = new Map<number, ProcessMetrics>()
  const pidList = getValidPidList(pids)
  if (!pidList) return metricsByPid

  const result = await executeFileSafe('ps', ['-p', pidList, '-o', 'pid=,pcpu=,rss='])
  if (!result.success || !result.stdout) return metricsByPid

  for (const line of result.stdout.split('\n')) {
    const parsed = parsePsMetricsLine(line)
    if (!parsed) continue
    metricsByPid.set(parsed.pid, {
      cpu: parsed.cpu,
      memory: parsed.memory,
    })
  }

  return metricsByPid
}

/**
 * List running services on Windows
 * Uses netstat -ano to find listening ports and tasklist for process names
 * Optimized: batch process info queries to reduce system calls
 * 
 * @returns Promise resolving to array of RunningService
 */
async function listWindowsServices(): Promise<RunningService[]> {
  const services: RunningService[] = []
  const pidPorts = new Map<number, Set<number>>()
  
  // Get listening ports with PIDs
  const netstatResult = await executeFileSafe('netstat', ['-ano', '-p', 'TCP'])
  
  if (!netstatResult.success) {
    return services
  }
  
  const lines = netstatResult.stdout.split('\n')
  
  // First pass: collect all PIDs and their ports
  for (const line of lines) {
    const parsed = parseNetstatLine(line)
    
    if (!parsed) {
      continue
    }
    
    // Skip system processes (PID 0 and 4)
    if (parsed.pid === 0 || parsed.pid === 4) {
      continue
    }
    
    const ports = pidPorts.get(parsed.pid) || new Set<number>()
    ports.add(parsed.port)
    pidPorts.set(parsed.pid, ports)
  }
  
  // Batch get all process names in one call
  const pids = Array.from(pidPorts.keys())
  if (pids.length === 0) return services
  
  // Get all process names at once using tasklist (much faster than individual calls)
  const tasklistResult = await executeFileSafe('tasklist', ['/FO', 'CSV', '/NH'])
  const processNameMap = new Map<number, string>()
  const processMetricsMap = new Map<number, ProcessMetrics>()
  
  if (tasklistResult.success && tasklistResult.stdout) {
    const taskLines = tasklistResult.stdout.split('\n')
    for (const taskLine of taskLines) {
      // Format: "process.exe","12345","Console","1","12,345 K"
      const match = taskLine.match(/"([^"]+)","(\d+)","[^"]*","[^"]*","([^"]+)"/)
      if (match) {
        const name = match[1]
        const pid = parseInt(match[2], 10)
        if (pids.includes(pid)) {
          processNameMap.set(pid, name)
          const memory = parseTasklistMemoryMB(match[3])
          if (memory !== null) {
            processMetricsMap.set(pid, { memory })
          }
        }
      }
    }
  }
  
  // Build services list (skip wmic calls for better performance)
  for (const [pid, ports] of pidPorts) {
    const name = processNameMap.get(pid)
    const metrics = processMetricsMap.get(pid)
    if (name) {
      // Update cache (timestamp handled internally by BoundedLRUCache)
      processInfoCache.set(pid, {
        name,
        command: name, // Use name as command to avoid wmic calls
      })

      for (const port of ports) {
        services.push({
          pid,
          name,
          port,
          command: name,
          cpu: metrics?.cpu,
          memory: metrics?.memory,
        })
      }
    }
  }
  
  return services
}

/**
 * List running services on Unix (macOS/Linux)
 * Uses lsof -i to find listening ports
 * 
 * @returns Promise resolving to array of RunningService
 */
async function listUnixServices(): Promise<RunningService[]> {
  const services: RunningService[] = []
  const seen = new Set<string>()
  const processInfoByPid = new Map<number, { name: string; command: string } | null>()
  
  // Get listening ports with process info
  const lsofResult = await executeFileSafe('lsof', ['-i', '-P', '-n'])
  
  if (!lsofResult.success && !lsofResult.stdout) {
    // Try alternative: ss command on Linux
    const ssResult = await executeFileSafe('ss', ['-tlnp'])
    if (ssResult.success && ssResult.stdout) {
      const ssServices = parseSSOutput(ssResult.stdout)
      const metricsByPid = await getUnixProcessMetrics(ssServices.map(s => s.pid))
      return ssServices.map(service => {
        const metrics = metricsByPid.get(service.pid)
        return {
          ...service,
          cpu: metrics?.cpu,
          memory: metrics?.memory,
        }
      })
    }
    return services
  }
  
  const lines = lsofResult.stdout.split('\n')
  const entries: Array<{ pid: number; port: number; name: string }> = []
  
  for (const line of lines) {
    const parsed = parseLsofLine(line)
    
    if (!parsed) {
      continue
    }
    
    const key = `${parsed.pid}:${parsed.port}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    
    entries.push(parsed)
  }

  const metricsByPid = await getUnixProcessMetrics(entries.map(entry => entry.pid))

  for (const entry of entries) {
    // Get full process info
    let processInfo = processInfoByPid.get(entry.pid)
    if (!processInfoByPid.has(entry.pid)) {
      const cached = processInfoCache.get(entry.pid)
      if (cached) {
        processInfo = cached
        processInfoByPid.set(entry.pid, cached)
      } else {
        processInfo = await getUnixProcessInfo(entry.pid)
        processInfoByPid.set(entry.pid, processInfo)
        if (processInfo) {
          processInfoCache.set(entry.pid, processInfo)
        }
      }
    }

    const metrics = metricsByPid.get(entry.pid)
    
    services.push({
      pid: entry.pid,
      name: entry.name,
      port: entry.port,
      command: processInfo?.command || entry.name,
      cpu: metrics?.cpu,
      memory: metrics?.memory,
    })
  }
  
  return services
}

/**
 * Parse ss command output (Linux alternative to lsof)
 * Format: "LISTEN  0  128  *:3000  *:*  users:(("node",pid=12345,fd=23))"
 * 
 * @param output The ss command output
 * @returns Array of RunningService
 */
function parseSSOutput(output: string): RunningService[] {
  const services: RunningService[] = []
  const seen = new Set<string>()
  const lines = output.split('\n')
  
  for (const line of lines) {
    if (!line.includes('LISTEN')) continue
    
    // Extract port
    const portMatch = line.match(/\*:(\d+)/)
    if (!portMatch) continue
    const port = parseInt(portMatch[1], 10)
    
    // Extract PID and process name
    const processMatch = line.match(/\("([^"]+)",pid=(\d+)/)
    if (!processMatch) continue
    
    const name = processMatch[1]
    const pid = parseInt(processMatch[2], 10)
    
    const key = `${pid}:${port}`
    if (seen.has(key)) continue
    seen.add(key)
    
    services.push({
      pid,
      name,
      port,
      command: name,
    })
  }
  
  return services
}

/**
 * List all running services
 * 
 * Property 19: Running Service Information
 * Validates: Requirements 11.1, 11.2, 11.3
 * 
 * @returns Promise resolving to array of RunningService
 */
export async function listRunningServices(): Promise<RunningService[]> {
  if (isWindows()) {
    return listWindowsServices()
  }
  return listUnixServices()
}

/**
 * Find a service by port number
 * 
 * @param port The port number to search for
 * @returns Promise resolving to RunningService or null
 */
export async function findServiceByPort(port: number): Promise<RunningService | null> {
  const services = await listRunningServices()
  return services.find(s => s.port === port) || null
}

/**
 * Kill a service by PID
 * 
 * Property 20: Service Stop Action Availability
 * Validates: Requirements 11.5, 11.7
 * 
 * @param pid The process ID to kill
 * @returns Promise resolving to true if successful
 */
export async function killService(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }
  
  // Don't allow killing system processes
  if (pid === 1 || pid === 4) {
    return false
  }
  
  let result
  
  if (isWindows()) {
    // Windows: use taskkill
    result = await executeFileSafe('taskkill', ['/PID', String(pid), '/F'])
  } else {
    // Unix: use kill
    result = await executeFileSafe('kill', ['-9', String(pid)])
  }
  
  return result.success
}

/**
 * Filter services to only include common development ports
 * 
 * @param services Array of services to filter
 * @returns Filtered array of services on common dev ports
 */
export function filterDevServices(services: RunningService[]): RunningService[] {
  return services.filter(s => s.port && COMMON_DEV_PORTS.includes(s.port))
}

/**
 * ServiceMonitor class providing monitoring functionality with auto-refresh
 * 
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4
 */
export class ServiceMonitor {
  private monitoringInterval: NodeJS.Timeout | null = null
  private cacheCleanupInterval: NodeJS.Timeout | null = null
  private listeners: ((services: RunningService[]) => void)[] = []
  
  // Debounce state - Validates: Requirement 6.1
  private debounceTimeout: NodeJS.Timeout | null = null
  private pendingUpdate: boolean = false
  
  // Window visibility state - Validates: Requirement 6.3
  private windowVisible: boolean = true
  private currentInterval: number = FOREGROUND_INTERVAL
  
  /**
   * List all running services
   */
  async listRunningServices(): Promise<RunningService[]> {
    return listRunningServices()
  }
  
  /**
   * Find a service by port
   */
  async findServiceByPort(port: number): Promise<RunningService | null> {
    return findServiceByPort(port)
  }
  
  /**
   * Kill a service by PID
   */
  async killService(pid: number): Promise<boolean> {
    return killService(pid)
  }
  
  /**
   * Start auto-monitoring services
   * 
   * Validates: Requirement 11.6 (refresh every 5 seconds)
   * Validates: Requirement 6.1 (debounce updates)
   * @param interval Refresh interval in milliseconds (default: FOREGROUND_INTERVAL)
   */
  startMonitoring(interval: number = FOREGROUND_INTERVAL): void {
    if (this.monitoringInterval) {
      this.stopMonitoring()
    }
    
    this.currentInterval = interval
    
    this.monitoringInterval = setInterval(async () => {
      try {
        const services = await this.listRunningServices()
        this.debouncedNotify(services) // Use debounced notify - Validates: Requirement 6.1
      } catch {
        // Silently handle errors during monitoring
      }
    }, interval)
    
    // Start cache cleanup (every 5 minutes)
    // Validates: Requirement 5.4 (execute cache cleanup every 5 minutes)
    if (!this.cacheCleanupInterval) {
      this.cacheCleanupInterval = setInterval(() => {
        processInfoCache.cleanup()
      }, CLEANUP_INTERVAL)
    }
  }

  /**
   * Stop auto-monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval)
      this.monitoringInterval = null
    }

    // Clear cache cleanup interval to prevent memory leak
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval)
      this.cacheCleanupInterval = null
    }
  }

  /**
   * Debounced notify - merges multiple updates within DEBOUNCE_MS into one
   *
   * Validates: Requirement 6.1 (merge updates within 500ms)
   * Validates: Requirement 6.2 (batch send updates)
   * @param services The services to notify listeners about
   */
  private debouncedNotify(services: RunningService[]): void {
    this.pendingUpdate = true

    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout)
    }

    this.debounceTimeout = setTimeout(() => {
      if (this.pendingUpdate) {
        this.notifyListeners(services)
        this.pendingUpdate = false
      }
      this.debounceTimeout = null
    }, DEBOUNCE_MS)
  }
  
  /**
   * Set window visibility and adjust monitoring interval accordingly
   * 
   * Validates: Requirement 6.3 (reduce frequency to 30s when window not visible)
   * @param visible Whether the window is visible
   */
  setWindowVisible(visible: boolean): void {
    if (this.windowVisible === visible) return
    
    this.windowVisible = visible
    const newInterval = visible ? FOREGROUND_INTERVAL : BACKGROUND_INTERVAL
    
    if (this.currentInterval !== newInterval && this.monitoringInterval) {
      this.currentInterval = newInterval
      this.stopMonitoring()
      this.startMonitoring(newInterval)
    }
  }
  
  /**
   * Force an immediate update, bypassing debounce
   * 
   * Validates: Requirement 6.4 (execute immediately on user request)
   * @returns Promise resolving when update is complete
   */
  async forceUpdate(): Promise<void> {
    // Clear any pending debounce
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout)
      this.debounceTimeout = null
    }
    this.pendingUpdate = false
    
    // Execute immediately
    const services = await this.listRunningServices()
    this.notifyListeners(services)
  }
  
  /**
   * Get current window visibility state
   * @returns Whether the window is currently visible
   */
  isWindowVisible(): boolean {
    return this.windowVisible
  }
  
  /**
   * Get current monitoring interval
   * @returns Current interval in milliseconds
   */
  getCurrentInterval(): number {
    return this.currentInterval
  }
  
  /**
   * Add a listener for service updates
   * @param listener Callback function to receive service updates
   */
  addListener(listener: (services: RunningService[]) => void): void {
    this.listeners.push(listener)
  }
  
  /**
   * Remove a listener
   * @param listener The listener to remove
   */
  removeListener(listener: (services: RunningService[]) => void): void {
    const index = this.listeners.indexOf(listener)
    if (index !== -1) {
      this.listeners.splice(index, 1)
    }
  }
  
  /**
   * Notify all listeners of service updates
   */
  private notifyListeners(services: RunningService[]): void {
    for (const listener of this.listeners) {
      try {
        listener(services)
      } catch {
        // Ignore listener errors
      }
    }
  }
  
  /**
   * Filter services to common development ports
   */
  filterDevServices(services: RunningService[]): RunningService[] {
    return filterDevServices(services)
  }
  
  /**
   * Check if monitoring is active
   */
  isMonitoring(): boolean {
    return this.monitoringInterval !== null
  }
}

// Export a default instance
export const serviceMonitor = new ServiceMonitor()
