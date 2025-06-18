// Math Utilities
class MathUtils {
  // Linear interpolation
  static lerp(start, end, factor) {
    return start + (end - start) * factor
  }

  // Smooth step interpolation
  static smoothStep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)
  }

  // Clamp value between min and max
  static clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
  }

  // Map value from one range to another
  static map(value, inMin, inMax, outMin, outMax) {
    return ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin
  }

  // Random number between min and max
  static random(min = 0, max = 1) {
    return Math.random() * (max - min) + min
  }

  // Random integer between min and max (inclusive)
  static randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
  }

  // Distance between two points
  static distance(x1, y1, x2, y2) {
    const dx = x2 - x1
    const dy = y2 - y1
    return Math.sqrt(dx * dx + dy * dy)
  }

  // Angle between two points
  static angle(x1, y1, x2, y2) {
    return Math.atan2(y2 - y1, x2 - x1)
  }

  // Normalize angle to 0-2π range
  static normalizeAngle(angle) {
    while (angle < 0) angle += Math.PI * 2
    while (angle >= Math.PI * 2) angle -= Math.PI * 2
    return angle
  }

  // Convert degrees to radians
  static degToRad(degrees) {
    return (degrees * Math.PI) / 180
  }

  // Convert radians to degrees
  static radToDeg(radians) {
    return (radians * 180) / Math.PI
  }

  // Easing functions
  static easeInOut(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
  }

  static easeOut(t) {
    return 1 - Math.pow(1 - t, 3)
  }

  static easeIn(t) {
    return t * t * t
  }

  // Noise function (simplified Perlin noise)
  static noise(x, y = 0, z = 0) {
    // Simple hash-based noise
    const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453
    return (n - Math.floor(n)) * 2 - 1
  }

  // Vector operations
  static vector2(x = 0, y = 0) {
    return { x, y }
  }

  static vectorAdd(v1, v2) {
    return { x: v1.x + v2.x, y: v1.y + v2.y }
  }

  static vectorSubtract(v1, v2) {
    return { x: v1.x - v2.x, y: v1.y - v2.y }
  }

  static vectorMultiply(v, scalar) {
    return { x: v.x * scalar, y: v.y * scalar }
  }

  static vectorMagnitude(v) {
    return Math.sqrt(v.x * v.x + v.y * v.y)
  }

  static vectorNormalize(v) {
    const mag = this.vectorMagnitude(v)
    return mag > 0 ? { x: v.x / mag, y: v.y / mag } : { x: 0, y: 0 }
  }

  // Check if point is inside circle
  static pointInCircle(px, py, cx, cy, radius) {
    return this.distance(px, py, cx, cy) <= radius
  }

  // Check if point is inside rectangle
  static pointInRect(px, py, rx, ry, rw, rh) {
    return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh
  }
}

window.MathUtils = MathUtils
