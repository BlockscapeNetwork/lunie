const { gql } = require('apollo-server')
const typeDefs = gql`
  enum ValidatorStatusEnum {
    ACTIVE
    INACTIVE
  }

  type Tally {
    yes: String # BigNumber
    no: String # BigNumber
    abstain: String # BigNumber
    veto: String # BigNumber
    total: String # BigNumber
    totalVotedPercentage: Float
  }

  type Coin {
    amount: String
    denom: String
  }

  type Reward {
    validator: Validator
    amount: String
  }

  type Proposal {
    networkId: String!
    id: Int
    type: String
    title: String
    description: String
    status: String
    creationTime: String
    statusBeginTime: String
    statusEndTime: String
    tally: Tally
    deposit: String # BigNumber
  }

  type Validator {
    networkId: String!
    operatorAddress: String
    consensusPubkey: String
    jailed: Boolean
    details: String
    website: String
    identity: String
    moniker: String
    votingPower: String # TODO tokens / total tokens
    startHeight: Int # TODO
    uptimePercentage: String
    tokens: String
    commissionUpdateTime: String
    commission: String
    maxCommission: String
    maxChangeCommission: String
    commissionLastUpdate: String
    height: Int # TODO
    status: ValidatorStatusEnum
    statusDetailed: String
    delegatorDelegation: String
    selfStake: String
    expectedReturns: String

    # Added
    name: String
    picture: String
  }

  type Block {
    networkId: String!
    height: Int
    hash: String
    chainId: String
    time: String
    numTxs: Int
    proposer_address: String
  }

  type Maintenance {
    id: Int!
    message: String
    show: Boolean
    type: String
  }

  type Network {
    id: String
    title: String
    chain_id: String
    rpc_url: String
    api_url: String
    bech32_prefix: String
    testnet: Boolean
    feature_session: Boolean
    feature_portfolio: Boolean
    feature_validators: Boolean
    feature_proposals: Boolean
    feature_activity: Boolean
    feature_explorer: Boolean
    action_send: Boolean
    action_claim_rewards: Boolean
    action_delegate: Boolean
    action_redelegate: Boolean
    action_undelegate: Boolean
    action_deposit: Boolean
    action_vote: Boolean
    action_proposal: Boolean
    experimental: Boolean
  }

  type Delegation {
    delegatorAddress: String!
    amount: String!
    validator: Validator
  }

  type Undelegation {
    delegatorAddress: String!
    validator: Validator
    amount: String!
    startHeight: String!
    endTime: String!
  }

  type Transaction {
    type: String!
    hash: String!
    height: Int!
    group: String!
    timestamp: String!
    gasUsed: Int
    gasWanted: Int
    success: Boolean
    log: String
    memo: String
    fee: Coin
    signature: String!
    value: String!
    amount: String
  }

  type GovernanceParameters {
    depositDenom: String
    votingThreshold: Float
    vetoThreshold: Float
    depositThreshold: String # BigNumber
  }

  type Vote {
    option: String
  }

  type Overview {
    totalStake: String!
    liquidStake: String!
    totalRewards: String!
  }

  type BankTransaction {
    hash: String!
    height: Int!
    timestamp: String
    gasUsed: Int
    gasWanted: Int
    senderAddress: String!
    recipientAddress: String!
    amount: Coin
    success: Boolean
    log: String
    memo: String
    fee: Coin
    signature: String
  }

  type MetaData {
    stakingDenom: String!
  }

  type Subscription {
    blockAdded(networkId: String!): Block
  }

  type Query {
    block(networkId: String!, height: Int): Block
    proposal(networkId: String!, id: Int!): Proposal
    proposals(networkId: String!): [Proposal]
    validators(
      networkId: String!
      delegatorAddress: String
      all: Boolean
      query: String
    ): [Validator]
    vote(networkId: String!, proposalId: Int!, address: String!): Vote
    governanceParameters(networkId: String!): GovernanceParameters
    validator(networkId: String!, operatorAddress: String!): Validator
    networks: [Network]
    network(id: String): Network
    maintenance: [Maintenance]
    balance(networkId: String!, address: String!): [Coin]
    overview(networkId: String!, address: String!): Overview
    delegation(
      networkId: String!
      delegatorAddress: String!
      operatorAddress: String!
    ): Delegation
    delegations(networkId: String!, delegatorAddress: String!): [Delegation]
    undelegations(networkId: String!, delegatorAddress: String!): [Undelegation]
    bondedTokens(networkId: String!): String
    annualProvision(networkId: String!): String
    rewards(
      networkId: String!
      delegatorAddress: String!
      operatorAddress: String
    ): [Reward]
    metaData(networkId: String!): MetaData
    transactions(networkId: String!, address: String!): [Transaction]
  }
`

module.exports = typeDefs
