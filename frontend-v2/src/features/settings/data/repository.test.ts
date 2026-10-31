import { beforeEach, describe, expect, it } from 'vitest'
import { DemoRepository } from './repository'
import {
  changeConnection,
  connectionReady,
  deleteSkill,
  saveConnection,
  saveSkill,
  setModelDefault,
  validateConnection,
} from './resource-actions'
import type { ConnectionDraft } from './types'

const user = { id: 'current', displayName: '当前用户', role: 'owner' as const }
let values: Map<string, string>
const port = () => ({
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    values.set(key, value)
  },
})
const repository = () => new DemoRepository(user, port)
beforeEach(() => {
  values = new Map()
})

describe('settings demo persistence', () => {
  it('persists per user, does not mutate returned snapshots, and keeps another user isolated', async () => {
    const first = repository()
    const state = await first.read()
    await first.update(state.revision, (data) =>
      saveSkill(data, {
        name: 'custom',
        description: '',
        content: '# 私有演示',
      }),
    )
    expect(state.skills.some((s) => s.name === 'custom')).toBe(false)
    expect(
      (await repository().read()).skills.some((s) => s.name === 'custom'),
    ).toBe(true)
    expect(
      (
        await new DemoRepository(
          { id: 'other', displayName: '另一用户', role: 'member' },
          port,
        ).read()
      ).skills.some((s) => s.name === 'custom'),
    ).toBe(false)
  })
  it('rejects a stale write instead of losing an earlier change', async () => {
    const repo = repository()
    const state = await repo.read()
    await repo.update(state.revision, (data) =>
      saveSkill(data, { name: 'first', description: '', content: '' }),
    )
    await expect(
      repo.update(state.revision, (data) =>
        saveSkill(data, { name: 'lost', description: '', content: '' }),
      ),
    ).rejects.toThrow('其他操作')
    expect((await repo.read()).skills.map((s) => s.name)).toContain('first')
    expect((await repo.read()).skills.map((s) => s.name)).not.toContain('lost')
  })
  it('does not report successful storage when writing fails', async () => {
    const state = await repository().read()
    const repo = new DemoRepository(user, () => ({
      getItem: port().getItem,
      setItem: () => {
        throw new Error('quota')
      },
    }))
    await expect(
      repo.update(state.revision, (data) => {
        data.skills = []
      }),
    ).rejects.toThrow('尚未保存')
    expect((await repository().read()).skills).toHaveLength(state.skills.length)
  })
  it('keeps corrupt data until an explicit reset and does not reset another user', async () => {
    const repo = repository()
    const other = new DemoRepository(
      { id: 'other', displayName: '另一用户', role: 'member' },
      port,
    )
    await other.read()
    values.set(repo.key, '{"schema":1,"skills":null}')
    await expect(repo.read()).rejects.toThrow('重置')
    expect(values.get(repo.key)).toBe('{"schema":1,"skills":null}')
    await repo.reset()
    expect((await repo.read()).skills.length).toBeGreaterThan(0)
    expect(values.has(other.key)).toBe(true)
  })
})

describe('document skills', () => {
  it('supports local editing, validation and deletion', async () => {
    const repo = repository()
    let state = await repo.read()
    state = await repo.update(state.revision, (data) =>
      saveSkill(
        data,
        { name: 'test-plan', description: '修改说明', content: '# 新版' },
        'local-test-plan',
      ),
    )
    expect(state.skills.find((s) => s.id === 'local-test-plan')?.content).toBe(
      '# 新版',
    )
    await expect(
      repo.update(state.revision, (data) =>
        saveSkill(data, { name: 'TEST-PLAN', description: '', content: '' }),
      ),
    ).rejects.toThrow('同名')
    state = await repo.update(state.revision, (data) =>
      deleteSkill(data, 'local-test-plan'),
    )
    expect(state.skills.some((s) => s.id === 'local-test-plan')).toBe(false)
  })
  it('keeps no roster, invitations or join history in browser storage', async () => {
    const state = await repository().read()
    expect(state.schema).toBe(3)
    expect(state).not.toHaveProperty('catalog')
    expect(state).not.toHaveProperty('installations')
    for (const field of ['members', 'history', 'links', 'requests'])
      expect(state).not.toHaveProperty(field)
  })
  it('upgrades schema 2 without keeping its local marketplace mirror', async () => {
    const repo = repository()
    const initial = await repo.read()
    values.set(
      repo.key,
      JSON.stringify({
        ...initial,
        schema: 2,
        catalog: [{ id: 'stale' }],
        installations: [{ id: 'stale-selection' }],
        skills: [
          ...initial.skills,
          {
            id: 'stale-plugin-skill',
            namespace: 'demo',
            name: 'stale',
            description: '',
            content: '',
            source: { kind: 'plugin', pluginId: 'demo/stale' },
            availability: 'available',
          },
        ],
      }),
    )
    const upgraded = await repo.read()
    expect(upgraded.schema).toBe(3)
    expect(upgraded).not.toHaveProperty('catalog')
    expect(upgraded).not.toHaveProperty('installations')
    expect(
      upgraded.skills.every((skill) => skill.source.kind === 'local'),
    ).toBe(true)
    expect(JSON.parse(values.get(repo.key) ?? '{}').schema).toBe(3)
  })
})

describe('model metadata without credentials', () => {
  const draft: ConnectionDraft = {
    name: '连接',
    protocol: 'openai-completions',
    authMode: 'bearer',
    baseUrl: 'https://models.example.com/v1',
    enabled: true,
    models: [
      { id: 'org/model', name: '模型', contextWindow: 64000, maxTokens: 8192 },
    ],
  }
  it('preserves slash model ids and allows defaults only for ready connections', async () => {
    const repo = repository()
    let state = await repo.read()
    state = await repo.update(state.revision, (data) =>
      saveConnection(data, draft),
    )
    const connection = state.connections.at(-1)!
    expect(connection.models[0].id).toBe('org/model')
    await expect(
      repo.update(state.revision, (data) =>
        setModelDefault(data, connection.id, 'org/model'),
      ),
    ).rejects.toThrow('演示凭据')
    state = await repo.update(state.revision, (data) =>
      changeConnection(data, connection.id, 'credential'),
    )
    state = await repo.update(state.revision, (data) =>
      setModelDefault(data, connection.id, 'org/model'),
    )
    expect(connectionReady(state)).toBe(true)
    state = await repo.update(state.revision, (data) =>
      changeConnection(data, connection.id, 'toggle'),
    )
    expect(connectionReady(state)).toBe(false)
    state = await repo.update(state.revision, (data) =>
      changeConnection(data, connection.id, 'delete'),
    )
    expect(connectionReady(state)).toBe(false)
    expect(values.get(repo.key)).not.toMatch(/apiKey|secret|credentialValue/)
  })
  it('rejects stale connection edits while preserving latest metadata', async () => {
    const repo = repository()
    let state = await repo.read()
    const connection = state.connections[0]
    state = await repo.update(state.revision, (data) =>
      changeConnection(data, connection.id, 'toggle'),
    )
    await expect(
      repo.update(state.revision, (data) =>
        saveConnection(data, draft, connection.id, connection.version),
      ),
    ).rejects.toThrow('草稿已保留')
    expect((await repo.read()).connections[0].enabled).toBe(false)
  })
  it.each([
    { ...draft, baseUrl: 'http://example.com' },
    { ...draft, baseUrl: 'https://name:secret@example.com' },
    { ...draft, models: [] },
    { ...draft, models: [draft.models[0], draft.models[0]] },
    { ...draft, models: [{ ...draft.models[0], maxTokens: 64001 }] },
    { ...draft, authMode: 'x-api-key' as const },
  ])(
    'validates contract metadata without accessing the network: %j',
    (invalid) => {
      expect(validateConnection(invalid)).toBeTypeOf('string')
    },
  )
})
