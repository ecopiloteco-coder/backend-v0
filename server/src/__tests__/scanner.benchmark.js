const fs = require('fs');
const path = require('path');
const FileScanner = require('../utils/FileScanner');

async function runBenchmark() {
    console.log('Starting FileScanner Benchmark...');
    
    // Create a large file
    const largeFilePath = path.join(__dirname, 'large_test_file.txt');
    const content = 'This is a test line.\n'.repeat(100000); // ~2MB
    fs.writeFileSync(largeFilePath, content);

    console.log(`Created test file: ${(fs.statSync(largeFilePath).size / 1024 / 1024).toFixed(2)} MB`);

    const start = process.hrtime();
    
    const result = await FileScanner.scanFile(largeFilePath);
    
    const end = process.hrtime(start);
    const timeMs = (end[0] * 1000 + end[1] / 1e6).toFixed(2);

    console.log(`Scan completed in ${timeMs} ms`);
    console.log(`Hash: ${result.integrity.hash}`);
    
    // Cleanup
    fs.unlinkSync(largeFilePath);
    
    if (parseFloat(timeMs) > 1000) {
        console.warn('WARNING: Scan took longer than 1s');
    } else {
        console.log('Performance: OK');
    }
}

runBenchmark().catch(console.error);
