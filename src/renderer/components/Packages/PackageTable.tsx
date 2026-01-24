/**
 * PackageTable Component
 * 
 * Table component for displaying packages from a package manager:
 * - Package name and version
 * - Latest version check
 * - Location
 * - Uninstall functionality
 */

import React, { useState, useMemo, useCallback, useRef } from 'react'
import { Table, Button, Typography, Tooltip, message, Tag, Space, Progress, Popconfirm } from 'antd'
import {
  LinkOutlined,
  CopyOutlined,
  ArrowRightOutlined,
  ArrowUpOutlined,
  LoadingOutlined,
  SyncOutlined,
  DownloadOutlined,
  StopOutlined,
  DeleteOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../store'
import type { PackageInfo } from '@shared/types'
import type { ColumnsType } from 'antd/es/table'

const { Text, Paragraph } = Typography

export interface PackageTableProps {
  packages: PackageInfo[]
  loading: boolean
  onRefresh: () => void
  manager: 'npm' | 'pip' | 'composer' | 'brew'
}

/**
 * Get external link URL for package based on manager
 */
const getPackageUrl = (pkg: PackageInfo): string => {
  switch (pkg.manager) {
    case 'npm':
      return `https://www.npmjs.com/package/${pkg.name}`
    case 'pip':
      return `https://pypi.org/project/${pkg.name}`
    case 'composer':
      return `https://packagist.org/packages/${pkg.name}`
    case 'brew':
      return pkg.location === 'cask'
        ? `https://formulae.brew.sh/cask/${pkg.name}`
        : `https://formulae.brew.sh/formula/${pkg.name}`
    default:
      return ''
  }
}

/**
 * Compare two semver versions
 * Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
const compareVersions = (v1: string, v2: string): number => {
  const parts1 = v1.replace(/^[^\d]*/, '').split('.').map(n => parseInt(n) || 0)
  const parts2 = v2.replace(/^[^\d]*/, '').split('.').map(n => parseInt(n) || 0)
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0
    const p2 = parts2[i] || 0
    if (p1 < p2) return -1
    if (p1 > p2) return 1
  }
  return 0
}

const VERSION_LIKE_PATTERN = /\d+\.\d+/

const isVersionLike = (value: string): boolean => VERSION_LIKE_PATTERN.test(value)

const PackageTable: React.FC<PackageTableProps> = ({
  packages,
  loading,
  onRefresh,
  manager,
}) => {
  const { t } = useTranslation()
  const { packageVersionCache, updatePackageVersionInfo } = useAppStore()
  const [checkingAll, setCheckingAll] = useState(false)

  // Progress state for version check
  const [checkProgress, setCheckProgress] = useState<{
    total: number;
    completed: number;
    cancelled: boolean;
  } | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  
  // Track which packages are being uninstalled
  const [uninstallingPackages, setUninstallingPackages] = useState<Set<string>>(new Set())

  // Memoize version comparison results
  const memoizedVersionComparison = useMemo(() => {
    return packages.reduce<Record<string, number>>((acc, pkg) => {
      const cacheKey = `${manager}:${pkg.name}`
      const cached = packageVersionCache[cacheKey]
      if (cached?.checked && cached.latest && isVersionLike(cached.latest)) {
        acc[pkg.name] = compareVersions(pkg.version, cached.latest)
      }
      return acc;
    }, {});
  }, [packages, packageVersionCache, manager]);

  const handleCopyLocation = useCallback((location: string) => {
    navigator.clipboard.writeText(location)
      .then(() => {
        message.success(t('notifications.copySuccess'))
      })
      .catch(() => {
        message.error(t('notifications.copyFailed'))
      })
  }, [t])

  const handleCopyUpdateCommand = useCallback((pkg: PackageInfo) => {
    let command = ''
    switch (manager) {
      case 'npm':
        command = `npm update -g ${pkg.name}`
        break
      case 'pip':
        command = `pip install --upgrade ${pkg.name}`
        break
      case 'composer':
        command = `composer global update ${pkg.name}`
        break
      case 'brew':
        command = pkg.location === 'cask'
          ? `brew upgrade --cask ${pkg.name}`
          : `brew upgrade ${pkg.name}`
        break
    }
    if (!command) return
    navigator.clipboard.writeText(command)
      .then(() => {
        message.success(t('notifications.copySuccess', 'Copied to clipboard'))
      })
      .catch(() => {
        message.error(t('notifications.copyFailed', 'Copy failed'))
      })
  }, [manager, t])

  const checkVersion = useCallback(async (pkg: PackageInfo) => {
    if (manager !== 'npm' && manager !== 'pip' && manager !== 'brew') return;

    const cacheKey = `${manager}:${pkg.name}`

    if (!window.electronAPI?.packages) {
      console.error('Packages API not available')
      updatePackageVersionInfo(cacheKey, {
        latest: t('packages.checkFailed', 'Check failed'),
        checking: false,
        checked: true
      })
      return
    }

    updatePackageVersionInfo(cacheKey, { latest: '', checking: true, checked: false })

    try {
      if (manager === 'brew') {
        if (!window.electronAPI.packages.checkBrewOutdated) {
          updatePackageVersionInfo(cacheKey, {
            latest: t('packages.checkFailed', 'Check failed'),
            checking: false,
            checked: true
          })
          return
        }

        const result = await window.electronAPI.packages.checkBrewOutdated(pkg.name, { cask: pkg.location === 'cask' })
        if (!result.success) {
          updatePackageVersionInfo(cacheKey, {
            latest: result.error || t('packages.checkFailed', 'Check failed'),
            checking: false,
            checked: true
          })
          return
        }

        const location = pkg.location === 'cask' ? 'cask' : 'formula'
        const entry = result.packages.find(p => p.name === pkg.name && p.location === location)

        updatePackageVersionInfo(cacheKey, {
          latest: entry?.currentVersion || pkg.version || t('common.unknown'),
          checking: false,
          checked: true
        })
        return
      }

      const result = manager === 'npm'
        ? await window.electronAPI.packages.checkNpmLatestVersion(pkg.name)
        : await window.electronAPI.packages.checkPipLatestVersion(pkg.name)

      updatePackageVersionInfo(cacheKey, {
        latest: result?.latest || t('common.unknown'),
        checking: false,
        checked: true
      })
    } catch (error) {
      console.error(`Failed to check version for ${pkg.name}:`, error)
      updatePackageVersionInfo(cacheKey, { latest: 'error', checking: false, checked: true })
    }
  }, [manager, t, updatePackageVersionInfo])


  const handleUpdatePackage = useCallback(async (pkg: PackageInfo) => {
    if (manager !== 'npm' && manager !== 'pip' && manager !== 'brew') return;

    const cacheKey = `${manager}:${pkg.name}`

    if (manager === 'brew') {
      if (!window.electronAPI?.packages?.upgradeBrew) {
        message.error(t('packages.updateFailed'))
        return
      }

      updatePackageVersionInfo(cacheKey, { updating: true })
      try {
        const result = await window.electronAPI.packages.upgradeBrew(pkg.name, { cask: pkg.location === 'cask' })
        if (result.success) {
          message.success(t('packages.updateSuccess'))
          onRefresh()
          updatePackageVersionInfo(cacheKey, { latest: '', checked: false })
        } else {
          message.error(result.error || t('packages.updateFailed'))
        }
      } catch (error) {
        console.error(`Failed to update package ${pkg.name}:`, error)
        message.error(t('packages.updateFailed'))
      } finally {
        updatePackageVersionInfo(cacheKey, { updating: false })
      }
      return
    }

    if (!window.electronAPI?.packages?.update) {
      message.error(t('packages.updateFailed'))
      return
    }

    updatePackageVersionInfo(cacheKey, { updating: true })
    try {
      const result = await window.electronAPI.packages.update(pkg.name, manager)
      if (result.success) {
        message.success(t('packages.updateSuccess'))
        onRefresh()
        await checkVersion(pkg)
      } else {
        message.error(result.error || t('packages.updateFailed'))
      }
    } catch (error) {
      console.error(`Failed to update package ${pkg.name}:`, error)
      message.error(t('packages.updateFailed'))
    } finally {
      updatePackageVersionInfo(cacheKey, { updating: false })
    }
  }, [manager, t, onRefresh, checkVersion, updatePackageVersionInfo])

  // Handle package uninstallation
  const handleUninstallPackage = useCallback(async (pkg: PackageInfo) => {
    if (!window.electronAPI?.packages?.uninstall) {
      message.error(t('packages.uninstallFailed', 'Uninstall failed'))
      return
    }

    setUninstallingPackages(prev => new Set(prev).add(pkg.name))
    try {
      if (manager === 'brew') {
        if (!window.electronAPI?.packages?.uninstallEnhanced) {
          message.error(t('packages.uninstallFailed', 'Uninstall failed'))
          return
        }

        const result = await window.electronAPI.packages.uninstallEnhanced(pkg.name, manager, { cask: pkg.location === 'cask' })
        if (result.success) {
          message.success(t('packages.uninstallSuccess', 'Package uninstalled successfully'))
          onRefresh()
        } else {
          message.error(result.error || t('packages.uninstallFailed', 'Uninstall failed'))
        }

        return
      }

      const success = await window.electronAPI.packages.uninstall(pkg.name, manager)
      if (success) {
        message.success(t('packages.uninstallSuccess', 'Package uninstalled successfully'))
        onRefresh()
        return
      }

      message.error(t('packages.uninstallFailed', 'Uninstall failed'))
    } catch (error) {
      console.error(`Failed to uninstall package ${pkg.name}:`, error)
      message.error(t('packages.uninstallFailed', 'Uninstall failed'))
    } finally {
      setUninstallingPackages(prev => {
        const next = new Set(prev)
        next.delete(pkg.name)
        return next
      })
    }
  }, [manager, t, onRefresh])

  const checkAllVersions = useCallback(async () => {
    if (manager !== 'npm' && manager !== 'pip' && manager !== 'brew') return;

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setCheckingAll(true);
    setCheckProgress({ total: packages.length, completed: 0, cancelled: false });

    if (manager === 'brew') {
      if (!window.electronAPI?.packages?.checkBrewOutdated) {
        message.error(t('packages.checkFailed', 'Check failed'))
        setCheckingAll(false)
        setCheckProgress(null)
        return
      }

      try {
        const result = await window.electronAPI.packages.checkBrewOutdated()
        if (!result.success) {
          message.error(result.error || t('packages.checkFailed', 'Check failed'))
          return
        }

        const outdated = new Map<string, string>()
        for (const entry of result.packages) {
          outdated.set(`${entry.location}:${entry.name}`, entry.currentVersion)
        }

        let completedCount = 0
        for (const pkg of packages) {
          if (signal.aborted) break
          const location = pkg.location === 'cask' ? 'cask' : 'formula'
          const latest = outdated.get(`${location}:${pkg.name}`) || pkg.version || t('common.unknown')
          updatePackageVersionInfo(`${manager}:${pkg.name}`, {
            latest,
            checking: false,
            checked: true,
          })
          completedCount++
          if (!signal.aborted) {
            setCheckProgress(prev => prev ? { ...prev, completed: completedCount } : null)
          }
        }
      } catch (error) {
        console.error('Failed to check Homebrew outdated packages:', error)
        message.error(t('packages.checkFailed', 'Check failed'))
      } finally {
        if (!signal.aborted) {
          setCheckingAll(false)
          setTimeout(() => {
            if (!signal.aborted) {
              setCheckProgress(null)
            }
          }, 2000)
        } else {
          setCheckingAll(false)
          setCheckProgress(prev => prev ? { ...prev, cancelled: true } : null)
        }
      }

      return
    }

    const CONCURRENCY_LIMIT = 5;
    const queue = [...packages];
    let completedCount = 0;

    const worker = async () => {
      while (queue.length > 0 && !signal.aborted) {
        const pkg = queue.shift();
        if (!pkg) break;
        try {
          await checkVersion(pkg);
          await new Promise(resolve => setTimeout(resolve, 100));
        } finally {
          completedCount++;
          if (!signal.aborted) {
            setCheckProgress(prev => prev ? { ...prev, completed: completedCount } : null);
          }
        }
      }
    };

    const workers = Array(Math.min(CONCURRENCY_LIMIT, packages.length))
      .fill(null)
      .map(() => worker());

    try {
      await Promise.all(workers);
    } catch (err) {
      console.error("Parallel check failed", err);
    } finally {
      if (!signal.aborted) {
        setCheckingAll(false);
        setTimeout(() => {
          if (!signal.aborted) {
            setCheckProgress(null);
          }
        }, 2000);
      } else {
        setCheckingAll(false);
        setCheckProgress(prev => prev ? { ...prev, cancelled: true } : null);
      }
    }
  }, [manager, packages, checkVersion, t, updatePackageVersionInfo]);

  const columns: ColumnsType<PackageInfo> = [
    {
      title: t('packages.name'),
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (name, record) => (
        <Space>
          <Text strong className="font-mono">{name}</Text>
          <Button type="text" size="small" icon={<LinkOutlined />} onClick={() => window.open(getPackageUrl(record), '_blank')} />
        </Space>
      ),
    },
    {
      title: t('packages.version'),
      key: 'version',
      width: 250,
      render: (_, record) => {
        const info = packageVersionCache[`${manager}:${record.name}`]
        const comparison = memoizedVersionComparison[record.name];
        const hasUpdate = manager === 'brew'
          ? Boolean(info?.checked && info.latest && info.latest !== record.version)
          : (comparison !== undefined && comparison < 0);
        const isLatest = manager === 'brew'
          ? Boolean(info?.checked && (!info.latest || info.latest === record.version))
          : (comparison !== undefined && comparison >= 0);

        return (
          <Space size="small" wrap>
            <Tag color="blue" className="font-mono m-0">{record.version}</Tag>
            {hasUpdate && info ? (
              <>
                <ArrowRightOutlined style={{ fontSize: 10, color: "#bfbfbf" }} />
                <Tooltip title={t('packages.clickToCopyCommand')}>
                  <Tag 
                    color="orange" 
                    className="font-mono m-0 cursor-pointer" 
                    icon={<ArrowUpOutlined />} 
                    onClick={() => handleCopyUpdateCommand(record)}
                  >
                    {info.latest}
                  </Tag>
                </Tooltip>
              </>
            ) : isLatest ? (
              <Tag color="success" className="m-0">{t('packages.latest')}</Tag>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: t('packages.location'),
      dataIndex: 'location',
      key: 'location',
      ellipsis: true,
      render: (location) => (
        <div className="flex items-center gap-2">
          <Tooltip title={location}>
            <Paragraph className="font-mono text-xs m-0 flex-1" ellipsis={{ rows: 1 }}>{location}</Paragraph>
          </Tooltip>
          <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => handleCopyLocation(location)} />
        </div>
      ),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 200,
      align: 'right',
      render: (_, record) => {
        const info = packageVersionCache[`${manager}:${record.name}`]
        const isUninstalling = uninstallingPackages.has(record.name)
        const comparison = memoizedVersionComparison[record.name] ?? 0;

        // Uninstall button - always shown
        const uninstallButton = (
            <Popconfirm
              title={t('packages.confirmUninstall', 'Confirm uninstall')}
              description={t('packages.confirmUninstallDesc', `Are you sure you want to uninstall ${record.name}?`)}
            onConfirm={() => handleUninstallPackage(record)}
            okText={t('common.confirm', 'Yes')}
            cancelText={t('common.cancel', 'No')}
            okButtonProps={{ danger: true }}
          >
            <Tooltip title={t('packages.uninstall', 'Uninstall')}>
              <Button
                type="text"
                size="small"
                danger
                icon={isUninstalling ? <LoadingOutlined /> : <DeleteOutlined />}
                disabled={isUninstalling}
              />
            </Tooltip>
          </Popconfirm>
        )

        // For managers without update-check support, only show uninstall button
        if (manager !== 'npm' && manager !== 'pip' && manager !== 'brew') {
          return uninstallButton;
        }

        const hasUpdate = manager === 'brew'
          ? Boolean(info?.checked && info.latest && info.latest !== record.version)
          : (info?.checked && comparison < 0)

        // Has update available - show update button and uninstall button
        if (hasUpdate) {
          return (
            <Space size="small">
              <Button
                type="primary" size="small" ghost
                icon={info.updating ? <LoadingOutlined /> : <DownloadOutlined />}
                onClick={() => handleUpdatePackage(record)}
                disabled={info.updating}
              >
                {info.updating ? t('packages.updating') : t('packages.update')}
              </Button>
              {uninstallButton}
            </Space>
          );
        }

        // Default: show check update button and uninstall button
        return (
          <Space size="small">
            <Button
              type="link" size="small"
              icon={info?.checking ? <LoadingOutlined /> : <SyncOutlined />}
              onClick={() => checkVersion(record)}
              disabled={info?.checking}
            >
              {info?.checking ? "" : t('packages.checkUpdate')}
            </Button>
            {uninstallButton}
          </Space>
        );
      },
    },
  ]

  return (
    <div className="package-table">
      {(manager === 'npm' || manager === 'pip' || manager === 'brew') && (
        <div style={{ marginBottom: 16 }}>
          <Space>
            <Button 
              icon={checkingAll ? <LoadingOutlined /> : <SyncOutlined />} 
              onClick={checkAllVersions} 
              disabled={checkingAll || packages.length === 0}
            >
              {checkingAll ? t('packages.checking') : t('packages.checkAllUpdates')}
            </Button>
            {checkingAll && (
              <Button icon={<StopOutlined />} onClick={() => abortControllerRef.current?.abort()} danger>
                {t('common.cancel')}
              </Button>
            )}
          </Space>
          {checkProgress && (
            <div style={{ marginTop: 8 }}>
              <Progress 
                percent={Math.round((checkProgress.completed / checkProgress.total) * 100)} 
                size="small" 
                status={checkProgress.cancelled ? 'exception' : 'active'} 
                format={() => `${checkProgress.completed}/${checkProgress.total}`} 
              />
            </div>
          )}
        </div>
      )}

      <Table 
        columns={columns} 
        dataSource={packages} 
        loading={loading} 
        rowKey="name" 
        size="middle" 
        pagination={{ pageSize: 20, showSizeChanger: true }} 
      />
    </div>
  )
}

export default PackageTable
