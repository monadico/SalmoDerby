// Enhanced Liquid Glass Effects for Galaxy Page
class LiquidGlassEffects {
  constructor() {
    this.elements = new Set()
    this.mousePosition = { x: 0, y: 0 }
    this.isActive = true
    this.performanceMode = "high" // high, medium, low

    this.init()
  }

  init() {
    this.bindEvents()
    this.setupMouseTracking()
    this.startEffectLoop()
    this.detectPerformance()
  }

  detectPerformance() {
    // Simple performance detection
    const start = performance.now()
    for (let i = 0; i < 100000; i++) {
      Math.random()
    }
    const end = performance.now()

    if (end - start > 10) {
      this.performanceMode = "low"
    } else if (end - start > 5) {
      this.performanceMode = "medium"
    }
  }

  bindEvents() {
    // Listen for performance frames
    window.addEventListener("performanceFrame", () => {
      if (this.isActive) {
        this.updateEffects()
      }
    })

    // Adjust performance based on visibility
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.performanceMode = "low"
      } else {
        this.detectPerformance()
      }
    })
  }

  setupMouseTracking() {
    let ticking = false

    const updateMousePosition = (e) => {
      if (!ticking) {
        requestAnimationFrame(() => {
          this.mousePosition.x = e.clientX
          this.mousePosition.y = e.clientY
          this.updateMouseEffects()
          ticking = false
        })
        ticking = true
      }
    }

    document.addEventListener("mousemove", updateMousePosition)
  }

  updateMouseEffects() {
    // Enhanced mouse-based liquid glass effects
    this.elements.forEach((config) => {
      if (config.followMouse && config.element) {
        this.updateMouseFollowEffect(config)
      }
    })
  }

  addElement(element, options = {}) {
    const config = {
      element,
      intensity: options.intensity || 1,
      followMouse: options.followMouse || false,
      morphing: options.morphing || false,
      holographic: options.holographic || false,
      liquidWave: options.liquidWave || false,
      ...options,
    }

    this.elements.add(config)
    this.setupElementEffects(config)
  }

  setupElementEffects(config) {
    const { element, followMouse, morphing, holographic, liquidWave } = config

    if (followMouse) {
      this.setupMouseFollowEffect(element)
    }

    if (morphing) {
      this.setupMorphingEffect(element)
    }

    if (holographic) {
      this.setupHolographicEffect(element)
    }

    if (liquidWave) {
      this.setupLiquidWaveEffect(element)
    }

    // Add enhanced liquid glass classes
    element.classList.add("liquid-glass-enhanced")

    // Add performance-based optimizations
    if (this.performanceMode === "low") {
      element.style.willChange = "transform"
    } else {
      element.style.willChange = "transform, filter, backdrop-filter"
    }
  }

  setupMouseFollowEffect(element) {
    const handleMouseMove = window.PerformanceManager?.throttle(
      (e) => {
        const rect = element.getBoundingClientRect()
        const centerX = rect.left + rect.width / 2
        const centerY = rect.top + rect.height / 2

        const deltaX = (e.clientX - centerX) / rect.width
        const deltaY = (e.clientY - centerY) / rect.height

        const intensity = this.performanceMode === "high" ? 12 : 8
        const rotateX = deltaY * intensity
        const rotateY = -deltaX * intensity

        element.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`

        // Enhanced gradient based on mouse position
        const gradientX = this.map(deltaX, -1, 1, 0, 100)
        const gradientY = this.map(deltaY, -1, 1, 0, 100)

        if (this.performanceMode !== "low") {
          element.style.background = `
          radial-gradient(circle at ${gradientX}% ${gradientY}%, 
            rgba(255, 255, 255, 0.25) 0%, 
            rgba(131, 110, 249, 0.15) 30%,
            rgba(32, 0, 82, 0.1) 60%,
            transparent 100%),
          ${element.dataset.originalBackground || ""}
        `
        }
      },
      this.performanceMode === "high" ? 16 : 32,
    )

    element.addEventListener("mousemove", handleMouseMove)

    element.addEventListener("mouseleave", () => {
      element.style.transform = ""
      if (element.dataset.originalBackground) {
        element.style.background = element.dataset.originalBackground
      }
    })

    element.addEventListener("mouseenter", () => {
      if (!element.dataset.originalBackground) {
        element.dataset.originalBackground = getComputedStyle(element).background
      }
    })
  }

  updateMouseFollowEffect(config) {
    const { element, intensity } = config
    const rect = element.getBoundingClientRect()

    // Check if mouse is near element
    const distance = Math.sqrt(
      Math.pow(this.mousePosition.x - (rect.left + rect.width / 2), 2) +
        Math.pow(this.mousePosition.y - (rect.top + rect.height / 2), 2),
    )

    if (distance < 200) {
      // Within influence range
      const influence = Math.max(0, 1 - distance / 200)
      const glowIntensity = influence * intensity

      if (this.performanceMode !== "low") {
        element.style.filter = `brightness(${1 + glowIntensity * 0.2}) saturate(${1 + glowIntensity * 0.3})`
        element.style.boxShadow = `0 0 ${20 * glowIntensity}px rgba(131, 110, 249, ${0.3 * glowIntensity})`
      }
    }
  }

  setupMorphingEffect(element) {
    let morphPhase = Math.random() * Math.PI * 2

    const updateMorph = () => {
      morphPhase += 0.015

      if (this.performanceMode === "low") return

      const borderRadius1 = 50 + Math.sin(morphPhase) * 8
      const borderRadius2 = 50 + Math.cos(morphPhase * 1.3) * 6
      const borderRadius3 = 50 + Math.sin(morphPhase * 0.8) * 10
      const borderRadius4 = 50 + Math.cos(morphPhase * 1.1) * 7

      element.style.borderRadius = `
        ${borderRadius1}% ${borderRadius2}% ${borderRadius3}% ${borderRadius4}% /
        ${borderRadius2}% ${borderRadius4}% ${borderRadius1}% ${borderRadius3}%
      `
    }

    element._morphUpdate = updateMorph
  }

  setupHolographicEffect(element) {
    let huePhase = Math.random() * 360

    const updateHolographic = () => {
      if (this.performanceMode === "low") return

      huePhase += this.performanceMode === "high" ? 1.5 : 0.8

      const hue1 = huePhase % 360
      const hue2 = (huePhase + 60) % 360
      const hue3 = (huePhase + 120) % 360

      element.style.background = `
        linear-gradient(45deg, 
          hsla(${hue1}, 70%, 60%, 0.12) 0%,
          hsla(${hue2}, 70%, 60%, 0.08) 50%,
          hsla(${hue3}, 70%, 60%, 0.12) 100%)
      `

      element.style.borderColor = `hsla(${hue1}, 70%, 60%, 0.4)`
    }

    element._holographicUpdate = updateHolographic
  }

  setupLiquidWaveEffect(element) {
    let wavePhase = Math.random() * Math.PI * 2

    const updateWave = () => {
      if (this.performanceMode === "low") return

      wavePhase += 0.02

      const translateX = Math.sin(wavePhase) * 2
      const translateY = Math.cos(wavePhase * 1.3) * 1.5
      const scale = 1 + Math.sin(wavePhase * 0.7) * 0.02

      element.style.transform = `translateX(${translateX}px) translateY(${translateY}px) scale(${scale})`
    }

    element._waveUpdate = updateWave
  }

  updateEffects() {
    this.elements.forEach((config) => {
      const { element, morphing, holographic, liquidWave } = config

      if (morphing && element._morphUpdate) {
        element._morphUpdate()
      }

      if (holographic && element._holographicUpdate) {
        element._holographicUpdate()
      }

      if (liquidWave && element._waveUpdate) {
        element._waveUpdate()
      }
    })
  }

  createRippleEffect(x, y, container) {
    const ripple = document.createElement("div")
    ripple.className = "liquid-ripple"

    const size = this.performanceMode === "high" ? 300 : 200
    const duration = this.performanceMode === "high" ? 1200 : 800

    ripple.style.cssText = `
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      width: 0;
      height: 0;
      border-radius: 50%;
      background: radial-gradient(circle, 
        rgba(131, 110, 249, 0.4) 0%, 
        rgba(131, 110, 249, 0.2) 30%,
        rgba(255, 255, 255, 0.1) 60%,
        transparent 100%);
      pointer-events: none;
      z-index: 1000;
      animation: liquidRipple ${duration}ms ease-out forwards;
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    `

    container.appendChild(ripple)

    // Remove after animation
    setTimeout(() => {
      if (ripple.parentNode) {
        ripple.parentNode.removeChild(ripple)
      }
    }, duration)
  }

  // Enhanced ripple for galaxy interactions
  createGalaxyRipple(x, y, container, intensity = 1) {
    if (this.performanceMode === "low") return

    const ripple = document.createElement("div")
    ripple.className = "galaxy-liquid-ripple"

    const size = 400 * intensity
    const duration = 1500

    ripple.style.cssText = `
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      width: 0;
      height: 0;
      border-radius: 50%;
      background: radial-gradient(circle, 
        rgba(255, 255, 255, ${0.3 * intensity}) 0%, 
        rgba(131, 110, 249, ${0.4 * intensity}) 20%,
        rgba(32, 0, 82, ${0.2 * intensity}) 50%,
        transparent 80%);
      pointer-events: none;
      z-index: 15;
      animation: galaxyLiquidRipple ${duration}ms ease-out forwards;
      backdrop-filter: blur(8px) saturate(150%);
      -webkit-backdrop-filter: blur(8px) saturate(150%);
      border: 1px solid rgba(131, 110, 249, ${0.3 * intensity});
    `

    container.appendChild(ripple)

    setTimeout(() => {
      if (ripple.parentNode) {
        ripple.parentNode.removeChild(ripple)
      }
    }, duration)
  }

  startEffectLoop() {
    this.isActive = true
  }

  removeElement(element) {
    for (const config of this.elements) {
      if (config.element === element) {
        this.elements.delete(config)
        break
      }
    }

    element.classList.remove("liquid-glass-enhanced")
    element.style.transform = ""
    element.style.background = ""
    element.style.borderRadius = ""
    element.style.borderColor = ""
    element.style.filter = ""
    element.style.boxShadow = ""
  }

  setPerformanceMode(mode) {
    this.performanceMode = mode

    // Update all elements based on performance mode
    this.elements.forEach((config) => {
      if (mode === "low") {
        config.element.style.willChange = "transform"
      } else {
        config.element.style.willChange = "transform, filter, backdrop-filter"
      }
    })
  }

  destroy() {
    this.isActive = false
    this.elements.clear()
  }

  map(value, inMin, inMax, outMin, outMax) {
    return ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin
  }
}

// Enhanced CSS for new effects
const style = document.createElement("style")
style.textContent = `
  @keyframes liquidRipple {
    0% {
      width: 0;
      height: 0;
      opacity: 1;
      transform: translate(-50%, -50%) scale(0);
    }
    50% {
      opacity: 0.8;
    }
    100% {
      width: 300px;
      height: 300px;
      opacity: 0;
      transform: translate(-50%, -50%) scale(1);
    }
  }

  @keyframes galaxyLiquidRipple {
    0% {
      width: 0;
      height: 0;
      opacity: 1;
      transform: translate(-50%, -50%) scale(0) rotate(0deg);
    }
    25% {
      opacity: 0.9;
      transform: translate(-50%, -50%) scale(0.3) rotate(90deg);
    }
    50% {
      opacity: 0.7;
      transform: translate(-50%, -50%) scale(0.7) rotate(180deg);
    }
    75% {
      opacity: 0.4;
      transform: translate(-50%, -50%) scale(0.9) rotate(270deg);
    }
    100% {
      width: 400px;
      height: 400px;
      opacity: 0;
      transform: translate(-50%, -50%) scale(1) rotate(360deg);
    }
  }
  
  .liquid-glass-enhanced {
    transition: all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  }

  .galaxy-liquid-ripple {
    mix-blend-mode: screen;
  }

  /* Performance optimizations */
  @media (max-width: 768px) {
    .liquid-glass-enhanced {
      backdrop-filter: blur(8px) !important;
      -webkit-backdrop-filter: blur(8px) !important;
    }
  }
`
document.head.appendChild(style)

window.LiquidGlassEffects = new LiquidGlassEffects()
