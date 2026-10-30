import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'

import { AuditLogModel } from '../src/models/AuditLog.js'
import { ConsentRecordModel } from '../src/models/ConsentRecord.js'
import { PolicyVersionModel } from '../src/models/PolicyVersion.js'
import { ProductModel } from '../src/models/Product.js'
import { UserModel } from '../src/models/User.js'
import { purgeDueAccounts } from '../src/services/accountDeletionService.js'
import { api, createProduct, createStore, env, startTestServer, stopTestServer } from './helpers/testServer.js'

type PolicyList = { policies: Array<{ policyType: string; version: string; isDraft: boolean }> }
type Pending = { pending: Array<{ policyType: string; version: string; blocking: boolean; acceptedVersion: string | null }>; blocking: boolean }

before(async () => { await startTestServer() }, { timeout: 300_000 })
after(async () => { await stopTestServer() })

async function currentVersions(): Promise<{ terms: string; privacy: string }> {
  const { body } = await api<PolicyList>('/api/legal/policies')
  return {
    terms: body.policies.find((policy) => policy.policyType === 'terms')!.version,
    privacy: body.policies.find((policy) => policy.policyType === 'privacy')!.version,
  }
}

function registrationFor(email: string, versions: { terms: string; privacy: string }, overrides: Record<string, unknown> = {}) {
  return {
    firstName: 'Ana', lastName: 'Cruz', email, mobileNumber: '09171234567', password: 'Passw0rdTest', confirmPassword: 'Passw0rdTest',
    storeName: `Consent Store ${email}`, storeAddress: 'Quezon City', termsAccepted: true, privacyPolicyAccepted: true,
    termsVersion: versions.terms, privacyVersion: versions.privacy, ...overrides,
  }
}

let nextPolicyNumber = 1
async function publish(adminToken: string, policyType: 'terms' | 'privacy', requiresReacceptance: boolean) {
  nextPolicyNumber += 1
  const version = `2.${nextPolicyNumber}`
  const result = await api('/api/auth/admin/policies', {
    token: adminToken,
    body: {
      policyType, version, title: policyType === 'terms' ? 'Terms of Service' : 'Privacy Policy', summary: 'Updated summary.',
      changeSummary: `Changes in ${version}: a long explanation that is deliberately longer than sixty-four characters so the global input limit would have rejected it.`,
      sections: [{ id: 'one', heading: 'One', paragraphs: ['Some text.'], bullets: [] }],
      isDraft: false, requiresReacceptance, effectiveAt: new Date().toISOString(),
    },
  })
  return { version, result }
}

test('the policy pages are public, versioned drafts with placeholders instead of invented company details', async () => {
  const list = await api<PolicyList>('/api/legal/policies')
  assert.equal(list.status, 200)
  assert.deepEqual(list.body.policies.map((policy) => policy.policyType).sort(), ['privacy', 'terms'])
  assert.ok(list.body.policies.every((policy) => policy.isDraft), 'seeded policies are marked as drafts')

  const terms = await api<{ policy: { sections: Array<{ paragraphs: string[]; bullets?: string[] }>; isCurrent: boolean }; versions: unknown[] }>('/api/legal/policies/terms')
  assert.equal(terms.status, 200)
  assert.equal(terms.body.policy.isCurrent, true)
  const text = JSON.stringify(terms.body.policy.sections)
  assert.match(text, /\[operator legal name — to be provided by the owner\]/)
  assert.equal((await api('/api/legal/policies/cookies')).status, 404)
  assert.equal((await api('/api/legal/policies/terms?version=nope')).status, 404)
})

test('registration without agreement is rejected by the server and leaves nothing behind', async () => {
  const versions = await currentVersions()
  const email = `no-agreement-${Date.now()}@example.test`
  for (const overrides of [{ termsAccepted: false }, { privacyPolicyAccepted: 'true' }]) {
    const response = await api<{ code: string; message: string }>('/api/auth/register', { body: registrationFor(email, versions, overrides) })
    assert.equal(response.status, 400)
    assert.equal(response.body.code, 'AGREEMENT_REQUIRED')
  }
  assert.equal(await UserModel.countDocuments({ email }), 0)
})

test('registration must reference the policy versions the user was shown', async () => {
  const versions = await currentVersions()
  const email = `stale-${Date.now()}@example.test`
  const stale = await api<{ code: string }>('/api/auth/register', { body: registrationFor(email, versions, { termsVersion: '0.0-old' }) })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.code, 'POLICY_VERSION_MISMATCH')
  assert.equal(await UserModel.countDocuments({ email }), 0)
})

test('registration with agreement records exactly the accepted versions', async () => {
  const versions = await currentVersions()
  const email = `agreed-${Date.now()}@example.test`
  const before = Date.now()
  const response = await api<{ user: { id: string } }>('/api/auth/register', { body: registrationFor(email, versions) })
  assert.equal(response.status, 201)

  const records = await ConsentRecordModel.find({ userId: response.body.user.id }).sort({ consentType: 1 }).lean()
  assert.deepEqual(records.map((record) => [record.consentType, record.policyVersion, record.accepted, record.source]), [
    ['PRIVACY_NOTICE', versions.privacy, true, 'REGISTRATION'],
    ['TERMS_OF_SERVICE', versions.terms, true, 'REGISTRATION'],
  ])
  assert.ok(records.every((record) => record.acceptedAt.getTime() >= before - 1000 && record.acceptedAt.getTime() <= Date.now() + 1000))
  assert.ok(!('marketing' in records[0]!), 'no optional marketing consent is bundled in')
  const events = (await AuditLogModel.find({ userId: response.body.user.id, event: 'CONSENT_RECORDED' }).lean()).map((entry) => entry.metadata)
  assert.equal(events.length, 2)
})

test('a failed registration (email cannot be delivered) saves no account and no acceptance record', async () => {
  const versions = await currentVersions()
  const email = `undeliverable-${Date.now()}@example.test`
  const original = { mode: env.emailMode, provider: env.emailProvider }
  env.emailMode = 'production'
  env.emailProvider = 'smtp' as typeof env.emailProvider
  try {
    const response = await api<{ message: string }>('/api/auth/register', { body: registrationFor(email, versions) })
    assert.equal(response.status, 502)
    assert.match(response.body.message, /nothing was saved/i)
    assert.doesNotMatch(JSON.stringify(response.body), /SMTP|EMAIL_HOST|stack/i)
  } finally {
    env.emailMode = original.mode
    env.emailProvider = original.provider
  }
  assert.equal(await UserModel.countDocuments({ email }), 0)
  const orphaned = await ConsentRecordModel.countDocuments({ policyVersion: versions.terms, userId: { $nin: (await UserModel.find().select('_id').lean()).map((user) => user._id) } })
  assert.equal(orphaned, 0, 'no acceptance record without an account')
})

test('publishing keeps old versions; changed Terms must be re-accepted before store features work', async () => {
  const admin = await createStore({ role: 'ADMIN', acceptPolicies: false })
  const owner = await createStore()
  assert.equal((await api('/api/store/products', { token: owner.token })).status, 200)

  assert.equal((await publish(owner.token, 'terms', true)).result.status, 403, 'store owners cannot publish policies')
  const first = await currentVersions()
  const { version, result } = await publish(admin.token, 'terms', true)
  assert.equal(result.status, 201)

  const duplicate = await api('/api/auth/admin/policies', { token: admin.token, body: { policyType: 'terms', version, title: 'Terms of Service', summary: 's', changeSummary: 'again', sections: [{ id: 'x', heading: 'X', paragraphs: ['changed text'] }], isDraft: false, requiresReacceptance: true, effectiveAt: new Date().toISOString() } })
  assert.equal(duplicate.status, 409, 'a published version cannot be replaced')

  const history = await api<{ policy: { version: string; isCurrent: boolean }; versions: Array<{ version: string; isCurrent: boolean }> }>('/api/legal/policies/terms')
  assert.equal(history.body.policy.version, version)
  assert.deepEqual(history.body.versions.map((entry) => entry.version).sort(), [first.terms, version].sort())
  const old = await api<{ policy: { version: string; isCurrent: boolean } }>(`/api/legal/policies/terms?version=${encodeURIComponent(first.terms)}`)
  assert.equal(old.body.policy.version, first.terms)
  assert.equal(old.body.policy.isCurrent, false)

  // The existing owner is stopped from store features, but not from reading status, exporting or signing out.
  const blocked = await api<{ code: string }>('/api/store/products', { token: owner.token })
  assert.equal(blocked.status, 403)
  assert.equal(blocked.body.code, 'POLICY_REVIEW_REQUIRED')
  assert.equal((await api('/api/business/settings', { token: owner.token })).status, 403)
  const status = await api<Pending>('/api/privacy/status', { token: owner.token })
  assert.equal(status.body.blocking, true)
  assert.equal(status.body.pending[0]!.acceptedVersion, first.terms)
  assert.equal((await api('/api/privacy/export', { token: owner.token })).status, 200)

  // Continued use is not agreement; a wrong or stale version is refused; only an explicit action records acceptance.
  assert.equal((await api('/api/privacy/consents', { token: owner.token, body: { consentType: 'TERMS_OF_SERVICE', policyVersion: first.terms } })).status, 409)
  assert.equal(await ConsentRecordModel.countDocuments({ userId: owner.id, consentType: 'TERMS_OF_SERVICE' }), 1)
  assert.equal((await api('/api/privacy/consents', { token: owner.token, body: { consentType: 'TERMS_OF_SERVICE', policyVersion: version } })).status, 200)
  assert.equal((await api('/api/store/products', { token: owner.token })).status, 200)

  const records = await ConsentRecordModel.find({ userId: owner.id, consentType: 'TERMS_OF_SERVICE' }).sort({ acceptedAt: 1 }).lean()
  assert.deepEqual(records.map((record) => record.policyVersion), [first.terms, version], 'history is preserved, not overwritten')
  assert.equal((await api('/api/privacy/consents', { token: owner.token, body: { consentType: 'TERMS_OF_SERVICE', policyVersion: version } })).status, 200)
  assert.equal(await ConsentRecordModel.countDocuments({ userId: owner.id, consentType: 'TERMS_OF_SERVICE' }), 2, 'repeating an accepted version adds no duplicate')

  // Nobody can accept on behalf of someone else, and unauthenticated calls are rejected.
  const other = await createStore({ acceptPolicies: false })
  assert.equal(await ConsentRecordModel.countDocuments({ userId: other.id }), 0)
  assert.equal((await api('/api/privacy/consents', { method: 'POST', body: { consentType: 'TERMS_OF_SERVICE', policyVersion: version } })).status, 401)
  assert.equal(await ConsentRecordModel.countDocuments({ userId: other.id }), 0, 'no record is invented for a user who never accepted')
  assert.equal((await api('/api/store/products', { token: other.token })).status, 403, 'a user with no acceptance record is asked to accept, not assumed to have accepted')
})

test('privacy notice updates ask for acknowledgment but never block the app; minor versions do not prompt', async () => {
  const admin = await createStore({ role: 'ADMIN', acceptPolicies: false })
  const owner = await createStore()

  assert.equal((await publish(admin.token, 'privacy', false)).result.status, 201)
  const minor = await api<Pending>('/api/privacy/status', { token: owner.token })
  assert.deepEqual(minor.body.pending, [], 'no renewed agreement required')

  const { version } = await publish(admin.token, 'privacy', true)
  const status = await api<Pending>('/api/privacy/status', { token: owner.token })
  assert.equal(status.body.pending.length, 1)
  assert.equal(status.body.pending[0]!.policyType, 'privacy')
  assert.equal(status.body.pending[0]!.blocking, false)
  assert.equal(status.body.blocking, false)
  assert.equal((await api('/api/store/products', { token: owner.token })).status, 200)

  assert.equal((await api('/api/privacy/consents', { token: owner.token, body: { consentType: 'PRIVACY_NOTICE', policyVersion: version } })).status, 200)
  assert.deepEqual((await api<Pending>('/api/privacy/status', { token: owner.token })).body.pending, [])
})

test('policy and consent history cannot be edited or deleted through the application', async () => {
  const owner = await createStore()
  const record = await ConsentRecordModel.findOne({ userId: owner.id }).lean()
  assert.ok(record)
  await assert.rejects(() => ConsentRecordModel.updateOne({ _id: record._id }, { $set: { policyVersion: 'forged' } }), /append-only/)
  await assert.rejects(() => ConsentRecordModel.deleteMany({ userId: owner.id }), /append-only/)
  await assert.rejects(() => PolicyVersionModel.updateOne({}, { $set: { title: 'rewritten' } }), /append-only/)
  await assert.rejects(() => AuditLogModel.deleteMany({}), /append-only/)
  const stored = await ConsentRecordModel.findById(record._id)
  stored!.policyVersion = 'forged'
  await assert.rejects(() => stored!.save(), /append-only/)
})

test('logout revokes only the token that was used', async () => {
  const owner = await createStore()
  const first = (await api<{ token: string }>('/api/auth/login', { body: { email: owner.email, password: owner.password } })).body.token
  const second = (await api<{ token: string }>('/api/auth/login', { body: { email: owner.email, password: owner.password } })).body.token
  assert.equal((await api('/api/store/products', { token: first })).status, 200)
  assert.equal((await api('/api/auth/logout', { token: first, body: {} })).status, 200)
  assert.equal((await api('/api/store/products', { token: first })).status, 401, 'the signed-out token is dead')
  assert.equal((await api('/api/store/products', { token: second })).status, 200, 'other devices stay signed in')
})

test('data export contains only the requester\'s own data and no secrets', async () => {
  const alice = await createStore()
  const bob = await createStore()
  await createProduct(alice.token, { name: 'Alice Secret Biscuit' })
  await createProduct(bob.token, { name: 'Bob Private Soap' })

  assert.equal((await api('/api/privacy/export')).status, 401)
  const exported = await api<Record<string, unknown>>('/api/privacy/export', { token: alice.token })
  assert.equal(exported.status, 200)
  assert.match(exported.headers.get('content-disposition') ?? '', /attachment/)
  const text = JSON.stringify(exported.body)
  assert.match(text, /Alice Secret Biscuit/)
  assert.doesNotMatch(text, /Bob Private Soap/)
  assert.doesNotMatch(text, new RegExp(bob.email))
  assert.doesNotMatch(text, /passwordHash|otpHash|tokenVersion|\$2[aby]\$/)
  assert.equal((exported.body.consents as unknown[]).length, 2)
  assert.equal(await AuditLogModel.countDocuments({ userId: alice.id, event: 'DATA_EXPORT_REQUESTED' }), 1)
})

test('privacy requests accept real messages, stay private, and validate input', async () => {
  const alice = await createStore()
  const bob = await createStore()
  const message = 'Please correct the spelling of my store address on file. '.repeat(5)
  const created = await api<{ request: { id: string; status: string } }>('/api/privacy/requests', { token: alice.token, body: { type: 'CORRECTION', message } })
  assert.equal(created.status, 201)
  assert.equal(created.body.request.status, 'RECEIVED')

  assert.equal((await api('/api/privacy/requests', { token: alice.token, body: { type: 'NOPE', message: 'x' } })).status, 400)
  assert.equal((await api('/api/privacy/requests', { token: alice.token, body: { type: 'QUESTION', message: '   ' } })).status, 400)
  assert.equal((await api('/api/privacy/requests', { token: alice.token, body: { type: 'QUESTION', message: 'x'.repeat(1001) } })).status, 400)

  const mine = await api<{ requests: Array<{ message: string; type: string }> }>('/api/privacy/requests', { token: alice.token })
  assert.equal(mine.body.requests.length, 1)
  assert.equal(mine.body.requests[0]!.type, 'CORRECTION')
  assert.equal((await api<{ requests: unknown[] }>('/api/privacy/requests', { token: bob.token })).body.requests.length, 0, 'another user sees none of it')

  const admin = await createStore({ role: 'ADMIN', acceptPolicies: false })
  assert.equal((await api('/api/auth/admin/privacy-requests', { token: alice.token })).status, 403)
  const queue = await api<{ requests: Array<{ _id: string; requester: { email: string } }> }>('/api/auth/admin/privacy-requests?status=RECEIVED', { token: admin.token })
  const entry = queue.body.requests.find((request) => request._id === created.body.request.id)
  assert.equal(entry?.requester.email, alice.email)
  const updated = await api(`/api/auth/admin/privacy-requests/${created.body.request.id}`, { method: 'PATCH', token: admin.token, body: { status: 'COMPLETED', resolutionNote: 'Corrected.' } })
  assert.equal(updated.status, 200)
  assert.equal((await api<{ requests: Array<{ status: string }> }>('/api/privacy/requests', { token: alice.token })).body.requests[0]!.status, 'COMPLETED')
})

test('account deletion needs the password and a typed confirmation, waits, can be cancelled, then removes only that account', async () => {
  const leaving = await createStore()
  const staying = await createStore()
  await createProduct(leaving.token, { name: 'Leaving Product' })
  const keptProduct = await createProduct(staying.token, { name: 'Staying Product' })

  assert.equal((await api('/api/privacy/deletion', { token: leaving.token, body: { password: leaving.password } })).status, 400, 'typed confirmation is required')
  assert.equal((await api('/api/privacy/deletion', { token: leaving.token, body: { password: 'WrongPassw0rd', confirmation: 'DELETE' } })).status, 400)
  assert.equal(await UserModel.countDocuments({ _id: leaving.id, deletionScheduledFor: { $exists: true } }), 0, 'nothing scheduled without reauthentication')
  assert.equal((await api('/api/privacy/deletion', { body: { password: 'x', confirmation: 'DELETE' } })).status, 401)

  const scheduled = await api<{ deletion: { scheduledFor: string } }>('/api/privacy/deletion', { token: leaving.token, body: { password: leaving.password, confirmation: 'DELETE' } })
  assert.equal(scheduled.status, 200)
  const days = (new Date(scheduled.body.deletion.scheduledFor).getTime() - Date.now()) / 86_400_000
  assert.ok(days > env.accountDeletionGraceDays - 0.01 && days <= env.accountDeletionGraceDays + 0.01)
  assert.equal(await purgeDueAccounts(), 0, 'nothing is deleted before the waiting period ends')

  assert.equal((await api('/api/privacy/deletion', { method: 'DELETE', token: leaving.token })).status, 200)
  assert.equal((await api('/api/privacy/deletion', { method: 'DELETE', token: leaving.token })).status, 404)
  assert.equal(await purgeDueAccounts(new Date(Date.now() + 400 * 86_400_000)), 0, 'a cancelled request is never purged')

  await api('/api/privacy/deletion', { token: leaving.token, body: { password: leaving.password, confirmation: 'DELETE' } })
  const purged = await purgeDueAccounts(new Date(Date.now() + (env.accountDeletionGraceDays + 1) * 86_400_000))
  assert.equal(purged, 1)
  assert.equal(await UserModel.countDocuments({ _id: leaving.id }), 0)
  assert.equal(await ProductModel.countDocuments({ storeId: leaving.id }), 0)
  assert.equal(await ProductModel.countDocuments({ _id: keptProduct._id }), 1, 'other stores are untouched')
  assert.equal(await UserModel.countDocuments({ _id: staying.id }), 1)
  assert.ok(await ConsentRecordModel.countDocuments({ userId: leaving.id }) >= 2, 'agreement history is retained')
  assert.equal(await AuditLogModel.countDocuments({ userId: leaving.id, event: 'ACCOUNT_DELETED' }), 1)
  assert.equal((await api('/api/store/products', { token: leaving.token })).status, 401)

  const admin = await createStore({ role: 'ADMIN', acceptPolicies: false })
  assert.equal((await api('/api/privacy/deletion', { token: admin.token, body: { password: admin.password, confirmation: 'DELETE' } })).status, 403)
})

test('audit and consent records never contain secrets, and errors reveal no internals', async () => {
  const records = JSON.stringify([...(await AuditLogModel.find().lean()), ...(await ConsentRecordModel.find().lean())])
  assert.doesNotMatch(records, /passwordHash|otpHash|Passw0rd|\$2[aby]\$|eyJ[A-Za-z0-9_-]{10,}/)

  const owner = await createStore()
  const badId = await api<{ message: string }>('/api/store/products/not-an-id', { token: owner.token })
  assert.ok(badId.status >= 400 && badId.status < 500)
  assert.doesNotMatch(JSON.stringify(badId.body), /Cast|Mongo|stack|at .*\.ts|node_modules/i)
  const noAccount = await api<{ message: string }>('/api/auth/login', { body: { email: 'nobody@example.test', password: 'Passw0rdTest' } })
  const wrongPassword = await api<{ message: string }>('/api/auth/login', { body: { email: owner.email, password: 'Passw0rdWrong' } })
  assert.equal(noAccount.status, 401)
  assert.deepEqual(noAccount.body, wrongPassword.body, 'login does not reveal whether the email exists')
})

test('registration is rate limited', async () => {
  const versions = await currentVersions()
  const statuses: number[] = []
  for (let attempt = 0; attempt < 6; attempt += 1) {
    statuses.push((await api('/api/auth/register', { body: registrationFor(`ratelimit-${attempt}-${Date.now()}@example.test`, versions, { termsAccepted: false }) })).status)
  }
  assert.ok(statuses.includes(429), `expected a 429 in ${statuses.join(',')}`)
})
