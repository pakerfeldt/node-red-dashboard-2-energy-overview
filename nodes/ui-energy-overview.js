module.exports = function (RED) {
    function UIEnergyOverviewNode (config) {
        RED.nodes.createNode(this, config)

        const node = this

        const group = RED.nodes.getNode(config.group)

        if (!group) {
            node.error('No group configured')
            return
        }

        const base = group.getBase()

        const evts = {
            onAction: true,
            beforeSend: function (msg) {
                const updates = msg.ui_update
                if (updates) {
                    if (typeof updates.pulseColor !== 'undefined') {
                        base.stores.state.set(base, node, msg, 'pulseColor', updates.pulseColor)
                    }
                    if (typeof updates.image !== 'undefined') {
                        base.stores.state.set(base, node, msg, 'image', updates.image)
                    }
                    if (typeof updates.animationSpeed !== 'undefined') {
                        base.stores.state.set(base, node, msg, 'animationSpeed', updates.animationSpeed)
                    }
                    if (typeof updates.trailLength !== 'undefined') {
                        base.stores.state.set(base, node, msg, 'trailLength', updates.trailLength)
                    }
                    if (typeof updates.trailSpacing !== 'undefined') {
                        base.stores.state.set(base, node, msg, 'trailSpacing', updates.trailSpacing)
                    }
                    if (typeof updates.fadeTime !== 'undefined') {
                        base.stores.state.set(base, node, msg, 'fadeTime', updates.fadeTime)
                    }
                    if (typeof updates.strokeWidth !== 'undefined') {
                        base.stores.state.set(base, node, msg, 'strokeWidth', updates.strokeWidth)
                    }
                }
                return msg
            },
            onInput: function (msg, send, done) {
                base.stores.data.save(base, node, msg)
                send(msg)
            },
            onSocket: {
            }
        }

        group.register(node, config, evts)
    }

    RED.nodes.registerType('ui-energy-overview', UIEnergyOverviewNode)
}
