// Gmunk-Style Data Stream Visualization
class GmunkDataStream {
  constructor(canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext("2d")
    this.isActive = false
    this.streams = []
    this.maxStreams = 40
    this.animationSpeed = 1

    this.setupCanvas()
    this.initializeStreams()
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
    const resizeHandler =
      window.PerformanceManager?.debounce(() => {
        this.resize()
        this.initializeStreams()
      }, 250) ||
      (() => {
        this.resize()
        this.initializeStreams()
      })

    window.addEventListener("resize", resizeHandler)

    // Listen for performance frames
    window.addEventListener("performanceFrame", (e) => {
      if (this.isActive) {
        this.update(e.detail.deltaTime)
        this.render()
      }
    })
  }

  initializeStreams() {
    this.streams = []

    // Create vertical data streams
    for (let i = 0; i < this.maxStreams; i++) {
      this.createStream(i)
    }
  }

  createStream(index) {
    const stream = {
      x: (index / this.maxStreams) * this.width,
      segments: [],
      baseIntensity: Math.random() * 0.5 + 0.3,
      frequency: Math.random() * 0.02 + 0.01,
      phase: Math.random() * Math.PI * 2,
      color: this.getStreamColor(index),
      width: Math.random() * 8 + 4,
      lastUpdate: 0,
    }

    // Initialize segments for this stream
    for (let y = 0; y < this.height + 50; y += 3) {
      stream.segments.push({
        y: y,
        intensity: 0,
        height: Math.random() * 15 + 5,
        targetIntensity: 0,
        life: 0,
      })
    }

    this.streams.push(stream)
  }

  getStreamColor(index) {
    const colors = [
      { r: 255, g: 0, b: 128 }, // Pink/Magenta
      { r: 128, g: 0, b: 255 }, // Purple
      { r: 0, g: 128, b: 255 }, // Blue
      { r: 0, g: 255, b: 255 }, // Cyan
      { r: 255, g: 64, b: 192 }, // Hot Pink
      { r: 64, g: 128, b: 255 }, // Light Blue
    ]

    return colors[index % colors.length]
  }

  update(deltaTime) {
    const time = Date.now() * 0.001

    this.streams.forEach((stream, streamIndex) => {
      // Update stream activity based on data flow
      const activityWave = Math.sin(time * stream.frequency + stream.phase) * 0.5 + 0.5
      const burstProbability = stream.baseIntensity * activityWave * 0.1

      stream.segments.forEach((segment, segmentIndex) => {
        // Create flowing data bursts
        if (Math.random() < burstProbability) {
          segment.targetIntensity = Math.random() * 0.8 + 0.2
          segment.life = Math.random() * 2000 + 1000 // 1-3 seconds
        }

        // Update segment intensity
        if (segment.life > 0) {
          segment.life -= deltaTime
          const lifeFactor = Math.max(0, segment.life / 2000)
          segment.intensity = this.lerp(segment.intensity, segment.targetIntensity * lifeFactor, 0.1)
        } else {
          segment.intensity = this.lerp(segment.intensity, 0, 0.05)
        }

        // Add wave motion
        const waveOffset = Math.sin(time * 2 + segmentIndex * 0.1) * 2
        segment.x = stream.x + waveOffset
      })
    })
  }

  render() {
    // Clear canvas with slight trail effect
    this.ctx.fillStyle = "rgba(0, 0, 0, 0.1)"
    this.ctx.fillRect(0, 0, this.width, this.height)

    this.streams.forEach((stream) => {
      stream.segments.forEach((segment) => {
        if (segment.intensity > 0.01) {
          this.renderSegment(stream, segment)
        }
      })
    })
  }

  renderSegment(stream, segment) {
    const { color } = stream
    const alpha = segment.intensity
    const glowSize = segment.height * (1 + segment.intensity * 2)

    this.ctx.save()

    // Create glow effect
    const gradient = this.ctx.createRadialGradient(segment.x, segment.y, 0, segment.x, segment.y, glowSize)

    gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`)
    gradient.addColorStop(0.3, `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha * 0.6})`)
    gradient.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`)

    this.ctx.fillStyle = gradient
    this.ctx.fillRect(segment.x - glowSize, segment.y - segment.height / 2, glowSize * 2, segment.height)

    // Core segment
    this.ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha * 1.5})`
    this.ctx.fillRect(segment.x - stream.width / 2, segment.y - segment.height / 2, stream.width, segment.height)

    this.ctx.restore()
  }

  // Trigger data burst (called from backend)
  triggerDataBurst(streamIndex, intensity = 1) {
    if (streamIndex < this.streams.length) {
      const stream = this.streams[streamIndex]
      const burstHeight = Math.floor(this.height * 0.3) // 30% of height
      const startY = Math.random() * (this.height - burstHeight)

      for (let i = 0; i < burstHeight; i += 3) {
        const segmentIndex = Math.floor((startY + i) / 3)
        if (segmentIndex < stream.segments.length) {
          const segment = stream.segments[segmentIndex]
          segment.targetIntensity = intensity * (Math.random() * 0.5 + 0.5)
          segment.life = Math.random() * 1500 + 1000
        }
      }
    }
  }

  // Trigger transaction visualization
  addTransaction(data) {
    const streamIndex = Math.floor(Math.random() * this.streams.length)
    let intensity = 0.3

    // Determine intensity based on transaction type/value
    switch (data.type) {
      case "small":
        intensity = 0.3
        break
      case "medium":
        intensity = 0.5
        break
      case "large":
        intensity = 0.7
        break
      case "supernova":
        intensity = 1.0
        break
    }

    this.triggerDataBurst(streamIndex, intensity)
  }

  // Add entity activity
  addEntityActivity(entityName, activity) {
    // Map entity to specific streams
    const entityHash = this.hashString(entityName)
    const streamIndex = entityHash % this.streams.length

    this.triggerDataBurst(streamIndex, activity.intensity || 0.6)
  }

  hashString(str) {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash)
  }

  lerp(start, end, factor) {
    return start + (end - start) * factor
  }

  start() {
    this.isActive = true
  }

  stop() {
    this.isActive = false
  }

  destroy() {
    this.stop()
    this.streams = []
  }
}

// Data Feed Manager
class DataFeedManager {
  constructor(feedElement) {
    this.feedElement = feedElement
    this.maxItems = 50
    this.items = []
  }

  addItem(type, data) {
    const timestamp = new Date().toLocaleTimeString()
    let content = ""

    switch (type) {
      case "transaction":
        content = `
          <div class="feed-item">
            <div class="timestamp">${timestamp}</div>
            <div class="action">Transaction ${data.hash.substring(0, 8)}...</div>
            <div class="details">${data.from.substring(0, 6)}... → ${data.to.substring(0, 6)}... (${data.value} ETH)</div>
          </div>
        `
        break
      case "contract":
        content = `
          <div class="feed-item">
            <div class="timestamp">${timestamp}</div>
            <div class="action">Contract Interaction</div>
            <div class="details">${data.contract.substring(0, 8)}... - ${data.method}</div>
          </div>
        `
        break
      case "entity":
        content = `
          <div class="feed-item">
            <div class="timestamp">${timestamp}</div>
            <div class="action">${data.entity} Activity</div>
            <div class="details">TPS: ${data.tps} | Total: ${data.total}</div>
          </div>
        `
        break
    }

    this.feedElement.insertAdjacentHTML("afterbegin", content)

    // Remove old items
    const items = this.feedElement.children
    while (items.length > this.maxItems) {
      this.feedElement.removeChild(items[items.length - 1])
    }
  }
}

// Flow Visualization
class FlowVisualization {
  constructor(container) {
    this.container = container
    this.dots = []
    this.maxDots = 20
    this.init()
  }

  init() {
    this.createDots()
    this.animate()
  }

  createDots() {
    for (let i = 0; i < this.maxDots; i++) {
      setTimeout(() => {
        this.addDot()
      }, i * 200)
    }
  }

  addDot() {
    const dot = document.createElement("div")
    dot.className = "flow-dot"
    dot.style.top = Math.random() * 50 + 25 + "px"
    dot.style.animationDelay = Math.random() * 4 + "s"
    dot.style.animationDuration = Math.random() * 2 + 3 + "s"

    this.container.appendChild(dot)

    // Remove after animation
    setTimeout(() => {
      if (dot.parentNode) {
        dot.parentNode.removeChild(dot)
      }
    }, 5000)
  }

  animate() {
    setInterval(() => {
      if (Math.random() < 0.3) {
        this.addDot()
      }
    }, 500)
  }
}

// User Avatar Manager
class UserAvatarManager {
  constructor(container) {
    this.container = container
    this.avatars = []
    this.maxAvatars = 15
    this.init()
  }

  init() {
    this.generateAvatars()
  }

  generateAvatars() {
    const names = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O"]

    for (let i = 0; i < this.maxAvatars; i++) {
      const avatar = document.createElement("div")
      avatar.className = "user-avatar"
      avatar.textContent = names[i % names.length]
      avatar.title = `User ${names[i % names.length]}`

      this.container.appendChild(avatar)
    }
  }

  updateActivity(userIndex) {
    const avatars = this.container.children
    if (avatars[userIndex]) {
      avatars[userIndex].style.animation = "none"
      setTimeout(() => {
        avatars[userIndex].style.animation = "gmunkGlow 1s ease-out"
      }, 10)
    }
  }
}

window.GmunkDataStream = GmunkDataStream
window.DataFeedManager = DataFeedManager
window.FlowVisualization = FlowVisualization
window.UserAvatarManager = UserAvatarManager
