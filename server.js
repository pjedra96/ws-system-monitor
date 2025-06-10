const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const si = require('systeminformation');
const os = require('os');
const { exec } = require('child_process');
const cpuHistory = {m1: [], m5: [], m15: []};
const maxSamples = { m1: 60, m5: 300, m15: 900 };

const server = http.createServer((req, res) => {
    let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.wav': 'audio/wav',
        '.mp4': 'video/mp4',
        '.woff': 'application/font-woff',
        '.ttf': 'application/font-ttf',
        '.eot': 'application/vnd.ms-fontobject',
        '.otf': 'application/font-otf',
        '.wasm': 'application/wasm'
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code == 'ENOENT') {
                res.writeHead(404);
                res.end('404 Not Found');
            } else {
                res.writeHead(500);
                res.end('500 Internal Server Error');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('Client connected');

    // Simulate sending data every second
    /*setInterval(() => {
        const data = JSON.stringify({
            date: new Date().toLocaleTimeString(),
            disk: { kbt: Math.random() * 100, tps: Math.random() * 50, mbs: Math.random() * 10 },
            cpu: { us: Math.random() * 100, sy: Math.random() * 100, id: Math.random() * 100 },
            load_average: { m1: Math.random() * 5, m5: Math.random() * 5, m15: Math.random() * 5 }
        });
        ws.send(data);
    }, 1000);*/
    // Use systeminformation to get actual data
    setInterval(async () => {
        try {
            const [cpu] = await Promise.all([
                si.currentLoad()
            ]);
            // Update CPU history
            const totalCpu = cpu.currentLoadUser + cpu.currentLoadSystem;
            ['m1', 'm5', 'm15'].forEach(key => {
                cpuHistory[key].unshift(totalCpu);
                if (cpuHistory[key].length > maxSamples[key]) cpuHistory[key].pop();
            });
            const avgCpu = key => cpuHistory[key].reduce((a, b) => a + b, 0) / (cpuHistory[key].length || 1);
            // Get current time
            const now = new Date();

            // Prepare disk stats
            let diskStats = {
                kbt: "N/A",
                tps: "N/A",
                mbs: "N/A"
            };

            if (os.platform() === 'win32') {
                // Windows: Use wmic
                exec('wmic path Win32_PerfFormattedData_PerfDisk_PhysicalDisk get DiskTransfersPerSec,DiskReadBytesPerSec,DiskWriteBytesPerSec /format:csv', (err, stdout) => {
                    if (!err && stdout) {
                        const lines = stdout.trim().split('\n').filter(line => line.trim());
                        // Find the first valid data line (skip header and _Total)
                        const dataLine = lines.find(line => line && !line.includes('Node') && !line.includes('_Total'));
                        if (dataLine) {
                            const parts = dataLine.split(',');
                            // Columns: NodeName,DiskReadBytesPerSec,DiskTransfersPerSec,DiskWriteBytesPerSec
                            const tps = Number(parts[2]);
                            const readB = Number(parts[1]);
                            const writeB = Number(parts[3].replace(/\r/g, ''));
                            const totalBytes = readB + writeB;
                            const mbs = (typeof totalBytes === 'number' && totalBytes > 0) ? (totalBytes / (1024 * 1024)).toFixed(3) : "N/A";
                            const kbt = (typeof tps === 'number' && tps > 0 && typeof totalBytes === 'number') ? ((totalBytes / 1024) / tps).toFixed(3) : "N/A";
                            diskStats = {
                                kbt: isNaN(kbt) ? "N/A" : kbt,
                                tps: isNaN(tps) ? "N/A" : tps.toFixed(3),
                                mbs: isNaN(mbs) ? "N/A" : mbs
                            };
                        }
                    }
                    sendStats();
                });
            } else {
                // Linux/macOS: Use iostat
                exec('iostat -d 1 2', (err, stdout) => {
                    if (!err && stdout) {
                        // Find the last device line with numbers
                        const lines = stdout.trim().split('\n');
                        const deviceLine = lines.reverse().find(line => /\d/.test(line) && !line.includes('Device'));
                        if (deviceLine) {
                            const parts = deviceLine.trim().split(/\s+/);
                            // Typical columns: Device tps kB_read/s kB_wrtn/s kB_read kB_wrtn
                            // We'll use tps, kB_read/s, kB_wrtn/s
                            const tps = Number(parts[1]);
                            const kb_read_s = Number(parts[2]);
                            const kb_wrtn_s = Number(parts[3]);
                            const mbs = ((kb_read_s + kb_wrtn_s) / 1024).toFixed(3);
                            const kbt = (tps > 0 ? ((kb_read_s + kb_wrtn_s) / tps).toFixed(3) : "N/A");
                            diskStats = {
                                kbt,
                                tps: isNaN(tps) ? "N/A" : tps.toFixed(3),
                                mbs: isNaN(mbs) ? "N/A" : mbs
                            };
                        }
                    }
                    sendStats();
                });
            }

            // Send stats after diskStats is set
            function sendStats() {
                let load_average, m1, m5, m15;
                const data = JSON.stringify({
                    date: now.toLocaleTimeString(),
                    disk: diskStats,
                    cpu: {
                        us: cpu.currentLoadUser,
                        sy: cpu.currentLoadSystem,
                        id: cpu.currentLoadIdle
                    },
                    load_average: (() => {
                        if(os.platform() === 'win32'){
                            m1 = avgCpu('m1'), m5 = avgCpu('m5'), m15 = avgCpu('m15');
                        }else{ // Linux/macOS
                            [m1, m5, m15] = os.loadavg();
                        }
                        return { m1, m5, m15 };
                    })()
                });
                ws.send(data);
            }
        } catch (err) {
            console.error('Error getting system info:', err);
        }
    }, 1000);

    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});