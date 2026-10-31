import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'

import { clientKey, generalLimit, rateLimit } from '../src/middleware/rateLimitMiddleware.js'

let server: Server
let base = ''

before(async () => {
  const app = express()
  app.get('/tight', rateLimit(2, 60_000, () => 'tight-test'), (_req, res) => { res.json({ ok: true }) })
  app.get('/general', generalLimit('general-test', 3), (_req, res) => { res.json({ ok: true }) })
  server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())) })

test('requests over the limit get a JSON 429 and the window is advertised in headers', async () => {
  const statuses: number[] = []
  let blocked: Response | undefined
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${base}/tight`)
    statuses.push(response.status)
    if (response.status === 429) blocked ??= response
  }
  assert.deepEqual(statuses, [200, 200, 429, 429])
  assert.deepEqual(await blocked!.json(), { message: 'Too many requests. Please try again later.' })
  assert.ok(blocked!.headers.get('ratelimit') ?? blocked!.headers.get('ratelimit-policy'), 'standard rate-limit headers are sent')
  assert.equal(blocked!.headers.get('x-ratelimit-limit'), null, 'legacy headers are not')
})

test('the general limiter lets normal use through and stops a flood', async () => {
  const statuses: number[] = []
  for (let attempt = 0; attempt < 5; attempt += 1) statuses.push((await fetch(`${base}/general`)).status)
  assert.deepEqual(statuses, [200, 200, 200, 429, 429])
})

test('IPv6 clients are grouped by network prefix so changing address inside one range does not reset the limit', () => {
  const key = (ip: string) => clientKey({ ip } as never)
  assert.equal(key('203.0.113.7'), '203.0.113.7')
  assert.equal(key('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), key('2001:db8:1:2:1111:2222:3333:4444'))
  assert.notEqual(key('2001:db8:1:2::1'), key('2001:db8:9:9::1'))
  assert.equal(clientKey({} as never), 'unknown')
})
