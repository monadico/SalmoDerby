// static/script.js
// Monad Testnet Visualizer: WebGL Particle System & Live Transaction Feed

// --- [CUSTOMIZATION] Definition of the star spawning zone ---
const spawnZone = [
    { x: 0.59, y: 0.75 }, { x: 0.86, y: 0.69 }, { x: 0.96, y: 0.61 },
    { x: 0.96, y: 0.34 }, { x: 0.84, y: 0.29 }, { x: 0.68, y: 0.21 },
    { x: 0.66, y: 0.15 }, { x: 0.58, y: 0.03 }, { x: 0.41, y: 0.02 },
    { x: 0.33, y: 0.09 }, { x: 0.28, y: 0.20 }, { x: 0.21, y: 0.30 },
    { x: 0.12, y: 0.35 }, { x: 0.02, y: 0.39 }, { x: 0.01, y: 0.49 },
    { x: 0.02, y: 0.57 }, { x: 0.06, y: 0.58 }, { x: 0.02, y: 0.72 },
    { x: 0.56, y: 0.75 },
];

// --- Point-in-Polygon helper function ---
function isPointInPolygon(point, polygon) {
    let isInside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        const intersect = ((yi > point.y) !== (yj > point.y))
            && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
        if (intersect) {
            isInside = !isInside;
        }
    }
    return isInside;
}

// --- HTML Element References & Globals ---
const canvas = document.getElementById('starCanvas');
const tpsDisplay = document.getElementById('tps-counter');
const performanceDisplay = document.getElementById('performance-counter');
const txList = document.getElementById('transaction-list');
let gl, program, particleSystem, animationId;
let frameCount = 0, lastFPSTime = 0, currentFPS = 0;
const transactionTimestamps = []; 
const tpsWindowSeconds = 10;
const tpsUpdateIntervalMs = 1000; 

// --- Configuration Constants ---
const MAX_PARTICLES = 15000;
const PARTICLE_LIFESPAN_MS = 800.0;
const PARTICLE_BASE_SIZE = 1.0; 
const DRIFT_SPEED_SCALE = 0.0005; 
const SSE_EVENT_NAME_BLOCKS = "new_block_summary";
const SSE_EVENT_NAME_TXS = "latest_transactions";

// --- Shaders ---
const vertexShaderSource = `
attribute vec2 a_particlePos; attribute float a_size; attribute float a_alpha; 
attribute float a_age; attribute vec3 a_color; uniform vec2 u_resolution;
varying float v_alpha_final; varying vec3 v_color; varying float v_glowIntensity;
void main() {
    vec2 zeroToOne = a_particlePos / u_resolution;
    vec2 clipSpace = (zeroToOne * 2.0 - 1.0) * vec2(1.0, -1.0); 
    gl_Position = vec4(clipSpace, 0.0, 1.0);
    float lifeRatio = a_age / ${PARTICLE_LIFESPAN_MS.toFixed(1)};
    float sizeMultiplier; float alphaMultiplier;
    if (lifeRatio < 0.3) { 
        alphaMultiplier = lifeRatio / 0.3;
        sizeMultiplier = 0.5 + alphaMultiplier * 0.7;
    } else { 
        float fadeRatio = (lifeRatio - 0.3) / 0.7;
        alphaMultiplier = 1.0 - fadeRatio;
        sizeMultiplier = alphaMultiplier * alphaMultiplier; 
    }
    gl_PointSize = a_size * sizeMultiplier * 25.0; 
    v_alpha_final = a_alpha * alphaMultiplier; 
    v_color = a_color;
    v_glowIntensity = sizeMultiplier;
}`;

const fragmentShaderSource = `
precision mediump float;
varying float v_alpha_final; varying vec3 v_color; varying float v_glowIntensity;
void main() {
    vec2 coord = gl_PointCoord - vec2(0.5); 
    float dist = length(coord);
    float coreAlpha = 1.0 - smoothstep(0.0, 0.35, dist); 
    float glowAlpha = 1.0 - smoothstep(0.15, 0.5, dist); 
    glowAlpha = glowAlpha * glowAlpha * 0.6; 
    float finalIntensity = coreAlpha * 0.8 + glowAlpha * v_glowIntensity;
    if (finalIntensity < 0.01 || v_alpha_final < 0.01) { discard; }
    gl_FragColor = vec4(v_color * finalIntensity, v_alpha_final * finalIntensity * coreAlpha);
}`;

// --- ParticleSystem Class ---
class ParticleSystem {
    constructor(maxParticles) { this.maxParticles = maxParticles; this.activeParticleCount = 0; this.nextAvailableIndex = 0; this.positions = new Float32Array(maxParticles * 2); this.velocities = new Float32Array(maxParticles * 2); this.sizes = new Float32Array(maxParticles); this.baseAlphas = new Float32Array(maxParticles); this.ages = new Float32Array(maxParticles); this.birthTimes = new Float32Array(maxParticles); this.colors = new Float32Array(maxParticles * 3); this.activeFlags = new Uint8Array(maxParticles); this.setupBuffers(); }
    setupBuffers() { this.positionBuffer = gl.createBuffer(); this.sizeBuffer = gl.createBuffer(); this.alphaBuffer = gl.createBuffer(); this.ageBuffer = gl.createBuffer(); this.colorBuffer = gl.createBuffer(); }
    
    addParticle() {
        let index = this.nextAvailableIndex;
        if (!this.activeFlags[index]) { this.activeParticleCount = Math.min(this.activeParticleCount + 1, this.maxParticles); }
        
        const canvasCssWidth = canvas.clientWidth;
        const canvasCssHeight = canvas.clientHeight;
        let spawnX, spawnY;

        let attempts = 0;
        const maxAttempts = 50;

        while (attempts < maxAttempts) {
            const candidateX = Math.random() * canvasCssWidth;
            const candidateY = Math.random() * canvasCssHeight;
            const normPoint = { x: candidateX / canvasCssWidth, y: candidateY / canvasCssHeight };
            if (isPointInPolygon(normPoint, spawnZone)) {
                spawnX = candidateX;
                spawnY = candidateY;
                break;
            }
            attempts++;
        }
        if (spawnX === undefined) { return; }

        this.activeFlags[index] = 1; this.nextAvailableIndex = (index + 1) % this.maxParticles;
        const currentTime = performance.now();
        this.positions[index * 2] = spawnX; this.positions[index * 2 + 1] = spawnY;
        this.velocities[index * 2] = (Math.random() - 0.5) * DRIFT_SPEED_SCALE * canvasCssWidth;
        this.velocities[index * 2 + 1] = (Math.random() - 0.5) * DRIFT_SPEED_SCALE * canvasCssHeight * 0.5;
        this.sizes[index] = PARTICLE_BASE_SIZE * (0.8 + Math.random() * 0.4);
        this.baseAlphas[index] = 1.0; this.ages[index] = 0; this.birthTimes[index] = currentTime;
        this.colors[index * 3] = 0.8 + Math.random() * 0.2; this.colors[index * 3 + 1] = 0.8 + Math.random() * 0.2; this.colors[index * 3 + 2] = 0.9 + Math.random() * 0.1;
    }

    update(currentTime) { let currentActive = 0; for (let i = 0; i < this.maxParticles; i++) { if (!this.activeFlags[i]) continue; const age = currentTime - this.birthTimes[i]; if (age > PARTICLE_LIFESPAN_MS) { this.activeFlags[i] = 0; this.activeParticleCount--; continue; } this.ages[i] = age; const dtSeconds = 16.67 / 1000; this.positions[i * 2] += this.velocities[i * 2] * dtSeconds; this.positions[i * 2 + 1] += this.velocities[i * 2 + 1] * dtSeconds; if (this.positions[i * 2] < 0 || this.positions[i * 2] > canvas.clientWidth || this.positions[i * 2 + 1] < 0 || this.positions[i * 2 + 1] > canvas.clientHeight) { this.activeFlags[i] = 0; this.activeParticleCount--; } currentActive++; } return currentActive; }
    
    render() {
        if (!gl || !program || this.activeParticleCount === 0) return;
        const activePositionsData = new Float32Array(this.activeParticleCount * 2); const activeSizesData = new Float32Array(this.activeParticleCount); const activeBaseAlphasData = new Float32Array(this.activeParticleCount); const activeAgesData = new Float32Array(this.activeParticleCount); const activeColorsData = new Float32Array(this.activeParticleCount * 3);
        let bufferWriteIdx = 0;
        for (let i = 0; i < this.maxParticles; i++) {
            if (this.activeFlags[i]) {
                activePositionsData[bufferWriteIdx * 2] = this.positions[i * 2]; activePositionsData[bufferWriteIdx * 2 + 1] = this.positions[i * 2 + 1];
                activeSizesData[bufferWriteIdx] = this.sizes[i]; activeBaseAlphasData[bufferWriteIdx] = this.baseAlphas[i];
                activeAgesData[bufferWriteIdx] = this.ages[i]; activeColorsData[bufferWriteIdx * 3] = this.colors[i * 3];
                activeColorsData[bufferWriteIdx * 3 + 1] = this.colors[i * 3 + 1]; activeColorsData[bufferWriteIdx * 3 + 2] = this.colors[i * 3 + 2];
                bufferWriteIdx++;
            }
        }
        const particlePosLocation = gl.getAttribLocation(program, 'a_particlePos'); const sizeLocation = gl.getAttribLocation(program, 'a_size'); const alphaLocation = gl.getAttribLocation(program, 'a_alpha'); const ageLocation = gl.getAttribLocation(program, 'a_age'); const colorLocation = gl.getAttribLocation(program, 'a_color');
        
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
        gl.drawArrays(gl.POINTS, 0, this.activeParticleCount);
    }
}

// --- WebGL & App Initialization ---
function createShader(glContext, type, source) { const shader = glContext.createShader(type); glContext.shaderSource(shader, source); glContext.compileShader(shader); if (!glContext.getShaderParameter(shader, glContext.COMPILE_STATUS)) { console.error(`Shader compilation error:`, glContext.getShaderInfoLog(shader)); glContext.deleteShader(shader); return null; } return shader; }
function createProgram(glContext, vertexShader, fragmentShader) { const prog = glContext.createProgram(); glContext.attachShader(prog, vertexShader); glContext.attachShader(prog, fragmentShader); glContext.linkProgram(prog); if (!glContext.getProgramParameter(prog, glContext.LINK_STATUS)) { console.error('Program linking error:', glContext.getProgramInfoLog(prog)); return null; } return prog; }
function initWebGL() { gl = canvas.getContext('webgl', { antialias: true }); if (!gl) { console.error('WebGL not supported!'); return false; } const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource); const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource); if (!vertexShader || !fragmentShader) return false; program = createProgram(gl, vertexShader, fragmentShader); if (!program) return false; gl.useProgram(program); gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); particleSystem = new ParticleSystem(MAX_PARTICLES); return true; }
function resizeCanvasAndWebGLContext() {
    const displayWidth  = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;
    if (canvas.width  !== displayWidth || canvas.height !== displayHeight) {
        canvas.width  = displayWidth;
        canvas.height = displayHeight;
        if (gl) { gl.viewport(0, 0, canvas.width, canvas.height); }
        if (program) { const resolutionLocation = gl.getUniformLocation(program, 'u_resolution'); gl.uniform2f(resolutionLocation, canvas.width, canvas.height); }
    }
}
function renderLoop(currentTimeMs) { animationId = requestAnimationFrame(renderLoop); if (!gl || !particleSystem || !program) return; resizeCanvasAndWebGLContext(); frameCount++; const nowMs = performance.now(); if (nowMs - lastFPSTime >= 1000) { currentFPS = frameCount; lastFPSTime = nowMs; frameCount = 0; } gl.clearColor(0.0, 0.0, 0.0, 0.0); gl.clear(gl.COLOR_BUFFER_BIT); const activeParticles = particleSystem.update(nowMs); if (performanceDisplay) { performanceDisplay.textContent = `Stars: ${activeParticles} | FPS: ${currentFPS}`; } particleSystem.render(); }
function updateTPSDisplay() { const now = Date.now(); while (transactionTimestamps.length > 0 && transactionTimestamps[0] < now - (tpsWindowSeconds * 1000)) { transactionTimestamps.shift(); } const tps = (transactionTimestamps.length / tpsWindowSeconds).toFixed(1); if (tpsDisplay) { tpsDisplay.textContent = `TPS: ${tps}`; } }

function init() {
    if (!initWebGL()) { const starContainer = document.getElementById('star-canvas-container'); if(starContainer) starContainer.innerHTML = "<p style='color:red; text-align:center;'>WebGL not supported or failed to initialize.</p>"; return; }
    console.log("WebGL particle system initialized.");
    resizeCanvasAndWebGLContext(); 
    window.addEventListener('resize', resizeCanvasAndWebGLContext);
    setInterval(updateTPSDisplay, tpsUpdateIntervalMs);
    lastFPSTime = performance.now();
    renderLoop(performance.now()); 
    console.log("High-performance WebGL particle system ready.");
}

// --- SSE Connections ---
// Connect to the main visualizer's stream
const blockSummaryEventSource = new EventSource('/transaction-stream');
blockSummaryEventSource.onopen = function() { console.log("JS: Block Summary SSE Stream connected. Listening for 'new_block_summary' events..."); };
blockSummaryEventSource.addEventListener(SSE_EVENT_NAME_BLOCKS, function(event) {
    try {
        const blockSummaryBatch = JSON.parse(event.data); 
        if (Array.isArray(blockSummaryBatch)) {
            for (const blockSummary of blockSummaryBatch) {
                const txCount = blockSummary.transaction_count || 0;
                for (let i = 0; i < txCount; i++) {
                    if (particleSystem) { transactionTimestamps.push(Date.now()); particleSystem.addParticle(); }
                }
            }
        }
    } catch (e) { console.error("JS ERROR: Failed to parse or process block summary data:", e, "Data was:", event.data); }
});
blockSummaryEventSource.onerror = function(err) { console.error("JS: Block Summary EventSource failed:", err); };

// Connect to the new transaction feed stream
const txFeedEventSource = new EventSource('/latest-tx-feed');
txFeedEventSource.onopen = function() { console.log("JS: Transaction Feed SSE Stream connected. Listening for 'latest_transactions' events..."); };
txFeedEventSource.addEventListener(SSE_EVENT_NAME_TXS, function(event) {
    if (!txList) return;
    try {
        const transactions = JSON.parse(event.data); 
        const fragment = document.createDocumentFragment();
        transactions.forEach(tx => {
            const listItem = document.createElement('li');
            const explorerUrl = `https://testnet.monadexplorer.com/tx/${tx.hash}`;
            const valueInWei = BigInt(tx.value || '0'); 
            const valueInMon = (Number(valueInWei) / 1e18).toFixed(4);
            const from_addr = tx.from || 'N/A'; 
            const to_addr = tx.to || 'N/A';
            listItem.innerHTML = `<a href="${explorerUrl}" target="_blank" rel="noopener noreferrer"><span class="tx-hash" title="${tx.hash}">Hash: ${tx.hash.substring(0, 12)}...</span><br><span class="tx-from" title="${from_addr}">From: ${from_addr.substring(0, 14)}...</span> &rarr; <span class="tx-to" title="${to_addr}">To: ${to_addr.substring(0, 14)}...</span><span class="tx-value">${valueInMon} MON</span></a>`;
            fragment.appendChild(listItem);
        });
        txList.innerHTML = ''; 
        txList.appendChild(fragment);
    } catch (e) { console.error("JS ERROR: Failed to parse transaction feed data:", e, "Data:", event.data); }
});
txFeedEventSource.onerror = function(err) { console.error("JS: Transaction Feed EventSource failed:", err); };

// --- Cleanup and Initialization Listeners ---
document.addEventListener('DOMContentLoaded', init);
window.addEventListener('beforeunload', function() {
    if (animationId) { cancelAnimationFrame(animationId); }
    if (blockSummaryEventSource) { blockSummaryEventSource.close(); }
    if (txFeedEventSource) { txFeedEventSource.close(); }
});
