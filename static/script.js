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
      // This list will be configurable via the modal.
      // Structure: { "Entity Name": ["0xaddress1", "0xaddress2"], ... }
      racers: {
        "LFJ": ["0x45A62B090DF48243F12A21897e7ed91863E2c86b"],
        "PancakeSwap": ["0x94D220C58A23AE0c2eE29344b00A30D1c2d9F1bc"],
        "Bean Exchange": ["0xCa810D095e90Daae6e867c19DF6D9A8C56db2c89"],
        "Ambient Finance": ["0x88B96aF200c8a9c35442C8AC6cd3D22695AaE4F0"],
        "Izumi Finance": ["0xf6ffe4f3fdc8bbb7f70ffd48e61f17d1e343ddfd"],
        "Octoswap": ["0xb6091233aAcACbA45225a2B2121BBaC807aF4255"],
        "Uniswap": ["0x3aE6D8A282D67893e17AA70ebFFb33EE5aa65893"]
      },
    };
    this.racerData = {}; // To store latest TPS data { name: { tps: 0 } }
    this.racerProgress = {}; // To store visual progress { name: 0 }
    this.racerWins = {}; // To store win counts { name: 0 }
    this.raceFinishLine = 0; // Will be set dynamically based on racetrack width
    this.raceInProgress = true;
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

    const streamUrl = `${window.CONFIG.API_BASE_URL}/firehose-stream`;
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

    const streamUrl = `${window.CONFIG.API_BASE_URL}/derby-stream`;
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
    console.log("Initializing Derby with current config...");
    
    // Initialize win counts for all racers
    Object.keys(this.derbyConfig.racers).forEach(name => {
        if (!this.racerWins[name]) {
            this.racerWins[name] = 0;
        }
        if (!this.racerProgress[name]) {
            this.racerProgress[name] = 0;
        }
    });
    
    this.setupRacetrack();
    this.updateScoreboard();
    // No stream connection here, it's handled by tab switching or applying config
  }

  updateDerbyUI() {
    if (!this.racerData) {
      console.log("No racer data available");
      return;
    }
    console.log("Derby UI update - Racer data:", this.racerData);
    console.log("Derby UI update - Current racers config:", Object.keys(this.derbyConfig.racers));
    this.updateRacerProgress();
    this.updateScoreboard();
  }

  updateRacerProgress() {
    const racetrack = document.getElementById('racetrack');
    if (!racetrack) {
        console.error("❌ Racetrack not found in updateRacerProgress");
        return;
    }

    let someoneFinished = false;
    let winners = [];
    let debugInfo = [];

    Object.keys(this.derbyConfig.racers).forEach(name => {
        const tps = this.racerData[name] ? this.racerData[name].tps : 0;
        const currentProgress = this.racerProgress[name] || 0;
        
        // The movement increment is now based on TPS. Adjust the factor for good visual speed.
        const movement = tps * 15; 
        this.racerProgress[name] = currentProgress + movement;

        // Check if this racer finished the race
        if (this.racerProgress[name] >= this.raceFinishLine) {
            someoneFinished = true;
            winners.push(name);
            // Initialize win count if not exists
            if (!this.racerWins[name]) {
                this.racerWins[name] = 0;
            }
            this.racerWins[name]++;
            console.log(`🏆 ${name} wins! Total wins: ${this.racerWins[name]}`);
        }

        const racerElement = racetrack.querySelector(`.racer[data-name="${name}"]`);
        if (racerElement) {
            // Use left position instead of transform for better visibility
            const startPosition = 150; // Starting position after labels
            const newPosition = startPosition + this.racerProgress[name];
            racerElement.style.left = `${newPosition}px`;
            
            debugInfo.push({
                name: name,
                tps: tps.toFixed(2),
                progress: this.racerProgress[name].toFixed(1),
                position: newPosition.toFixed(1),
                element: !!racerElement
            });
        } else {
            console.warn(`❌ Racer element not found for ${name}`);
            debugInfo.push({
                name: name,
                tps: tps.toFixed(2),
                progress: this.racerProgress[name].toFixed(1),
                position: 'N/A',
                element: false
            });
        }
    });

    // Log debug info every few updates (to avoid spam)
    if (Math.random() < 0.1) { // 10% chance to log
        console.table(debugInfo);
    }

    // Reset race if someone finished
    if (someoneFinished) {
        console.log(`🏁 Race finished! Winners: ${winners.join(', ')}`);
        this.resetRace();
    }
  }

  updateScoreboard() {
    const scoreboard = document.getElementById('scoreboardContent');
    if (!scoreboard) return;
    
    // Create an array from the racer data to sort it
    const sortedRacers = Object.keys(this.derbyConfig.racers).map(name => ({
        name: name,
        tps: this.racerData[name] ? this.racerData[name].tps : 0,
        wins: this.racerWins[name] || 0,
        progress: this.racerProgress[name] || 0
    })).sort((a, b) => b.tps - a.tps);

    scoreboard.innerHTML = ''; // Clear previous entries
    sortedRacers.forEach((racer, index) => {
        const scoreItem = document.createElement('div');
        scoreItem.className = 'scoreboard-item';
        const progressPercent = ((racer.progress / this.raceFinishLine) * 100).toFixed(1);
        scoreItem.innerHTML = `
            <div class="rank">${index + 1}</div>
            <div class="racer-name">${racer.name}</div>
            <div class="racer-stats">
                <div class="racer-tps">${racer.tps.toFixed(2)} TPS</div>
                <div class="racer-wins">🏆 ${racer.wins}</div>
                <div class="racer-progress">${progressPercent}%</div>
            </div>
        `;
        scoreboard.appendChild(scoreItem);
    });
  }

  resetRace() {
    console.log("🔄 Resetting race - all horses back to starting line!");
    
    // Reset all progress to 0
    Object.keys(this.derbyConfig.racers).forEach(name => {
        this.racerProgress[name] = 0;
        
        // Reset visual position
        const racerElement = document.querySelector(`.racer[data-name="${name}"]`);
        if (racerElement) {
            racerElement.style.left = `150px`; // Back to starting position
        }
    });
    
    // Update scoreboard to reflect reset
    this.updateScoreboard();
  }

  setupRacetrack() {
    const racetrack = document.getElementById('racetrack');
    if (!racetrack) {
        console.error("❌ Racetrack element not found!");
        return;
    }

    console.log("🏁 Setting up racetrack...");
    racetrack.innerHTML = ''; // Clear existing racers
    this.racerProgress = {}; // Reset progress

    // Calculate finish line based on racetrack width
    // Leave some margin (100px) so horses don't go completely off-screen
    this.raceFinishLine = racetrack.clientWidth - 250; // Account for starting position (150px) + margin (100px)
    console.log(`🏁 Finish line set to ${this.raceFinishLine}px (racetrack width: ${racetrack.clientWidth}px)`);

    // Add visual finish line
    const existingFinishLine = racetrack.querySelector('.finish-line');
    if (existingFinishLine) {
        existingFinishLine.remove();
    }
    
    const finishLine = document.createElement('div');
    finishLine.className = 'finish-line';
    finishLine.style.left = `${150 + this.raceFinishLine}px`; // Position at actual finish
    racetrack.appendChild(finishLine);
    console.log("🏁 Finish line created and positioned");

    const racerNames = Object.keys(this.derbyConfig.racers);
    console.log(`🏎️ Creating ${racerNames.length} racers:`, racerNames);

    racerNames.forEach((name, index) => {
        const laneY = index * 60 + 20; // More space between lanes (60px instead of 50px)
        
        // Create the racer element
        const racer = document.createElement('div');
        racer.className = 'racer';
        racer.dataset.name = name;
        racer.style.top = `${laneY}px`;
        racer.style.left = '150px'; // Ensure starting position is set
        
        // Create the lane label (stays on the left)
        const laneLabel = document.createElement('div');
        laneLabel.className = 'lane-label';
        laneLabel.textContent = name;
        laneLabel.style.top = `${laneY}px`;
        laneLabel.style.left = '10px'; // Fixed position on the left
        
        // Create the racing lane background
        const lane = document.createElement('div');
        lane.className = 'racing-lane';
        lane.style.top = `${laneY - 5}px`; // Slightly above racer for background
        lane.style.height = '50px';
        lane.dataset.lane = index;
        
        racetrack.appendChild(lane);
        racetrack.appendChild(laneLabel);
        racetrack.appendChild(racer);
        
        console.log(`🏎️ Created racer "${name}" at lane ${index}, position (150px, ${laneY}px)`);
    });
    
    console.log(`✅ Racetrack setup complete! Total elements in racetrack: ${racetrack.children.length}`);
  }

  // --- Tab Management ---

  switchTab(tabName) {
    if (this.currentTab === tabName) return;
    this.currentTab = tabName;
    console.log(`Switched to ${tabName} tab.`);

    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.getElementById(tabName)?.classList.add('active');

    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.tab-button[data-tab="${tabName}"]`)?.classList.add('active');
    
    this.closeStreams();

    if (tabName === 'cityscape') {
        this.connectToStream();
    } else if (tabName === 'derby') {
        this.initializeDerby();
        this.connectToDerbyStream();
    } else {
      // Handle other tabs like dashboard if they need specific connections
    }
  }

  // --- Derby Configuration Modal Methods ---

  updateCurrentEntities() {
    const container = document.getElementById('currentEntities');
    if (!container) return;

    container.innerHTML = '';
    Object.keys(this.derbyConfig.racers).forEach(name => {
        const tag = document.createElement('div');
        tag.className = 'entity-tag';
        tag.innerHTML = `${name} <button class="remove-btn" data-entity="${name}">×</button>`;
        container.appendChild(tag);
    });

    container.querySelectorAll('.remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent modal from closing
            this.removeEntity(btn.dataset.entity);
        });
    });
  }

  removeEntity(entityName) {
    delete this.derbyConfig.racers[entityName];
    this.updateCurrentEntities();
  }

  addEntity() {
    console.log("addEntity() called");
    const nameInput = document.getElementById('entityName');
    const addressesInput = document.getElementById('entityAddresses');
    
    if (!nameInput) {
        console.error("entityName input not found");
        return;
    }
    if (!addressesInput) {
        console.error("entityAddresses input not found");
        return;
    }

    const name = nameInput.value.trim();
    const addressInput = addressesInput.value.trim();
    
    console.log("Name:", name);
    console.log("Address input:", addressInput);

    if (!name) {
        alert("Please provide an entity name.");
        return;
    }

    if (!addressInput) {
        alert("Please provide at least one address.");
        return;
    }

    // Split by comma, trim whitespace, and filter out empty strings
    const addresses = addressInput.split(',')
        .map(addr => addr.trim())
        .filter(addr => addr.length > 0); // More permissive validation for testing

    console.log("Parsed addresses:", addresses);

    if (addresses.length === 0) {
        alert("Please provide valid addresses (comma-separated if multiple).");
        return;
    }

    if (this.derbyConfig.racers[name]) {
        console.warn(`Entity ${name} already exists. Overwriting addresses.`);
    }
    
    this.derbyConfig.racers[name] = addresses;
    console.log("Updated racers config:", this.derbyConfig.racers);
    
    this.updateCurrentEntities();
    nameInput.value = '';
    addressesInput.value = '';
    
    console.log("Entity added successfully");
  }

  openConfigModal() {
    const modal = document.getElementById('configModal');
    if (modal) {
        this.updateCurrentEntities(); // Make sure the list is up-to-date when opening
        modal.classList.add('active');
    }
  }

  closeConfigModal() {
    const modal = document.getElementById('configModal');
    if (modal) modal.classList.remove('active');
  }

  async applyConfiguration() {
    console.log("Applying new Derby configuration...");

    const entitiesPayload = Object.keys(this.derbyConfig.racers).map(name => ({
        name: name,
        addresses: this.derbyConfig.racers[name]
    }));

    try {
        const response = await fetch(`${window.CONFIG.API_BASE_URL}/update-derby-config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entities: entitiesPayload })
        });

        if (!response.ok) {
            throw new Error(`Failed to update config: ${response.statusText}`);
        }

        const result = await response.json();
        console.log("Backend response:", result.message);
        
        this.closeConfigModal();
        
        // Reset all progress when configuration changes to ensure fair start
        this.resetRace();
        
        // Initialize win counts for new entities
        Object.keys(this.derbyConfig.racers).forEach(name => {
            if (!this.racerWins[name]) {
                this.racerWins[name] = 0;
            }
        });
        
        // Re-initialize the derby with the new settings and reconnect the stream
        if (this.currentTab === 'derby') {
            this.initializeDerby();
        }

    } catch (error) {
        console.error("Error applying configuration:", error);
        alert("Could not apply the new configuration. Please check the console for details.");
    }
  }

  resetConfiguration() {
    console.log("Resetting Derby configuration to default.");
    // This now just resets the local config.
    // applyConfiguration must be called to send it to the backend.
    this.derbyConfig.racers = {
      "LFJ": ["0x45A62B090DF48243F12A21897e7ed91863E2c86b"],
      "PancakeSwap": ["0x94D220C58A23AE0c2eE29344b00A30D1c2d9F1bc"],
      "Bean Exchange": ["0xCa810D095e90Daae6e867c19DF6D9A8C56db2c89"],
      "Ambient Finance": ["0x88B96aF200c8a9c35442C8AC6cd3D22695AaE4F0"],
      "Izumi Finance": ["0xf6ffe4f3fdc8bbb7f70ffd48e61f17d1e343ddfd"],
      "Octoswap": ["0xb6091233aAcACbA45225a2B2121BBaC807aF4255"],
      "Uniswap": ["0x3aE6D8A282D67893e17AA70ebFFb33EE5aa65893"]
    };
    this.updateCurrentEntities(); // Update the UI in the modal
    // We don't auto-apply, user must click "Apply Configuration"
  }

  setupEventListeners() {
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => this.switchTab(button.dataset.tab));
    });

    // --- Derby Modal Listeners ---
    const configButton = document.getElementById('configButton');
    const closeModal = document.getElementById('closeModal');
    const addEntityButton = document.getElementById('addEntity');
    const applyConfigButton = document.getElementById('applyConfig');
    const resetConfigButton = document.getElementById('resetConfig');

    if (configButton) {
        configButton.addEventListener('click', () => this.openConfigModal());
        console.log("Config button event listener added");
    } else {
        console.error("configButton not found");
    }

    if (closeModal) {
        closeModal.addEventListener('click', () => this.closeConfigModal());
        console.log("Close modal event listener added");
    } else {
        console.error("closeModal button not found");
    }

    if (addEntityButton) {
        addEntityButton.addEventListener('click', () => {
            console.log("Add entity button clicked");
            this.addEntity();
        });
        console.log("Add entity button event listener added");
    } else {
        console.error("addEntity button not found");
    }

    if (applyConfigButton) {
        applyConfigButton.addEventListener('click', () => this.applyConfiguration());
        console.log("Apply config button event listener added");
    } else {
        console.error("applyConfig button not found");
    }

    if (resetConfigButton) {
        resetConfigButton.addEventListener('click', () => this.resetConfiguration());
        console.log("Reset config button event listener added");
    } else {
        console.error("resetConfig button not found");
    }
    
    window.addEventListener('resize', () => {
        if (this.currentTab === 'cityscape') {
            this.setupGridLines();
        } else if (this.currentTab === 'derby') {
            // Recalculate finish line when window is resized
            const racetrack = document.getElementById('racetrack');
            if (racetrack) {
                this.raceFinishLine = racetrack.clientWidth - 100;
                console.log(`🏁 Finish line updated to ${this.raceFinishLine}px due to resize`);
            }
        }
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new MonadVisualizer();
});