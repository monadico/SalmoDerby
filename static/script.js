document.addEventListener('DOMContentLoaded', () => {

    // --- Configuration ---
    // The backend now serves the root, so the data stream is at this relative path
    const BACKEND_URL = '/derby-data'; 
    const START_LINE_PERCENT = 10;
    const FINISH_LINE_PERCENT = 90;
    const SPEED_FACTOR = 0.5;

    const DEX_CONFIG = {
        'lfj': { racerId: 'racer-lfj', tpsId: 'tps-lfj', lapsId: 'laps-lfj', hashId: 'hash-lfj' },
        'pancakeswap': { racerId: 'racer-pancakeswap', tpsId: 'tps-pancakeswap', lapsId: 'laps-pancakeswap', hashId: 'hash-pancakeswap' },
        'bean-exchange': { racerId: 'racer-bean-exchange', tpsId: 'tps-bean-exchange', lapsId: 'laps-bean-exchange', hashId: 'hash-bean-exchange' },
        'ambient-finance': { racerId: 'racer-ambient-finance', tpsId: 'tps-ambient-finance', lapsId: 'laps-ambient-finance', hashId: 'hash-ambient-finance' },
        'izumi-finance': { racerId: 'racer-izumi-finance', tpsId: 'tps-izumi-finance', lapsId: 'laps-izumi-finance', hashId: 'hash-izumi-finance' },
        'octoswap': { racerId: 'racer-octoswap', tpsId: 'tps-octoswap', lapsId: 'laps-octoswap', hashId: 'hash-octoswap' },
        'uniswap': { racerId: 'racer-uniswap', tpsId: 'tps-uniswap', lapsId: 'laps-uniswap', hashId: 'hash-uniswap' }
    };

    const racerState = {};
    for (const key in DEX_CONFIG) {
        racerState[key] = {
            position: START_LINE_PERCENT,
            laps: 0
        };
    }

    function connectToServer() {
        console.log('Connecting to data stream...');
        const eventSource = new EventSource(BACKEND_URL);

        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            updateRacers(data);
        };

        eventSource.onerror = (err) => {
            console.error('EventSource failed:', err);
            eventSource.close();
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

                const racerElement = document.getElementById(config.racerId);
                if (!racerElement) continue;

                racerElement.style.animationPlayState = tps > 0 ? 'running' : 'paused';

                const movement = tps * SPEED_FACTOR;
                state.position += movement;

                if (state.position >= FINISH_LINE_PERCENT) {
                    state.laps++;
                    const overshoot = state.position - FINISH_LINE_PERCENT;
                    state.position = START_LINE_PERCENT + overshoot;
                }

                racerElement.style.left = `${state.position}%`;
                
                document.getElementById(config.tpsId).textContent = tps;
                document.getElementById(config.lapsId).textContent = state.laps;
                document.getElementById(config.hashId).textContent = hash;
            }
        }
    }
    
    connectToServer();
});
