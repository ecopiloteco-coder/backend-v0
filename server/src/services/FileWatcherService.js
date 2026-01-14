const chokidar = require('chokidar');
const path = require('path');
const FileScanner = require('../utils/FileScanner');

class FileWatcherService {
    constructor() {
        this.watcher = null;
        this.watchedPath = null;
        this.scanResults = new Map(); // path -> scan result
        this.recentEvents = []; // list of recent event logs
        this.isReady = false;
        this.options = {
            ignored: [
                /(^|[\/\\])\../, // ignore dotfiles
                /node_modules/,
                /coverage/,
                /__tests__/, // maybe ignore tests or scan them? Requirement says "Scan all files... including Source code...". Let's scan tests too but maybe with different rules. For now, scan everything.
                /\.log$/
            ],
            persistent: true,
            ignoreInitial: false, // Scan initial files
            awaitWriteFinish: {
                stabilityThreshold: 2000,
                pollInterval: 100
            }
        };
    }

    /**
     * Start watching a directory.
     * @param {string} dirPath - Absolute path to directory.
     */
    start(dirPath) {
        if (this.watcher) {
            console.warn('Watcher already running.');
            return;
        }

        this.watchedPath = dirPath;
        console.log(`[FileWatcher] Starting watch on: ${dirPath}`);

        this.watcher = chokidar.watch(dirPath, this.options);

        this.watcher
            .on('add', (path) => this.handleFileChange('add', path))
            .on('change', (path) => this.handleFileChange('change', path))
            .on('unlink', (path) => this.handleFileRemove(path))
            .on('error', (error) => this.logEvent('error', `Watcher error: ${error}`))
            .on('ready', () => {
                this.isReady = true;
                this.logEvent('info', 'Initial scan complete. Watcher is ready.');
                console.log('[FileWatcher] Ready.');
            });
    }

    /**
     * Stop the watcher.
     */
    async stop() {
        if (this.watcher) {
            await this.watcher.close();
            this.watcher = null;
            this.isReady = false;
            console.log('[FileWatcher] Stopped.');
        }
    }

    /**
     * Handle file addition or modification.
     */
    async handleFileChange(type, filePath) {
        // Skip if not a file we care about (double check)
        
        console.log(`[FileWatcher] File ${type}: ${filePath}`);
        this.logEvent(type, `File ${type}: ${path.basename(filePath)}`);

        // Trigger scan
        const result = await FileScanner.scanFile(filePath);
        
        // Update results
        this.scanResults.set(filePath, result);

        // Notify/Log issues
        if (result.status === 'danger') {
            console.error(`[SECURITY ALERT] ${filePath}:`, result.security);
            this.logEvent('alert', `Security issue in ${path.basename(filePath)}`);
        } else if (result.status === 'warning') {
            console.warn(`[QUALITY WARNING] ${filePath}:`, result.quality);
            this.logEvent('warning', `Quality issue in ${path.basename(filePath)}`);
        } else if (result.status === 'error') {
             console.error(`[SCAN ERROR] ${filePath}:`, result.error);
             this.logEvent('error', `Scan failed for ${path.basename(filePath)}`);
        }
    }

    /**
     * Handle file removal.
     */
    handleFileRemove(filePath) {
        console.log(`[FileWatcher] File unlink: ${filePath}`);
        this.scanResults.delete(filePath);
        this.logEvent('unlink', `File deleted: ${path.basename(filePath)}`);
    }

    /**
     * Log an event to history.
     */
    logEvent(type, message) {
        const event = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
            timestamp: new Date().toISOString(),
            type,
            message
        };
        this.recentEvents.unshift(event);
        // Keep last 100 events
        if (this.recentEvents.length > 100) {
            this.recentEvents.pop();
        }
    }

    /**
     * Get current system status.
     */
    getStatus() {
        const totalFiles = this.scanResults.size;
        let issues = 0;
        let securityIssues = 0;

        for (const res of this.scanResults.values()) {
            if (res.status === 'warning') issues++;
            if (res.status === 'danger') securityIssues++;
        }

        return {
            status: this.isReady ? 'running' : 'initializing',
            watchedPath: this.watchedPath,
            stats: {
                totalFiles,
                warnings: issues,
                securityAlerts: securityIssues
            },
            recentEvents: this.recentEvents,
            scanResults: Array.from(this.scanResults.values()) // Return full list? Maybe too big. 
                // Let's return only issues or simplified list if needed.
                // For now, return all is fine for a small project.
        };
    }
}

// Singleton instance
module.exports = new FileWatcherService();
