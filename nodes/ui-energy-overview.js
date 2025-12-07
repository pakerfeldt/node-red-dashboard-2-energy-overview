module.exports = function (RED) {
    /**
     * Validates and clamps a numeric value to a specified range
     * @param {*} value - The value to validate
     * @param {number} min - Minimum allowed value
     * @param {number} max - Maximum allowed value
     * @param {number} defaultValue - Default value if validation fails
     * @returns {{valid: boolean, value: number}} Validation result with clamped value
     */
    function validateNumericRange (value, min, max, defaultValue) {
        const num = parseFloat(value)
        if (isNaN(num)) {
            return { valid: false, value: defaultValue }
        }
        return { valid: true, value: Math.min(Math.max(num, min), max) }
    }

    /**
     * Validates a color string (hex format)
     * @param {*} value - The color value to validate
     * @returns {boolean} True if valid hex color
     */
    function isValidColor (value) {
        if (typeof value !== 'string') return false
        return /^#([0-9A-Fa-f]{3}){1,2}$/.test(value)
    }

    /**
     * Validates an image URL or path
     * @param {*} value - The image URL/path to validate
     * @returns {boolean} True if valid
     */
    function isValidImageUrl (value) {
        if (typeof value !== 'string') return false
        // Allow empty string (resets to default), relative paths, and URLs
        if (value === '') return true
        // Basic URL/path validation - allows http(s), data URIs, and relative paths
        return /^(https?:\/\/|data:image\/|\/|\.?\/)/.test(value) || 
               /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(value)
    }

    // Animation settings validation rules (matching the HTML configuration)
    const VALIDATION_RULES = {
        animationSpeed: { min: 50, max: 500, default: 150 },
        trailLength: { min: 50, max: 300, default: 120 },
        trailSpacing: { min: 1, max: 20, default: 4 },
        fadeTime: { min: 500, max: 3000, default: 1600 },
        strokeWidth: { min: 1, max: 10, default: 3.2 }
    }

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
                    // Validate and set pulseColor
                    if (typeof updates.pulseColor !== 'undefined') {
                        if (isValidColor(updates.pulseColor)) {
                            base.stores.state.set(base, node, msg, 'pulseColor', updates.pulseColor)
                        } else {
                            node.warn(`Invalid pulseColor value: ${updates.pulseColor}. Expected hex color (e.g., #4dcbbf)`)
                        }
                    }

                    // Validate and set image
                    if (typeof updates.image !== 'undefined') {
                        if (isValidImageUrl(updates.image)) {
                            base.stores.state.set(base, node, msg, 'image', updates.image)
                        } else {
                            node.warn(`Invalid image value: ${updates.image}. Expected URL or path to image`)
                        }
                    }

                    // Validate and set numeric animation settings
                    Object.keys(VALIDATION_RULES).forEach(function (key) {
                        if (typeof updates[key] !== 'undefined') {
                            const rule = VALIDATION_RULES[key]
                            const result = validateNumericRange(updates[key], rule.min, rule.max, rule.default)
                            if (result.valid) {
                                base.stores.state.set(base, node, msg, key, result.value)
                            } else {
                                node.warn(`Invalid ${key} value: ${updates[key]}. Expected number between ${rule.min} and ${rule.max}`)
                            }
                        }
                    })
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
