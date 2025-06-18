// Performance Utilities
class PerformanceManager {
  constructor() {
    this.rafId = null
    this.isReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    this.observers = new Map()
    this.pools = new Map()
    this.init()
  }

  init() {
    // Setup performance monitoring
    this.setupRAF()
    this.setupIntersectionObserver()
    this.setupResizeObserver()
    this.setupObjectPools()
  }

  setupRAF() {
    let lastTime = 0
    const targetFPS = 60
    const targetFrameTime = 1000 / targetFPS

    const animate = (currentTime) => {
      const deltaTime = currentTime - lastTime

      if (deltaTime >= targetFrameTime) {
        // Dispatch custom event for frame updates
        window.dispatchEvent(
          new CustomEvent("performanceFrame", {
            detail: { deltaTime, currentTime },
          }),
        )
        lastTime = currentTime
      }

      this.rafId = requestAnimationFrame(animate)
    }

    this.rafId = requestAnimationFrame(animate)
  }

  setupIntersectionObserver() {
    const options = {
      root: null,
      rootMargin: "50px",
      threshold: [0, 0.25, 0.5, 0.75, 1],
    }

    this.intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const element = entry.target
        const callback = this.observers.get(element)

        if (callback) {
          callback(entry)
        }
      })
    }, options)
  }

  setupResizeObserver() {
    this.resizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const element = entry.target
        const callback = this.observers.get(element)

        if (callback) {
          callback(entry)
        }
      })
    })
  }

  setupObjectPools() {
    // Pool for DOM elements to reduce garbage collection
    this.pools.set("stars", [])
    this.pools.set("particles", [])
    this.pools.set("monanimals", [])
  }

  // Object pooling methods
  getFromPool(type) {
    const pool = this.pools.get(type)
    return pool && pool.length > 0 ? pool.pop() : null
  }

  returnToPool(type, object) {
    const pool = this.pools.get(type)
    if (pool && pool.length < 100) {
      // Limit pool size
      pool.push(object)
    }
  }

  // Throttle function calls
  throttle(func, limit) {
    let inThrottle
    return function () {
      const args = arguments
      
      if (!inThrottle) {
        func.apply(this, args)
        inThrottle = true
        setTimeout(() => (inThrottle = false), limit)
      }
    }
  }

  // Debounce function calls
  debounce(func, wait, immediate) {
    let timeout
    return function () {
      
      const args = arguments
      const later = () => {
        timeout = null
        if (!immediate) func.apply(this, args)
      }
      const callNow = immediate && !timeout
      clearTimeout(timeout)
      timeout = setTimeout(later, wait)
      if (callNow) func.apply(this, args)
    }
  }

  // Observe element for intersection
  observeIntersection(element, callback) {
    this.observers.set(element, callback)
    this.intersectionObserver.observe(element)
  }

  // Observe element for resize
  observeResize(element, callback) {
    this.observers.set(element, callback)
    this.resizeObserver.observe(element)
  }

  // Unobserve element
  unobserve(element) {
    this.observers.delete(element)
    this.intersectionObserver.unobserve(element)
    this.resizeObserver.unobserve(element)
  }

  // Check if reduced motion is preferred
  isReducedMotionPreferred() {
    return this.isReducedMotion
  }

  // Cleanup
  destroy() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
    }
    this.intersectionObserver.disconnect()
    this.resizeObserver.disconnect()
    this.observers.clear()
    this.pools.clear()
  }
}

// Export singleton instance
window.PerformanceManager = new PerformanceManager()
