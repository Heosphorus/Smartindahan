import type { Request, Response } from 'express'

import { policyTypes, type PolicyType } from '../models/PolicyVersion.js'
import { currentPolicy, policyHistory, policyVersion } from '../services/policyService.js'

function parsePolicyType(value: unknown): PolicyType | null {
  return typeof value === 'string' && (policyTypes as readonly string[]).includes(value) ? value as PolicyType : null
}

/** Public: the current version of every policy (without the full text). */
export async function listCurrentPolicies(_req: Request, res: Response): Promise<void> {
  const policies = []
  for (const policyType of policyTypes) {
    const policy = await currentPolicy(policyType)
    if (policy) {
      const { sections: _sections, ...summary } = policy
      policies.push(summary)
    }
  }
  res.status(200).json({ policies })
}

/** Public: the full text of the current version, or of a specific historical version via ?version=. */
export async function getPolicy(req: Request, res: Response): Promise<void> {
  const policyType = parsePolicyType(req.params.type)
  if (!policyType) {
    res.status(404).json({ message: 'Policy not found.' })
    return
  }
  const requested = typeof req.query.version === 'string' ? req.query.version : undefined
  const policy = requested ? await policyVersion(policyType, requested) : await currentPolicy(policyType)
  if (!policy) {
    res.status(404).json({ message: 'That policy version was not found.' })
    return
  }
  res.status(200).json({ policy, versions: await policyHistory(policyType) })
}
