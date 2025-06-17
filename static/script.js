class MonadVisualizer {
    constructor() {
      this.currentTab = "cityscape"
      this.isConnected = false
      this.transactionCount = 0
      this.currentTps = 0
      this.derbyConfig = {
        entities: ["Uniswap", "SushiSwap", "PancakeSwap", "Curve", "Balancer"],
      }
      this.racerPositions = {}
      this.racerData = {}
  
      this.init()
    }
  
    init() {
      this.setupEventListeners()
      this.initializeDerby()
      this.startCityscapeSimulation()
      this.startDerbySimulation()
    }
  
    setupEventListeners() {
      // Tab navigation
      document.querySelectorAll(".tab-button").forEach((button) => {
        button.addEventListener("click", (e) => {
          this.switchTab(e.target.dataset.tab)
        })
      })
  
      // Derby configuration
      document.getElementById("configButton").addEventListener("click", () => {
        this.openConfigModal()
      })
  
      document.getElementById("closeModal").addEventListener("click", () => {
        this.closeConfigModal()
      })
  
      document.getElementById("applyConfig").addEventListener("click", () => {
        this.applyConfiguration()
      })
  
      document.getElementById("resetConfig").addEventListener("click", () => {
        this.resetConfiguration()
      })
  
      // Close modal on overlay click
      document.getElementById("configModal").addEventListener("click", (e) => {
        if (e.target.id === "configModal") {
          this.closeConfigModal()
        }
      })
    }
  
    switchTab(tabName) {
      // Update active tab button
      document.querySelectorAll(".tab-button").forEach((btn) => {
        btn.classList.remove("active")
      })
      document.querySelector(`[data-tab="${tabName}"]`).classList.add("active")
  
      // Update active page
      document.querySelectorAll(".page").forEach((page) => {
        page.classList.remove("active")
      })
      document.getElementById(tabName).classList.add("active")
  
      this.currentTab = tabName
    }
  
    // Cityscape Firehose Implementation
    startCityscapeSimulation() {
      this.simulateTransactionStream()
      this.spawnMonanimal()
      this.updateStats()
    }
  
    simulateTransactionStream() {
      const starsContainer = document.getElementById("starsContainer")
  
      const createStar = () => {
        const star = document.createElement("div")
        star.className = "star"
  
        // Random position
        star.style.left = Math.random() * 100 + "%"
        star.style.top = Math.random() * 100 + "%"
  
        // Random color variation
        const colors = ["#836EF9", "#FBFAF9", "#FFFFFF"]
        star.style.background = colors[Math.floor(Math.random() * colors.length)]
  
        starsContainer.appendChild(star)
  
        // Remove after animation
        setTimeout(() => {
          if (star.parentNode) {
            star.parentNode.removeChild(star)
          }
        }, 1000)
  
        this.transactionCount++
      }
  
      // Variable rate transaction simulation
      const scheduleNextStar = () => {
        const delay = Math.random() * 200 + 50 // 50-250ms
        setTimeout(() => {
          createStar()
          scheduleNextStar()
        }, delay)
      }
  
      scheduleNextStar()
    }
  
    spawnMonanimal() {
      const container = document.getElementById("monanimalsContainer")
  
      const createMonanimal = () => {
        const monanimal = document.createElement("div")
        monanimal.className = "monanimal"
  
        // Random vertical position
        monanimal.style.top = Math.random() * 80 + 10 + "%"
        monanimal.style.left = "-50px"
  
        container.appendChild(monanimal)
  
        // Remove after animation
        setTimeout(() => {
          if (monanimal.parentNode) {
            monanimal.parentNode.removeChild(monanimal)
          }
        }, 15000)
      }
  
      // Spawn Monanimal every 8-15 seconds
      const scheduleNextMonanimal = () => {
        const delay = Math.random() * 7000 + 8000
        setTimeout(() => {
          createMonanimal()
          scheduleNextMonanimal()
        }, delay)
      }
  
      scheduleNextMonanimal()
    }
  
    updateStats() {
      const updateTps = () => {
        // Simulate TPS fluctuation
        this.currentTps = Math.floor(Math.random() * 5000 + 1000)
        document.getElementById("liveTps").textContent = this.currentTps.toLocaleString()
        document.getElementById("totalTx").textContent = this.transactionCount.toLocaleString()
      }
  
      updateTps()
      setInterval(updateTps, 1000)
    }
  
    // Derby Implementation
    initializeDerby() {
      this.createEntityCheckboxes()
      this.setupRacetrack()
      this.updateScoreboard()
    }
  
    createEntityCheckboxes() {
      const container = document.getElementById("entityCheckboxes")
      const availableEntities = [
        "Uniswap",
        "SushiSwap",
        "PancakeSwap",
        "Curve",
        "Balancer",
        "Compound",
        "Aave",
        "MakerDAO",
        "1inch",
        "Kyber",
      ]
  
      container.innerHTML = ""
  
      availableEntities.forEach((entity) => {
        const item = document.createElement("div")
        item.className = "checkbox-item"
  
        const checkbox = document.createElement("input")
        checkbox.type = "checkbox"
        checkbox.id = `entity-${entity}`
        checkbox.value = entity
        checkbox.checked = this.derbyConfig.entities.includes(entity)
  
        const label = document.createElement("label")
        label.htmlFor = `entity-${entity}`
        label.textContent = entity
  
        item.appendChild(checkbox)
        item.appendChild(label)
        container.appendChild(item)
      })
    }
  
    setupRacetrack() {
      const racetrack = document.getElementById("racetrack")
      racetrack.innerHTML = ""
  
      this.derbyConfig.entities.forEach((entity, index) => {
        const lane = document.createElement("div")
        lane.className = "race-lane"
        lane.innerHTML = `
                  <div class="lane-background"></div>
                  <div class="lane-label">${entity}</div>
                  <div class="racer" id="racer-${entity}"></div>
              `
        racetrack.appendChild(lane)
  
        // Initialize racer position and data
        this.racerPositions[entity] = 0
        this.racerData[entity] = {
          tps: Math.floor(Math.random() * 1000 + 100),
          laps: 0,
          hash: this.generateRandomHash(),
        }
      })
    }
  
    updateScoreboard() {
      const content = document.getElementById("scoreboardContent")
      content.innerHTML = ""
  
      // Sort entities by TPS for leaderboard
      const sortedEntities = [...this.derbyConfig.entities].sort((a, b) => this.racerData[b].tps - this.racerData[a].tps)
  
      sortedEntities.forEach((entity, index) => {
        const data = this.racerData[entity]
        const card = document.createElement("div")
        card.className = "racer-card"
        card.innerHTML = `
                  <div class="racer-name">#${index + 1} ${entity}</div>
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
          // Update TPS with some variation
          const variation = (Math.random() - 0.5) * 200
          this.racerData[entity].tps = Math.max(50, Math.floor(this.racerData[entity].tps + variation))
  
          // Update position based on TPS
          const speed = this.racerData[entity].tps / 10000 // Normalize speed
          this.racerPositions[entity] += speed
  
          // Check for lap completion
          if (this.racerPositions[entity] >= 1) {
            this.racerPositions[entity] = 0
            this.racerData[entity].laps++
            this.racerData[entity].hash = this.generateRandomHash()
          }
  
          // Update racer visual position
          const racerElement = document.getElementById(`racer-${entity}`)
          if (racerElement) {
            const trackWidth = racerElement.parentElement.offsetWidth - 40
            const position = this.racerPositions[entity] * trackWidth
            racerElement.style.left = position + "px"
          }
        })
  
        this.updateScoreboard()
      }
  
      // Update race every 100ms for smooth animation
      setInterval(updateRace, 100)
    }
  
    generateRandomHash() {
      return "0x" + Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join("")
    }
  
    // Modal Management
    openConfigModal() {
      document.getElementById("configModal").classList.add("active")
    }
  
    closeConfigModal() {
      document.getElementById("configModal").classList.remove("active")
    }
  
    applyConfiguration() {
      const checkboxes = document.querySelectorAll('#entityCheckboxes input[type="checkbox"]')
      const selectedEntities = Array.from(checkboxes)
        .filter((cb) => cb.checked)
        .map((cb) => cb.value)
  
      if (selectedEntities.length === 0) {
        alert("Please select at least one entity to race.")
        return
      }
  
      this.derbyConfig.entities = selectedEntities
      this.racerPositions = {}
      this.racerData = {}
  
      this.setupRacetrack()
      this.closeConfigModal()
    }
  
    resetConfiguration() {
      this.derbyConfig.entities = ["Uniswap", "SushiSwap", "PancakeSwap", "Curve", "Balancer"]
      this.createEntityCheckboxes()
      this.setupRacetrack()
    }
  }
  
  // Initialize the application when DOM is loaded
  document.addEventListener("DOMContentLoaded", () => {
    new MonadVisualizer()
  })
  
  // Performance optimization: Use requestAnimationFrame for smooth animations
  let lastFrameTime = 0
  function optimizedUpdate(currentTime) {
    if (currentTime - lastFrameTime >= 16) {
      // ~60fps
      // Perform any frame-based updates here
      lastFrameTime = currentTime
    }
    requestAnimationFrame(optimizedUpdate)
  }
  requestAnimationFrame(optimizedUpdate)
  