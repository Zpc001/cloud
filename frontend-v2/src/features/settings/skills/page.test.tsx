import { beforeEach, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  installMarketplaceBackend,
  marketplaceEntry,
  marketplaceSelection,
  renderSettingsPage,
} from '../test-utils'
import SkillsPage from './page'

const writing = marketplaceEntry('writing-kit', {
  kind: 'skill',
  title: '写作工具箱',
  description: '让团队文档保持清晰与一致。',
  readme: '# writing-guide\n\n先明确读者和目的，再组织内容。',
})

beforeEach(() => localStorage.clear())

it('creates, edits, renders and deletes a local document', async () => {
  installMarketplaceBackend({ catalog: [writing] })
  const user = userEvent.setup()
  renderSettingsPage(<SkillsPage />)
  await screen.findByRole('article', { name: 'change-summary' })
  await user.click(screen.getByRole('button', { name: '新建技能' }))
  await user.type(screen.getByLabelText('技能名称'), 'release-notes')
  await user.type(screen.getByLabelText('简介'), '发布说明')
  await user.type(
    screen.getByLabelText('说明文档（Markdown）'),
    '# 发布清单\n\n检查兼容性。',
  )
  await user.click(screen.getByRole('button', { name: '保存技能' }))
  const row = await screen.findByRole('article', { name: 'release-notes' })
  await user.click(
    within(row).getByRole('button', { name: '查看技能 release-notes' }),
  )
  expect(
    await screen.findByRole('heading', { name: '发布清单' }),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '编辑技能' }))
  await user.clear(screen.getByLabelText('简介'))
  await user.type(screen.getByLabelText('简介'), '已更新')
  await user.click(screen.getByRole('button', { name: '保存技能' }))
  await screen.findByRole('button', { name: '编辑技能' })
  await user.click(screen.getByRole('button', { name: '删除技能' }))
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: '删除技能',
    }),
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('article', { name: 'release-notes' }),
    ).not.toBeInTheDocument(),
  )
})

it('installs and removes the source plugin from the skill row and keeps the document readonly', async () => {
  const backend = installMarketplaceBackend({ catalog: [writing] })
  const user = userEvent.setup()
  renderSettingsPage(<SkillsPage />)
  const row = await screen.findByRole('article', { name: 'writing-guide' })
  expect(within(row).getByText('来源插件未安装')).toBeInTheDocument()
  await user.click(within(row).getByRole('button', { name: '安装技能' }))
  await waitFor(() => expect(within(row).getByText('可用')).toBeInTheDocument())
  expect(
    backend.state.selections.find(
      (selection) => selection.identifier === 'writing-kit',
    )?.desiredState,
  ).toBe('installed')
  await user.click(within(row).getByRole('button', { name: '移除技能' }))
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: '移除技能',
    }),
  )
  await waitFor(() =>
    expect(within(row).getByText('来源插件未安装')).toBeInTheDocument(),
  )
  await user.click(
    within(row).getByRole('button', { name: '查看技能 writing-guide' }),
  )
  expect(
    screen.queryByRole('button', { name: '编辑技能' }),
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: /demo\/writing-kit/ }),
  ).toHaveAttribute('href', '/settings/plugins?plugin=demo%2Fwriting-kit')
})

it('shows a member the market state without write controls', async () => {
  installMarketplaceBackend({
    role: 'member',
    catalog: [writing],
    selections: [marketplaceSelection(writing)],
  })
  renderSettingsPage(<SkillsPage />)
  const row = await screen.findByRole('article', { name: 'writing-guide' })
  expect(within(row).getByText('可用')).toBeInTheDocument()
  expect(
    within(row).queryByRole('button', { name: '移除技能' }),
  ).not.toBeInTheDocument()
})
