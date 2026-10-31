import { createContext, useContext } from 'react'
import { useGetApiV1MeTenants } from '@/api/me/me'
import type { User } from '@/api/generated.schemas'

export const UserContext = createContext<User | null>(null)

/** The signed-in user; only valid below `SessionGate`. */
export function useUser(): User {
  const user = useContext(UserContext)
  if (!user) throw new Error('useUser outside SessionGate')
  return user
}

/** The two workspace roles v2 knows; Cloud's admin vocabulary is not part of the demo. */
export type WorkspaceRole = 'owner' | 'member'

/**
 * The caller's role in the current workspace. `GET /api/v1/me` forbids extra fields, so the role
 * comes from the tenant membership that `GET /api/v1/me/tenants` already returns; it is null
 * while that request is pending.
 */
export function useRole(): WorkspaceRole | null {
  const tenants = useGetApiV1MeTenants()
  const role = tenants.data?.items?.[0]?.role
  return role === 'owner' || role === 'member' ? role : null
}

/** Only an owner may invite; pages use this instead of comparing roles themselves. */
export function useCanInvite(): boolean {
  return useRole() === 'owner'
}
