import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema.js'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
pool.on('error', (err) => console.error('pg pool error:', err))
export const db = drizzle(pool, { schema })
