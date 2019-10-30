const { PerBlockCacheDataSource } = require('./helpers/PerBlockCacheDataSource')
const BigNumber = require('bignumber.js')
const _ = require('lodash')
const chainpubsub = require('./chain-pubsub')
const { uniqWith, sortBy, reverse } = require('lodash')
const { encodeB32, decodeB32, pubkeyToAddress } = require('./tools')

class CosmosV0API extends PerBlockCacheDataSource {
  constructor(network) {
    super()
    this.baseURL = network.api_url
    this.initialize({})
    this.networkId = network.id

    this.setReducers()
    this.subscribeToBlocks(network)
    this.loadStaticData()

    // prepopulate cache
    this.getAllValidators()
  }

  setReducers() {
    this.reducers = require('./reducers/cosmosV0-reducers')
  }

  // querying data from the cosmos REST API
  // is overwritten in cosmos v2 to extract from a differnt result format
  // some endpoints /blocks and /txs have a different response format so they use this.get directly
  async query(url) {
    return this.get(url)
  }

  async loadStaticData() {
    this.blockHeight = (await this.get(
      '/blocks/latest'
    )).block_meta.header.height
    this.stakingDenom = (await this.query('/staking/parameters')).bond_denom
    this.signedBlocksWindow = (await this.query(
      '/slashing/parameters'
    )).signed_blocks_window
  }

  // subscribe to blocks via Tendermint
  async subscribeToBlocks(network) {
    this.wsClient = await chainpubsub.client(network.rpc_url)
    this.wsClient.subscribe({ query: "tm.event='NewBlock'" }, async event => {
      this.blockHeight = event.block.header.height
      const block = await this.getBlockByHeight({
        blockHeight: event.block.header.height
      })
      chainpubsub.publishBlockAdded(network.id, block)
      this.reactToNewTransactions(network, event.block.header.height)
    })
  }

  async reactToNewTransactions(network, height) {
    const txs = await this.getTransactionsByHeight(height)
    txs.forEach(tx => {
      this.extractInvolvedAddresses(tx.raw).forEach(address => {
        chainpubsub.publishUserTransactionAdded(network.id, address, tx)
      })
    })
  }

  extractInvolvedAddresses(transaction) {
    const involvedAddresses = transaction.tags.reduce((addresses, tag) => {
      // temporary in here to identify why this fails
      if (!tag.value) {
        console.log(JSON.stringify(transaction))
        return addresses
      }
      if (tag.value.startsWith(`cosmos`)) {
        addresses.push(tag.value)
      }
      return addresses
    }, [])
    return involvedAddresses
  }

  async getTransactionsByHeight(height) {
    const txs = await this.get(`txs?tx.height=${height}`)
    return Array.isArray(txs)
      ? txs.map(transaction => this.reducers.transactionReducer(transaction))
      : []
  }

  async getValidatorSigningInfos(validators) {
    const signingInfos = await Promise.all(
      validators.map(({ consensus_pubkey }) =>
        this.getValidatorSigningInfo(consensus_pubkey)
      )
    )

    return signingInfos
  }

  async getValidatorSigningInfo(validatorConsensusPubKey) {
    try {
      const exceptions = [
        `cosmosvalconspub1zcjduepqx38v580cmd9em3n7mcgzj22jwdwks5lr3lfxl8g87vzjp7jyyszsr4xvzv`,
        `cosmosvalconspub1zcjduepqlzmd0spn9m0m3eq9zp93d4w6e5tugamv44yqjzyacelnvra634fqnfec0r`
      ]
      if (exceptions.indexOf(validatorConsensusPubKey) !== -1) {
        console.log(`Ignore Validator ${validatorConsensusPubKey}`)
        throw Error()
      }
      const response = await this.query(
        `slashing/validators/${validatorConsensusPubKey}/signing_info`,
        { cacheOptions: { ttl: 60 } }
      )
      return {
        address: pubkeyToAddress(validatorConsensusPubKey),
        ...response
      }
    } catch (e) {
      return {
        address: pubkeyToAddress(validatorConsensusPubKey),
        missed_blocks_counter: '0',
        start_height: '0'
      }
    }
  }

  async getAllValidatorSets() {
    const response = await this.query(`validatorsets/latest`)
    return response
  }

  async getAllValidators() {
    let [validators, annualProvision, validatorSet] = await Promise.all([
      Promise.all([
        this.query(`staking/validators?status=unbonding`),
        this.query(`staking/validators?status=bonded`),
        this.query(`staking/validators?status=unbonded`)
      ]).then(validatorGroups => [].concat(...validatorGroups)),
      this.getAnnualProvision(),
      this.getAllValidatorSets()
    ])

    // create a dictionary to reduce array lookups
    const consensusValidators = _.keyBy(validatorSet.validators, 'address')
    const totalVotingPower = validatorSet.validators.reduce(
      (sum, { voting_power }) => sum.plus(voting_power),
      BigNumber(0)
    )

    // query for signing info
    const signingInfos = _.keyBy(
      await this.getValidatorSigningInfos(validators),
      'address'
    )

    validators.forEach(validator => {
      const consensusAddress = pubkeyToAddress(validator.consensus_pubkey)
      validator.voting_power = consensusValidators[consensusAddress]
        ? BigNumber(consensusValidators[consensusAddress].voting_power)
          .div(totalVotingPower)
          .toNumber()
        : 0
      validator.signing_info = signingInfos[consensusAddress]
    })

    return validators.map(validator =>
      this.reducers.validatorReducer(
        this.networkId,
        this.signedBlocksWindow,
        validator,
        annualProvision
      )
    )
  }

  async getValidatorByAddress(wantedOperatorAddress) {
    const hexDelegatorAddressFromOperator = decodeB32(wantedOperatorAddress)
    const delegatorAddressFromOperator = encodeB32(
      hexDelegatorAddressFromOperator,
      `cosmos`
    )

    const [validators, selfDelegation] = await Promise.all([
      this.getAllValidators(),
      this.query(
        `staking/delegators/${delegatorAddressFromOperator}/delegations/${wantedOperatorAddress}`
      )
    ])
    const validator = validators.find(
      ({ operatorAddress }) => operatorAddress === wantedOperatorAddress
    )

    validator.selfStake = this.reducers.delegationReducer(
      selfDelegation,
      validator
    ).amount

    return validator
  }

  async getAllProposals() {
    const response = await this.query('gov/proposals')
    const { bonded_tokens: totalBondedTokens } = await this.query(
      '/staking/pool'
    )
    if (!Array.isArray(response)) return []
    const proposals = response.map(async proposal => {
      return this.reducers.proposalReducer(
        this.networkId,
        proposal,
        {}, //TODO also add tally to overview when we need it
        totalBondedTokens
      )
    })
    return _.orderBy(proposals, 'id', 'desc')
  }

  async getProposalById({ proposalId }) {
    const [
      proposal,
      { bonded_tokens: totalBondedTokens },
      tally
    ] = await Promise.all([
      this.query(`/gov/proposals/${proposalId}`),
      this.query('/staking/pool'),
      this.query(`/gov/proposals/${proposalId}/tally`)
    ])
    return this.reducers.proposalReducer(
      this.networkId,
      proposal,
      tally,
      totalBondedTokens
    )
  }

  async getGovernanceParameters() {
    const depositParameters = await this.query(`gov/parameters/deposit`)
    const tallyingParamers = await this.query(`gov/parameters/tallying`)

    return this.reducers.governanceParameterReducer(
      depositParameters,
      tallyingParamers
    )
  }

  async getDelegatorVote({ proposalId, address }) {
    const response = await this.query(`gov/proposals/${proposalId}/votes`)
    const votes = response || []
    const vote = votes.find(({ voter }) => voter === address) || {}
    return {
      option: vote.option
    }
  }

  async getBlockByHeight({ blockHeight }) {
    let block, transactions
    if (blockHeight) {
      const response = await Promise.all([
        this.get(`blocks/${blockHeight}`),
        this.getTransactionsByHeight(blockHeight)
      ])
      block = response[0]
      transactions = response[1]
    } else {
      block = await this.get(`blocks/latest`)
      transactions = await this.getTransactionsByHeight(
        block.block_meta.header.height
      )
    }
    return this.reducers.blockReducer(this.networkId, block, transactions)
  }

  async getBalancesFromAddress(address) {
    const response = await this.query(`bank/balances/${address}`)
    return response.map(this.reducers.coinReducer)
  }

  async getDelegationsForDelegatorAddress(address) {
    let delegations =
      (await this.query(`staking/delegators/${address}/delegations`)) || []
    const validators = await this.getAllValidators()
    const validatorsDictionary = _.keyBy(validators, 'operatorAddress')

    return delegations.map(delegation =>
      this.reducers.delegationReducer(
        delegation,
        validatorsDictionary[delegation.validator_address]
      )
    )
  }

  async getUndelegationsForDelegatorAddress(address) {
    let undelegations =
      (await this.query(
        `staking/delegators/${address}/unbonding_delegations`
      )) || []
    const validators = await this.getAllValidators()
    const validatorsDictionary = _.keyBy(validators, 'operatorAddress')

    // undelegations come in a nested format { validator_address, delegator_address, entries }
    // we flatten the format to be able to easier iterate over the list
    const flattenedUndelegations = undelegations.reduce(
      (list, undelegation) =>
        list.concat(
          undelegation.entries.map(entry => ({
            validator_address: undelegation.validator_address,
            delegator_address: undelegation.delegator_address,
            balance: entry.balance,
            completion_time: entry.completion_time,
            creation_height: entry.creation_height,
            initial_balance: entry.initial_balance
          }))
        ),
      []
    )
    return flattenedUndelegations.map(undelegation =>
      this.reducers.undelegationReducer(
        undelegation,
        validatorsDictionary[undelegation.validator_address]
      )
    )
  }

  async getDelegationForValidator(delegatorAddress, operatorAddress) {
    const [delegation, validator] = await Promise.all([
      this.query(
        `staking/delegators/${delegatorAddress}/delegations/${operatorAddress}`
      ).catch(() => ({
        validator_address: operatorAddress,
        delegator_address: delegatorAddress,
        shares: 0
      })),
      this.getValidatorByAddress(operatorAddress)
    ])
    return this.reducers.delegationReducer(delegation, validator)
  }

  async getAnnualProvision() {
    const response = await this.query(`minting/annual-provisions`)
    return response
  }

  async getRewards(delegatorAddress, delegations) {
    if (!delegations) {
      delegations = await this.getDelegationsForDelegatorAddress(
        delegatorAddress
      )
    }
    const rewards = await Promise.all(
      delegations.map(async ({ validatorAddress, validator }) => ({
        validator,
        rewards:
          (await this.query(
            `distribution/delegators/${delegatorAddress}/rewards/${validatorAddress}`
          )) || []
      }))
    )
    return rewards
      .filter(({ rewards }) => rewards.length > 0)
      .map(({ rewards, validator }) =>
        this.reducers.rewardReducer(rewards[0], validator)
      )
  }

  async getOverview(delegatorAddress) {
    const [balances, delegations] = await Promise.all([
      this.getBalancesFromAddress(delegatorAddress),
      this.getDelegationsForDelegatorAddress(delegatorAddress)
    ])
    const rewards = await this.getRewards(delegatorAddress, delegations)
    return this.reducers.overviewReducer(
      balances,
      delegations,
      rewards,
      this.stakingDenom
    )
  }

  async getTransactions(address) {
    const pagination = `&limit=${1000000000}`

    const txs = await Promise.all([
      this.get(`/txs?sender=${address}${pagination}`),
      this.get(`/txs?recipient=${address}${pagination}`),
      this.get(`/txs?action=submit_proposal&proposer=${address}${pagination}`),
      this.get(`/txs?action=deposit&depositor=${address}${pagination}`),
      this.get(`/txs?action=vote&voter=${address}${pagination}`),
      // this.get(`/txs?action=create_validator&destination-validator=${valAddress}`), // TODO
      // this.get(`/txs?action=edit_validator&destination-validator=${valAddress}`), // TODO
      this.get(`/txs?action=delegate&delegator=${address}${pagination}`),
      this.get(
        `/txs?action=begin_redelegate&delegator=${address}${pagination}`
      ),
      this.get(`/txs?action=begin_unbonding&delegator=${address}${pagination}`),
      // this.get(`/txs?action=unjail&source-validator=${address}`), // TODO
      // this.get(`/txs?action=set_withdraw_address&delegator=${address}`), // other
      this.get(
        `/txs?action=withdraw_delegator_reward&delegator=${address}${pagination}`
      ),
      this.get(
        `/txs?action=withdraw_validator_rewards_all&source-validator=${address}${pagination}`
      )
    ]).then(transactionGroups => [].concat(...transactionGroups))

    const duplicateFreeTxs = uniqWith(txs, (a, b) => a.txhash === b.txhash)
    const sortedTxs = sortBy(duplicateFreeTxs, ['timestamp'])
    const reversedTxs = reverse(sortedTxs)
    return reversedTxs.map(this.reducers.transactionReducer)
  }
}

module.exports = CosmosV0API
