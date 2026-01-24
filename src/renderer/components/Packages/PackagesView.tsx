/**
 * PackagesView Component
 * 
 * Main view for displaying packages from different package managers:
 * - Tabs for npm, pip, composer
 * - Package table with search
 * - Uninstall functionality
 * 
 * Validates: Requirements 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 6.4
 * Property 5: Package Information Completeness
 * Property 6: Package List Parsing
 */

import React, { useState, useEffect, useMemo } from 'react'
import { Typography, Tabs, Input, Alert, Empty, Badge, Button, Space, Tooltip, message } from 'antd'
import { SearchOutlined, WarningOutlined, CheckCircleOutlined, CopyOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../store'
import PackageTable from './PackageTable'
import type { PackageInfo, PackageManagerStatus } from '@shared/types'

const { Title, Text } = Typography

type PackageManager = 'npm' | 'pip' | 'composer' | 'brew'

const PackagesView: React.FC = () => {
  const { t } = useTranslation()
  const {
    npmPackages,
    pipPackages,
    composerPackages,
    brewPackages,
    packagesLoading,
    packagesError,
    loadPackages,
    tools,
  } = useAppStore()

  const [activeTab, setActiveTab] = useState<PackageManager>('npm')
  const [searchText, setSearchText] = useState('')
  const [managerStatuses, setManagerStatuses] = useState<PackageManagerStatus[]>([])
  const [statusesLoading, setStatusesLoading] = useState(false)

  // Load packages on mount
  useEffect(() => {
    if (npmPackages.length === 0 && pipPackages.length === 0 && composerPackages.length === 0 && brewPackages.length === 0 && !packagesLoading) {
      loadPackages('all')
    }
  }, [npmPackages.length, pipPackages.length, composerPackages.length, brewPackages.length, packagesLoading, loadPackages])

  // Load package manager statuses on mount
  useEffect(() => {
    const loadStatuses = async () => {
      if (!window.electronAPI?.packages?.discoverManagers) {
        return
      }
      
      setStatusesLoading(true)
      try {
        const statuses = await window.electronAPI.packages.discoverManagers()
        setManagerStatuses(statuses)
      } catch (error) {
        console.error('Failed to load package manager statuses:', error)
      } finally {
        setStatusesLoading(false)
      }
    }
    
    loadStatuses()
  }, [])

  // Get status for a specific manager
  const getManagerStatus = (manager: PackageManager): PackageManagerStatus | undefined => {
    return managerStatuses.find(s => s.manager === manager)
  }

  // Check if package managers are installed
  const isNpmInstalled = useMemo(() => {
    return tools.some(tool => tool.name.toLowerCase() === 'npm' && tool.isInstalled)
  }, [tools])

  const isPipInstalled = useMemo(() => {
    return tools.some(tool => tool.name.toLowerCase() === 'pip' && tool.isInstalled)
  }, [tools])

  const isComposerInstalled = useMemo(() => {
    return tools.some(tool => tool.name.toLowerCase() === 'composer' && tool.isInstalled)
  }, [tools])

  const isBrewInstalled = useMemo(() => {
    return tools.some(tool => tool.name.toLowerCase() === 'brew' && tool.isInstalled)
  }, [tools])

  // Get packages for current tab
  const getCurrentPackages = (): PackageInfo[] => {
    switch (activeTab) {
      case 'npm':
        return npmPackages
      case 'pip':
        return pipPackages
      case 'composer':
        return composerPackages
      case 'brew':
        return brewPackages
      default:
        return []
    }
  }

  // Filter packages by search text
  const filteredPackages = useMemo(() => {
    const packages = getCurrentPackages()
    if (!searchText.trim()) {
      return packages
    }
    const lowerSearch = searchText.toLowerCase()
    return packages.filter(pkg =>
      pkg.name.toLowerCase().includes(lowerSearch) ||
      pkg.version.toLowerCase().includes(lowerSearch)
    )
  }, [activeTab, npmPackages, pipPackages, composerPackages, brewPackages, searchText])

  // Handle refresh
  const handleRefresh = () => {
    loadPackages(activeTab)
  }

  // Handle copy PATH command
  const handleCopyPathCommand = (status: PackageManagerStatus) => {
    if (!status.foundPath) return
    
    const isWindows = window.electronAPI.platform === 'win32'
    const pathDir = status.foundPath.substring(0, status.foundPath.lastIndexOf(isWindows ? '\\' : '/'))
    
    const command = isWindows
      ? `setx PATH "%PATH%;${pathDir}"`
      : `export PATH="$PATH:${pathDir}"`
    
    navigator.clipboard.writeText(command)
      .then(() => message.success(t('notifications.copySuccess', 'Copied to clipboard')))
      .catch(() => message.error(t('notifications.copyFailed', 'Copy failed')))
  }

  // Check if current manager is installed
  const isCurrentManagerInstalled = (): boolean => {
    switch (activeTab) {
      case 'npm':
        return isNpmInstalled
      case 'pip':
        return isPipInstalled
      case 'composer':
        return isComposerInstalled
      case 'brew':
        return isBrewInstalled
      default:
        return false
    }
  }

  // Render PATH warning for current manager
  const renderPathWarning = () => {
    const status = getManagerStatus(activeTab)
    
    if (!status || status.status !== 'path_missing') {
      return null
    }

    return (
      <Alert
        message={
          <Space>
            <WarningOutlined />
            <Text strong>{t('packages.pathMissing', `${activeTab.toUpperCase()} is installed but not in PATH`)}</Text>
          </Space>
        }
        description={
          <div>
            <Text>{status.message || t('packages.pathMissingDescription', 'The package manager is installed but not accessible from the command line.')}</Text>
            {status.foundPath && (
              <div style={{ marginTop: 8 }}>
                <Text type="secondary">Found at: </Text>
                <Text code>{status.foundPath}</Text>
                <Button
                  type="link"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => handleCopyPathCommand(status)}
                >
                  {t('packages.copyPathCommand', 'Copy PATH command')}
                </Button>
              </div>
            )}
          </div>
        }
        type="warning"
        showIcon
        closable
        style={{ marginBottom: 16 }}
      />
    )
  }

  // Render status indicator for tab
  const renderStatusIndicator = (manager: PackageManager) => {
    const status = getManagerStatus(manager)
    
    if (!status || statusesLoading) {
      return null
    }

    if (status.status === 'available') {
      return (
        <Tooltip title={t('packages.available', 'Available')}>
          <CheckCircleOutlined style={{ color: '#52c41a', marginLeft: 4 }} />
        </Tooltip>
      )
    }

    if (status.status === 'path_missing') {
      return (
        <Tooltip title={t('packages.pathMissing', 'Installed but not in PATH')}>
          <WarningOutlined style={{ color: '#faad14', marginLeft: 4 }} />
        </Tooltip>
      )
    }

    return null
  }

  // Tab items with package counts
  const tabItems = [
    {
      key: 'npm',
      label: (
        <Badge count={npmPackages.length} size="small" offset={[10, 0]}>
          <Space size={4}>
            <span>{t('packages.npm')}</span>
            {renderStatusIndicator('npm')}
          </Space>
        </Badge>
      ),
      children: null,
    },
    {
      key: 'pip',
      label: (
        <Badge count={pipPackages.length} size="small" offset={[10, 0]}>
          <Space size={4}>
            <span>{t('packages.pip')}</span>
            {renderStatusIndicator('pip')}
          </Space>
        </Badge>
      ),
      children: null,
    },
    {
      key: 'composer',
      label: (
        <Badge count={composerPackages.length} size="small" offset={[10, 0]}>
          <Space size={4}>
            <span>{t('packages.composer')}</span>
            {renderStatusIndicator('composer')}
          </Space>
        </Badge>
      ),
      children: null,
    },
    {
      key: 'brew',
      label: (
        <Badge count={brewPackages.length} size="small" offset={[10, 0]}>
          <Space size={4}>
            <span>{t('packages.brew', 'Homebrew Packages')}</span>
            {renderStatusIndicator('brew')}
          </Space>
        </Badge>
      ),
      children: null,
    },
  ]

  // Render content based on manager installation status
  const renderContent = () => {
    // 优先显示加载状态，防止工具检测未完成导致的误判
    if (packagesLoading) {
    return (
      <PackageTable
        packages={filteredPackages}
        loading={true}
        onRefresh={handleRefresh}
        manager={activeTab}
      />
    )
  }

    // 错误处理
    if (packagesError) {
      return (
        <Alert
          message={t('errors.loadFailed')}
          description={packagesError}
          type="error"
          showIcon
          action={
            <Button type="link" size="small" onClick={handleRefresh}>
              {t('common.retry')}
            </Button>
          }
        />
      )
    }

    // 只有在加载完成且明确未安装时显示 Empty
    // 增加 tools.length > 0 判断以确保环境数据已同步
    if (tools.length > 0 && !isCurrentManagerInstalled()) {
      const managerName = activeTab.toUpperCase()
      return (
        <Empty
          description={
            <div>
              <Text>{t('packages.managerNotInstalled', { manager: managerName })}</Text>
            </div>
          }
        />
      )
    }

    // Package table
    return (
      <PackageTable
        packages={filteredPackages}
        loading={false}
        onRefresh={handleRefresh}
        manager={activeTab}
      />
    )
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <Title level={3} className="!mb-1">{t('packages.title')}</Title>
        <Text type="secondary">{t('packages.subtitle')}</Text>
      </div>

      {/* PATH Warning */}
      {renderPathWarning()}

      {/* Tabs for package managers - Validates: Requirement 3.3, 4.3 */}
      <Tabs
        activeKey={activeTab}
        onChange={(key) => {
          setActiveTab(key as PackageManager)
          setSearchText('')
        }}
        items={tabItems}
        tabBarExtraContent={
          <Input
            placeholder={t('common.searchPlaceholder')}
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            allowClear
            style={{ width: 250 }}
          />
        }
      />

      {/* Content */}
      <div className="mt-4">
        {renderContent()}
      </div>
    </div>
  )
}

export default PackagesView
