/**
 * AI CLI Tools View Component
 * 
 * Displays and manages AI CLI tools:
 * - Codex (OpenAI)
 * - Claude Code (Anthropic)
 * - Gemini CLI (Google)
 * - OpenCode (SST)
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  Typography,
  Card,
  Row,
  Col,
  Button,
  Tag,
  Space,
  Skeleton,
  Empty,
  message,
  Popconfirm,
  Tooltip,
  Alert,
} from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DownloadOutlined,
  SyncOutlined,
  DeleteOutlined,
  LinkOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { AICLITool } from '@shared/types'

const { Title, Text, Paragraph } = Typography

// Provider colors
const providerColors: Record<string, string> = {
  openai: '#10a37f',
  anthropic: '#d4a574',
  google: '#4285f4',
  sst: '#f97316',
  other: '#6b7280',
}

const AICLIView: React.FC = () => {
  const { t } = useTranslation()
  const [tools, setTools] = useState<AICLITool[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({})

  const loadTools = useCallback(async () => {
    setLoading(true)
    try {
      if (window.electronAPI?.aiCli) {
        const result = await window.electronAPI.aiCli.detectAll()
        setTools(result)
      }
    } catch (error) {
      console.error('Failed to load AI CLI tools:', error)
      message.error(t('errors.detectionFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadTools()
  }, [loadTools])

  const handleInstall = async (tool: AICLITool) => {
    setActionLoading(prev => ({ ...prev, [tool.name]: 'install' }))
    try {
      if (window.electronAPI?.aiCli) {
        const result = await window.electronAPI.aiCli.install(tool.name)
        if (result.success) {
          message.success(t('aiCli.installSuccess', { name: tool.displayName }))
          loadTools()
        } else {
          message.error(result.error || t('aiCli.installFailed'))
        }
      }
    } catch (error) {
      message.error(t('aiCli.installFailed'))
    } finally {
      setActionLoading(prev => ({ ...prev, [tool.name]: '' }))
    }
  }

  const handleUpdate = async (tool: AICLITool) => {
    setActionLoading(prev => ({ ...prev, [tool.name]: 'update' }))
    try {
      if (window.electronAPI?.aiCli) {
        const result = await window.electronAPI.aiCli.update(tool.name)
        if (result.success) {
          message.success(t('aiCli.updateSuccess', { name: tool.displayName, version: result.newVersion }))
          loadTools()
        } else {
          message.error(result.error || t('aiCli.updateFailed'))
        }
      }
    } catch (error) {
      message.error(t('aiCli.updateFailed'))
    } finally {
      setActionLoading(prev => ({ ...prev, [tool.name]: '' }))
    }
  }

  const handleUninstall = async (tool: AICLITool) => {
    setActionLoading(prev => ({ ...prev, [tool.name]: 'uninstall' }))
    try {
      if (window.electronAPI?.aiCli) {
        const result = await window.electronAPI.aiCli.uninstall(tool.name)
        if (result.success) {
          message.success(t('aiCli.uninstallSuccess', { name: tool.displayName }))
          loadTools()
        } else {
          message.error(result.error || t('aiCli.uninstallFailed'))
        }
      }
    } catch (error) {
      message.error(t('aiCli.uninstallFailed'))
    } finally {
      setActionLoading(prev => ({ ...prev, [tool.name]: '' }))
    }
  }

  const handleOpenHomepage = (url: string) => {
    if (window.electronAPI?.shell?.openExternal) {
      window.electronAPI.shell.openExternal(url)
    } else {
      window.open(url, '_blank')
    }
  }

  const handleOpenConfig = async (configPath: string) => {
    if (window.electronAPI?.shell?.openPath) {
      try {
        await window.electronAPI.shell.openPath(configPath)
      } catch (error) {
        message.error((error as Error)?.message || t('aiCli.openConfigFailed'))
      }
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <Title level={3}>{t('aiCli.title')}</Title>
          <Text type="secondary">{t('aiCli.detecting')}</Text>
        </div>
        <Row gutter={[16, 16]}>
          {[1, 2, 3, 4].map(i => (
            <Col key={i} xs={24} sm={12} lg={12} xl={6}>
              <Skeleton active paragraph={{ rows: 5 }} />
            </Col>
          ))}
        </Row>
      </div>
    )
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex justify-between items-start">
        <div>
          <Title level={3} className="!mb-1">{t('aiCli.title')}</Title>
          <Text type="secondary">{t('aiCli.subtitle')}</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={loadTools}>
          {t('common.refresh')}
        </Button>
      </div>

      {/* Info Alert */}
      <Alert
        message={t('aiCli.infoTitle')}
        description={t('aiCli.infoDescription')}
        type="info"
        showIcon
        className="mb-6"
      />

      {/* Tools Grid */}
      {tools.length === 0 ? (
        <Empty description={t('aiCli.noTools')} />
      ) : (
        <Row gutter={[16, 16]}>
          {tools.map(tool => (
            <Col key={tool.name} xs={24} sm={12} lg={12} xl={6}>
              <Card
                hoverable
                className="h-full"
                styles={{
                  body: { height: '100%', display: 'flex', flexDirection: 'column' }
                }}
              >
                {/* Header */}
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <Text strong className="text-lg">{tool.displayName}</Text>
                    <div className="mt-1">
                      <Tag color={providerColors[tool.provider]}>
                        {tool.provider.toUpperCase()}
                      </Tag>
                    </div>
                  </div>
                  {tool.isInstalled ? (
                    <Tag icon={<CheckCircleOutlined />} color="success">
                      {t('tools.installed')}
                    </Tag>
                  ) : (
                    <Tag icon={<CloseCircleOutlined />} color="default">
                      {t('tools.notInstalled')}
                    </Tag>
                  )}
                </div>

                {/* Description */}
                <Paragraph type="secondary" className="flex-grow" ellipsis={{ rows: 2 }}>
                  {tool.description}
                </Paragraph>

                {/* Version & Path */}
                {tool.isInstalled && (
                  <div className="mb-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Text type="secondary">{t('tools.version')}:</Text>
                      <Text code>{tool.version || 'N/A'}</Text>
                    </div>
                    {tool.path && (
                      <div className="flex items-center gap-2">
                        <Text type="secondary">{t('tools.path')}:</Text>
                        <Text code className="text-xs truncate max-w-[150px]" title={tool.path}>
                          {tool.path}
                        </Text>
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="mt-auto pt-3 border-t">
                  <Space wrap>
                    {!tool.isInstalled ? (
                      <Button
                        type="primary"
                        icon={<DownloadOutlined />}
                        loading={actionLoading[tool.name] === 'install'}
                        onClick={() => handleInstall(tool)}
                      >
                        {t('aiCli.install')}
                      </Button>
                    ) : (
                      <>
                        <Button
                          icon={<SyncOutlined />}
                          loading={actionLoading[tool.name] === 'update'}
                          onClick={() => handleUpdate(tool)}
                        >
                          {t('aiCli.update')}
                        </Button>
                        <Popconfirm
                          title={t('aiCli.uninstallConfirm', { name: tool.displayName })}
                          onConfirm={() => handleUninstall(tool)}
                          okText={t('common.confirm')}
                          cancelText={t('common.cancel')}
                        >
                          <Button
                            danger
                            icon={<DeleteOutlined />}
                            loading={actionLoading[tool.name] === 'uninstall'}
                          >
                            {t('aiCli.uninstall')}
                          </Button>
                        </Popconfirm>
                      </>
                    )}
                    <Tooltip title={t('aiCli.openHomepage')}>
                      <Button
                        icon={<LinkOutlined />}
                        onClick={() => handleOpenHomepage(tool.homepage)}
                      />
                    </Tooltip>
                    {tool.isInstalled && tool.configPath && (
                      <Tooltip title={t('aiCli.openConfig')}>
                        <Button
                          icon={<FolderOpenOutlined />}
                          onClick={() => handleOpenConfig(tool.configPath!)}
                        />
                      </Tooltip>
                    )}
                  </Space>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </div>
  )
}

export default AICLIView
