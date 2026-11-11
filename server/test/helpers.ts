import type { AddressInfo } from 'node:net'
import { createApp } from '../src/app.js'
import { closeDb, initDb } from '../src/db.js'
import { seedDemo } from '../src/fixtures.js'

/** Data di calendario a N giorni da oggi: i test non devono invecchiare. */
export const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)

export interface Client {
  cookie: string
  get(path: string): Promise<Res>
  post(path: string, body?: unknown): Promise<Res>
  put(path: string, body?: unknown): Promise<Res>
  patch(path: string, body?: unknown): Promise<Res>
  del(path: string): Promise<Res>
}
export interface Res { status: number; body: any }

export async function boot() {
  process.env.DATABASE_URL = ''
  await initDb({ memory: true })
  const data = await seedDemo()
  const server = createApp().listen(0)
  await new Promise<void>((r) => server.once('listening', () => r()))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const client = (): Client => {
    const c: Client = {
      cookie: '',
      async get(path) { return send('GET', path) },
      async post(path, b) { return send('POST', path, b) },
      async put(path, b) { return send('PUT', path, b) },
      async patch(path, b) { return send('PATCH', path, b) },
      async del(path) { return send('DELETE', path) },
    }
    async function send(method: string, path: string, b?: unknown): Promise<Res> {
      const res = await fetch(base + path, {
        method,
        headers: { 'content-type': 'application/json', ...(c.cookie ? { cookie: c.cookie } : {}) },
        body: b === undefined ? undefined : JSON.stringify(b),
      })
      const setCookie = res.headers.get('set-cookie')
      if (setCookie) c.cookie = setCookie.split(';')[0]!
      return { status: res.status, body: await res.json().catch(() => null) }
    }
    return c
  }

  async function login(email: string, password = 'password123') {
    const c = client()
    const res = await c.post('/api/auth/login', { email, password })
    if (res.status !== 200) throw new Error(`login fallito per ${email}: ${JSON.stringify(res.body)}`)
    return c
  }

  return {
    base,
    data,
    anon: client(),
    login,
    async close() {
      await new Promise<void>((r) => server.close(() => r()))
      await closeDb()
    },
  }
}
