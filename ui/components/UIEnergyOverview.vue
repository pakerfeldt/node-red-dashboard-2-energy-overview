<template>
    <div class="ui-energy-overview-wrapper">
        <div class="canvas-wrapper">
            <img ref="baseImage" :src="imageUrl" alt="House" @load="onImageLoad" />
            <svg ref="overlay" preserveAspectRatio="xMidYMid meet">
                <defs>
                    <filter id="pulseBlur" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="2.0" />
                    </filter>
                </defs>
            </svg>
        </div>
    </div>
</template>

<script>
import { mapState } from 'vuex'

const DEFAULT_HOUSE_IMAGE = '/resources/node-red-dashboard-2-energy-overview/house.webp'

export default {
    name: 'UIEnergyOverview',
    inject: ['$socket', '$dataTracker'],
    props: {
        id: { type: String, required: true },
        props: { type: Object, default: () => ({}) },
        state: { type: Object, default: () => ({ enabled: false, visible: false }) }
    },
    data () {
        return {
            mounted: false,
            imageLoaded: false,
            animationFrameId: null,
            REF_WIDTH: 1056,
            REF_HEIGHT: 992,
            scaleFactor: 1,
            INACTIVE_ROUTE_COLOR: '#7a7b7e',
            DEFAULT_PULSE_COLOR: '#4dcbbf',
            pulses: {},
            labelLines: {},
            pulseGroups: {},


            defaultPulsePathsData: {
                solarToInverter: 'M 427 295 L 484 332 L 484 533',
                inverterToHome1: 'M 513 532 L 513 445 L 808 451 L 810 549',
                inverterToHome2: 'M 513 532 L 513 445 L 966 455',
                inverterToGrid: 'M 451 631 L 401 631 L 403 821 L 449 848',
                inverterToBattery: 'M 499 649 L 499 748 L 594 742',
                inverterToCar: 'M 451 604 L 389 608 L 253 599 L 253 654'
            },
            defaultLabelPathsData: {
                solar: { d: 'M 608 41 L 608 300', align: 'top', label: 'SOLAR' },
                home: { d: 'M 776 41 L 776 445', align: 'top', label: 'HOME' },
                grid: { d: 'M 448 850 L 448 921', align: 'bottom', label: 'GRID' },
                battery: { d: 'M 643 772 L 643 921', align: 'bottom', label: 'BATTERY' },
                car: { d: 'M 103 820 L 103 921', align: 'bottom', label: 'CAR' }
            },
            routes: {
                solarToInverter: {
                    group: 'solar',
                    reverse: false,
                    opposite: null
                },
                inverterToHome: {
                    group: 'home',
                    reverse: false,
                    opposite: null
                },
                inverterToGrid: {
                    group: 'grid',
                    reverse: false,
                    opposite: 'gridToInverter'
                },
                gridToInverter: {
                    group: 'grid',
                    reverse: true,
                    opposite: 'inverterToGrid'
                },
                inverterToBattery: {
                    group: 'battery',
                    reverse: false,
                    opposite: 'batteryToInverter'
                },
                batteryToInverter: {
                    group: 'battery',
                    reverse: true,
                    opposite: 'inverterToBattery'
                },
                inverterToCar: {
                    group: 'car',
                    reverse: false,
                    opposite: 'carToInverter'
                },
                carToInverter: {
                    group: 'car',
                    reverse: true,
                    opposite: 'inverterToCar'
                }
            }
        }
    },
    computed: {
        ...mapState('data', ['messages']),
        imageUrl () {
            const customImage = this.getProperty('image')
            return customImage || DEFAULT_HOUSE_IMAGE
        },
        pulseColor () {
            return this.getProperty('pulseColor') || this.DEFAULT_PULSE_COLOR
        },
        // Configurable base values
        BASE_SPEED_PX_PER_SEC () {
            return this.getProperty('animationSpeed') || 150
        },
        BASE_FADE_MS () {
            return this.getProperty('fadeTime') || 1600
        },
        BASE_TRAIL_LENGTH_PX () {
            return this.getProperty('trailLength') || 120
        },
        BASE_TRAIL_SPACING_PX () {
            return this.getProperty('trailSpacing') || 4
        },
        BASE_STROKE_WIDTH () {
            return this.getProperty('strokeWidth') || 3.2
        },
        BASE_LABEL_STROKE_WIDTH () {
            return 2.0
        },
        BASE_BLUR_STD_DEV () {
            return 2.0
        },
        labelFontSizes () {
            const defaultSizes = { value: 42, name: 32, sub: 32 }
            try {
                const custom = this.getProperty('labelFontSizes')
                return custom ? JSON.parse(custom) : defaultSizes
            } catch (e) {
                return defaultSizes
            }
        },
        labelSpacing () {
            const defaultSpacing = { textOffset: 16, valueLabelGap: 8, labelSubGap: 10 }
            try {
                const custom = this.getProperty('labelSpacing')
                return custom ? JSON.parse(custom) : defaultSpacing
            } catch (e) {
                return defaultSpacing
            }
        },
        // Scaled values
        SPEED_PX_PER_SEC () {
            return this.BASE_SPEED_PX_PER_SEC * this.scaleFactor
        },
        TRAIL_LENGTH_PX () {
            return this.BASE_TRAIL_LENGTH_PX * this.scaleFactor
        },
        TRAIL_SPACING_PX () {
            return this.BASE_TRAIL_SPACING_PX * this.scaleFactor
        },
        LABEL_VALUE_FONT_SIZE () {
            return this.labelFontSizes.value * this.scaleFactor
        },
        LABEL_NAME_FONT_SIZE () {
            return this.labelFontSizes.name * this.scaleFactor
        },
        LABEL_SUB_FONT_SIZE () {
            return this.labelFontSizes.sub * this.scaleFactor
        },
        LABEL_TEXT_OFFSET_X () {
            return this.labelSpacing.textOffset * this.scaleFactor
        },
        LABEL_VALUE_LABEL_GAP () {
            return this.labelSpacing.valueLabelGap * this.scaleFactor
        },
        LABEL_LABEL_SUB_GAP () {
            return this.labelSpacing.labelSubGap * this.scaleFactor
        },
        STROKE_WIDTH () {
            return this.BASE_STROKE_WIDTH * this.scaleFactor
        },
        LABEL_STROKE_WIDTH () {
            return this.BASE_LABEL_STROKE_WIDTH * this.scaleFactor
        },
        BLUR_STD_DEV () {
            return this.BASE_BLUR_STD_DEV * this.scaleFactor
        },
        TRAIL_MAX_DOTS () {
            return Math.floor(this.TRAIL_LENGTH_PX / this.TRAIL_SPACING_PX) + 1
        },
        parsedCustomPaths () {
            const customPathsJson = this.getProperty('customPaths')
            if (!customPathsJson || customPathsJson.trim() === '') {
                return null
            }
            try {
                const parsed = JSON.parse(customPathsJson)
                if (parsed.energyPaths && parsed.labels) {
                    return parsed
                }
                console.warn('[UIEnergyOverview] Custom paths missing required fields (energyPaths, labels), using defaults')
                return null
            } catch (e) {
                console.warn('[UIEnergyOverview] Invalid custom paths JSON, using defaults:', e.message)
                return null
            }
        },
        pulsePathsData () {
            const custom = this.parsedCustomPaths
            if (!custom) {
                return this.defaultPulsePathsData
            }

            const result = {}
            Object.entries(custom.energyPaths).forEach(([key, value]) => {
                if (Array.isArray(value)) {
                    value.forEach((path, index) => {
                        result[`${key}${index + 1}`] = path
                    })
                } else {
                    if (key === 'inverterToHome') {
                        result.inverterToHome1 = value
                    } else {
                        result[key] = value
                    }
                }
            })
            return result
        },
        labelPathsData () {
            const custom = this.parsedCustomPaths
            if (!custom) {
                return this.defaultLabelPathsData
            }

            const result = {}
            Object.entries(custom.labels).forEach(([key, value]) => {
                result[key] = {
                    d: value.position || value.d,
                    align: value.align || 'top',
                    label: value.text || value.label || key.toUpperCase()
                }
            })
            return result
        }
    },
    created () {
        this.$dataTracker(this.id, this.onInput, this.onLoad, this.onDynamicProperties)
    },
    mounted () {
        this.mounted = true
        this.$nextTick(() => {
            if (this.$refs.baseImage && this.$refs.baseImage.complete) {
                this.onImageLoad()
            }
        })
    },
    unmounted () {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId)
        }
    },
    methods: {
        onInput (msg) {
            if (!msg) return

            this.$store.commit('data/bind', {
                widgetId: this.id,
                msg
            })

            if (!this.imageLoaded) {
                this.waitForImageAndHandleMessage(msg)
                return
            }

            this.handleMessage(msg)
        },
        async waitForImageAndHandleMessage (msg) {
            // Wait for image to load with proper promise-based approach
            try {
                await this.ensureImageLoaded()
                if (this.imageLoaded) {
                    this.handleMessage(msg)
                }
            } catch (error) {
                console.error('[UIEnergyOverview] Failed to wait for image load:', error)
                // Fallback: try to handle message anyway
                this.handleMessage(msg)
            }
        },
        ensureImageLoaded () {
            return new Promise((resolve, reject) => {
                if (this.imageLoaded) {
                    resolve()
                    return
                }

                const img = this.$refs.baseImage
                if (!img) {
                    reject(new Error('Image element not found'))
                    return
                }

                if (img.complete) {
                    this.onImageLoad()
                    resolve()
                    return
                }

                const timeout = setTimeout(() => {
                    img.removeEventListener('load', onLoad)
                    img.removeEventListener('error', onError)
                    reject(new Error('Image load timeout'))
                }, 5000) // 5 second timeout

                const onLoad = () => {
                    clearTimeout(timeout)
                    img.removeEventListener('load', onLoad)
                    img.removeEventListener('error', onError)
                    this.onImageLoad()
                    resolve()
                }

                const onError = () => {
                    clearTimeout(timeout)
                    img.removeEventListener('load', onLoad)
                    img.removeEventListener('error', onError)
                    reject(new Error('Image failed to load'))
                }

                img.addEventListener('load', onLoad)
                img.addEventListener('error', onError)
            })
        },
        onLoad (msg) {
            if (msg) {
                this.onInput(msg)
            }
        },
        onDynamicProperties (msg) {
            const updates = msg.ui_update
            if (!updates) return

            if (typeof updates.pulseColor !== 'undefined') {
                this.setDynamicProperties({ pulseColor: updates.pulseColor })
                this.updatePulseColors()
            }
            if (typeof updates.image !== 'undefined') {
                this.setDynamicProperties({ image: updates.image })
            }
        },
        updatePulseColors () {
            Object.values(this.pulses).forEach(p => {
                p.circles.forEach(c => {
                    c.setAttribute('fill', this.pulseColor)
                })
            })
            Object.values(this.labelLines).forEach(entry => {
                if (entry.subEl) {
                    entry.subEl.setAttribute('fill', this.pulseColor)
                }
            })
        },
        onImageLoad () {
            const img = this.$refs.baseImage
            const svg = this.$refs.overlay
            if (!img || !svg || this.imageLoaded) return

            const w = img.naturalWidth
            const h = img.naturalHeight

            const scaleX = w / this.REF_WIDTH
            const scaleY = h / this.REF_HEIGHT
            this.scaleFactor = (scaleX + scaleY) / 2

            svg.setAttribute('viewBox', `0 0 ${w} ${h}`)

            const blurFilter = svg.querySelector('#pulseBlur feGaussianBlur')
            if (blurFilter) {
                blurFilter.setAttribute('stdDeviation', this.BLUR_STD_DEV.toFixed(1))
            }

            this.imageLoaded = true

            this.$nextTick(() => {
                this.initializePulses(svg)
                this.createLabelLines(svg)
                this.configureGlobalTiming()
                this.startAnimationLoop()

                const storedMsg = this.messages && this.messages[this.id]
                if (storedMsg) {
                    this.handleMessage(storedMsg)
                }
            })
        },
        startAnimationLoop () {
            const animate = (time) => {
                try {
                    this.animatePulsesFrame(time)
                    this.animationFrameId = requestAnimationFrame(animate)
                } catch (error) {
                    console.error('[UIEnergyOverview] Animation frame error:', error)
                    // Stop animation loop on error to prevent infinite error spam
                    if (this.animationFrameId) {
                        cancelAnimationFrame(this.animationFrameId)
                        this.animationFrameId = null
                    }
                }
            }
            this.animationFrameId = requestAnimationFrame(animate)
        },
        handleMessage (msg) {
            const payload = msg.payload || {}
            const routes = payload.routes || {}
            const labels = payload.labels || {}

            Object.keys(this.routes).forEach(routeName => {
                if (routes[routeName] === true) {
                    this.activateRoute(routeName)
                } else if (routes[routeName] === false) {
                    this.deactivateRoute(routeName)
                }
            })

            Object.keys(labels).forEach(name => {
                const label = labels[name]
                if (label.value !== undefined) {
                    this.setLineValue(name, label.value)
                }
                if (label.sublabel !== undefined) {
                    this.setLineSubLabel(name, label.sublabel)
                }
            })
        },
        activateRoute (routeName) {
            const route = this.routes[routeName]
            if (!route) return

            if (route.opposite) {
                this.deactivateRoute(route.opposite)
            }

            const group = this.pulseGroups[route.group]
            if (!group) return

            const now = performance.now()
            group.forEach(p => {
                p.reverse = route.reverse
                p.active = true
                p.cycleStart = now
                p.globalAlpha = 1
            })
        },
        deactivateRoute (routeName) {
            const route = this.routes[routeName]
            if (!route) return

            const group = this.pulseGroups[route.group]
            if (!group) return

            group.forEach(p => {
                p.active = false
                p.cycleStart = null
                p.circles.forEach(c => c.setAttribute('visibility', 'hidden'))
            })
        },
        scalePath (pathData) {
            return pathData.replace(/(-?\d+\.?\d*)/g, (match) => {
                return (parseFloat(match) * this.scaleFactor).toFixed(1)
            })
        },
        initializePulses (svg) {
            const svgNS = 'http://www.w3.org/2000/svg'

            Object.entries(this.pulsePathsData).forEach(([name, d]) => {
                const path = document.createElementNS(svgNS, 'path')
                path.setAttribute('d', this.scalePath(d))
                path.setAttribute('stroke', this.INACTIVE_ROUTE_COLOR)
                path.setAttribute('stroke-opacity', '0.6')
                path.setAttribute('stroke-width', this.STROKE_WIDTH.toFixed(1))
                path.setAttribute('fill', 'none')
                svg.appendChild(path)
                this.pulses[name] = this.createPulseForPath(path, svg, svgNS)
            })

            this.pulseGroups.solar = [this.pulses.solarToInverter].filter(Boolean)
            
            const homePaths = Object.keys(this.pulses)
                .filter(name => name.startsWith('inverterToHome'))
                .map(name => this.pulses[name])
                .filter(Boolean)
            this.pulseGroups.home = homePaths.length > 0 ? homePaths : []
            
            this.pulseGroups.grid = [this.pulses.inverterToGrid].filter(Boolean)
            this.pulseGroups.battery = [this.pulses.inverterToBattery].filter(Boolean)
            this.pulseGroups.car = [this.pulses.inverterToCar].filter(Boolean)
        },
        createPulseForPath (path, svg, svgNS) {
            const length = path.getTotalLength()
            const group = document.createElementNS(svgNS, 'g')
            group.setAttribute('filter', 'url(#pulseBlur)')
            svg.appendChild(group)

            const maxDotsForPath = Math.floor(length / this.TRAIL_SPACING_PX) + 1
            const trailCount = Math.min(this.TRAIL_MAX_DOTS, maxDotsForPath)
            const circles = []

            for (let i = 0; i < trailCount; i++) {
                const circle = document.createElementNS(svgNS, 'circle')
                circle.setAttribute('r', (this.STROKE_WIDTH * 1.1).toFixed(1))
                circle.setAttribute('fill', this.pulseColor)
                circle.setAttribute('fill-opacity', '0')
                circle.setAttribute('visibility', 'hidden')
                group.appendChild(circle)
                circles.push(circle)
            }

            const speed = this.SPEED_PX_PER_SEC
            const travelDuration = (length / speed) * 1000

            return {
                path,
                length,
                group,
                circles,
                trailCount,
                trailSpacingPx: this.TRAIL_SPACING_PX,
                active: false,
                reverse: false,
                speed,
                fadeDuration: this.BASE_FADE_MS,
                travelDuration,
                globalCycleDuration: 0,
                idleDuration: 0,
                cycleStart: null,
                globalAlpha: 1
            }
        },
        configureGlobalTiming () {
            const pulseValues = Object.values(this.pulses)
            if (pulseValues.length === 0) return
            const maxTravel = Math.max(...pulseValues.map(p => p.travelDuration))
            const globalCycleDuration = maxTravel + this.BASE_FADE_MS
            pulseValues.forEach(p => {
                p.globalCycleDuration = globalCycleDuration
                p.fadeDuration = this.BASE_FADE_MS // Update fade duration to current config
                const activeTime = p.travelDuration + p.fadeDuration
                p.idleDuration = Math.max(0, globalCycleDuration - activeTime)
            })
        },
        animatePulsesFrame (time) {
            Object.values(this.pulses).forEach(p => {
                if (!p.active) {
                    p.circles.forEach(c => c.setAttribute('visibility', 'hidden'))
                    return
                }

                if (p.cycleStart === null) {
                    p.cycleStart = time
                }

                const elapsed = time - p.cycleStart
                const localElapsed = elapsed % p.globalCycleDuration
                let progress
                let phase = 'idle'

                if (localElapsed < p.travelDuration) {
                    phase = 'travel'
                    progress = localElapsed / p.travelDuration
                    p.globalAlpha = 1
                } else if (localElapsed < p.travelDuration + p.fadeDuration) {
                    phase = 'fade'
                    progress = 1
                    const fadeElapsed = localElapsed - p.travelDuration
                    p.globalAlpha = Math.max(0, 1 - (fadeElapsed / p.fadeDuration))
                } else {
                    phase = 'idle'
                    progress = 0
                    p.globalAlpha = 0
                }

                if (phase === 'idle' || p.globalAlpha <= 0.01) {
                    p.circles.forEach(c => c.setAttribute('visibility', 'hidden'))
                    return
                }

                const tipForward = p.reverse ? (1 - progress) : progress
                const tipPos = p.length * tipForward

                for (let i = 0; i < p.trailCount; i++) {
                    const circle = p.circles[i]
                    const backOffset = i * p.trailSpacingPx
                    const pos = p.reverse ? tipPos + backOffset : tipPos - backOffset

                    if (pos < 0 || pos > p.length) {
                        circle.setAttribute('visibility', 'hidden')
                        continue
                    }

                    const pt = p.path.getPointAtLength(pos)
                    circle.setAttribute('cx', pt.x)
                    circle.setAttribute('cy', pt.y)
                    circle.setAttribute('visibility', 'visible')

                    const baseOpacity = 1 - i / p.trailCount
                    circle.setAttribute('fill-opacity', (baseOpacity * p.globalAlpha).toFixed(3))
                }
            })
        },
        createLabelLines (svg) {
            const svgNS = 'http://www.w3.org/2000/svg'

            Object.entries(this.labelPathsData).forEach(([name, cfg]) => {
                const path = document.createElementNS(svgNS, 'path')
                path.setAttribute('d', this.scalePath(cfg.d))
                path.setAttribute('stroke', this.INACTIVE_ROUTE_COLOR)
                path.setAttribute('stroke-opacity', '0.7')
                path.setAttribute('stroke-width', this.LABEL_STROKE_WIDTH.toFixed(1))
                path.setAttribute('fill', 'none')
                svg.appendChild(path)

                const length = path.getTotalLength()
                const p0 = path.getPointAtLength(0)
                const p1 = path.getPointAtLength(length)
                const topPoint = p0.y <= p1.y ? p0 : p1
                const bottomPoint = p0.y <= p1.y ? p1 : p0
                const rightX = Math.max(p0.x, p1.x) + this.LABEL_TEXT_OFFSET_X

                const valueText = document.createElementNS(svgNS, 'text')
                valueText.setAttribute('fill', '#ffffff')
                valueText.setAttribute('text-anchor', 'start')
                valueText.setAttribute('font-size', this.LABEL_VALUE_FONT_SIZE.toFixed(1))
                valueText.setAttribute('font-family', 'system-ui, -apple-system, sans-serif')

                const nameText = document.createElementNS(svgNS, 'text')
                nameText.setAttribute('fill', '#7d7f82')
                nameText.setAttribute('text-anchor', 'start')
                nameText.setAttribute('font-size', this.LABEL_NAME_FONT_SIZE.toFixed(1))
                nameText.setAttribute('font-family', 'system-ui, -apple-system, sans-serif')
                nameText.setAttribute('letter-spacing', (1 * this.scaleFactor).toFixed(1))
                nameText.textContent = cfg.label || name.toUpperCase()

                const subText = document.createElementNS(svgNS, 'text')
                subText.setAttribute('fill', this.pulseColor)
                subText.setAttribute('text-anchor', 'start')
                subText.setAttribute('font-size', this.LABEL_SUB_FONT_SIZE.toFixed(1))
                subText.setAttribute('font-family', 'system-ui, -apple-system, sans-serif')
                subText.setAttribute('display', 'none')

                if (cfg.align === 'top') {
                    valueText.setAttribute('dominant-baseline', 'hanging')
                    nameText.setAttribute('dominant-baseline', 'hanging')
                    subText.setAttribute('dominant-baseline', 'hanging')
                    const valueY = topPoint.y
                    const labelY = valueY + this.LABEL_VALUE_FONT_SIZE + this.LABEL_VALUE_LABEL_GAP
                    const subY = labelY + this.LABEL_NAME_FONT_SIZE + this.LABEL_LABEL_SUB_GAP
                    valueText.setAttribute('x', rightX.toFixed(1))
                    valueText.setAttribute('y', valueY.toFixed(1))
                    nameText.setAttribute('x', rightX.toFixed(1))
                    nameText.setAttribute('y', labelY.toFixed(1))
                    subText.setAttribute('x', rightX.toFixed(1))
                    subText.setAttribute('y', subY.toFixed(1))
                } else {
                    nameText.setAttribute('dominant-baseline', 'auto')
                    valueText.setAttribute('dominant-baseline', 'auto')
                    subText.setAttribute('dominant-baseline', 'hanging')
                    const labelBottomY = bottomPoint.y
                    const valueBottomY = labelBottomY - (this.LABEL_VALUE_LABEL_GAP + this.LABEL_NAME_FONT_SIZE)
                    const subTopY = labelBottomY + this.LABEL_LABEL_SUB_GAP
                    nameText.setAttribute('x', rightX.toFixed(1))
                    nameText.setAttribute('y', labelBottomY.toFixed(1))
                    valueText.setAttribute('x', rightX.toFixed(1))
                    valueText.setAttribute('y', valueBottomY.toFixed(1))
                    subText.setAttribute('x', rightX.toFixed(1))
                    subText.setAttribute('y', subTopY.toFixed(1))
                }

                svg.appendChild(valueText)
                svg.appendChild(nameText)
                svg.appendChild(subText)

                this.labelLines[name] = {
                    path,
                    valueEl: valueText,
                    labelEl: nameText,
                    subEl: subText
                }
            })
        },
        setLineValue (name, valueText) {
            const entry = this.labelLines[name]
            if (!entry) return
            entry.valueEl.textContent = valueText
        },
        setLineSubLabel (name, text) {
            const entry = this.labelLines[name]
            if (!entry) return
            if (text == null || text === '') {
                entry.subEl.textContent = ''
                entry.subEl.setAttribute('display', 'none')
            } else {
                entry.subEl.textContent = text
                entry.subEl.setAttribute('display', '')
            }
        },
        getProperty (key) {
            // Get property from props, state, or config
            if (this.state && this.state[key] !== undefined) {
                return this.state[key]
            }
            if (this.props && this.props[key] !== undefined) {
                return this.props[key]
            }
            return undefined
        },
        setDynamicProperties (updates) {
            // Update dynamic properties - this would be called by the parent component
            Object.keys(updates).forEach(key => {
                if (this.state) {
                    this.$set(this.state, key, updates[key])
                }
            })
        }
    }
}
</script>

<style scoped>
@import "../stylesheets/ui-energy-overview.css";
</style>
