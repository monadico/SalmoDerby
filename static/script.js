const canvas = document.getElementById('starCanvas');
const ctx = canvas.getContext('2d');
const tpsDisplay = document.getElementById('tps-counter');
const eventSource = new EventSource('/transaction-stream'); // FastAPI backend endpoint
const explorerTxBaseUrl = "https://testnet.monadexplorer.com/tx/";

let stars = [];
const STAR_CHAR = '✦';
const STAR_BASE_SIZE = 12;
const STAR_LIFESPAN_MS = 450; 
const STAR_CLICK_RADIUS = STAR_BASE_SIZE / 1.5; 
let txCounter = 0;
const transactionTimestamps = [];
const tpsWindowSeconds = 10;
const tpsUpdateIntervalMs = 1000;
const MAX_STARS_ON_CANVAS = 300;

function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    // #star-canvas-container is the parent whose size canvas should match
    const parentContainer = document.getElementById('star-canvas-container');
    if (!parentContainer) return;

    const rect = parentContainer.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    // Set style width/height for the canvas element itself to fit parent
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
}
window.addEventListener('resize', resizeCanvas);
// Initial resize after a very short delay to ensure parent container has dimensions
setTimeout(resizeCanvas, 50);


function updateTPS() {
    const now = Date.now();
    while (transactionTimestamps.length > 0 && transactionTimestamps[0] < now - (tpsWindowSeconds * 1000)) {
        transactionTimestamps.shift();
    }
    const tps = (transactionTimestamps.length / tpsWindowSeconds).toFixed(1);
    tpsDisplay.textContent = `TPS: ${tps}`;
}
setInterval(updateTPS, tpsUpdateIntervalMs);

function addStar(txData) {
    txCounter++;
    transactionTimestamps.push(Date.now());

    const dpr = window.devicePixelRatio || 1;
    // Use parentElement's dimensions for positioning, then draw on scaled canvas
    const containerWidth = canvas.parentElement.offsetWidth;
    const containerHeight = canvas.parentElement.offsetHeight;
    
    stars.push({
        x: Math.random() * (containerWidth - STAR_BASE_SIZE) + STAR_BASE_SIZE / 2, // Position in CSS pixels
        y: Math.random() * (containerHeight - STAR_BASE_SIZE) + STAR_BASE_SIZE / 2, // Position in CSS pixels
        alpha: 1.0,
        size: STAR_BASE_SIZE * (0.8 + Math.random() * 0.4), 
        txHash: txData.hash,
        blockNumber: txData.block_number,
        creationTime: Date.now(),
        driftX: (Math.random() - 0.5) * 0.2, 
        driftY: -0.3 - Math.random() * 0.3  
    });

    if (stars.length > MAX_STARS_ON_CANVAS) {
        stars.shift(); 
    }
}

function renderStars() {
    const now = Date.now();
    const dpr = window.devicePixelRatio || 1;
    const effectiveCanvasWidth = canvas.width / dpr;
    const effectiveCanvasHeight = canvas.height / dpr;
    
    ctx.clearRect(0, 0, effectiveCanvasWidth, effectiveCanvasHeight); 
    
    for (let i = stars.length - 1; i >= 0; i--) {
        const star = stars[i];
        const age = now - star.creationTime;

        if (age > STAR_LIFESPAN_MS) {
            stars.splice(i, 1); 
            continue;
        }

        const lifeRatio = age / STAR_LIFESPAN_MS; 
        
        if (lifeRatio < 0.3) { 
            star.currentAlpha = Math.min(1.0, lifeRatio / 0.3);
            star.currentSize = star.size * (0.5 + star.currentAlpha * 0.7); 
        } else { 
            star.currentAlpha = 1.0 - ((lifeRatio - 0.3) / 0.7);
            star.currentSize = star.size * star.currentAlpha * star.currentAlpha; 
        }
        star.currentSize = Math.max(2, star.currentSize); 
        star.x += star.driftX;
        star.y += star.driftY;

        ctx.globalAlpha = star.currentAlpha;
        ctx.font = `bold ${Math.round(star.currentSize)}px Arial, sans-serif`; 
        
        const r = 200 + Math.floor(Math.sin(now / 200 + i) * 55);
        const g = 200 + Math.floor(Math.sin(now / 300 + i * 2) * 55);
        const b = 220 + Math.floor(Math.sin(now / 400 + i * 3) * 35);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${star.currentAlpha})`;
        
        ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${star.currentAlpha * 0.7})`;
        ctx.shadowBlur = 3 + star.currentSize / 4;
        
        ctx.fillText(STAR_CHAR, star.x, star.y); // Draw at logical CSS pixel coordinate
    }
    ctx.globalAlpha = 1.0; 
    ctx.shadowBlur = 0;
    requestAnimationFrame(renderStars); 
}

canvas.addEventListener('click', function(event) {
    const rect = canvas.getBoundingClientRect();
    // clickX, clickY are relative to the canvas element's CSS dimensions
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;

    for (let i = stars.length - 1; i >= 0; i--) {
        const star = stars[i];
        // Star x, y are also in CSS pixel coordinates for positioning
        const currentDisplaySize = star.currentSize || star.size;
        const hitRadiusCurrent = STAR_CLICK_RADIUS * (currentDisplaySize / STAR_BASE_SIZE); 

        const dx = clickX - star.x; 
        const dy = clickY - star.y;
        if (dx * dx + dy * dy < hitRadiusCurrent * hitRadiusCurrent) {
            if (star.txHash && star.txHash !== 'N/A') {
                window.open(`${explorerTxBaseUrl}${star.txHash}`, '_blank');
            }
            break; 
        }
    }
});

eventSource.onopen = function() {
    console.log("SSE Stream connected. Waiting for stars...");
    // No status-message div in this version's HTML to update here
};

eventSource.addEventListener('new_transaction', function(event) {
    try {
        const txData = JSON.parse(event.data);
        addStar(txData); 
    } catch (e) {
        console.error("Failed to parse transaction data:", e, "Data:", event.data);
    }
});

eventSource.onerror = function(err) {
    console.error("EventSource failed:", err);
    // No status-message div to update here
};

console.log("JavaScript: EventSource connection initiated to /transaction-stream");
requestAnimationFrame(renderStars);