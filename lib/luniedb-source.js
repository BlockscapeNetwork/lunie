const { RESTDataSource } = require('apollo-datasource-rest')
const config = require('../config')
const queries = require('./queries')

const testnet = {
  id: 'local-cosmos-hub-testnet',
  title: 'Local Cosmos Testnet',
  chain_id: 'testnet',
  rpc_url: 'http://localhost:26657',
  api_url: 'http://localhost:9071',
  bech32_prefix: 'cosmos',
  testnet: true,
  feature_session: true,
  feature_portfolio: true,
  feature_validators: true,
  feature_proposals: true,
  feature_activity: true,
  feature_explorer: true,
  action_send: true,
  action_claim_rewards: true,
  action_delegate: true,
  action_redelegate: true,
  action_undelegate: true,
  action_deposit: true,
  action_vote: true,
  action_proposal: true,
  experimental: true,
  stakingDenom: 'STAKE'
}

class LunieDBAPI extends RESTDataSource {
  constructor() {
    super()
    this.baseURL = config.hasura_url
  }

  async getData(type, selection = '') {
    const data = await this.post(
      '',
      {
        query:
          typeof queries[type] !== 'undefined' ? queries[type](selection) : ''
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-hasura-admin-secret': config.hasura_admin_key
        }
      }
    )
    if (data.errors) {
      throw new Error(data.errors.map(({ message }) => message).join('\n'))
    }
    return data.data[type]
  }

  async getNetworks() {
    const response = await this.getData('networks')

    if (config.enableTestnet) {
      response.push(testnet)
    }

    return response
  }

  async getNetwork(networkID) {
    if (networkID === testnet.id) return testnet

    const selection = networkID ? `(where: {id: {_eq: "${networkID}"}})` : ''
    const response = await this.getData('networks', selection)

    return response && response.length ? response[0] : false
  }

  async getMaintenance() {
    const response = await this.getData('maintenance')
    return response
  }

  async getValidatorInfoByAddress(validatorId, networkID) {
    if (networkID === 'local-cosmos-hub-testnet') {
      return []
    }

    const selection = networkID
      ? `(where: {operator_address: {_eq: "${validatorId}"}})`
      : ''
    return await this.getData(
      networkID.replace(/-/g, '_') + '_validatorprofiles',
      selection
    )
  }

  async getValidatorsInfo(networkID) {
    return await this.getData(
      networkID.replace('-', '_') + '_validatorprofiles'
    )
  }
}

module.exports = LunieDBAPI
