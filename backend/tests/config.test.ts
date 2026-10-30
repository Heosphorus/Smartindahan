import test from 'node:test'
import assert from 'node:assert/strict'

import { describeConnectionFailure } from '../src/config/database.js'
import { env, parseAllowedOrigins, validateEnvironment, type EnvironmentConfig } from '../src/config/env.js'

const productionConfig: EnvironmentConfig = {
  ...env,
  nodeEnv: 'production',
  port: 5000,
  mongoUri: 'mongodb+srv://user:pass@cluster.example.mongodb.net/smartindahan',
  jwtSecret: 'f3a9c1e27b8d4a6f90b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5',
  frontendUrl: 'https://smartindahan.vercel.app',
  emailMode: 'production',
  emailProvider: 'resend',
  resendApiKey: 're_live_key_placeholder',
}

test('a complete production configuration is accepted', () => {
  assert.doesNotThrow(() => validateEnvironment(productionConfig))
})

test('production refuses weak or placeholder secrets, missing database and unsafe frontend origins', () => {
  const bad: Array<[Partial<EnvironmentConfig>, RegExp]> = [
    [{ jwtSecret: 'development-secret-change-me' }, /JWT_SECRET/],
    [{ jwtSecret: 'too-short' }, /JWT_SECRET/],
    [{ mongoUri: '  ' }, /MONGODB_URI/],
    [{ frontendUrl: 'http://localhost:5173' }, /FRONTEND_URL/],
    [{ frontendUrl: 'http://smartindahan.vercel.app' }, /FRONTEND_URL/],
    [{ frontendUrl: 'https://good.example,http://127.0.0.1:3000' }, /FRONTEND_URL/],
    [{ frontendUrl: '' }, /FRONTEND_URL/],
    [{ emailMode: 'development' }, /EMAIL_MODE/],
    [{ resendApiKey: '' }, /RESEND_API_KEY/],
    [{ port: 70000 }, /PORT/],
  ]
  for (const [override, message] of bad) {
    assert.throws(() => validateEnvironment({ ...productionConfig, ...override }), message, JSON.stringify(Object.keys(override)))
  }
})

test('development does not demand production secrets', () => {
  assert.doesNotThrow(() => validateEnvironment({ ...productionConfig, nodeEnv: 'development', jwtSecret: 'dev', mongoUri: '', frontendUrl: 'http://localhost:5173', emailMode: 'development', resendApiKey: '' }))
})

test('FRONTEND_URL accepts several origins and normalises paths and trailing slashes', () => {
  assert.deepEqual(
    parseAllowedOrigins('https://app.vercel.app/, https://owner.github.io/Smartindahan/ ,'),
    ['https://app.vercel.app', 'https://owner.github.io'],
  )
})

test('connection failures are described without leaking credentials or hostnames', () => {
  const secretUri = 'mongodb://admin:SuperSecret@ac-abc-shard-00-00.cluster.mongodb.net:27017'
  const cases: Array<[string, RegExp]> = [
    ['Authentication failed.', /authentication failed/],
    [`querySrv ECONNREFUSED _mongodb._tcp.cluster.mongodb.net (${secretUri})`, /DNS lookup failed/],
    ['Server selection timed out after 15000 ms', /network access failed/],
    ['connect ECONNREFUSED 127.0.0.1:27017', /refused/],
    ['Invalid scheme, expected connection string to start with "mongodb://"', /not a valid MongoDB connection string/],
    ['something unexpected', /database connection failed/],
  ]
  for (const [raw, expected] of cases) {
    const described = describeConnectionFailure(new Error(raw))
    assert.match(described, expected, raw)
    assert.ok(!described.includes('SuperSecret') && !described.includes('ac-abc-shard'), 'description must not echo the raw error')
  }
})
