/* istanbul ignore file */

import gql from "graphql-tag"
import store from "../vuex/store"

function getCurrentNetwork() {
  // console.log(store())
  return store().state.connection.network
}

export const schemaMap = {
  cosmoshub: "",
  [`gaia-testnet`]: "gaia_testnet_",
  testnet: "gaia_testnet_",
}

export const ValidatorFragment = `
  name
  operatorAddress
  consensusPubkey
  jailed
  picture
  details
  website
  identity
  votingPower
  startHeight
  uptimePercentage
  tokens
  commissionUpdateTime
  commission
  maxCommission
  maxChangeCommission
  status
  statusDetailed
  expectedReturns
  selfStake
`

export const AllValidators = () => {
  const currentNetwork = getCurrentNetwork()
  // console.log(`currentNetwork`, currentNetwork)
  return gql`
    query AllValidators {
      validators(networkId: "${currentNetwork}") {
        ${ValidatorFragment}
      }
    }`
}

export const ValidatorProfile = gql`
  query validator($networkId: String!, $operatorAddress: String!) {
    validator(networkId: $networkId, operatorAddress: $operatorAddress) {
      ${ValidatorFragment}
    }
  }
`

export const DelegatorValidators = (schema) => gql`
  query ValidatorInfo($delegatorAddress: String!) {
    validators(networkId: "${schema}", delegatorAddress: $delegatorAddress) {
      ${ValidatorFragment}
    }
  }
`

export const DelegationsForDelegator = (schema) => gql`
  query Delegations($delegatorAddress: String!) {
    delegations(networkId: "${schema}", delegatorAddress: $delegatorAddress) {
      validator {
        ${ValidatorFragment}
      }
      amount
    }
  }
`

export const Networks = gql`
  query Networks {
    networks {
      id
      chain_id
      testnet
      title
      icon
      slug
      powered {
        name
        providerAddress
        picture
      }
    }
  }
`

// load all the data immediatly to avoid async loading later
export const NetworksAll = gql`
  query Networks($experimental: Boolean) {
    networks(experimental: $experimental) {
      id
      chain_id
      testnet
      title
      icon
      slug
      default
      powered {
        name
        providerAddress
        picture
      }
      feature_session
      feature_portfolio
      feature_validators
      feature_proposals
      feature_activity
      feature_explorer
      action_send
      action_claim_rewards
      action_delegate
      action_redelegate
      action_undelegate
      action_deposit
      action_vote
      action_proposal
      stakingDenom
      network_type
      address_creator
      address_prefix
      ledger_app
      testnet
      enabled
      coinLookup {
        chainDenom
        viewDenom
        chainToViewConversionFactor
      }
    }
  }
`

export const NetworksResult = (data) => data.networks

const ProposalFragment = `
  id
  type
  title
  description
  creationTime
  status
  statusBeginTime
  statusEndTime
  tally {
    yes
    no
    veto
    abstain
    total
    totalVotedPercentage
  }
  deposit
  proposer,
  validator {
    name
  }
`

export const ProposalItem = (schema) => gql`
  query proposal($id: Int!) {
    proposal(networkId: "${schema}", id: $id) {
      ${ProposalFragment}
    }
  }
`

export const GovernanceParameters = (schema) => gql`
query governanceParameters {
  governanceParameters(networkId: "${schema}") {
    depositDenom
    votingThreshold
    vetoThreshold
    depositThreshold
  }
}
`

export const Vote = (schema) => gql`
query vote($proposalId: Int!, $address: String!) {
  vote(networkId: "${schema}", proposalId: $proposalId, address: $address) {
    option
  }
}
`

export const Block = (networkId) => gql`
query Block {
  block(networkId: "${networkId}") {
    height
    chainId
  }
}
`

export const MetaData = (schema) => gql`
query metaData {
  metaData(networkId: "${schema}") {
    stakingDenom
  }
}
`

export const UserTransactionAdded = gql`
  subscription($networkId: String!, $address: String!) {
    userTransactionAddedV2(networkId: $networkId, address: $address) {
      hash
      height
      success
      log
    }
  }
`

export const NotificationAdded = gql`
  subscription($addressObjects: [NotificationInput]!) {
    notificationAdded(addressObjects: $addressObjects) {
      networkId
      timestamp
      title
      link
      icon
    }
  }
`

export const AddressRole = gql`
  query($networkId: String!, $address: String!) {
    accountRole(networkId: $networkId, address: $address)
  }
`