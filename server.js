#!/usr/bin/env node
// Copyright (c) 2025 Peter Jedra - MIT License
// Packages/dependencies
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const si = require('systeminformation');
const os = require('os');
const { spawn } = require('child_process');

const isWindows = os.platform() === 'win32';
const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

// Windows has no load average, so we keep our own rolling average of total CPU % (one sample per second)
const cpuHistory = {m1: [], m5: [], m15: []};
const maxSamples = { m1: 60, m5: 300, m15: 900 };

// Latest disk reading from the background PowerShell sampler (Windows only)
let windowsDisk = null;

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
            res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
            res.end(content, 'utf-8');
        }
    });
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('Client connected');
    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

// Windows: wmic is deprecated (and missing on newer Windows 11), so read the disk performance counters
// from one long-running PowerShell process instead of spawning a new process every second.
function startWindowsDiskSampler() {
    const script = `
        while ($true) {
            $d = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'"
            try { [Console]::Out.WriteLine("$($d.DiskReadBytesPerSec),$($d.DiskWriteBytesPerSec),$($d.DiskTransfersPerSec)") } catch { exit }
            Start-Sleep -Seconds 1
        }`;
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true });

    let buffer = '';
    ps.stdout.on('data', chunk => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop();
        lines.forEach(line => {
            const [read, write, transfers] = line.split(',').map(Number);
            if (![read, write, transfers].some(isNaN)) {
                windowsDisk = { read, write, transfers, time: Date.now() };
            }
        });
    });
    ps.on('exit', code => {
        console.error(`Windows disk sampler exited (code ${code}), disk stats will show N/A`);
        windowsDisk = null;
    });
    process.on('exit', () => ps.kill());
}

// Build the disk block from bytes/sec and transfers/sec; null means "not available yet"
function diskStats(readBytesSec, writeBytesSec, transfersSec) {
    if (readBytesSec == null || writeBytesSec == null) {
        return { kbt: null, tps: null, mbs: null, read_mbs: null, write_mbs: null };
    }
    const totalBytes = readBytesSec + writeBytesSec;
    return {
        kbt: transfersSec > 0 ? totalBytes / 1024 / transfersSec : null,
        tps: transfersSec,
        mbs: totalBytes / MB,
        read_mbs: readBytesSec / MB,
        write_mbs: writeBytesSec / MB
    };
}

async function collectStats() {
    // fsStats/disksIO read /proc and lsblk on Linux (no iostat needed); they return null on Windows
    const [cpu, mem, net, fsIo, diskIo] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.networkStats(),
        isWindows ? null : si.fsStats(),
        isWindows ? null : si.disksIO()
    ]);

    const totalCpu = cpu.currentLoadUser + cpu.currentLoadSystem;
    ['m1', 'm5', 'm15'].forEach(key => {
        cpuHistory[key].unshift(totalCpu);
        if (cpuHistory[key].length > maxSamples[key]) cpuHistory[key].pop();
    });
    const avgCpu = key => cpuHistory[key].reduce((a, b) => a + b, 0) / (cpuHistory[key].length || 1);

    let disk;
    if (isWindows) {
        const fresh = windowsDisk && Date.now() - windowsDisk.time < 5000;
        disk = fresh ? diskStats(windowsDisk.read, windowsDisk.write, windowsDisk.transfers) : diskStats(null, null, null);
    } else {
        // The *_sec values are null on the first call, until there are two readings to compare
        disk = diskStats(fsIo && fsIo.rx_sec, fsIo && fsIo.wx_sec, diskIo && diskIo.tIO_sec);
    }

    const sum = (items, key) => items.some(item => item[key] != null) ? items.reduce((a, item) => a + (item[key] || 0), 0) : null;

    let load_average;
    if (isWindows) {
        load_average = { m1: avgCpu('m1'), m5: avgCpu('m5'), m15: avgCpu('m15') };
    } else { // Linux/macOS
        const [m1, m5, m15] = os.loadavg();
        load_average = { m1, m5, m15 };
    }

    return {
        date: new Date().toLocaleTimeString(),
        platform: os.platform(),
        cores: os.cpus().length,
        // How many seconds of CPU history the Windows averages are based on so far
        history_seconds: cpuHistory.m15.length,
        disk,
        cpu: {
            us: cpu.currentLoadUser,
            sy: cpu.currentLoadSystem,
            id: cpu.currentLoadIdle
        },
        load_average,
        mem: {
            used_pct: (mem.total - mem.available) / mem.total * 100,
            used_gb: (mem.total - mem.available) / GB,
            total_gb: mem.total / GB
        },
        net: {
            rx_sec: sum(net, 'rx_sec'),
            tx_sec: sum(net, 'tx_sec')
        }
    };
}

if (isWindows) {
    startWindowsDiskSampler();
}

// One shared sampling loop for all clients, so each new connection doesn't start another timer
let sampling = false;
setInterval(async () => {
    if (sampling) return; // previous sample still running
    sampling = true;
    try {
        const message = JSON.stringify(await collectStats());
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    } catch (err) {
        console.error('Error getting system info:', err);
    } finally {
        sampling = false;
    }
}, 1000);

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
