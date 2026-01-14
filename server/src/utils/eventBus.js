// Shared event bus for real-time project updates
const EventEmitter = require('events');

// Create a single event emitter instance for the entire application
const projectEvents = new EventEmitter();

// Set max listeners to prevent memory leak warnings
// Adjust based on expected concurrent SSE connections
projectEvents.setMaxListeners(1000);

// Export the emitter so controllers and routes can use it
module.exports = { projectEvents };
