class MonadVisualizer {
  constructor() {
    this.currentTab = "cityscape";
    this.eventSource = null; // To hold the SSE connection

    // --- State managed by backend data ---
    this.currentTps = 0;
    this.blockNumber = 0;
    this.totalTxFees = 0;
    this.maxTpsForBar = 8000;

    // --- NEW: For smooth rendering ---
    this.renderQueue = [];
    this.isProcessingQueue = false;
    this.RENDER_THRESHOLD = 5; // Max items before we speed up rendering
    this.MAX_RENDER_DELAY = 15; // Max delay in ms for smooth rendering

    // --- Derby properties (unchanged for now) ---
    this.derbyConfig = {
      entities: ["Uniswap", "SushiSwap", "PancakeSwap", "Curve", "Balancer"],
    };
    this.racerPositions = {};
    this.racerData = {};
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

  // Connects the frontend to the backend SSE stream
  connectToStream() {
    console.log("Connecting to backend firehose stream...");
    
    if (this.eventSource) {
      this.eventSource.close();
    }

    const streamUrl = 'http://localhost:8000/firehose-stream';
    this.eventSource = new EventSource(streamUrl);

    this.eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        this.updateStatsBar(data);

        // NEW: Instead of rendering immediately, add transactions to a queue
        if (data.transactions && data.transactions.length > 0) {
            this.renderQueue.push(...data.transactions);
            // Start the rendering loop if it's not already running
            if (!this.isProcessingQueue) {
                this.processRenderQueue();
            }
        }
    };

    this.eventSource.onerror = (err) => {
        console.error("EventSource failed:", err);
        this.eventSource.close();
        setTimeout(() => this.connectToStream(), 5000); 
    };
  }

  // NEW: Processes the render queue with dynamic delay
  processRenderQueue() {
    this.isProcessingQueue = true;

    if (this.renderQueue.length === 0) {
        this.isProcessingQueue = false;
        return;
    }

    // If the queue is too long, render a chunk at once to catch up
    const itemsToRenderCount = this.renderQueue.length > this.RENDER_THRESHOLD ? 3 : 1;
    
    for (let i = 0; i < itemsToRenderCount; i++) {
        const tx = this.renderQueue.shift();
        if (tx) {
            const transaction = {
                type: this.getTransactionType(tx.value),
                hash: tx.hash,
                timestamp: new Date().toISOString(),
                value: parseFloat(tx.value)
            };
            this.createTransactionBar(transaction);
            this.addToDataFeed(transaction);
        }
    }

    // Calculate dynamic delay: more items = less delay
    const delay = Math.max(0, this.MAX_RENDER_DELAY - (this.renderQueue.length * 2));

    setTimeout(() => {
        this.processRenderQueue();
    }, delay);
  }

  // Updates all the elements in the bottom stats bar
  updateStatsBar(data) {
    const tpsValueElement = document.getElementById('liveTpsValue');
    const tpsGaugeInnerElement = document.getElementById('tpsGaugeInner');
    if (tpsValueElement && tpsGaugeInnerElement) {
        const displayTps = data.tps.toFixed(1);
        tpsValueElement.textContent = displayTps;
        const gaugePercentage = Math.min(100, (data.tps / this.maxTpsForBar) * 100);
        tpsGaugeInnerElement.style.width = `${gaugePercentage}%`;
    }

    const blockElement = document.getElementById('blockNumberValue');
    if (blockElement) {
        this.blockNumber = data.latest_block.number;
        blockElement.textContent = this.blockNumber.toLocaleString();
    }

    const feesElement = document.getElementById('txFeesValue');
    if (feesElement) {
        this.totalTxFees += data.total_fees_in_batch;
        feesElement.textContent = this.totalTxFees.toFixed(4);
    }
  }

  // Helper function to determine transaction size from value
  getTransactionType(value) {
      const ethValue = parseFloat(value);
      if (ethValue > 100) return 'supernova';
      if (ethValue > 10) return 'large';
      if (ethValue > 1) return 'medium';
      return 'small';
  }

  // --- UI and unchanged methods below ---

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
      }
    }
  }

  createTransactionBar(transaction) {
    const container = document.querySelector(".transaction-container");
    if (!container) return;

    const bar = document.createElement("div");
    bar.classList.add("transaction-bar", transaction.type, "animated");
    if (transaction.type === 'supernova') {
        bar.classList.add('supernova');
    }

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
      if (bar.parentNode) {
        bar.remove();
      }
    }, 3600);
  }

  addToDataFeed(transaction) {
    const feed = document.getElementById('dataFeed');
    if (!feed) return;
    const feedItem = document.createElement('div');
    feedItem.className = 'feed-item';
    const timestamp = new Date(transaction.timestamp).toLocaleTimeString();
    const value = transaction.value.toFixed(2);
    feedItem.innerHTML = `<span class="timestamp">${timestamp}</span><span class="action">${transaction.type.toUpperCase()}</span><span class="details">${value} ETH</span>`;
    feed.insertBefore(feedItem, feed.firstChild);
    while (feed.children.length > 20) {
      feed.removeChild(feed.lastChild);
    }
  }

  initializeDerby() {
    this.updateCurrentEntities();
    this.setupRacetrack();
  }

  // --- DERBY METHODS (unchanged) ---
  updateCurrentEntities() {
    const container = document.getElementById('currentEntities');
    if (!container) return;
    container.innerHTML = '';
    this.derbyConfig.entities.forEach(entity => {
      const tag = document.createElement('div');
      tag.className = 'entity-tag';
      tag.innerHTML = `${entity} <button class="remove-btn" data-entity="${entity}">×</button>`;
      container.appendChild(tag);
    });
    container.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', () => this.removeEntity(btn.dataset.entity));
    });
  }
  removeEntity(entityName) {
    this.derbyConfig.entities = this.derbyConfig.entities.filter(e => e !== entityName);
    this.updateCurrentEntities();
  }
  addEntity() {
    const nameInput = document.getElementById('entityName');
    const addressesInput = document.getElementById('entityAddresses');
    if (!nameInput || !addressesInput) return;
    const name = nameInput.value.trim();
    const addresses = addressesInput.value.trim();
    if (name && addresses) {
      if (!this.derbyConfig.entities.includes(name)) {
        this.derbyConfig.entities.push(name);
        this.updateCurrentEntities();
      }
      nameInput.value = '';
      addressesInput.value = '';
    }
  }
  setupRacetrack() {
    const track = document.getElementById('racetrack');
    if (!track) return;
    track.innerHTML = '';
    this.derbyConfig.entities.forEach((entity) => {
      const lane = document.createElement('div');
      lane.className = 'race-lane';
      lane.innerHTML = `<div class="lane-background"></div><div class="racer" data-entity="${entity}"></div><div class="lane-label">${entity}</div>`;
      track.appendChild(lane);
    });
  }
  openConfigModal() {
    const modal = document.getElementById('configModal');
    if (modal) modal.classList.add('active');
  }
  closeConfigModal() {
    const modal = document.getElementById('configModal');
    if (modal) modal.classList.remove('active');
  }
  applyConfiguration() {
    this.setupRacetrack();
    this.closeConfigModal();
  }
  resetConfiguration() {
    this.derbyConfig.entities = ["Uniswap", "SushiSwap", "PancakeSwap", "Curve", "Balancer"];
    this.updateCurrentEntities();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new MonadVisualizer();
});
