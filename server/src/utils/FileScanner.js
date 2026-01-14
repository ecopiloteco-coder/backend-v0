const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// Patterns for security scanning
const SECURITY_PATTERNS = [
    { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/ },
    { name: 'Private Key', regex: /-----BEGIN PRIVATE KEY-----/ },
    { name: 'Generic API Key', regex: /api_key\s*[:=]\s*['"][a-zA-Z0-9]{20,}['"]/i },
    { name: 'Hardcoded Password', regex: /password\s*[:=]\s*['"][a-zA-Z0-9@#$%^&+=]{8,}['"]/i }
];

// Patterns for quality scanning
const QUALITY_PATTERNS = [
    { name: 'Console Log', regex: /console\.log\(/ },
    { name: 'TODO Comment', regex: /\/\/\s*TODO:/ },
    { name: 'FIXME Comment', regex: /\/\/\s*FIXME:/ }
];

class FileScanner {
    /**
     * Scans a file for integrity, security, and quality issues.
     * @param {string} filePath - Absolute path to the file.
     * @returns {Promise<Object>} - Scan results.
     */
    static async scanFile(filePath) {
        const result = {
            filePath,
            timestamp: new Date().toISOString(),
            integrity: { hash: null, size: 0 },
            security: [],
            quality: [],
            status: 'clean', // 'clean', 'warning', 'danger'
            error: null
        };

        try {
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                throw new Error('File does not exist');
            }

            const stats = fs.statSync(filePath);
            result.integrity.size = stats.size;

            // Read file content
            const content = fs.readFileSync(filePath); // Read as buffer for hash
            
            // Calculate Hash
            const hash = crypto.createHash('sha256').update(content).digest('hex');
            result.integrity.hash = hash;

            // If it's a text file, perform code analysis
            if (this.isTextFile(filePath)) {
                const textContent = content.toString('utf-8');
                
                // Security Scan
                for (const pattern of SECURITY_PATTERNS) {
                    if (pattern.regex.test(textContent)) {
                        result.security.push({ type: pattern.name, severity: 'high' });
                        result.status = 'danger';
                    }
                }

                // Quality Scan
                for (const pattern of QUALITY_PATTERNS) {
                    if (pattern.regex.test(textContent)) {
                        result.quality.push({ type: pattern.name, severity: 'low' });
                        if (result.status === 'clean') result.status = 'warning';
                    }
                }

                // Line length check
                const lines = textContent.split('\n');
                lines.forEach((line, index) => {
                    if (line.length > 300) {
                        result.quality.push({ 
                            type: 'Line too long', 
                            line: index + 1, 
                            severity: 'low' 
                        });
                        if (result.status === 'clean') result.status = 'warning';
                    }
                });
            }

        } catch (err) {
            result.error = err.message;
            result.status = 'error';
        }

        return result;
    }

    static isTextFile(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const textExtensions = ['.js', '.ts', '.json', '.md', '.txt', '.html', '.css', '.env', '.yml', '.yaml', '.xml'];
        return textExtensions.includes(ext);
    }
}

module.exports = FileScanner;
