// Advanced Particle System
class ParticleSystem {
  constructor(canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext("2d")
    this.particles = []
    this.maxParticles = 150
    this.isActive = true

    this.setupCanvas()
    this.bindEvents()
    this.start()
  }

  setupCanvas() {
    this.resize()
    this.ctx.globalCompositeOperation = "screen"
  }

  resize() {
    const dpr = window.devicePixelRatio || 1
    const rect = this.canvas.getBoundingClientRect()

    this.canvas.width = rect.width * dpr
    this.canvas.height = rect.height * dpr
    this.canvas.style.width = rect.width + "px"
    this.canvas.style.height = rect.height + "px"

    this.ctx.scale(dpr, dpr)
    this.width = rect.width
    this.height = rect.height
  }

  bindEvents() {
    const resizeHandler = window.PerformanceManager.debounce(() => {
      this.resize()
    }, 250)

    window.addEventListener("resize", resizeHandler)

    // Listen for performance frames
    window.addEventListener("performanceFrame", (e) => {
      if (this.isActive) {
        this.update(e.detail.deltaTime)
        this.render()
      }
    })
  }

  createParticle(x, y, options = {}) {
    if (this.particles.length >= this.maxParticles) {
      return
    }

    const particle = {
      x: x || Math.random(0, this.width),
      y: y || Math.random(0, this.height),
      vx: Math.random(-0.5, 0.5),
      vy: Math.random(-0.5, 0.5),
      life: 1,
      maxLife: Math.random(3000, 8000),
      size: Math.random(1, 3),
      color: options.color || `hsl(${Math.random(240, 280)}, 70%, 60%)`,
      alpha: Math.random(0.3, 0.8),
      type: options.type || "default",
      ...options,
    }

    this.particles.push(particle)
  }

  update(deltaTime) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i]

      // Update position
      particle.x += particle.vx * deltaTime * 0.01
      particle.y += particle.vy * deltaTime * 0.01

      // Update life
      particle.life -= deltaTime / particle.maxLife

      // Add some drift
      particle.vx += Math.noise(particle.x * 0.01, particle.y * 0.01) * 0.001
      particle.vy += Math.noise(particle.x * 0.01 + 100, particle.y * 0.01 + 100) * 0.001

      // Wrap around screen
      if (particle.x < -10) particle.x = this.width + 10
      if (particle.x > this.width + 10) particle.x = -10
      if (particle.y < -10) particle.y = this.height + 10
      if (particle.y > this.height + 10) particle.y = -10

      // Remove dead particles
      if (particle.life <= 0) {
        this.particles.splice(i, 1)
      }
    }

    // Spawn new particles
    if (this.particles.length < this.maxParticles && Math.random() < 0.3) {
      this.createParticle()
    }
  }

  render() {
    this.ctx.clearRect(0, 0, this.width, this.height)

    for (const particle of this.particles) {
      this.ctx.save()

      const alpha = particle.alpha * particle.life
      this.ctx.globalAlpha = alpha

      // Create gradient for glow effect
      const gradient = this.ctx.createRadialGradient(
        particle.x,
        particle.y,
        0,
        particle.x,
        particle.y,
        particle.size * 3,
      )

      gradient.addColorStop(0, particle.color)
      gradient.addColorStop(1, "transparent")

      this.ctx.fillStyle = gradient
      this.ctx.beginPath()
      this.ctx.arc(particle.x, particle.y, particle.size * 3, 0, Math.PI * 2)
      this.ctx.fill()

      // Core particle
      this.ctx.globalAlpha = alpha * 1.5
      this.ctx.fillStyle = particle.color
      this.ctx.beginPath()
      this.ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2)
      this.ctx.fill()

      this.ctx.restore()
    }
  }

  start() {
    this.isActive = true
    // Initial particle burst
    for (let i = 0; i < 20; i++) {
      this.createParticle()
    }
  }

  stop() {
    this.isActive = false
  }

  destroy() {
    this.stop()
    this.particles = []
  }
}

window.ParticleSystem = ParticleSystem

// MathUtils declaration
const MathUtils = {
  random: (min, max) => Math.random() * (max - min) + min,
  noise: (x, y) => {
    // Simple Perlin noise implementation
    const n = x + y * 57
    const a = Math.sin(n) * 43758.5453
    return a - Math.floor(a)
  },
}
