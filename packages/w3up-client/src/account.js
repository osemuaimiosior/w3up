import * as API from './types.js'
import * as Access from './capability/access.js'
import * as Plan from './capability/plan.js'
import { Delegation, importAuthorization } from '@web3-storage/access/agent'
import { add as provision, AccountDID } from '@web3-storage/access/provider'
import { fromEmail, toEmail } from '@web3-storage/did-mailto'

export { fromEmail }

/**
 * @typedef {import('@web3-storage/did-mailto').EmailAddress} EmailAddress
 */

/**
 * List all accounts that agent has stored access to. Returns a dictionary
 * of accounts keyed by their `did:mailto` identifier.
 *
 * @param {{agent: API.Agent}} client
 * @param {object} query
 * @param {API.DID<'mailto'>} [query.account]
 */
export const list = ({ agent }, { account } = {}) => {
  const query = /** @type {API.CapabilityQuery} */ ({
    with: account ?? /did:mailto:.*/,
    can: '*',
  })

  const proofs = agent.proofs([query])
  /** @type {Record<API.DidMailto, Account>} */
  const accounts = {}
  /** @type {Record<string, API.Delegation>} */
  const attestations = {}
  for (const proof of proofs) {
    const access = Delegation.allows(proof)
    for (const [resource, abilities] of Object.entries(access)) {
      if (AccountDID.is(resource) && abilities['*']) {
        const id = /** @type {API.DidMailto} */ (resource)

        const account =
          accounts[id] ||
          (accounts[id] = new Account({ id, agent, proofs: [] }))
        account.addProof(proof)
      }

      for (const settings of /** @type {{proof?:API.Link}[]} */ (
        abilities['ucan/attest'] || []
      )) {
        const id = settings.proof
        if (id) {
          attestations[`${id}`] = proof
        }
      }
    }
  }

  for (const account of Object.values(accounts)) {
    for (const proof of account.proofs) {
      const attestation = attestations[`${proof.cid}`]
      if (attestation) {
        account.addProof(attestation)
      }
    }
  }

  return accounts
}

/**
 * Attempts to obtains an account access by performing an authentication with
 * the did:mailto account corresponding to given email. Process involves out
 * of bound email verification, so this function returns a promise that will
 * resolve to an account only after access has been granted by the email owner
 * by clicking on the link in the email. If the link is not clicked within the
 * authorization session time bounds (currently 15 minutes), the promise will
 * resolve to an error.
 *
 * @param {{agent: API.Agent}} client
 * @param {EmailAddress} email
 * @returns {Promise<API.Result<Account, Error>>}
 */
export const login = async ({ agent }, email) => {
  const account = fromEmail(email)
  const result = await Access.request(
    { agent },
    {
      account,
      access: Access.accountAccess,
    }
  )

  const { ok: access, error } = result
  /* c8 ignore next 2 - don't know how to test this */
  if (error) {
    return { error }
  } else {
    const { ok, error } = await access.claim()
    /* c8 ignore next 2 - don't know how to test this */
    if (error) {
      return { error }
    } else {
      return { ok: new Account({ id: account, proofs: ok.proofs, agent }) }
    }
  }
}

/**
 * @typedef {object} Model
 * @property {API.DidMailto} id
 * @property {API.Agent} agent
 * @property {API.Delegation[]} proofs
 */

export class Account {
  /**
   * @param {Model} model
   */
  constructor(model) {
    this.model = model
    this.plan = new AccountPlan(model)
  }
  get agent() {
    return this.model.agent
  }
  get proofs() {
    return this.model.proofs
  }

  did() {
    return this.model.id
  }

  toEmail() {
    return toEmail(this.did())
  }

  /**
   * @param {API.Delegation} proof
   */
  addProof(proof) {
    this.proofs.push(proof)
  }

  /**
   * Provisions given `space` with this account.
   *
   * @param {API.SpaceDID} space
   * @param {object} input
   * @param {API.ProviderDID} [input.provider]
   * @param {API.Agent} [input.agent]
   */
  provision(space, input = {}) {
    return provision(this.agent, {
      ...input,
      account: this.did(),
      consumer: space,
      proofs: this.proofs,
    })
  }

  /**
   * Saves account in the agent store so it can be accessed across sessions.
   *
   * @param {object} input
   * @param {API.Agent} [input.agent]
   */
  async save({ agent = this.agent } = {}) {
    return await importAuthorization(agent, this)
  }
}

export class AccountPlan {
  /**
   * @param {Model} model
   */
  constructor(model) {
    this.model = model
  }

  /**
   * Gets information about the plan associated with this account.
   */
  async get() {
    return await Plan.get(this.model, {
      account: this.model.id,
      proofs: this.model.proofs,
    })
  }
}
