class MonadVisualizer {
  constructor() {
    this.currentTab = "cityscape";
    this.eventSource = null;
    this.derbyEventSource = null; // New EventSource for the Derby

    // --- Cityscape State ---
    this.currentTps = 0;
    this.blockNumber = 0;
    this.totalTxFees = 0;
    this.maxTpsForBar = 8000;
    this.renderQueue = []; 
    this.isProcessingQueue = false;
    this.MAX_QUEUE_SIZE = 500;
    this.RENDER_THRESHOLD = 10; 
    this.MAX_RENDER_DELAY = 20; 
    this.MIN_RENDER_DELAY = 1;

    // --- Derby State ---
    this.derbyConfig = {
      // This list will eventually be configurable via the modal.
      // For now, it mirrors the default backend entities.
      entities: [ "LFJ", "PancakeSwap", "Bean Exchange", "Ambient Finance", "Izumi Finance", "Octoswap", "Uniswap" ],
    };
    this.racerData = {}; // To store latest TPS data { name: { tps: 0 } }
    this.racerProgress = {}; // To store visual progress { name: 0 }
    this.numGridLines = 10;
    
    this.init();
    window.visualizer = this;
  }

  init() {
    this.setupEventListeners();
    this.setupGridLines();
    this.initializeDerby();
    this.connectToStream(); // Connect to the default cityscape stream first
  }

  // --- Stream Connection Management ---

  connectToStream() {
    console.log("Connecting to Cityscape firehose stream...");
    this.closeStreams(); // Ensure no other streams are active

    const streamUrl = 'http://localhost:8000/firehose-stream';
    this.eventSource = new EventSource(streamUrl);

    this.eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if(data.error) { console.error("Backend Error:", data.error); return; }
            this.updateStatsBar(data);
            if (data.transactions && data.transactions.length > 0) {
                const overflowCount = (this.renderQueue.length + data.transactions.length) - this.MAX_QUEUE_SIZE;
                if (overflowCount > 0) this.renderQueue.splice(0, overflowCount);
                this.renderQueue.push(...data.transactions);
                if (!this.isProcessingQueue) this.processRenderQueue();
            }
        } catch (e) { console.error("Error parsing Cityscape SSE data:", e); }
    };
    this.eventSource.onerror = (err) => { console.error("EventSource failed:", err); this.closeStreams(); };
  }

  connectToDerbyStream() {
    console.log("Connecting to Perpetual Derby stream...");
    this.closeStreams(); // Ensure no other streams are active

    const streamUrl = 'http://localhost:8000/derby-stream';
    this.derbyEventSource = new EventSource(streamUrl);

    this.derbyEventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.error) { console.error("Backend Derby Error:", data.error); return; }
            
            // Update racer data and UI
            this.racerData = data;
            this.updateDerbyUI();

        } catch (e) { console.error("Error parsing Derby SSE data:", e); }
    };
    this.derbyEventSource.onerror = (err) => { console.error("Derby EventSource failed:", err); this.closeStreams(); };
  }

  closeStreams() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      console.log("Closed cityscape stream.");
    }
    if (this.derbyEventSource) {
      this.derbyEventSource.close();
      this.derbyEventSource = null;
      console.log("Closed derby stream.");
    }
  }

  // --- Cityscape Methods ---

  processRenderQueue() { /* ... (previous implementation is correct, no changes needed) ... */
    this.isProcessingQueue = true;
    if (this.renderQueue.length === 0) { this.isProcessingQueue = false; return; }
    const itemsToRenderCount = this.renderQueue.length > this.RENDER_THRESHOLD ? 3 : 1;
    for (let i = 0; i < itemsToRenderCount; i++) {
        const tx = this.renderQueue.shift();
        if (tx) {
            const transaction = { type: this.getTransactionType(tx.value), hash: tx.hash, timestamp: new Date().toISOString(), value: parseFloat(tx.value) || 0 };
            this.createTransactionBar(transaction);
            this.addToDataFeed(transaction);
        }
    }
    const delay = Math.max(this.MIN_RENDER_DELAY, this.MAX_RENDER_DELAY - Math.floor(this.renderQueue.length / 10));
    setTimeout(() => { this.processRenderQueue(); }, delay);
  }
  updateStatsBar(data) { /* ... (previous implementation is correct, no changes needed) ... */
    if (!data) return;
    const tpsValueElement = document.getElementById('liveTpsValue');
    const tpsGaugeInnerElement = document.getElementById('tpsGaugeInner');
    if (tpsValueElement && tpsGaugeInnerElement && data.tps !== undefined) {
        this.currentTps = data.tps;
        tpsValueElement.textContent = this.currentTps.toFixed(1);
        const gaugePercentage = Math.min(100, (this.currentTps / this.maxTpsForBar) * 100);
        tpsGaugeInnerElement.style.width = `${gaugePercentage}%`;
    }
    const blockElement = document.getElementById('blockNumberValue');
    if (blockElement && data.latest_block && data.latest_block.number) {
        this.blockNumber = data.latest_block.number;
        blockElement.textContent = this.blockNumber.toLocaleString();
    }
    const feesElement = document.getElementById('txFeesValue');
    if (feesElement && data.total_fees_in_batch !== undefined) {
        this.totalTxFees += data.total_fees_in_batch;
        feesElement.textContent = this.totalTxFees.toFixed(4);
    }
  }
  getTransactionType(value) { /* ... (previous implementation is correct, no changes needed) ... */
      const monValue = parseFloat(value);
      if (monValue > 1000) return 'supernova';
      if (monValue > 100) return 'large';
      if (monValue > 20) return 'medium';
      return 'small';
  }
  addToDataFeed(transaction) { /* ... (previous implementation is correct, no changes needed) ... */
    const feed = document.getElementById('dataFeed');
    if (!feed) return;
    const feedItem = document.createElement('a');
    feedItem.className = 'feed-item';
    feedItem.href = `https://testnet.monadexplorer.com/tx/${transaction.hash}`;
    feedItem.target = '_blank';
    feedItem.rel = 'noopener noreferrer';
    const timestamp = new Date(transaction.timestamp).toLocaleTimeString();
    const value = transaction.value.toFixed(2);
    feedItem.innerHTML = `<span class="timestamp">${timestamp}</span><span class="action">${transaction.type.toUpperCase()}</span><span class="details">${value} MON</span>`;
    feed.insertBefore(feedItem, feed.firstChild);
    while (feed.children.length > 30) {
      feed.removeChild(feed.lastChild);
    }
  }
  createTransactionBar(transaction) { /* ... (previous implementation is correct, no changes needed) ... */
    const container = document.querySelector(".transaction-container");
    if (!container) return;
    const bar = document.createElement("div");
    bar.classList.add("transaction-bar", transaction.type, "animated");
    if (transaction.type === 'supernova') bar.classList.add('supernova');
    const minHeight = 2, maxHeight = 80, scaleFactor = 4;
    let height = minHeight + Math.log1p(transaction.value) * scaleFactor;
    height = Math.min(height, maxHeight);
    bar.style.height = `${height}px`;
    const columnWidth = container.clientWidth / this.numGridLines;
    const columnIndex = Math.floor(Math.random() * this.numGridLines);
    const x = columnIndex * columnWidth + (columnWidth / 2);
    const width = Math.random() * 60 + 40;
    bar.style.width = `${width}px`;
    bar.style.left = `${x}px`;
    bar.style.top = `${container.clientHeight + 20}px`;
    const monadColors = ["monad-purple", "monad-berry", "monad-off-white"];
    let colorClass = monadColors[Math.floor(Math.random() * monadColors.length)];
    if (transaction.type === "supernova") colorClass = "monad-off-white";
    else if (transaction.type === "large") {
      const largeTxColors = ["monad-purple", "monad-off-white"];
      colorClass = largeTxColors[Math.floor(Math.random() * largeTxColors.length)];
    }
    bar.classList.add(colorClass);
    container.appendChild(bar);
    setTimeout(() => { if (bar.parentNode) bar.remove(); }, 4000);
  }
  setupGridLines() { /* ... (previous implementation is correct, no changes needed) ... */
    const container = document.querySelector('.grid-lines');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < this.numGridLines; i++) {
        const line = document.createElement('div');
        line.className = 'grid-line';
        container.appendChild(line);
    }
  }
  
  // --- Derby Methods ---
  
  initializeDerby() {
    this.derbyConfig.entities.forEach(name => {
      this.racerData[name] = { tps: 0 };
      this.racerProgress[name] = 0;
    });
    this.setupRacetrack();
    this.updateScoreboard();
    this.updateCurrentEntities(); // For the modal
  }

  updateDerbyUI() {
    this.updateScoreboard();
    
    let someoneFinished = false;
    const movementScale = 1; // Adjust to make the race faster or slower

    this.derbyConfig.entities.forEach(name => {
      const tps = this.racerData[name]?.tps || 0;
      this.racerProgress[name] += tps * movementScale;
      
      const racerElement = document.querySelector(`.racer[data-entity="${name}"]`);
      if (racerElement) {
        // Cap progress at 95% to prevent the racer from going off-screen
        const displayProgress = Math.min(this.racerProgress[name], 95);
        racerElement.style.left = `${displayProgress}%`;
      }

      if (this.racerProgress[name] >= 100) {
        someoneFinished = true;
      }
    });

    if (someoneFinished) {
      console.log("A lap has finished! Resetting race.");
      // Reset progress for the next lap
      this.derbyConfig.entities.forEach(name => {
        this.racerProgress[name] = 0;
      });
    }
  }

  updateScoreboard() {
    const container = document.getElementById('scoreboardContent');
    if (!container) return;

    // Sort entities by TPS, descending
    const sortedEntities = this.derbyConfig.entities
      .map(name => ({ name, tps: this.racerData[name]?.tps || 0 }))
      .sort((a, b) => b.tps - a.tps);

    container.innerHTML = ''; // Clear previous state
    sortedEntities.forEach(entity => {
      const card = document.createElement('div');
      card.className = 'racer-card';
      card.innerHTML = `
        <div class="racer-name">${entity.name}</div>
        <div class="racer-stats">
          <span>TPS:</span>
          <span>${entity.tps.toFixed(2)}</span>
        </div>
      `;
      container.appendChild(card);
    });
  }

  setupRacetrack() {
    const track = document.getElementById('racetrack');
    if (!track) return;
    track.innerHTML = '';
    this.derbyConfig.entities.forEach((entity) => {
      const lane = document.createElement('div');
      lane.className = 'race-lane';
      lane.innerHTML = `
        <div class="lane-background"></div>
        <div class="racer" data-entity="${entity}"></div>
        <div class="lane-label">${entity}</div>
      `;
      track.appendChild(lane);
    });
  }

  // --- Tab Management ---

  switchTab(tabName) {
    this.currentTab = tabName;
    this.closeStreams(); // Close all active streams before switching

    document.querySelectorAll('.tab-button').forEach(button => {
      button.classList.toggle('active', button.dataset.tab === tabName);
    });
    document.querySelectorAll('.page').forEach(page => {
      page.classList.toggle('active', page.id === tabName);
    });
    
    // Connect to the appropriate stream for the new tab
    if (tabName === 'cityscape') {
      this.connectToStream();
    } else if (tabName === 'derby') {
      this.connectToDerbyStream();
    }
  }

  // --- Modal & Config Methods (Placeholders for now) ---
  updateCurrentEntities(){ const container = document.getElementById('currentEntities'); if (!container) return; container.innerHTML = ''; this.derbyConfig.entities.forEach(entity => { const tag = document.createElement('div'); tag.className = 'entity-tag'; tag.innerHTML = `${entity} <button class="remove-btn" data-entity="${entity}">×</button>`; container.appendChild(tag); }); container.querySelectorAll('.remove-btn').forEach(btn => { btn.addEventListener('click', () => this.removeEntity(btn.dataset.entity)); }); }
  removeEntity(entityName){ this.derbyConfig.entities = this.derbyConfig.entities.filter(e => e !== entityName); this.updateCurrentEntities(); }
  addEntity(){ const nameInput = document.getElementById('entityName'); const addressesInput = document.getElementById('entityAddresses'); if (!nameInput || !addressesInput) return; const name = nameInput.value.trim(); const addresses = addressesInput.value.trim(); if (name && addresses) { if (!this.derbyConfig.entities.includes(name)) { this.derbyConfig.entities.push(name); this.updateCurrentEntities(); } nameInput.value = ''; addressesInput.value = ''; } }
  openConfigModal(){ const modal = document.getElementById('configModal'); if (modal) modal.classList.add('active'); }
  closeConfigModal(){ const modal = document.getElementById('configModal'); if (modal) modal.classList.remove('active'); }
  applyConfiguration(){ this.initializeDerby(); this.closeConfigModal(); }
  resetConfiguration(){ this.derbyConfig.entities = [ "LFJ", "PancakeSwap", "Bean Exchange", "Ambient Finance", "Izumi Finance", "Octoswap", "Uniswap" ]; this.initializeDerby(); }
  setupEventListeners() {
    document.querySelectorAll('.tab-button').forEach(button => {
      button.addEventListener('click', () => {
        this.switchTab(button.dataset.tab);
      });
    });

    document.getElementById('configButton')?.addEventListener('click', () => this.openConfigModal());
    document.getElementById('closeModal')?.addEventListener('click', () => this.closeConfigModal());
    document.getElementById('addEntity')?.addEventListener('click', () => this.addEntity());
    document.getElementById('applyConfig')?.addEventListener('click', () => this.applyConfiguration());
    document.getElementById('resetConfig')?.addEventListener('click', () => this.resetConfiguration());
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new MonadVisualizer();
});