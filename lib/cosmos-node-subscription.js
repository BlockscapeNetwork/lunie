const _ = require('lodash')
const Tendermint = require('./helpers/tendermint')
const {
  publishBlockAdded,
  publishUserTransactionAdded,
  publishEvent: publishEvent
} = require('./subscriptions')
const Sentry = require('@sentry/node')

const WAIT_FOR_BLOCK_DELAY = 5000

// This class establishes an rpc connection to Tendermint.
// Used for listening to events, such as new blocks.
class CosmosNodeSubscription {
  constructor(network, CosmosApiClass, store) {
    this.network = network
    this.cosmosAPI = new CosmosApiClass(network)
    this.store = store

    // Create a RPC subscription for each network that will react to new block events.
    Tendermint()
      .connect(this.network.rpc_url)
      .then(connectedClient => {
        connectedClient.subscribe({ query: "tm.event='NewBlock'" }, event =>
          setTimeout(
            () => this.newBlockHandler(event.block.header.height),
            WAIT_FOR_BLOCK_DELAY
          )
        )
      })

    this.newBlockHandler()
  }

  // For each block event, we fetch the block information and publish a message.
  // A GraphQL resolver is listening for these messages and sends the block to
  // each subscribed user.
  async newBlockHandler(height) {
    if (height) {
      Sentry.configureScope(function (scope) {
        scope.setExtra('height', height)
      })
    }

    const block = await this.cosmosAPI.getBlockByHeight({
      blockHeight: height
    })
    const validatorMap = await this.getLatestBlockData()
    this.store.update({ height, block, validators: validatorMap })
    publishBlockAdded(this.network.id, block)
    // TODO remove, only for demo purposes
    // publishEvent(this.network.id, 'block', '', block)

    // in the case of height being undefined to query for latest
    // eslint-disable-next-line require-atomic-updates
    height = block.height

    // For each transaction listed in a block we extract the relevant addresses. This is published to the network.
    // A GraphQL resolver is listening for these messages and sends the
    // transaction to each subscribed user.
    // TODO doesn't handle failing txs as it doesn't extract addresses from those txs (they are not tagged)
    block.transactions.forEach(tx => {
      let addresses = []
      try {
        this.cosmosAPI.extractInvolvedAddresses(tx.raw).forEach(address => {
          addresses.push(address)
        })
      } catch (err) {
        Sentry.withScope(function (scope) {
          scope.setExtra('transaction', tx.raw)
          Sentry.captureException(err)
        })
      }
      addresses = _.uniq(addresses)
      addresses.forEach(address => {
        publishUserTransactionAdded(this.network.id, address, tx)
        publishEvent(this.network.id, 'transaction', address, tx)
      })
    })

    this.cosmosAPI.clearMemory()
  }

  async getLatestBlockData() {
    const validators = await this.cosmosAPI.getAllValidators()
    const validatorMap = _.keyBy(validators, 'operatorAddress')
    return validatorMap
  }
}

module.exports = CosmosNodeSubscription
