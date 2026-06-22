'use strict'

// Single source of truth for the widget's hub-and-spoke topology.
// Loaded by the Node-RED node via require(), and bundled into the UMD by Vite
// when the Vue component imports it. Plain CommonJS, Node >=14 compatible.

// The built-in entity set. Providing a custom `entities` block REPLACES this.
var DEFAULT_ENTITIES = {
	solar: { direction: 'source' },
	home: { direction: 'sink' },
	grid: { direction: 'both' },
	battery: { direction: 'both' },
	car: { direction: 'both' }
}

var VALID_DIRECTIONS = ['source', 'sink', 'both']
var RESERVED_NAMES = ['inverter']
var NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/

function capitalize (name) {
	return name.charAt(0).toUpperCase() + name.slice(1)
}

// Route-key conventions (must match the original hardcoded routes):
//   source -> "<name>ToInverter", sink -> "inverterTo<Name>", both -> both.
function toInverterKey (name) {
	return name + 'ToInverter'
}
function fromInverterKey (name) {
	return 'inverterTo' + capitalize(name)
}

// Derive routes, pulse-group keys, and the bidirectional map from an entity set.
function deriveTopology (entities) {
	var routes = {}
	var pulseGroupKeys = {}
	var bidirectional = {}

	Object.keys(entities).forEach(function (name) {
		var direction = entities[name] && entities[name].direction
		var toInv = toInverterKey(name)
		var fromInv = fromInverterKey(name)

		if (direction === 'source') {
			routes[toInv] = { group: name, reverse: false, opposite: null }
			pulseGroupKeys[name] = toInv
		} else if (direction === 'sink') {
			routes[fromInv] = { group: name, reverse: false, opposite: null }
			pulseGroupKeys[name] = fromInv
		} else if (direction === 'both') {
			routes[fromInv] = { group: name, reverse: false, opposite: toInv }
			routes[toInv] = { group: name, reverse: true, opposite: fromInv }
			pulseGroupKeys[name] = fromInv
			bidirectional[fromInv] = toInv
			bidirectional[toInv] = fromInv
		}
	})

	return { routes: routes, pulseGroupKeys: pulseGroupKeys, bidirectional: bidirectional }
}

// Map actual pulse path keys to their entity group. A group's forward key matches
// either an exact pulse key or that key followed by a numeric suffix
// (e.g. "inverterToHome" -> "inverterToHome1", "inverterToHome2").
function matchPulseGroups (pulseNames, pulseGroupKeys) {
	var groups = {}
	Object.keys(pulseGroupKeys).forEach(function (entity) {
		var forwardKey = pulseGroupKeys[entity]
		groups[entity] = pulseNames.filter(function (name) {
			if (name === forwardKey) return true
			if (name.indexOf(forwardKey) === 0) {
				return /^\d+$/.test(name.slice(forwardKey.length))
			}
			return false
		})
	})
	return groups
}

// Validate a raw `entities` object. Returns { valid, errors }.
function validateEntities (entities) {
	var errors = []
	if (typeof entities !== 'object' || entities === null || Array.isArray(entities)) {
		return { valid: false, errors: ['entities must be an object'] }
	}
	var names = Object.keys(entities)
	if (names.length === 0) {
		return { valid: false, errors: ['entities must declare at least one entity'] }
	}
	var seenRoutes = {}
	names.forEach(function (name) {
		if (!NAME_RE.test(name)) {
			errors.push('Invalid entity name "' + name + '" (letters, digits, underscore; must start with a letter)')
		}
		if (RESERVED_NAMES.indexOf(name.toLowerCase()) !== -1) {
			errors.push('Reserved entity name "' + name + '"')
		}
		var entity = entities[name]
		var direction = entity && entity.direction
		if (VALID_DIRECTIONS.indexOf(direction) === -1) {
			errors.push('Entity "' + name + '" has invalid direction "' + direction + '" (expected source, sink or both)')
			return
		}
		var keys = direction === 'source'
			? [toInverterKey(name)]
			: direction === 'sink'
				? [fromInverterKey(name)]
				: [fromInverterKey(name), toInverterKey(name)]
		keys.forEach(function (k) {
			if (seenRoutes[k]) {
				errors.push('Duplicate route "' + k + '" from entities "' + seenRoutes[k] + '" and "' + name + '"')
			} else {
				seenRoutes[k] = name
			}
		})
	})
	return { valid: errors.length === 0, errors: errors }
}

// Parse the customPaths JSON string and return a validated `entities` object,
// or null to signal "fall back to DEFAULT_ENTITIES".
function parseEntities (customPathsString) {
	if (!customPathsString || typeof customPathsString !== 'string' || customPathsString.trim() === '') {
		return null
	}
	var parsed
	try {
		parsed = JSON.parse(customPathsString)
	} catch (e) {
		return null
	}
	if (!parsed || typeof parsed !== 'object' || !parsed.entities) {
		return null
	}
	if (!validateEntities(parsed.entities).valid) {
		return null
	}
	return parsed.entities
}

var api = {
	DEFAULT_ENTITIES: DEFAULT_ENTITIES,
	deriveTopology: deriveTopology,
	matchPulseGroups: matchPulseGroups,
	validateEntities: validateEntities,
	parseEntities: parseEntities,
	capitalize: capitalize,
	toInverterKey: toInverterKey,
	fromInverterKey: fromInverterKey
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = api
}
if (typeof window !== 'undefined') {
	window.Topology = api
}
