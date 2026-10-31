import { beforeEach, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  installMarketplaceBackend,
  marketplaceEntry,
  marketplaceSelection,
  renderSettingsPage,
} from '../test-utils'
import PluginsPage from './page'

const writing = marketplaceEntry('writing-kit', {
  kind: 'skill',
  title: '写作工具箱',
  description: '让团队文档保持清晰与一致。',
})
const github = marketplaceEntry('github-tools', {
  title: 'GitHub 工具',
  version: '2.1.0',
})
const pack = marketplaceEntry('starter-pack', {
  kind: 'pack',
  title: '团队入门合集',
})

beforeEach(() => localStorage.clear())

it('searches and filters the server catalog, then confirms a server-backed removal', async () => {
  const backend = installMarketplaceBackend({
    catalog: [writing, github, pack],
    selections: [marketplaceSelection(writing, { version: 4 })],
  })
  const user = userEvent.setup()
  renderSettingsPage(<PluginsPage />, '/settings/plugins')
  const row = await screen.findByRole('article', { name: '写作工具箱' })
  await user.type(screen.getByRole('textbox', { name: '搜索插件' }), '写作')
  expect(
    screen.queryByRole('article', { name: 'GitHub 工具' }),
  ).not.toBeInTheDocument()
  await user.click(
    within(row).getByRole('button', { name: '查看插件 写作工具箱' }),
  )
  expect(await screen.findByRole('dialog')).toHaveTextContent(
    'demo/writing-kit',
  )
  await user.click(screen.getByRole('button', { name: '关闭详情' }))
  await user.click(within(row).getByRole('button', { name: '移除' }))
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: '移除' }))
  await waitFor(() =>
    expect(within(row).getByText('未安装')).toBeInTheDocument(),
  )
  expect(backend.bodies.at(-1)).toEqual({
    identifier: 'demo/writing-kit',
    version: 4,
  })
})

it('installs an MCP plugin through the contract route with a fresh version', async () => {
  const backend = installMarketplaceBackend({
    catalog: [writing, github, pack],
  })
  const user = userEvent.setup()
  renderSettingsPage(<PluginsPage />)
  const row = await screen.findByRole('article', { name: 'GitHub 工具' })
  await user.click(within(row).getByRole('button', { name: '安装' }))
  await waitFor(() =>
    expect(within(row).getByText('已安装')).toBeInTheDocument(),
  )
  expect(backend.bodies.at(-1)).toEqual({
    identifier: 'demo/github-tools',
    pluginVersion: '2.1.0',
    version: 0,
  })
  expect(
    backend.seen.some((request) =>
      request.startsWith('POST /api/v1/tenants/'),
    ),
  ).toBe(true)
})

it('keeps unsupported packs disabled and clears no-result filters', async () => {
  installMarketplaceBackend({ catalog: [writing, github, pack] })
  const user = userEvent.setup()
  renderSettingsPage(<PluginsPage />)
  const packRow = await screen.findByRole('article', { name: '团队入门合集' })
  expect(within(packRow).getByText('合集安装尚未支持')).toBeInTheDocument()
  await user.type(
    screen.getByRole('textbox', { name: '搜索插件' }),
    'nothing-matches',
  )
  await user.click(screen.getByRole('button', { name: '清除筛选' }))
  expect(screen.getAllByRole('article')).toHaveLength(3)
})

it('lets a member browse the catalog but not change it', async () => {
  installMarketplaceBackend({
    role: 'member',
    catalog: [writing, github],
    selections: [marketplaceSelection(github)],
  })
  renderSettingsPage(<PluginsPage />)
  const row = await screen.findByRole('article', { name: '写作工具箱' })
  expect(
    within(row).getByRole('button', { name: '安装' }),
  ).toBeDisabled()
  expect(
    screen.getByText(/安装与移除需要工作区 owner 权限/),
  ).toBeInTheDocument()
})
