// Galaxy Component
class Galaxy {
  constructor(container) {
    this.container = container
    this.isActive = false
    this.animationSpeed = 1

    this.init()
  }

  init() {
    this.setupElements()
    this.bindEvents()
  }

  setupElements() {
    // Get galaxy elements
    this.core = this.container.querySelector(".galaxy-core")
    this.arms = this.container.querySelector(".galaxy-arms")
    this.nebulas = this.container.querySelectorAll(".nebula")

    // Add liquid glass effects
    if (window.LiquidGlassEffects) {
      window.LiquidGlassEffects.addElement(this.container, {
        morphing: true,
        intensity: 0.5,
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
      })
    }
  }

  update(deltaTime) {
    // Dynamic animation speed based on performance
    const fps = 1000 / deltaTime
    this.animationSpeed = fps > 30 ? 1 : 0.5

    // Update animation speeds
    if (this.core) {
      this.core.style.animationDuration = `${60 / this.animationSpeed}s`
    }

    if (this.arms) {
      this.arms.style.animationDuration = `${120 / this.animationSpeed}s`
    }
  }

  setAnimationSpeed(speed) {
    const MathUtils = { clamp: (value, min, max) => Math.min(Math.max(value, min), max) }
    this.animationSpeed = MathUtils.clamp(speed, 0.1, 2)
  }

  pause() {
    this.isActive = false
    this.container.style.animationPlayState = "paused"
  }

  resume() {
    this.isActive = true
    this.container.style.animationPlayState = "running"
  }

  destroy() {
    this.isActive = false
    if (window.LiquidGlassEffects) {
      window.LiquidGlassEffects.removeElement(this.container)
    }
    if (window.PerformanceManager) {
      window.PerformanceManager.unobserve(this.container)
    }
  }
}

window.Galaxy = Galaxy
