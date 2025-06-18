// Configuration for different environments
const config = {
  // Default to localhost for development
  API_BASE_URL: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? 'http://localhost:8000'
    : 'https://your-render-app.onrender.com', // Replace with your actual Render URL
  
  // You can also use environment detection
  isDevelopment: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
};

// Export for use in other scripts
window.CONFIG = config; 