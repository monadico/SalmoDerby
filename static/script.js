document.addEventListener('DOMContentLoaded', () => {

    // --- Configuration ---
    // This should match the URL where your Python backend is running.
    const BACKEND_URL = 'http://127.0.0.1:8000/derby-data'; 
    const START_LINE_PERCENT = 10;
    const FINISH_LINE_PERCENT = 90;
    // This factor controls how much distance 1 TPS covers per update.
    // Adjust this value to make the race faster or slower.
    const SPEED_FACTOR = 0.5;

    // A mapping from the data keys we expect from the backend
    // to the element IDs in the HTML.
    const DEX_CONFIG = {
        'lfj': { racerId: 'racer-lfj', tpsId: 'tps-lfj', lapsId: 'laps-lfj', hashId: 'hash-lfj' },
        'pancakeswap': { racerId: 'racer-pancakeswap', tpsId: 'tps-pancakeswap', lapsId: 'laps-pancakeswap', hashId: 'hash-pancakeswap' },
        'bean-exchange': { racerId: 'racer-bean-exchange', tpsId: 'tps-bean-exchange', lapsId: 'laps-bean-exchange', hashId: 'hash-bean-exchange' },
        'ambient-finance': { racerId: 'racer-ambient-finance', tpsId: 'tps-ambient-finance', lapsId: 'laps-ambient-finance', hashId: 'hash-ambient-finance' },
        'izumi-finance': { racerId: 'racer-izumi-finance', tpsId: 'tps-izumi-finance', lapsId: 'laps-izumi-finance', hashId: 'hash-izumi-finance' },
        'octoswap': { racerId: 'racer-octoswap', tpsId: 'tps-octoswap', lapsId: 'laps-octoswap', hashId: 'hash-octoswap' },
        'uniswap': { racerId: 'racer-uniswap', tpsId: 'tps-uniswap', lapsId: 'laps-uniswap', hashId: 'hash-uniswap' }
    };

    // --- State Management ---
    // This object will hold the current progress (position and laps) for each racer.
    const racerState = {};
    for (const key in DEX_CONFIG) {
        racerState[key] = {
            position: START_LINE_PERCENT,
            laps: 0
        };
    }

    // --- Main Logic ---

    function connectToServer() {
        console.log('Connecting to server...');
        const eventSource = new EventSource(BACKEND_URL);

        // This function is called every time a new message is received from the server
        eventSource.onmessage = (event) => {
            // We expect the data to be a JSON string, so we parse it.
            const data = JSON.parse(event.data);
            
            // Update each racer based on the new data
            updateRacers(data);
        };

        // Handle connection errors
        eventSource.onerror = (err) => {
            console.error('EventSource failed:', err);
            eventSource.close();
            // Try to reconnect after a delay
            setTimeout(connectToServer, 5000); 
        };
    }

    function updateRacers(data) {
        for (const dexKey in data) {
            if (DEX_CONFIG[dexKey]) {
                const config = DEX_CONFIG[dexKey];
                const state = racerState[dexKey];
                const tps = data[dexKey].tps || 0;
                const hash = data[dexKey].hash || 'N/A';

                // Get the racer's HTML element
                const racerElement = document.getElementById(config.racerId);
                if (!racerElement) continue;

                // --- Animation Control ---
                // If TPS is > 0, the animation should be running. Otherwise, pause it.
                racerElement.style.animationPlayState = tps > 0 ? 'running' : 'paused';

                // --- Movement Calculation ---
                const movement = tps * SPEED_FACTOR;
                state.position += movement;

                // --- Lap Logic ---
                // Check if the racer has crossed the finish line
                if (state.position >= FINISH_LINE_PERCENT) {
                    state.laps++; // Increment lap count
                    // Calculate the "overshoot" to place the racer accurately on the next lap
                    const overshoot = state.position - FINISH_LINE_PERCENT;
                    state.position = START_LINE_PERCENT + overshoot;
                }

                // --- Update UI ---
                // Move the racer on the screen
                racerElement.style.left = `${state.position}%`;
                
                // Update the scoreboard
                document.getElementById(config.tpsId).textContent = tps;
                document.getElementById(config.lapsId).textContent = state.laps;
                document.getElementById(config.hashId).textContent = hash;
            }
        }
    }

    // Start the connection to the server
    connectToServer();
});