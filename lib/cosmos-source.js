const { RESTDataSource } = require('apollo-datasource-rest')
const chainpubsub = require('./chain-pubsub')
const {
  proposalReducer,
  validatorReducer,
  blockReducer,
  balanceReducer,
  delegationReducer
} = require('./reducers/cosmos-reducers')

class CosmosAPI extends RESTDataSource {
  constructor(network) {
    super()
    this.baseURL = network.api_url
    this.initialize({})
    this.wsClient = chainpubsub.client(network.rpc_url)
    this.wsClient.subscribe({ query: "tm.event='NewBlock'" }, async event => {
      const block = await this.getBlockByHeight({
        blockHeight: event.block.header.height
      })
      chainpubsub.publishBlockAdded(network.id, block)
    })
  }

  async getAllProposals() {
    const response = await this.get('gov/proposals')
    return Array.isArray(response)
      ? response.map(proposal => proposalReducer(proposal))
      : []
  }

  async getValidatorSigningInfo(validatorConsensusPubKey) {
    try {
      const exceptions = [
        `cosmosvalconspub1zcjduepqx38v580cmd9em3n7mcgzj22jwdwks5lr3lfxl8g87vzjp7jyyszsr4xvzv`,
        `cosmosvalconspub1zcjduepqlzmd0spn9m0m3eq9zp93d4w6e5tugamv44yqjzyacelnvra634fqnfec0r`
      ]
      if (exceptions.indexOf(validatorConsensusPubKey) !== -1) {
        throw Error(`Ignore Validator ${validatorConsensusPubKey}`)
      }
      const response = await this.get(
        `slashing/validators/${validatorConsensusPubKey}/signing_info`
      )
      return response
    } catch (e) {
      console.log(e)
      return {
        missed_blocks_counter: '0',
        start_height: '0'
      }
    }
  }

  async getAllValidatorSets() {
    const response = await this.get(`validatorsets/latest`)
    return response
  }

  async getAllValidators() {
    const response = await Promise.all([
      this.get(`staking/validators?status=unbonding`),
      this.get(`staking/validators?status=bonded`),
      this.get(`staking/validators?status=unbonded`)
    ]).then(validatorGroups => [].concat(...validatorGroups))

    const validatorSet = await this.getAllValidatorSets()

    validatorSet.validators.forEach(votingValidator => {
      const validator = response.find(
        v => v.consensus_pubkey === votingValidator.pub_key
      )
      validator.voting_power = validator ? votingValidator.voting_power : 0
    })

    await Promise.all(
      response.map(validator =>
        this.getValidatorSigningInfo(validator.consensus_pubkey)
      )
    ).then(singingInfos => {
      singingInfos.forEach((signingInfo, index) => {
        response[index].signing_info = signingInfo
      })
    })

    return Array.isArray(response)
      ? response.map(validator => validatorReducer(validator))
      : []
  }

  async getValidatorByAddress({ address }) {
    const response = await this.get(`staking/validators/${address}`)
    const signingInfo = await this.getValidatorSigningInfo(
      response.consensus_pubkey
    )
    response.signing_info = signingInfo
    return validatorReducer(response)
  }

  async getProposalById({ proposalId }) {
    const response = await this.get(`gov/proposals/${proposalId}`)
    return proposalReducer(response)
  }

  async getBlockByHeight({ blockHeight }) {
    let response
    if (blockHeight) {
      response = await this.get(`blocks/${blockHeight}`)
    } else {
      response = await this.get(`blocks/latest`)
    }
    return blockReducer(response)
  }

  async getBalanceFromAddress(address) {
    const response = await this.get(`bank/balances/${address}`)
    return balanceReducer(response)
  }

  async getDelegationsForDelegatorAddress(address) {
    const response = await this.get(`staking/delegators/${address}/delegations`)
    return Array.isArray(response)
      ? response.map(proposal => delegationReducer(proposal))
      : []
  }

  async getDelegationForValidator(delegatorAddress, validatorAddress) {
    const response = await this.get(
      `staking/delegators/${delegatorAddress}/delegations/${validatorAddress}`
    )
    return delegationReducer(response)
  }
}

module.exports = CosmosAPI
