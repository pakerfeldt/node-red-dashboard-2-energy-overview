'use strict'

// Merge an incoming widget payload with the node's stored payload.
//
// The widget component (ui/components/UIEnergyOverview.vue) only *deactivates*
// a route when it receives an explicit `false` — a route key that is simply
// absent is left untouched. So on reset we cannot clear routes by omission
// (sending `{}`); we must switch every previously-stored route OFF explicitly.
// This module is the node-side single source of truth for that merge so it can
// be unit-tested without the Node-RED runtime. Node-only — not bundled into the
// browser UMD.

function mergePayload (storedPayload, incomingPayload, opts) {
	const reset = !!(opts && opts.reset)
	const bidirectional = (opts && opts.bidirectional) || {}

	storedPayload = (storedPayload && typeof storedPayload === 'object') ? storedPayload : {}
	incomingPayload = (incomingPayload && typeof incomingPayload === 'object') ? incomingPayload : {}

	const storedRoutes = storedPayload.routes || {}
	// Clone so we never mutate the caller's incoming object.
	const newRoutes = Object.assign({}, incomingPayload.routes || {})

	// Turning a bidirectional route ON implicitly turns its opposite OFF,
	// unless the opposite was set explicitly in the same message.
	Object.keys(newRoutes).forEach(function (routeName) {
		if (newRoutes[routeName] === true && bidirectional[routeName]) {
			const opposite = bidirectional[routeName]
			if (newRoutes[opposite] === undefined) {
				newRoutes[opposite] = false
			}
		}
	})

	let baseRoutes = {}
	if (reset) {
		// Switch every previously-stored route OFF explicitly so the component
		// actually deactivates them (rather than ignoring the absent keys).
		Object.keys(storedRoutes).forEach(function (routeName) {
			baseRoutes[routeName] = false
		})
	} else {
		baseRoutes = storedRoutes
	}

	const routes = Object.assign({}, baseRoutes, newRoutes)

	// On reset, stored labels are dropped and only the incoming labels apply.
	const storedLabels = reset ? {} : (storedPayload.labels || {})
	const newLabels = incomingPayload.labels || {}
	const labels = Object.assign({}, storedLabels, newLabels)

	return { routes: routes, labels: labels }
}

module.exports = { mergePayload: mergePayload }
