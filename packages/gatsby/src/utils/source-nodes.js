const report = require(`gatsby-cli/lib/reporter`)

const apiRunner = require(`./api-runner-node`)
const { store } = require(`../redux`)
const { getNode, getNodes } = require(`../db/nodes`)
const { boundActionCreators } = require(`../redux/actions`)
const { deleteNode } = boundActionCreators

/**
 * Finds the name of all plugins which implement Gatsby APIs that
 * may create nodes, but which have not actually created any nodes.
 */
function discoverPluginsWithoutNodes(storeState) {
  // Find out which plugins own already created nodes
  const nodeOwnerSet = new Set([`default-site-plugin`])
  getNodes().forEach(node => nodeOwnerSet.add(node.internal.owner))

  return storeState.flattenedPlugins
    .filter(
      plugin =>
        // "Can generate nodes"
        plugin.nodeAPIs.includes(`sourceNodes`) &&
        // "Has not generated nodes"
        !nodeOwnerSet.has(plugin.name)
    )
    .map(plugin => plugin.name)
}

module.exports = async ({ webhookBody = {}, parentSpan } = {}) => {
  await apiRunner(`sourceNodes`, {
    traceId: `initial-sourceNodes`,
    waitForCascadingActions: true,
    parentSpan,
    webhookBody,
  })

  const state = store.getState()

  // Warn about plugins that should have created nodes but didn't.
  const pluginsWithNoNodes = discoverPluginsWithoutNodes(state)
  pluginsWithNoNodes.map(name =>
    report.warn(
      `The ${name} plugin has generated no Gatsby nodes. Do you need it?`
    )
  )

  // Garbage collect stale data nodes
  const staleNodes = getNodes().filter(node => {
    let rootNode = node
    let whileCount = 0
    while (
      rootNode.parent &&
      getNode(rootNode.parent) !== undefined &&
      whileCount < 101
    ) {
      rootNode = getNode(rootNode.parent)
      whileCount += 1
      if (whileCount > 100) {
        console.log(
          `It looks like you have a node that's set its parent as itself`,
          rootNode
        )
      }
    }

    return !state.nodesTouched.has(rootNode.id)
  })

  if (staleNodes.length > 0) {
    staleNodes.forEach(node => deleteNode({ node }))
  }
}
