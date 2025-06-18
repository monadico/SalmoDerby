class MonadVisualizer {
  constructor() {
    this.currentTab = "cityscape";
    this.eventSource = null;

    // --- State & Rendering ---
    this.currentTps = 0;
    this.blockNumber = 0;
    this.totalTxFees = 0;
    this.maxTpsForBar = 8000;

    // --- Unified Queue for Visuals & Data Feed ---
    this.renderQueue = []; 
    this.isProcessingQueue = false;
    this.MAX_QUEUE_SIZE = 500; // Max items to hold before dropping old ones
    this.RENDER_THRESHOLD = 10; 
    this.MAX_RENDER_DELAY = 20; 
    this.MIN_RENDER_DELAY = 1;

    // --- Derby properties ---
    this.derbyConfig = {
      entities: ["Uniswap", "SushiSwap", "PancakeSwap", "Curve", "Balancer"],
    };
    this.numGridLines = 10;
    
    this.init();
    window.visualizer = this;
  }

  init() {
    this.setupEventListeners();
    this.setupGridLines();
    this.initializeDerby();
    this.connectToStream();
  }

  connectToStream() {
    console.log("Connecting to backend firehose stream...");
    
    if (this.eventSource) {
      this.eventSource.close();
    }

    const streamUrl = 'http://localhost:8000/firehose-stream';
    this.eventSource = new EventSource(streamUrl);

    this.eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            if(data.error) {
                console.error("Received error from backend:", data.error);
                return;
            }

            this.updateStatsBar(data);

            if (data.transactions && data.transactions.length > 0) {
                // Load shedding logic for the unified queue
                const overflowCount = (this.renderQueue.length + data.transactions.length) - this.MAX_QUEUE_SIZE;
                if (overflowCount > 0) {
                    this.renderQueue.splice(0, overflowCount);
                }
                this.renderQueue.push(...data.transactions);

                if (!this.isProcessingQueue) {
                    this.processRenderQueue();
                }
            }
        } catch (e) {
            console.error("Error parsing SSE data:", e);
        }
    };

    this.eventSource.onerror = (err) => {
        console.error("EventSource failed:", err);
        this.eventSource.close();
        setTimeout(() => this.connectToStream(), 5000); 
    };
  }

  processRenderQueue() {
    this.isProcessingQueue = true;

    if (this.renderQueue.length === 0) {
        this.isProcessingQueue = false;
        return;
    }

    const itemsToRenderCount = this.renderQueue.length > this.RENDER_THRESHOLD ? 3 : 1;
    
    for (let i = 0; i < itemsToRenderCount; i++) {
        const tx = this.renderQueue.shift();
        if (tx) {
            const transaction = {
                type: this.getTransactionType(tx.value),
                hash: tx.hash,
                timestamp: new Date().toISOString(),
                value: parseFloat(tx.value) || 0
            };
            // Create a bar and add to the feed for each transaction
            this.createTransactionBar(transaction);
            this.addToDataFeed(transaction);
        }
    }

    const delay = Math.max(
        this.MIN_RENDER_DELAY, 
        this.MAX_RENDER_DELAY - Math.floor(this.renderQueue.length / 10)
    );

    setTimeout(() => {
        this.processRenderQueue();
    }, delay);
  }

  updateStatsBar(data) {
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

  getTransactionType(value) {
      const monValue = parseFloat(value);
      if (monValue > 1000) return 'supernova';
      if (monValue > 100) return 'large';
      if (monValue > 20) return 'medium';
      return 'small';
  }

  addToDataFeed(transaction) {
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

  // MODIFIED: Now sets bar height based on transaction value
  createTransactionBar(transaction) {
    const container = document.querySelector(".transaction-container");
    if (!container) return;

    const bar = document.createElement("div");
    // The 'type' class (small, large) is still useful for color and effects
    bar.classList.add("transaction-bar", transaction.type, "animated");
    if (transaction.type === 'supernova') {
        bar.classList.add('supernova');
    }

    // --- Dynamic Height Calculation ---
    const minHeight = 2; // px
    const maxHeight = 80; // px
    const scaleFactor = 4; // Adjust this to control height sensitivity
    // Use a logarithmic scale (log1p = ln(1+x)) to handle large value variations gracefully
    let height = minHeight + Math.log1p(transaction.value) * scaleFactor;
    height = Math.min(height, maxHeight); // Cap the height
    bar.style.height = `${height}px`;
    // --- End Dynamic Height ---
    
    const columnWidth = container.clientWidth / this.numGridLines;
    const columnIndex = Math.floor(Math.random() * this.numGridLines);
    const x = columnIndex * columnWidth + (columnWidth / 2);

    const width = Math.random() * 60 + 40;
    bar.style.width = `${width}px`;
    bar.style.left = `${x}px`;
    bar.style.top = `${container.clientHeight + 20}px`;

    const monadColors = ["monad-purple", "monad-berry", "monad-off-white"];
    let colorClass = monadColors[Math.floor(Math.random() * monadColors.length)];

    if (transaction.type === "supernova") {
      colorClass = "monad-off-white";
    } else if (transaction.type === "large") {
      const largeTxColors = ["monad-purple", "monad-off-white"];
      colorClass = largeTxColors[Math.floor(Math.random() * largeTxColors.length)];
    }
    bar.classList.add(colorClass);

    container.appendChild(bar);

    setTimeout(() => {
      if (bar.parentNode) bar.remove();
    }, 4000);
  }

  setupGridLines() {
    const container = document.querySelector('.grid-lines');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < this.numGridLines; i++) {
        const line = document.createElement('div');
        line.className = 'grid-line';
        container.appendChild(line);
    }
  }

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

  switchTab(tabName) {
    this.currentTab = tabName;
    document.querySelectorAll('.tab-button').forEach(button => {
      button.classList.toggle('active', button.dataset.tab === tabName);
    });
    document.querySelectorAll('.page').forEach(page => {
      page.classList.toggle('active', page.id === tabName);
    });
    
    if (tabName === 'cityscape') {
      this.connectToStream();
    } else {
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
        console.log("Closed firehose stream.");
      }
    }
  }

  // --- DERBY METHODS (unchanged) ---
  initializeDerby(){ this.updateCurrentEntities(); this.setupRacetrack(); }
  updateCurrentEntities(){ const container = document.getElementById('currentEntities'); if (!container) return; container.innerHTML = ''; this.derbyConfig.entities.forEach(entity => { const tag = document.createElement('div'); tag.className = 'entity-tag'; tag.innerHTML = `${entity} <button class="remove-btn" data-entity="${entity}">×</button>`; container.appendChild(tag); }); container.querySelectorAll('.remove-btn').forEach(btn => { btn.addEventListener('click', () => this.removeEntity(btn.dataset.entity)); }); }
  removeEntity(entityName){ this.derbyConfig.entities = this.derbyConfig.entities.filter(e => e !== entityName); this.updateCurrentEntities(); }
  addEntity(){ const nameInput = document.getElementById('entityName'); const addressesInput = document.getElementById('entityAddresses'); if (!nameInput || !addressesInput) return; const name = nameInput.value.trim(); const addresses = addressesInput.value.trim(); if (name && addresses) { if (!this.derbyConfig.entities.includes(name)) { this.derbyConfig.entities.push(name); this.updateCurrentEntities(); } nameInput.value = ''; addressesInput.value = ''; } }
  setupRacetrack(){ const track = document.getElementById('racetrack'); if (!track) return; track.innerHTML = ''; this.derbyConfig.entities.forEach((entity) => { const lane = document.createElement('div'); lane.className = 'race-lane'; lane.innerHTML = `<div class="lane-background"></div><div class="racer" data-entity="${entity}"></div><div class="lane-label">${entity}</div>`; track.appendChild(lane); }); }
  openConfigModal(){ const modal = document.getElementById('configModal'); if (modal) modal.classList.add('active'); }
  closeConfigModal(){ const modal = document.getElementById('configModal'); if (modal) modal.classList.remove('active'); }
  applyConfiguration(){ this.setupRacetrack(); this.closeConfigModal(); }
  resetConfiguration(){ this.derbyConfig.entities = ["Uniswap", "SushiSwap", "PancakeSwap", "Curve", "Balancer"]; this.updateCurrentEntities(); }
}

document.addEventListener("DOMContentLoaded", () => {
  new MonadVisualizer();
});