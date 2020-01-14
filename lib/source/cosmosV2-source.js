const CosmosV0API = require('./cosmosV0-source')
const { uniqWith, sortBy, reverse } = require('lodash')

class CosmosV2API extends CosmosV0API {
  setReducers() {
    this.reducers = require('../reducers/cosmosV2-reducers')
  }

  async query(url) {
    const response = await this.get(url)
    return response.result
  }

  async getValidatorSigningInfos() {
    const signingInfos = await this.query(`slashing/signing_infos`)
    return signingInfos
  }

  async getTransactions(address) {
    this.checkAddress(address)
    const pagination = `&limit=${1000000000}`

    const txs = await Promise.all([
      this.get(`/txs?message.sender=${address}${pagination}`).then(
        ({ txs }) => txs
      ),
      this.get(`/txs?transfer.recipient=${address}${pagination}`).then(
        ({ txs }) => txs
      )
    ]).then(([senderTxs, recipientTxs]) => [].concat(senderTxs, recipientTxs))

    const dupFreeTxs = uniqWith(txs, (a, b) => a.txhash === b.txhash)
    const sortedTxs = sortBy(dupFreeTxs, ['timestamp'])
    const reversedTxs = reverse(sortedTxs)
    return reversedTxs.map(tx =>
      this.reducers.transactionReducer(tx, this.reducers)
    )
  }

  extractInvolvedAddresses(transaction) {
    // If the transaction has failed, it doesn't get tagged
    if (!Array.isArray(transaction.events)) return []

    // extract all addresses from events that are either sender or recipient
    const involvedAddresses = transaction.events.reduce(
      (involvedAddresses, event) => {
        const senderAttribute = event.attributes.find(
          ({ key }) => key === 'sender'
        )
        if (senderAttribute) {
          involvedAddresses.push(senderAttribute.value)
        }

        const recipientAttribute = event.attributes.find(
          ({ key }) => key === 'recipient'
        )
        if (recipientAttribute) {
          involvedAddresses.push(recipientAttribute.value)
        }

        return involvedAddresses
      },
      []
    )
    return involvedAddresses
  }

  async getTransactionsByHeight(height) {
    const { txs } = await this.get(`txs?tx.height=${height}`)
    return Array.isArray(txs)
      ? txs.map(transaction =>
          this.reducers.transactionReducer(transaction, this.reducers)
        )
      : []
  }

  async getRewards(delegatorAddress, validatorsDictionary) {
    this.checkAddress(delegatorAddress)
    const result = await this.query(
      `distribution/delegators/${delegatorAddress}/rewards`
    )
    return (result.rewards || [])
      .filter(({ reward }) => reward && reward.length > 0)
      .map(({ reward, validator_address }) =>
        this.reducers.rewardReducer(
          reward[0],
          validatorsDictionary[validator_address]
        )
      )
  }
}

module.exports = CosmosV2API
