// Enhanced Star System with Liquid Glass Effects
class StarSystem {
  constructor(container) {
    this.container = container
    this.stars = []
    this.isActive = false
    this.spawnRate = 0.4
    this.maxStars = 60
    this.liquidGlassIntensity = 1

    this.init()
  }

  init() {
    this.bindEvents()
    this.setupLiquidGlassEffects()
  }

  setupLiquidGlassEffects() {
    // Add liquid glass enhancement to container
    if (window.LiquidGlassEffects) {
      window.LiquidGlassEffects.addElement(this.container, {
        morphing: true,
        intensity: 0.8,
        holographic: false,
      })
    }
  }

  bindEvents() {
    // Listen for performance frames
    window.addEventListener("performanceFrame", (e) => {
      if (this.isActive) {
        this.update(e.detail.deltaTime)
      }
    })

    // Intersection observer for performance
    if (window.PerformanceManager) {
      window.PerformanceManager.observeIntersection(this.container, (entry) => {
        this.isActive = entry.isIntersecting

        // Adjust liquid glass intensity based on visibility
        if (entry.isIntersecting) {
          this.liquidGlassIntensity = Math.min(1, entry.intersectionRatio + 0.5)
        }
      })
    }
  }

  createStar(options = {}) {
    if (this.stars.length >= this.maxStars) {
      return
    }

    // Try to get from object pool first
    let starElement = window.PerformanceManager?.getFromPool("stars")

    if (!starElement) {
      starElement = document.createElement("div")
    }

    // Reset element
    starElement.className = ""
    starElement.style.cssText = ""

    // Determine star type with enhanced probabilities for visual impact
    const rand = Math.random()
    let starType
    if (rand < 0.4) {
      starType = "small"
    } else if (rand < 0.7) {
      starType = "medium"
    } else if (rand < 0.92) {
      starType = "large"
    } else {
      starType = "supernova"
    }

    starElement.className = `star ${starType}`

    // Enhanced positioning with liquid glass consideration
    let x, y
    let attempts = 0
    do {
      x = Math.random() * 100
      y = Math.random() * 100
      attempts++
    } while (this.isInMoonArea(x, y) && attempts < 10)

    starElement.style.left = x + "%"
    starElement.style.top = y + "%"

    // Add liquid glass properties to individual stars
    starElement.style.backdropFilter = `blur(${2 * this.liquidGlassIntensity}px)`
    starElement.style.webkitBackdropFilter = `blur(${2 * this.liquidGlassIntensity}px)`

    // Enhanced animation duration based on type
    const baseDuration = starType === "supernova" ? 1800 : starType === "large" ? 1500 : 1200
    const duration = baseDuration * (0.8 + Math.random() * 0.4) // Add some variation

    starElement.style.animationDuration = `${duration}ms`

    // Add to container
    this.container.appendChild(starElement)

    // Store star data
    const star = {
      element: starElement,
      type: starType,
      createdAt: Date.now(),
      duration: duration,
      x: x,
      y: y,
    }

    this.stars.push(star)

    // Create liquid glass ripple effect for larger stars
    if ((starType === "large" || starType === "supernova") && window.LiquidGlassEffects) {
      setTimeout(() => {
        const rect = this.container.getBoundingClientRect()
        const rippleX = rect.left + (x / 100) * rect.width
        const rippleY = rect.top + (y / 100) * rect.height

        window.LiquidGlassEffects.createRippleEffect(rippleX, rippleY, this.container)
      }, 200)
    }

    // Remove after animation
    setTimeout(() => {
      this.removeStar(star)
    }, duration + 100)
  }

  removeStar(star) {
    const index = this.stars.indexOf(star)
    if (index > -1) {
      this.stars.splice(index, 1)

      if (star.element.parentNode) {
        star.element.parentNode.removeChild(star.element)
      }

      // Return to object pool
      if (window.PerformanceManager) {
        window.PerformanceManager.returnToPool("stars", star.element)
      }
    }
  }

  isInMoonArea(x, y) {
    const centerX = 50
    const centerY = 50
    const moonRadius = 18 // Slightly larger to account for liquid glass effects
    const distance = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2))
    return distance < moonRadius
  }

  update(deltaTime) {
    // Dynamic spawn rate based on performance and liquid glass intensity
    const adjustedSpawnRate = this.spawnRate * this.liquidGlassIntensity * (deltaTime > 20 ? 0.7 : 1)

    // Spawn new stars based on rate
    if (Math.random() < adjustedSpawnRate * (deltaTime / 16)) {
      this.createStar()
    }

    // Clean up old stars
    const now = Date.now()
    for (let i = this.stars.length - 1; i >= 0; i--) {
      const star = this.stars[i]
      if (now - star.createdAt > star.duration + 200) {
        this.removeStar(star)
      }
    }

    // Update liquid glass effects on existing stars
    this.updateLiquidGlassEffects()
  }

  updateLiquidGlassEffects() {
    // Periodically enhance star visual effects
    if (Math.random() < 0.1) {
      // 10% chance per frame
      this.stars.forEach((star) => {
        if (star.type === "large" || star.type === "supernova") {
          const element = star.element
          const currentFilter = element.style.backdropFilter || ""

          // Pulse the backdrop filter for enhanced liquid glass effect
          const pulseIntensity = 2 + Math.sin(Date.now() * 0.005) * 1
          element.style.backdropFilter = `blur(${pulseIntensity * this.liquidGlassIntensity}px)`
          element.style.webkitBackdropFilter = `blur(${pulseIntensity * this.liquidGlassIntensity}px)`
        }
      })
    }
  }

  createBurst(centerX = 50, centerY = 50, count = 20) {
    // Enhanced burst with liquid glass effects
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const angle = (i / count) * 2 * Math.PI
        const distance = Math.random() * (30 - 18) + 18 // Larger spread
        const x = centerX + Math.cos(angle) * distance
        const y = centerY + Math.sin(angle) * distance

        // Ensure within bounds
        const clampedX = Math.max(5, Math.min(95, x))
        const clampedY = Math.max(5, Math.min(95, y))

        // Create enhanced stars for burst
        const starType = Math.random() > 0.5 ? "large" : "supernova"
        this.createStarAt(clampedX, clampedY, starType)
      }, i * 25) // Faster succession for more dramatic effect
    }

    // Create central liquid glass explosion effect
    if (window.LiquidGlassEffects) {
      const rect = this.container.getBoundingClientRect()
      const explosionX = rect.left + (centerX / 100) * rect.width
      const explosionY = rect.top + (centerY / 100) * rect.height

      // Multiple ripples for explosion effect
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          window.LiquidGlassEffects.createRippleEffect(explosionX, explosionY, this.container)
        }, i * 150)
      }
    }
  }

  createStarAt(x, y, type = "medium") {
    const starElement = document.createElement("div")
    starElement.className = `star ${type}`
    starElement.style.left = x + "%"
    starElement.style.top = y + "%"

    // Enhanced liquid glass properties for manually created stars
    starElement.style.backdropFilter = `blur(${3 * this.liquidGlassIntensity}px)`
    starElement.style.webkitBackdropFilter = `blur(${3 * this.liquidGlassIntensity}px)`

    this.container.appendChild(starElement)

    const duration = type === "supernova" ? 1800 : 1500
    const star = {
      element: starElement,
      type: type,
      createdAt: Date.now(),
      duration: duration,
      x: x,
      y: y,
    }

    this.stars.push(star)

    setTimeout(() => {
      this.removeStar(star)
    }, duration)
  }

  setSpawnRate(rate) {
    this.spawnRate = Math.max(0, Math.min(1, rate))
  }

  setLiquidGlassIntensity(intensity) {
    this.liquidGlassIntensity = Math.max(0, Math.min(2, intensity))
  }

  pause() {
    this.isActive = false
  }

  resume() {
    this.isActive = true
  }

  destroy() {
    this.isActive = false

    // Clean up all stars
    this.stars.forEach((star) => {
      if (star.element.parentNode) {
        star.element.parentNode.removeChild(star.element)
      }
    })

    this.stars = []

    // Remove liquid glass effects
    if (window.LiquidGlassEffects) {
      window.LiquidGlassEffects.removeElement(this.container)
    }

    if (window.PerformanceManager) {
      window.PerformanceManager.unobserve(this.container)
    }
  }
}

window.StarSystem = StarSystem
