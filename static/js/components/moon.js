// Moon Component
class Moon {
  constructor(element) {
    this.element = element
    this.imageContainer = element.querySelector("#moonImageContainer")
    this.isRotating = true
    this.rotationSpeed = 1
    this.currentImage = null

    this.init()
  }

  init() {
    this.setupEffects()
    this.bindEvents()
  }

  setupEffects() {
    // Add liquid glass effects
    if (window.LiquidGlassEffects) {
      window.LiquidGlassEffects.addElement(this.element, {
        followMouse: true,
        holographic: true,
        intensity: 1.5,
      })
    }
  }

  bindEvents() {
    // Click interaction
    this.element.addEventListener("click", (e) => {
      this.createClickEffect(e)
    })

    // Hover effects
    this.element.addEventListener("mouseenter", () => {
      this.element.style.animationDuration = "15s"
    })

    this.element.addEventListener("mouseleave", () => {
      this.element.style.animationDuration = "30s"
    })
  }

  loadImage(imageUrl) {
    return new Promise((resolve, reject) => {
      // Clear existing content
      this.imageContainer.innerHTML = ""

      if (!imageUrl) {
        resolve()
        return
      }

      const img = document.createElement("img")
      img.src = imageUrl
      img.alt = "Monad Character"
      img.style.cssText = `
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 50%;
        opacity: 0;
        transition: opacity 0.8s ease;
      `

      img.onload = () => {
        // Fade in effect
        requestAnimationFrame(() => {
          img.style.opacity = "1"
        })
        this.currentImage = img
        resolve(img)
      }

      img.onerror = () => {
        console.warn("Failed to load moon image:", imageUrl)
        reject(new Error("Failed to load image"))
      }

      this.imageContainer.appendChild(img)
    })
  }

  createClickEffect(event) {
    const rect = this.element.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2

    // Create ripple effect
    if (window.LiquidGlassEffects) {
      window.LiquidGlassEffects.createRippleEffect(centerX, centerY, document.body)
    }

    // Trigger star burst
    if (window.visualizer && window.visualizer.createMoonBurst) {
      window.visualizer.createMoonBurst()
    }

    // Temporary scale effect
    this.element.style.transform = "translate(-50%, -50%) scale(1.1)"
    setTimeout(() => {
      this.element.style.transform = "translate(-50%, -50%) scale(1)"
    }, 200)
  }

  setRotationSpeed(speed) {
    const MathUtils = {
      clamp: (value, min, max) => Math.min(Math.max(value, min), max),
    }
    this.rotationSpeed = MathUtils.clamp(speed, 0, 3)
    const duration = 30 / this.rotationSpeed
    this.element.style.animationDuration = `${duration}s`
  }

  pauseRotation() {
    this.isRotating = false
    this.element.style.animationPlayState = "paused"
  }

  resumeRotation() {
    this.isRotating = true
    this.element.style.animationPlayState = "running"
  }

  destroy() {
    if (window.LiquidGlassEffects) {
      window.LiquidGlassEffects.removeElement(this.element)
    }
  }
}

window.Moon = Moon
