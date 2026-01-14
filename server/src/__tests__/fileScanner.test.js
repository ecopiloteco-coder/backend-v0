const fs = require('fs');
const path = require('path');
const FileScanner = require('../utils/FileScanner');

describe('FileScanner', () => {
    const testDir = path.join(__dirname, 'temp_test_files');
    
    beforeAll(() => {
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir);
        }
    });

    afterAll(() => {
        // Clean up
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    test('should detect security issues (AWS Key)', async () => {
        const filePath = path.join(testDir, 'leak.js');
        const content = 'const key = "AKIAIOSFODNN7EXAMPLE";';
        fs.writeFileSync(filePath, content);

        const result = await FileScanner.scanFile(filePath);
        expect(result.status).toBe('danger');
        expect(result.security).toHaveLength(1);
        expect(result.security[0].type).toBe('AWS Access Key');
    });

    test('should detect quality issues (console.log)', async () => {
        const filePath = path.join(testDir, 'log.js');
        const content = 'console.log("debug");';
        fs.writeFileSync(filePath, content);

        const result = await FileScanner.scanFile(filePath);
        // It might be warning or danger depending on precedence.
        // If only quality issues, it should be warning.
        expect(result.status).toBe('warning');
        expect(result.quality).toHaveLength(1);
        expect(result.quality[0].type).toBe('Console Log');
    });

    test('should detect long lines', async () => {
        const filePath = path.join(testDir, 'long.js');
        const longLine = 'a'.repeat(301);
        fs.writeFileSync(filePath, longLine);

        const result = await FileScanner.scanFile(filePath);
        expect(result.status).toBe('warning');
        expect(result.quality.some(q => q.type === 'Line too long')).toBe(true);
    });

    test('should return clean status for clean files', async () => {
        const filePath = path.join(testDir, 'clean.js');
        const content = 'const a = 1;';
        fs.writeFileSync(filePath, content);

        const result = await FileScanner.scanFile(filePath);
        expect(result.status).toBe('clean');
        expect(result.security).toHaveLength(0);
        expect(result.quality).toHaveLength(0);
        expect(result.integrity.hash).toBeDefined();
    });
});
