class MonadVisualizer {
  constructor() {
    this.currentTab = "cityscape";
    this.eventSource = null; // To hold the SSE connection

    // --- State managed by backend data ---
    this.currentTps = 0;
    this.blockNumber = 0;
    this.totalTxFees = 0;
    this.maxTpsForBar = 8000;

    // --- Smart Queue with Load Shedding ---
    this.renderQueue = []; // Holds incoming transactions for visualization.
    this.isProcessingQueue = false; // Flag to ensure only one rendering loop is active.
    this.MAX_QUEUE_SIZE = 500; // The maximum number of transactions to hold before dropping old ones.
    this.RENDER_THRESHOLD = 10; // Number of items in queue before we start rendering in batches to catch up.
    this.MAX_RENDER_DELAY = 20; // The base delay (in ms) between rendering frames for a smooth visual effect.
    this.MIN_RENDER_DELAY = 1; // The minimum delay when the queue is large, to render as fast as possible.


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
        try {
            const data = JSON.parse(event.data);

            if(data.error) {
                console.error("Received error from backend:", data.error);
                return;
            }

            this.updateStatsBar(data);

            // *** SMART QUEUE LOGIC ***
            if (data.transactions && data.transactions.length > 0) {
                // 1. Check if the queue will overflow
                const overflowCount = (this.renderQueue.length + data.transactions.length) - this.MAX_QUEUE_SIZE;

                // 2. If it will overflow, remove the oldest transactions ("load shedding")
                if (overflowCount > 0) {
                    this.renderQueue.splice(0, overflowCount); // Remove oldest items from the front
                    console.warn(`Queue overloaded. Shedding ${overflowCount} oldest transactions.`);
                }

                // 3. Add the new, most recent transactions to the queue
                this.renderQueue.push(...data.transactions);

                // 4. Start the rendering loop if it's not already running
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
        // Implement a backoff strategy for reconnection
        setTimeout(() => this.connectToStream(), 5000); 
    };
  }

  // Processes the render queue with dynamic delay and batching
  processRenderQueue() {
    this.isProcessingQueue = true;

    // Stop if the queue is empty
    if (this.renderQueue.length === 0) {
        this.isProcessingQueue = false;
        return;
    }

    // Dynamic batching: If the queue is long, render a larger chunk to catch up.
    const itemsToRenderCount = this.renderQueue.length > this.RENDER_THRESHOLD ? 3 : 1;
    
    for (let i = 0; i < itemsToRenderCount; i++) {
        const tx = this.renderQueue.shift(); // Get the oldest transaction from the front
        if (tx) {
            const transaction = {
                type: this.getTransactionType(tx.value),
                hash: tx.hash,
                timestamp: new Date().toISOString(),
                value: parseFloat(tx.value) || 0
            };
            this.createTransactionBar(transaction);
            this.addToDataFeed(transaction);
        }
    }

    // Dynamic delay: The more items in the queue, the smaller the delay, ensuring faster rendering.
    const delay = Math.max(
        this.MIN_RENDER_DELAY, 
        this.MAX_RENDER_DELAY - Math.floor(this.renderQueue.length / 10)
    );

    // Schedule the next frame
    setTimeout(() => {
        this.processRenderQueue();
    }, delay);
  }

  // Updates all the elements in the bottom stats bar
  updateStatsBar(data) {
    if (!data) return;

    const tpsValueElement = document.getElementById('liveTpsValue');
    const tpsGaugeInnerElement = document.getElementById('tpsGaugeInner');
    if (tpsValueElement && tpsGaugeInnerElement && data.tps !== undefined) {
        const displayTps = data.tps.toFixed(1);
        tpsValueElement.textContent = displayTps;
        const gaugePercentage = Math.min(100, (data.tps / this.maxTpsForBar) * 100);
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

  // Helper function to determine transaction size from value
  getTransactionType(value) {
      const ethValue = parseFloat(value);
      if (ethValue > 100) return 'supernova';
      if (ethValue > 10) return 'large';
      if (ethValue > 1) return 'medium';
      return 'small';
  }

  // --- UI Methods ---

  addToDataFeed(transaction) {
    const feed = document.getElementById('dataFeed');
    if (!feed) return;

    // *** MODIFIED: Create an anchor (<a>) tag instead of a div ***
    const feedItem = document.createElement('a');
    feedItem.className = 'feed-item';
    
    // Set the link to the Monad Explorer for the specific transaction hash
    feedItem.href = `https://testnet.monadexplorer.com/tx/${transaction.hash}`;
    
    // Open the link in a new tab for better user experience
    feedItem.target = '_blank';
    feedItem.rel = 'noopener noreferrer'; // Security best practice for target="_blank"

    const timestamp = new Date(transaction.timestamp).toLocaleTimeString();
    const value = transaction.value.toFixed(2);
    feedItem.innerHTML = `<span class="timestamp">${timestamp}</span><span class="action">${transaction.type.toUpperCase()}</span><span class="details">${value} ETH</span>`;
    
    feed.insertBefore(feedItem, feed.firstChild);

    // Keep the feed list to a reasonable size
    while (feed.children.length > 30) {
      feed.removeChild(feed.lastChild);
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

    // Garbage collection for the DOM element
    setTimeout(() => {
      if (bar.parentNode) {
        bar.remove();
      }
    }, 4000); // Animation is 3.5s, give it a little extra time
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

  // --- Event Listeners and Tab Management ---

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

  initializeDerby() {
    this.updateCurrentEntities();
    this.setupRacetrack();
  }

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
