// Main Application with Gmunk Integration
class MonadVisualizer {
  constructor() {
    this.currentTab = "datastream"
    this.isConnected = false
    this.transactionCount = 0
    this.currentTps = 0
    this.derbyConfig = {
      entities: ["Uniswap", "SushiSwap", "PancakeSwap", "Curve", "Balancer"],
    }
    this.racerPositions = {}
    this.racerData = {}

    // Component instances
    this.particleSystem = null
    this.gmunkStream = null
    this.dataFeed = null
    this.flowViz = null
    this.userAvatars = null

    this.init()
    window.visualizer = this
    window.setMoonCharacter = (imageUrl) => this.setMoonCharacter(imageUrl)
  }

  async init() {
    await this.waitForDOMReady()
    this.setupComponents()
    this.setupEventListeners()
    this.initializeDerby()
    this.startSimulations()
    this.enhanceGlassEffects()
  }

  waitForDOMReady() {
    return new Promise((resolve) => {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", resolve)
      } else {
        resolve()
      }
    })
  }

  setupComponents() {
    // Initialize particle system
    const particleCanvas = document.getElementById("particle-canvas")
    if (particleCanvas && window.ParticleSystem) {
      this.particleSystem = new window.ParticleSystem(particleCanvas)
    }

    // Initialize Gmunk data stream
    const gmunkCanvas = document.getElementById("gmunk-canvas")
    if (gmunkCanvas && window.GmunkDataStream) {
      this.gmunkStream = new window.GmunkDataStream(gmunkCanvas)
    }

    // Initialize data feed
    const dataFeedElement = document.getElementById("dataFeed")
    if (dataFeedElement && window.DataFeedManager) {
      this.dataFeed = new window.DataFeedManager(dataFeedElement)
    }

    // Initialize flow visualization
    const flowVizElement = document.getElementById("flowViz")
    if (flowVizElement && window.FlowVisualization) {
      this.flowViz = new window.FlowVisualization(flowVizElement)
    }

    // Initialize user avatars
    const userAvatarsElement = document.getElementById("userAvatars")
    if (userAvatarsElement && window.UserAvatarManager) {
      this.userAvatars = new window.UserAvatarManager(userAvatarsElement)
    }
  }

  enhanceGlassEffects() {
    if (!window.LiquidGlassEffects) return

    // Enhanced gmunk container
    const gmunkContainer = document.querySelector(".gmunk-container")
    if (gmunkContainer) {
      window.LiquidGlassEffects.addElement(gmunkContainer, {
        followMouse: true,
        morphing: true,
        holographic: true,
        intensity: 2,
      })
    }

    // Enhanced stat panels
    const statPanels = document.querySelectorAll(".stat-panel")
    statPanels.forEach((panel) => {
      window.LiquidGlassEffects.addElement(panel, {
        followMouse: true,
        morphing: true,
        intensity: 1.5,
      })
    })

    // Enhanced data stream container
    const streamContainer = document.querySelector(".data-stream-container")
    if (streamContainer) {
      window.LiquidGlassEffects.addElement(streamContainer, {
        followMouse: true,
        holographic: true,
        liquidWave: true,
        intensity: 2.5,
      })
    }

    // Enhance all other glass panels
    const glassPanels = document.querySelectorAll(".ultra-glass")
    glassPanels.forEach((panel) => {
      if (!panel.closest(".gmunk-container") && !panel.classList.contains("stat-panel")) {
        window.LiquidGlassEffects.addElement(panel, {
          followMouse: true,
          morphing: Math.random() > 0.6,
          holographic: Math.random() > 0.8,
          intensity: this.random(1, 1.8),
        })
      }
    })

    // Enhanced click effects
    document.addEventListener("click", (e) => {
      const target = e.target.closest(".data-stream-container, .stat-panel")
      if (target) {
        window.LiquidGlassEffects.createGalaxyRipple(e.clientX, e.clientY, target, 1.5)
      } else {
        const glassTarget = e.target.closest(".ultra-glass, .glass-button, .tab-button")
        if (glassTarget) {
          window.LiquidGlassEffects.createRippleEffect(e.clientX, e.clientY, document.body)
        }
      }
    })
  }

  setupEventListeners() {
    // Tab navigation
    document.querySelectorAll(".tab-button").forEach((button) => {
      button.addEventListener("click", (e) => {
        this.switchTab(e.target.closest(".tab-button").dataset.tab)
      })
    })

    // Derby configuration
    const configButton = document.getElementById("configButton")
    if (configButton) {
      configButton.addEventListener("click", () => this.openConfigModal())
    }

    const closeModal = document.getElementById("closeModal")
    if (closeModal) {
      closeModal.addEventListener("click", () => this.closeConfigModal())
    }

    const applyConfig = document.getElementById("applyConfig")
    if (applyConfig) {
      applyConfig.addEventListener("click", () => this.applyConfiguration())
    }

    const resetConfig = document.getElementById("resetConfig")
    if (resetConfig) {
      resetConfig.addEventListener("click", () => this.resetConfiguration())
    }

    const addEntity = document.getElementById("addEntity")
    if (addEntity) {
      addEntity.addEventListener("click", () => this.addEntity())
    }

    // Close modal on overlay click
    const configModal = document.getElementById("configModal")
    if (configModal) {
      configModal.addEventListener("click", (e) => {
        if (e.target.id === "configModal") {
          this.closeConfigModal()
        }
      })
    }
  }

  switchTab(tabName) {
    // Update active tab button
    document.querySelectorAll(".tab-button").forEach((btn) => {
      btn.classList.remove("active")
    })
    const activeTab = document.querySelector(`[data-tab="${tabName}"]`)
    if (activeTab) {
      activeTab.classList.add("active")
    }

    // Update active page
    document.querySelectorAll(".page").forEach((page) => {
      page.classList.remove("active")
    })

    const targetPage = document.getElementById(tabName)
    if (targetPage) {
      targetPage.classList.add("active")
    }

    this.currentTab = tabName
    this.optimizeForTab(tabName)
  }

  optimizeForTab(tabName) {
    if (tabName === "datastream") {
      if (this.gmunkStream) this.gmunkStream.start()
      if (this.particleSystem) this.particleSystem.start()
    } else {
      if (this.gmunkStream) this.gmunkStream.stop()
      if (this.particleSystem) this.particleSystem.stop()
    }
  }

  startSimulations() {
    this.simulateDataStream()
    this.updateStats()
    this.startDerbySimulation()
  }

  simulateDataStream() {
    const createTransaction = () => {
      const transactionTypes = ["small", "medium", "large", "supernova"]
      const weights = [0.5, 0.3, 0.15, 0.05]

      let random = Math.random()
      let type = "small"

      for (let i = 0; i < weights.length; i++) {
        if (random < weights[i]) {
          type = transactionTypes[i]
          break
        }
        random -= weights[i]
      }

      const transaction = {
        hash: "0x" + Math.random().toString(16).substr(2, 16),
        from: "0x" + Math.random().toString(16).substr(2, 8) + "...",
        to: "0x" + Math.random().toString(16).substr(2, 8) + "...",
        value: this.random(0.1, 100).toFixed(4),
        type: type,
      }

      // Add to gmunk stream
      if (this.gmunkStream && this.currentTab === "datastream") {
        this.gmunkStream.addTransaction(transaction)
      }

      // Add to data feed
      if (this.dataFeed) {
        this.dataFeed.addItem("transaction", transaction)
      }

      this.transactionCount++
    }

    const scheduleNextTransaction = () => {
      const delay = this.random(100, 500)
      setTimeout(() => {
        if (this.currentTab === "datastream") {
          createTransaction()
        }
        scheduleNextTransaction()
      }, delay)
    }

    scheduleNextTransaction()
  }

  updateStats() {
    const updateValues = () => {
      // Update main stats
      this.currentTps = Math.floor(this.random(1000, 6000))
      const activeContracts = Math.floor(this.random(300, 400))
      const activityToday = Math.floor(this.random(18000, 21000))
      const activeUsers = Math.floor(this.random(3000, 4000))

      // Update DOM elements
      const elements = {
        activeContracts: activeContracts,
        activityToday: activityToday.toLocaleString(),
        activeUsers: activeUsers.toLocaleString(),
        gasMetrics: (Math.random() * 20 + 10).toFixed(1) + "m",
        participants: activeUsers.toLocaleString(),
      }

      Object.entries(elements).forEach(([id, value]) => {
        const element = document.getElementById(id)
        if (element) {
          element.textContent = value
        }
      })

      // Simulate entity activity
      if (this.gmunkStream && Math.random() < 0.3) {
        const entities = ["Uniswap", "SushiSwap", "PancakeSwap", "Curve"]
        const entity = entities[Math.floor(Math.random() * entities.length)]

        this.gmunkStream.addEntityActivity(entity, {
          intensity: this.random(0.4, 0.8),
        })

        if (this.dataFeed) {
          this.dataFeed.addItem("entity", {
            entity: entity,
            tps: Math.floor(this.random(100, 1000)),
            total: Math.floor(this.random(10000, 50000)),
          })
        }
      }

      // Update user activity
      if (this.userAvatars && Math.random() < 0.2) {
        const userIndex = Math.floor(Math.random() * 15)
        this.userAvatars.updateActivity(userIndex)
      }
    }

    updateValues()
    setInterval(updateValues, 2000)
  }

  // Derby Implementation (keeping existing code)
  initializeDerby() {
    this.updateCurrentEntities()
    this.setupRacetrack()
    this.updateScoreboard()
  }

  updateCurrentEntities() {
    const container = document.getElementById("currentEntities")
    if (!container) return

    container.innerHTML = ""

    if (this.derbyConfig.entities.length === 0) {
      container.innerHTML = '<span style="opacity: 0.6; font-style: italic;">No entities configured</span>'
      return
    }

    this.derbyConfig.entities.forEach((entity) => {
      const tag = document.createElement("div")
      tag.className = "entity-tag"
      tag.innerHTML = `
        <span>${entity.name || entity}</span>
        <button class="remove-btn" onclick="visualizer.removeEntity('${entity.name || entity}')" title="Remove entity">×</button>
      `
      container.appendChild(tag)
    })
  }

  removeEntity(entityName) {
    this.derbyConfig.entities = this.derbyConfig.entities.filter((entity) => (entity.name || entity) !== entityName)
    this.updateCurrentEntities()
    this.setupRacetrack()
  }

  addEntity() {
    const nameInput = document.getElementById("entityName")
    const addressInput = document.getElementById("entityAddresses")
    const monitoringOption = document.querySelector('input[name="monitoring"]:checked')

    if (!nameInput || !addressInput || !monitoringOption) return

    const name = nameInput.value.trim()
    const addresses = addressInput.value.trim()

    if (!name || !addresses) {
      alert("Please enter both entity name and address(es)")
      return
    }

    const newEntity = {
      name: name,
      addresses: addresses.split(",").map((addr) => addr.trim()),
      monitoring: monitoringOption.value,
    }

    const exists = this.derbyConfig.entities.some((entity) => (entity.name || entity) === name)

    if (exists) {
      alert("An entity with this name already exists")
      return
    }

    this.derbyConfig.entities.push(newEntity)
    this.updateCurrentEntities()

    nameInput.value = ""
    addressInput.value = ""
    const toAddressRadio = document.getElementById("toAddress")
    if (toAddressRadio) {
      toAddressRadio.checked = true
    }
  }

  setupRacetrack() {
    const racetrack = document.getElementById("racetrack")
    if (!racetrack) return

    racetrack.innerHTML = ""

    this.derbyConfig.entities.forEach((entity) => {
      const entityName = entity.name || entity
      const lane = document.createElement("div")
      lane.className = "race-lane"
      lane.innerHTML = `
        <div class="lane-background"></div>
        <div class="lane-label">${entityName}</div>
        <div class="racer" id="racer-${entityName}"></div>
      `
      racetrack.appendChild(lane)

      this.racerPositions[entityName] = 0
      this.racerData[entityName] = {
        tps: Math.floor(this.random(100, 1000)),
        laps: 0,
        hash: this.generateRandomHash(),
      }
    })
  }

  updateScoreboard() {
    const content = document.getElementById("scoreboardContent")
    if (!content) return

    content.innerHTML = ""

    const sortedEntities = [...this.derbyConfig.entities].sort((a, b) => {
      const aName = a.name || a
      const bName = b.name || b
      return (this.racerData[bName]?.tps || 0) - (this.racerData[aName]?.tps || 0)
    })

    sortedEntities.forEach((entity, index) => {
      const entityName = entity.name || entity
      const data = this.racerData[entityName]
      if (!data) return

      const card = document.createElement("div")
      card.className = "racer-card"
      card.innerHTML = `
        <div class="racer-name">#${index + 1} ${entityName}</div>
        <div class="racer-stats">
          <span>TPS: ${data.tps}</span>
          <span>Laps: ${data.laps}</span>
        </div>
        <div style="font-size: 0.7rem; opacity: 0.6; margin-top: 0.5rem;">
          ${data.hash}
        </div>
      `
      content.appendChild(card)
    })
  }

  startDerbySimulation() {
    const updateRace = () => {
      this.derbyConfig.entities.forEach((entity) => {
        const entityName = entity.name || entity
        const data = this.racerData[entityName]
        if (!data) return

        const variation = (Math.random() - 0.5) * 200
        data.tps = Math.max(50, Math.floor(data.tps + variation))

        const speed = data.tps / 10000
        this.racerPositions[entityName] += speed

        if (this.racerPositions[entityName] >= 1) {
          this.racerPositions[entityName] = 0
          data.laps++
          data.hash = this.generateRandomHash()
        }

        const racerElement = document.getElementById(`racer-${entityName}`)
        if (racerElement) {
          const trackWidth = racerElement.parentElement.offsetWidth - 40
          const position = this.racerPositions[entityName] * trackWidth
          racerElement.style.left = position + "px"
        }
      })

      this.updateScoreboard()
    }

    setInterval(updateRace, 100)
  }

  generateRandomHash() {
    return "0x" + Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join("")
  }

  // Modal Management
  openConfigModal() {
    const modal = document.getElementById("configModal")
    if (modal) {
      modal.classList.add("active")
    }
  }

  closeConfigModal() {
    const modal = document.getElementById("configModal")
    if (modal) {
      modal.classList.remove("active")
    }
  }

  applyConfiguration() {
    this.setupRacetrack()
    this.closeConfigModal()
  }

  resetConfiguration() {
    this.derbyConfig.entities = [
      { name: "Uniswap", addresses: ["0x1f9840a85d5af5bf1d1762f925bdaddc4201f984"], monitoring: "both" },
      { name: "SushiSwap", addresses: ["0x6b3595068778dd592e39a122f4f5a5cf09c90fe2"], monitoring: "both" },
      { name: "PancakeSwap", addresses: ["0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82"], monitoring: "both" },
    ]
    this.updateCurrentEntities()
    this.setupRacetrack()

    const nameInput = document.getElementById("entityName")
    const addressInput = document.getElementById("entityAddresses")
    const toAddressRadio = document.getElementById("toAddress")

    if (nameInput) nameInput.value = ""
    if (addressInput) addressInput.value = ""
    if (toAddressRadio) toAddressRadio.checked = true
  }

  setMoonCharacter(imageUrl) {
    // Legacy function for compatibility
    console.log("Moon character function called, but using Gmunk stream instead")
  }

  // Utility methods
  random(min, max) {
    return Math.random() * (max - min) + min
  }

  destroy() {
    if (this.particleSystem) this.particleSystem.destroy()
    if (this.gmunkStream) this.gmunkStream.destroy()
  }
}

// Initialize the application when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  new MonadVisualizer()
})
