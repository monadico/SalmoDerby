document.addEventListener('DOMContentLoaded', () => {

    // --- Default Preset Configuration ---
    const DEFAULT_DEX_CONFIG = [
        { name: "LFJ", addresses: "0x45A62B090DF48243F12A21897e7ed91863E2c86b", criteria: "to" },
        { name: "PancakeSwap", addresses: "0x94D220C58A23AE0c2eE29344b00A30D1c2d9F1bc", criteria: "to" },
        { name: "Bean Exchange", addresses: "0xCa810D095e90Daae6e867c19DF6D9A8C56db2c89", criteria: "to" },
        { name: "Ambient Finance", addresses: "0x88B96aF200c8a9c35442C8AC6cd3D22695AaE4F0", criteria: "to" },
        { name: "Izumi Finance", addresses: "0xf6ffe4f3fdc8bbb7f70ffd48e61f17d1e343ddfd", criteria: "to" },
        { name: "Octoswap", addresses: "0xb6091233aAcACbA45225a2B2121BBaC807aF4255", criteria: "to" },
        { name: "Uniswap", addresses: "0x3aE6D8A282D67893e17AA70ebFFb33EE5aa65893", criteria: "to" }
    ];

    // --- Global State ---
    let activeEventSource = null;
    let currentConfig = [];
    const racerState = {};
    const START_LINE_PERCENT = 10;
    const FINISH_LINE_PERCENT = 90;
    const SPEED_FACTOR = 0.5;

    // --- DOM Elements ---
    const scoreboardBody = document.getElementById('scoreboard-body');
    const racetrack = document.getElementById('racetrack');
    const configOverlay = document.getElementById('config-overlay');
    const showConfigBtn = document.getElementById('show-config-btn');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const configForm = document.getElementById('config-form');
    const entitySlotsContainer = document.getElementById('entity-slots-container');
    const addEntityBtn = document.getElementById('add-entity-btn');

    // ===================================
    // === RACE & UI MANAGEMENT
    // ===================================

    function initializeDerby(config) {
        if (activeEventSource) {
            activeEventSource.close();
            activeEventSource = null;
        }

        currentConfig = config;
        
        scoreboardBody.innerHTML = '';
        racetrack.innerHTML = '';
        Object.keys(racerState).forEach(key => delete racerState[key]);
        
        config.forEach((entity, index) => {
            const entityId = `entity-${index}`;
            
            const row = scoreboardBody.insertRow();
            row.innerHTML = `
                <td>${escapeHTML(entity.name)}</td>
                <td id="tps-${entityId}">0</td>
                <td id="laps-${entityId}">0</td>
                <td id="hash-${entityId}">N/A</td>
            `;

            const lane = document.createElement('div');
            lane.className = 'lane';
            lane.innerHTML = `
                <div class="racer" id="racer-${entityId}"></div>
                <span class="lane-label">${escapeHTML(entity.name)}</span>
            `;
            racetrack.appendChild(lane);

            racerState[entityId] = { position: START_LINE_PERCENT, laps: 0 };
        });

        connectToServer(config);
    }

    function connectToServer(config) {
        const queryParams = `?config=${encodeURIComponent(JSON.stringify(config))}`;
        const eventSourceUrl = `/derby-data${queryParams}`;

        console.log(`Connecting to: ${eventSourceUrl}`);
        activeEventSource = new EventSource(eventSourceUrl);

        activeEventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                updateRacers(data);
            } catch (e) {
                console.error("Failed to parse server data:", e);
            }
        };

        activeEventSource.onerror = (err) => {
            console.error('EventSource failed:', err);
            activeEventSource.close();
        };
    }

    function updateRacers(data) {
        currentConfig.forEach((_, index) => {
            const entityId = `entity-${index}`;
            const entityData = data[entityId];
            if (!entityData) return;
            
            const state = racerState[entityId];
            if (!state) return;

            const tps = entityData.tps || 0;
            const hash = entityData.hash || 'N/A';

            const racerElement = document.getElementById(`racer-${entityId}`);
            if (!racerElement) return;

            racerElement.style.animationPlayState = tps > 0 ? 'running' : 'paused';
            
            const movement = tps * SPEED_FACTOR;
            state.position += movement;

            if (state.position >= FINISH_LINE_PERCENT) {
                state.laps++;
                const overshoot = state.position - FINISH_LINE_PERCENT;
                state.position = START_LINE_PERCENT + overshoot;
            }

            racerElement.style.left = `${state.position}%`;
            
            document.getElementById(`tps-${entityId}`).textContent = tps;
            document.getElementById(`laps-${entityId}`).textContent = state.laps;
            document.getElementById(`hash-${entityId}`).textContent = hash;
        });
    }

    // ===================================
    // === MODAL & FORM MANAGEMENT
    // ===================================

    function populateModalForm(config) {
        entitySlotsContainer.innerHTML = '';
        config.forEach((entity, index) => {
            addEntitySlot(entity.name, entity.addresses, entity.criteria, index);
        });
        checkEntityLimit();
    }

    function addEntitySlot(name = '', addresses = '', criteria = 'to', index = null) {
        if (index === null) {
            index = entitySlotsContainer.children.length;
        }
        
        const slot = document.createElement('div');
        slot.className = 'entity-slot';
        slot.innerHTML = `
            <button type="button" class="remove-entity-btn" title="Remove this entity">X</button>
            <div class="slot-header">
                <label for="entity-name-${index}">Entity Name</label>
                <input type="text" id="entity-name-${index}" class="entity-name" placeholder="e.g., My Awesome DEX" value="${escapeHTML(name)}">
            </div>
            <div class="slot-body">
                <label for="entity-addresses-${index}">Addresses / Contracts (comma separated)</label>
                <textarea id="entity-addresses-${index}" class="entity-addresses" rows="3" placeholder="0x...">${escapeHTML(addresses)}</textarea>
            </div>
            <div class="slot-criteria">
                <label>Criteria:</label>
                <div class="radio-group">
                    <input type="radio" id="criteria-to-${index}" name="criteria-${index}" value="to" ${criteria === 'to' ? 'checked' : ''}>
                    <label for="criteria-to-${index}">To Address</label>
                    <input type="radio" id="criteria-from-${index}" name="criteria-${index}" value="from" ${criteria === 'from' ? 'checked' : ''}>
                    <label for="criteria-from-${index}">From Address</label>
                    <input type="radio" id="criteria-both-${index}" name="criteria-${index}" value="both" ${criteria === 'both' ? 'checked' : ''}>
                    <label for="criteria-both-${index}">Both</label>
                    <input type="radio" id="criteria-deployer-${index}" name="criteria-${index}" value="deployer" ${criteria === 'deployer' ? 'checked' : ''}>
                    <label for="criteria-deployer-${index}">Deployed By</label>
                </div>
            </div>
        `;
        entitySlotsContainer.appendChild(slot);
        
        slot.querySelector('.remove-entity-btn').addEventListener('click', () => {
            slot.remove();
            checkEntityLimit();
        });
        checkEntityLimit();
    }
    
    function checkEntityLimit() {
        addEntityBtn.disabled = entitySlotsContainer.children.length >= 8;
    }

    function escapeHTML(str) {
        const p = document.createElement("p");
        p.appendChild(document.createTextNode(str));
        return p.innerHTML;
    }

    // --- Event Listeners ---
    showConfigBtn.addEventListener('click', () => {
        populateModalForm(currentConfig);
        configOverlay.classList.remove('hidden');
    });

    closeModalBtn.addEventListener('click', () => {
        configOverlay.classList.add('hidden');
    });

    addEntityBtn.addEventListener('click', () => {
        if (entitySlotsContainer.children.length < 8) {
            addEntitySlot();
        }
    });

    configForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const newConfig = [];
        const slots = entitySlotsContainer.querySelectorAll('.entity-slot');
        slots.forEach((slot, index) => {
            const name = slot.querySelector('.entity-name').value.trim();
            const addresses = slot.querySelector('.entity-addresses').value.trim();
            const criteria = slot.querySelector(`input[name="criteria-${index}"]:checked`).value;
            
            if (name && addresses) {
                newConfig.push({ name, addresses, criteria });
            }
        });

        if (newConfig.length > 0) {
            initializeDerby(newConfig);
        }
        configOverlay.classList.add('hidden');
    });

    // --- INITIALIZATION ---
    initializeDerby(DEFAULT_DEX_CONFIG);
});