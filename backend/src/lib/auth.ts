import { createMiddleware } from 'hono/factory'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { org_members } from '../db/schema.js'

export type Env = { Variables: { userId: string } }
export const authMiddleware = createMiddleware<Env>(async (c, next) => {
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  c.set('userId', userId)
  await next()
})
export function getUserId(c: any): string {
  return c.get('userId') ?? c.req.header('X-User-Id') ?? c.req.header('x-user-id') ?? ''
}

export async function assertOrgMember(userId: string, orgId: string): Promise<boolean> {
  if (!userId || !orgId) return false
  const [row] = await db
    .select()
    .from(org_members)
    .where(and(eq(org_members.org_id, orgId), eq(org_members.user_id, userId)))
    .limit(1)
  return !!row
}
