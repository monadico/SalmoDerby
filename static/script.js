// static/script.js
// High-Performance WebGL Particle System for Blockchain Transaction Visualization

const canvas = document.getElementById('starCanvas');
const tpsDisplay = document.getElementById('tps-counter');
const performanceDisplay = document.getElementById('performance-counter');

// WebGL context and performance settings
let gl;
let program;
let particleSystem;
let animationId; // To store requestAnimationFrame ID for potential cancellation

// Performance monitoring
let frameCount = 0;
let lastFPSTime = 0;
let currentFPS = 0;

// Transaction tracking for TPS
let txCounter = 0; 
const transactionTimestamps = []; 
const tpsWindowSeconds = 10;
const tpsUpdateIntervalMs = 1000; 

// Optimized constants for WebGL particles (from your WebGL example)
const MAX_PARTICLES = 12000;
const PARTICLE_LIFESPAN_MS = 450.0; 
const PARTICLE_BASE_SIZE = 1.0;   
const DRIFT_SPEED_SCALE = 0.0005; 

// SSE Event name from Python backend (must match)
const SSE_BATCH_EVENT_NAME = "new_transactions_batch"; // Python backend sends batches with this event name
const explorerTxBaseUrl = "https://testnet.monadexplorer.com/tx/";

// Vertex shader for particle rendering (from your WebGL example)
const vertexShaderSource = `
attribute vec2 a_particlePos;
attribute float a_size;
attribute float a_alpha; 
attribute float a_age;
attribute vec3 a_color;

uniform vec2 u_resolution;
uniform float u_time; 

varying float v_alpha_final; 
varying vec3 v_color;
varying float v_glowIntensity;

void main() {
    vec2 zeroToOne = a_particlePos / u_resolution;
    vec2 clipSpace = (zeroToOne * 2.0 - 1.0) * vec2(1.0, -1.0); 
    
    gl_Position = vec4(clipSpace, 0.0, 1.0);

    float lifeRatio = a_age / ${PARTICLE_LIFESPAN_MS.toFixed(1)};
    float sizeMultiplier;
    float alphaMultiplier;
    
    if (lifeRatio < 0.3) { 
        alphaMultiplier = lifeRatio / 0.3;
        sizeMultiplier = 0.5 + alphaMultiplier * 0.7;
    } else { 
        float fadeRatio = (lifeRatio - 0.3) / 0.7;
        alphaMultiplier = 1.0 - fadeRatio;
        sizeMultiplier = alphaMultiplier * alphaMultiplier; 
    }
    sizeMultiplier = max(0.0, sizeMultiplier);
    alphaMultiplier = max(0.0, alphaMultiplier);
    
    gl_PointSize = a_size * sizeMultiplier * 25.0; 
    
    v_alpha_final = a_alpha * alphaMultiplier; 
    v_color = a_color;
    v_glowIntensity = sizeMultiplier;
}
`;

// Fragment shader for particle rendering (from your WebGL example)
const fragmentShaderSource = `
precision mediump float;

varying float v_alpha_final;
varying vec3 v_color;
varying float v_glowIntensity;

void main() {
    vec2 coord = gl_PointCoord - vec2(0.5); 
    float dist = length(coord);
    
    float coreAlpha = 1.0 - smoothstep(0.0, 0.35, dist); 
    float glowAlpha = 1.0 - smoothstep(0.15, 0.5, dist); 
    glowAlpha = glowAlpha * glowAlpha * 0.6; 
    
    float finalIntensity = coreAlpha * 0.8 + glowAlpha * v_glowIntensity;
    
    if (finalIntensity < 0.01 || v_alpha_final < 0.01) { discard; }

    gl_FragColor = vec4(v_color * finalIntensity, v_alpha_final * finalIntensity * coreAlpha);
}
`;

class ParticleSystem {
    constructor(maxParticles) {
        this.maxParticles = maxParticles;
        this.activeParticleCount = 0;
        this.nextAvailableIndex = 0;
        
        this.positions = new Float32Array(maxParticles * 2);
        this.velocities = new Float32Array(maxParticles * 2);
        this.sizes = new Float32Array(maxParticles);
        this.baseAlphas = new Float32Array(maxParticles);
        this.ages = new Float32Array(maxParticles);
        this.birthTimes = new Float32Array(maxParticles);
        this.colors = new Float32Array(maxParticles * 3);
        this.activeFlags = new Uint8Array(maxParticles);
        this.txHashes = new Array(maxParticles).fill(null);

        this.setupBuffers();
    }
    
    setupBuffers() {
        this.positionBuffer = gl.createBuffer();
        this.sizeBuffer = gl.createBuffer();
        this.alphaBuffer = gl.createBuffer();
        this.ageBuffer = gl.createBuffer();
        this.colorBuffer = gl.createBuffer();
        
        const staticPointVertices = new Float32Array(this.maxParticles * 2); 
        this.staticPointVertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.staticPointVertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, staticPointVertices, gl.STATIC_DRAW);
    }
    
    addParticle(txData) { 
        let index = this.nextAvailableIndex;
        if (!this.activeFlags[index]) {
            this.activeParticleCount = Math.min(this.activeParticleCount + 1, this.maxParticles);
        }
        this.activeFlags[index] = 1;
        this.nextAvailableIndex = (index + 1) % this.maxParticles;

        const currentTime = performance.now();
        const canvasCssWidth = canvas.clientWidth;
        const canvasCssHeight = canvas.clientHeight;

        this.positions[index * 2] = Math.random() * canvasCssWidth;
        this.positions[index * 2 + 1] = Math.random() * canvasCssHeight;
        
        this.velocities[index * 2] = (Math.random() - 0.5) * DRIFT_SPEED_SCALE * canvasCssWidth;
        this.velocities[index * 2 + 1] = (-0.3 * DRIFT_SPEED_SCALE - Math.random() * 0.3 * DRIFT_SPEED_SCALE) * canvasCssHeight;
        
        this.sizes[index] = PARTICLE_BASE_SIZE * (0.8 + Math.random() * 0.4);
        this.baseAlphas[index] = 1.0;
        this.ages[index] = 0;
        this.birthTimes[index] = currentTime;
        
        this.colors[index * 3] = 0.8 + Math.random() * 0.2; 
        this.colors[index * 3 + 1] = 0.8 + Math.random() * 0.2; 
        this.colors[index * 3 + 2] = 0.9 + Math.random() * 0.1; 
        
        this.txHashes[index] = txData.hash; 
    }
    
    update(currentTime) {
        let currentActive = 0;
        for (let i = 0; i < this.maxParticles; i++) {
            if (!this.activeFlags[i]) continue;
            const age = currentTime - this.birthTimes[i];
            if (age > PARTICLE_LIFESPAN_MS) {
                this.activeFlags[i] = 0; this.txHashes[i] = null; this.activeParticleCount--; continue;
            }
            this.ages[i] = age;
            const dtSeconds = 16.67 / 1000; 
            this.positions[i * 2] += this.velocities[i * 2] * dtSeconds;
            this.positions[i * 2 + 1] += this.velocities[i * 2 + 1] * dtSeconds;

            const dpr = window.devicePixelRatio || 1;
            const canvasEffectiveWidth = canvas.width / dpr; 
            const canvasEffectiveHeight = canvas.height / dpr;
            if (this.positions[i * 2] < 0 || this.positions[i * 2] > canvasEffectiveWidth ||
                this.positions[i * 2 + 1] < 0 || this.positions[i * 2 + 1] > canvasEffectiveHeight) {
                this.activeFlags[i] = 0; this.txHashes[i] = null; this.activeParticleCount--;
            }
            currentActive++;
        }
        return currentActive; 
    }
    
    render() {
        if (!gl || !program || this.activeParticleCount === 0) return;

        const activePositionsData = new Float32Array(this.activeParticleCount * 2);
        const activeSizesData = new Float32Array(this.activeParticleCount);
        const activeBaseAlphasData = new Float32Array(this.activeParticleCount);
        const activeAgesData = new Float32Array(this.activeParticleCount);
        const activeColorsData = new Float32Array(this.activeParticleCount * 3);

        let bufferWriteIdx = 0;
        for (let i = 0; i < this.maxParticles; i++) {
            if (this.activeFlags[i]) {
                activePositionsData[bufferWriteIdx * 2]     = this.positions[i * 2];
                activePositionsData[bufferWriteIdx * 2 + 1] = this.positions[i * 2 + 1];
                activeSizesData[bufferWriteIdx]             = this.sizes[i];
                activeBaseAlphasData[bufferWriteIdx]        = this.baseAlphas[i];
                activeAgesData[bufferWriteIdx]              = this.ages[i];
                activeColorsData[bufferWriteIdx * 3]        = this.colors[i * 3];
                activeColorsData[bufferWriteIdx * 3 + 1]    = this.colors[i * 3 + 1];
                activeColorsData[bufferWriteIdx * 3 + 2]    = this.colors[i * 3 + 2];
                bufferWriteIdx++;
            }
        }

        const particlePosLocation = gl.getAttribLocation(program, 'a_particlePos');
        const sizeLocation = gl.getAttribLocation(program, 'a_size');
        const alphaLocation = gl.getAttribLocation(program, 'a_alpha');
        const ageLocation = gl.getAttribLocation(program, 'a_age');
        const colorLocation = gl.getAttribLocation(program, 'a_color');
        const staticPositionLocation = gl.getAttribLocation(program, "a_position");

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer); gl.bufferData(gl.ARRAY_BUFFER, activePositionsData, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(particlePosLocation); gl.vertexAttribPointer(particlePosLocation, 2, gl.FLOAT, false, 0, 0);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuffer); gl.bufferData(gl.ARRAY_BUFFER, activeSizesData, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(sizeLocation); gl.vertexAttribPointer(sizeLocation, 1, gl.FLOAT, false, 0, 0);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.alphaBuffer); gl.bufferData(gl.ARRAY_BUFFER, activeBaseAlphasData, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(alphaLocation); gl.vertexAttribPointer(alphaLocation, 1, gl.FLOAT, false, 0, 0);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.ageBuffer); gl.bufferData(gl.ARRAY_BUFFER, activeAgesData, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(ageLocation); gl.vertexAttribPointer(ageLocation, 1, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer); gl.bufferData(gl.ARRAY_BUFFER, activeColorsData, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(colorLocation); gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, 0, 0);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.staticPointVertexBuffer);
        gl.enableVertexAttribArray(staticPositionLocation);
        gl.vertexAttribPointer(staticPositionLocation, 2, gl.FLOAT, false, 0, 0); 
        
        gl.drawArrays(gl.POINTS, 0, this.activeParticleCount);
    }
}

function createShader(glContext, type, source) {
    const shader = glContext.createShader(type); glContext.shaderSource(shader, source); glContext.compileShader(shader);
    if (!glContext.getShaderParameter(shader, glContext.COMPILE_STATUS)) {
        console.error(`Shader compilation error (${type === gl.VERTEX_SHADER ? 'Vertex' : 'Fragment'} Shader):`, glContext.getShaderInfoLog(shader));
        glContext.deleteShader(shader); return null;
    } return shader;
}
function createProgram(glContext, vertexShader, fragmentShader) {
    const prog = glContext.createProgram(); glContext.attachShader(prog, vertexShader); glContext.attachShader(prog, fragmentShader); glContext.linkProgram(prog);
    if (!glContext.getProgramParameter(prog, glContext.LINK_STATUS)) {
        console.error('Program linking error:', glContext.getProgramInfoLog(prog));
        glContext.deleteProgram(prog); return null;
    } return prog;
}

function initWebGL() {
    gl = canvas.getContext('webgl', { preserveDrawingBuffer: false, antialias: true }) || 
         canvas.getContext('experimental-webgl', { preserveDrawingBuffer: false, antialias: true });
    if (!gl) {
        console.error('WebGL not supported! Please use a modern browser.');
        if(performanceDisplay) performanceDisplay.textContent = "WebGL Not Supported!";
        return false;
    }
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    if (!vertexShader || !fragmentShader) return false;
    program = createProgram(gl, vertexShader, fragmentShader);
    if (!program) return false;
    gl.useProgram(program); gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    particleSystem = new ParticleSystem(MAX_PARTICLES);
    console.log('WebGL particle system initialized.');
    return true;
}

function resizeCanvasAndWebGLContext() {
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = canvas.clientWidth;  
    const displayHeight = canvas.clientHeight;
    const newBufferWidth = Math.round(displayWidth * dpr);
    const newBufferHeight = Math.round(displayHeight * dpr);
    if (canvas.width !== newBufferWidth || canvas.height !== newBufferHeight) {
        canvas.width = newBufferWidth; canvas.height = newBufferHeight;
        if (gl && program) { 
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
            const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
            gl.uniform2f(resolutionLocation, gl.drawingBufferWidth, gl.drawingBufferHeight);
        }
    }
}

let lastFrameTimeMs = 0;
function renderLoop(currentTimeMs) { 
    animationId = requestAnimationFrame(renderLoop); 
    if (!gl || !particleSystem || !program) return;
    resizeCanvasAndWebGLContext(); 
    frameCount++;
    const nowMs = performance.now();
    if (nowMs - lastFPSTime >= 1000) { currentFPS = frameCount; lastFPSTime = nowMs; frameCount = 0; }
    gl.clearColor(0.0, 0.0, 0.0, 0.0); 
    gl.clear(gl.COLOR_BUFFER_BIT);
    const activeParticles = particleSystem.update(nowMs); 
    const timeLocation = gl.getUniformLocation(program, 'u_time');
    if (timeLocation !== null) { gl.uniform1f(timeLocation, nowMs * 0.001); }
    particleSystem.render();
    if (performanceDisplay) { performanceDisplay.textContent = `Stars: ${activeParticles} | FPS: ${currentFPS}`; }
    lastFrameTimeMs = currentTimeMs;
}

function updateTPSDisplay() {
    const now = Date.now();
    while (transactionTimestamps.length > 0 && transactionTimestamps[0] < now - (tpsWindowSeconds * 1000)) {
        transactionTimestamps.shift();
    }
    const tps = (transactionTimestamps.length / tpsWindowSeconds).toFixed(1);
    if (tpsDisplay) { tpsDisplay.textContent = `TPS: ${tps}`; }
}

canvas.addEventListener('click', function(event) {
    if (!particleSystem || !gl) return;
    const rect = canvas.getBoundingClientRect();
    const clickX_css = event.clientX - rect.left;
    const clickY_css = event.clientY - rect.top;

    for (let i = 0; i < particleSystem.maxParticles; i++) {
        if (particleSystem.activeFlags[i]) {
            const particleX_css = particleSystem.positions[i * 2]; 
            const particleY_css = particleSystem.positions[i * 2 + 1];
            
            // Approximate visual size for click radius.
            const age = performance.now() - particleSystem.birthTimes[i];
            let currentVisualSizeFactor = 0;
            if (age <= PARTICLE_LIFESPAN_MS) {
                const lifeRatio = age / PARTICLE_LIFESPAN_MS;
                 if (lifeRatio < 0.3) { 
                    currentVisualSizeFactor = 0.5 + (lifeRatio / 0.3) * 0.7;
                } else { 
                    const fadeRatio = (lifeRatio - 0.3) / 0.7;
                    currentVisualSizeFactor = (1.0 - fadeRatio) * (1.0 - fadeRatio); 
                }
                currentVisualSizeFactor = Math.max(0.0, currentVisualSizeFactor);
            }
            const clickRadius = particleSystem.sizes[i] * currentVisualSizeFactor * 25.0 * 0.5 / (window.devicePixelRatio || 1); // Approx half of gl_PointSize in CSS px

            const dx = clickX_css - particleX_css;
            const dy = clickY_css - particleY_css;
            if (dx * dx + dy * dy < clickRadius * clickRadius) {
                const txHash = particleSystem.txHashes[i];
                if (txHash && txHash !== 'N/A') {
                    window.open(`${explorerTxBaseUrl}${txHash}`, '_blank');
                    return; 
                }
            }
        }
    }
});

function init() {
    if (!initWebGL()) { 
        const starContainer = document.getElementById('star-canvas-container');
        if(starContainer) starContainer.innerHTML = "<p style='color:red; text-align:center; padding-top: 50px;'>WebGL not supported or failed to initialize. Cannot display stars.</p>";
        return;
    }
    resizeCanvasAndWebGLContext(); 
    window.addEventListener('resize', resizeCanvasAndWebGLContext);
    setInterval(updateTPSDisplay, tpsUpdateIntervalMs);
    lastFPSTime = performance.now();
    renderLoop(performance.now()); 
    console.log('High-performance WebGL particle system ready.');
}

const eventSource = new EventSource('/transaction-stream');

eventSource.onopen = function() {
    console.log(`JS: SSE Stream connected. Listening for '${SSE_BATCH_EVENT_NAME}' events...`);
};

// MODIFIED TO HANDLE BATCHED EVENTS
eventSource.addEventListener(SSE_BATCH_EVENT_NAME, function(event) {
    // console.log("JS: Received raw data for batch event:", event.data); 
    try {
        const txBatch = JSON.parse(event.data);
        // console.log("JS: Parsed txBatch:", txBatch); 

        if (Array.isArray(txBatch)) {
            // console.log(`JS: Processing batch of ${txBatch.length} transactions.`);
            for (const txData of txBatch) {
                if (particleSystem && typeof particleSystem.addParticle === 'function') {
                    transactionTimestamps.push(Date.now());
                    particleSystem.addParticle(txData); 
                } else {
                     console.error("JS ERROR: particleSystem not initialized or addParticle is not a function!");
                }
            }
        } else {
             console.error("JS ERROR: Received non-array data for batch event. Data:", txBatch);
        }
    } catch (e) {
        console.error("JS ERROR: Failed to parse or process transaction batch data:", e, "Problematic data was:", event.data);
    }
});

eventSource.onerror = function(err) { 
    console.error("JS: EventSource failed:", err); 
};

document.addEventListener('DOMContentLoaded', init);

window.addEventListener('beforeunload', function() {
    if (animationId) {
        cancelAnimationFrame(animationId);
    }
    if (eventSource) {
        eventSource.close();
    }
});