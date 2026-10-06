// This file contains the JavaScript code that establishes a WebSocket connection, handles incoming data, updates the table with statistics, and renders the line graph based on the received data.
let webSocket = null; // Make it global
let chartUpdateTimeout = null;
let dataCounter = 0; // Add a counter
const statsArray = [];
const maxStats = 10;

const ctx = document.getElementById('lineChart').getContext('2d');
const lineChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [
            {
                label: 'User CPU Usage',
                data: [],
                borderColor: '#2e7d32',
                backgroundColor: 'rgba(46, 125, 50, 0.12)',
                fill: true,
                tension: 0.3,
                pointRadius: 2,
            },
            {
                label: 'System CPU Usage',
                data: [],
                borderColor: '#d32f2f',
                backgroundColor: 'rgba(211, 47, 47, 0.10)',
                fill: true,
                tension: 0.3,
                pointRadius: 2,
            }
        ]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } }
        },
        scales: {
            x: {
                grid: { display: false }
            },
            y: {
                beginAtZero: true,
                max: 100,
                ticks: { callback: value => value + '%' },
                grid: { color: '#eef1f4' }
            }
        }
    }
});

// Detect OS on page load
document.addEventListener('DOMContentLoaded', function() {
    const os = getOS();
    const mobileOS = isMobile();
    const subtitleElem = document.getElementsByClassName('subtitle')[0];
    if (mobileOS !== false) {
        subtitleElem.innerHTML += `<br><span class="client-info">Connected client ${mobileOS} detected (mobile)</span>`;
    }else{
        if(os === 'Windows'){
            subtitleElem.innerHTML += `<br><span class="client-info">Connected client ${os} detected</span>`;
        }
    }
    
    // Handle window unload to close WebSocket
    window.addEventListener('beforeunload', function() {
        closeWebSocket();
    });
});

function getClientInfo() {
    return {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        screen: {
            width: window.screen.width,
            height: window.screen.height
        }
    };
}

function isMobile() {
    const userAgent = navigator.userAgent.toLowerCase();
    if (/android/.test(userAgent)) return 'Android';
    if (/iphone|ipad|ipod/.test(userAgent)) return 'iOS';
    return false; // Not a mobile device
}

function getOS() {
    const platform = navigator.platform.toLowerCase();
    const userAgent = navigator.userAgent.toLowerCase();

    if (platform.includes('win')) return 'Windows';
    if (platform.includes('mac')) return 'macOS';
    if (platform.includes('linux')) return 'Linux';
    if (/android/.test(userAgent)) return 'Android';
    if (/iphone|ipad|ipod/.test(userAgent)) return 'iOS';
    return 'Unknown';
}

function startWebSocket() {
    if (webSocket && webSocket.readyState !== WebSocket.CLOSED) {
        return; // Already open
    }
    // Connect back to whichever host served the page, so it also works when opened from another machine
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    webSocket = new WebSocket(`${protocol}://${location.host}/iostat`);

    webSocket.onopen = function() {
        console.log('Connection opened.');
        setStatus(true);
    };

    webSocket.onmessage = function(event) {
        dataCounter++;
        // Only process every 2nd data point (adjust as needed)
        if (dataCounter % 2 !== 0) {
            return;
        }

        const data = JSON.parse(event.data);
        applyServerInfo(data);

        statsArray.unshift(data);
        if (statsArray.length > maxStats) {
            statsArray.pop();
        }

        updateTable();

        // Throttle chart updates to once every 2 seconds
        if (!chartUpdateTimeout) {
            chartUpdateTimeout = setTimeout(() => {
                updateChart();
                chartUpdateTimeout = null;
            }, 2000);
        }
    };

    webSocket.onclose = function() {
        console.log('Connection closed.');
        setStatus(false);
    };
}

function setStatus(connected) {
    const statusElem = document.getElementById('status');
    statusElem.textContent = connected ? 'Connected' : 'Disconnected';
    statusElem.classList.toggle('connected', connected);
}

function closeWebSocket() {
    if (webSocket) {
        webSocket.close();
    }
}

// Reference ranges used to colour the cells
const CPU_PERCENT_LEVELS = { busy: 70, high: 90 };    // total CPU %
const LOAD_PER_CORE_LEVELS = { busy: 0.7, high: 1.0 }; // Linux/macOS load average divided by core count
const MEMORY_PERCENT_LEVELS = { busy: 80, high: 90 };  // memory in use (excluding reclaimable cache)

const PLATFORM_NAMES = { win32: 'Windows', linux: 'Linux', darwin: 'macOS' };
let serverPlatform = null;

// Relabel the load average columns and explain them, based on the server's OS (not the browser's)
function applyServerInfo(stat) {
    const legend = document.getElementById('loadLegend');
    const isWindows = stat.platform === 'win32';

    if (serverPlatform !== stat.platform) {
        serverPlatform = stat.platform;
        const name = PLATFORM_NAMES[stat.platform] || stat.platform;
        document.getElementById('serverInfo').textContent =
            `Server: ${name} · ${stat.cores} CPU cores · ${stat.mem.total_gb.toFixed(1)} GB RAM`;

        if (isWindows) {
            document.getElementById('additional_stats').textContent = 'Avg CPU usage';
            document.getElementById('avg1').innerHTML = '1 min <small>avg CPU %</small>';
            document.getElementById('avg5').innerHTML = '5 min <small>avg CPU %</small>';
            document.getElementById('avg15').innerHTML = '15 min <small>avg CPU %</small>';
        } else {
            document.getElementById('additional_stats').textContent = `Load average (${stat.cores} cores)`;
            document.getElementById('avg1').innerHTML = '1 min <small>total · per core</small>';
            document.getElementById('avg5').innerHTML = '5 min <small>total · per core</small>';
            document.getElementById('avg15').innerHTML = '15 min <small>total · per core</small>';
        }
    }

    const scale = `<span class="level-ok">green</span> = comfortable, <span class="level-busy">amber</span> = busy, <span class="level-high">red</span> = overloaded.`;
    if (isWindows) {
        const minutes = Math.floor(stat.history_seconds / 60);
        const warmUp = stat.history_seconds < 900
            ? ` The server has only been sampling for ${minutes < 1 ? 'under a minute' : minutes + ' min'}, so the longer averages are still filling up.`
            : '';
        legend.innerHTML = `<strong>Avg CPU usage:</strong> Windows has no load average, so these columns show the average total CPU % over the last 1, 5 and 15 minutes. ` +
            `Under ${CPU_PERCENT_LEVELS.busy}% is comfortable, ${CPU_PERCENT_LEVELS.busy}–${CPU_PERCENT_LEVELS.high}% is busy, over ${CPU_PERCENT_LEVELS.high}% means the CPU is saturated. ${scale}${warmUp}`;
    } else {
        legend.innerHTML = `<strong>Load average:</strong> the average number of processes running or waiting to run (on Linux this includes processes waiting on disk) over the last 1, 5 and 15 minutes. ` +
            `Read it against the core count: a load of ${stat.cores} means all ${stat.cores} cores are fully used. ` +
            `Per core, under ${LOAD_PER_CORE_LEVELS.busy} is comfortable, ${LOAD_PER_CORE_LEVELS.busy}–${LOAD_PER_CORE_LEVELS.high} is busy, over ${LOAD_PER_CORE_LEVELS.high} means work is queuing. ${scale} ` +
            `If the 1 min value is higher than the 15 min value, load is rising.`;
    }
}

function levelClass(value, levels) {
    if (value >= levels.high) return 'level-high';
    if (value >= levels.busy) return 'level-busy';
    return 'level-ok';
}

function fmt(value, digits = 2) {
    return value == null ? 'N/A' : value.toFixed(digits);
}

// Network speed in bytes/sec, scaled to a readable unit
function fmtRate(bytesPerSec) {
    if (bytesPerSec == null) return 'N/A';
    if (bytesPerSec >= 1024 * 1024) return (bytesPerSec / (1024 * 1024)).toFixed(2) + ' MB/s';
    return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
}

function loadCell(value, stat) {
    if (value == null) return '<td>N/A</td>';
    if (stat.platform === 'win32') {
        return `<td class="${levelClass(value, CPU_PERCENT_LEVELS)}">${value.toFixed(1)}%</td>`;
    }
    const perCore = value / stat.cores;
    return `<td class="${levelClass(perCore, LOAD_PER_CORE_LEVELS)}">${value.toFixed(2)} <small>${perCore.toFixed(2)}</small></td>`;
}

function updateTable() {
    const tableBody = document.getElementById('statsTableBody');
    tableBody.innerHTML = '';

    statsArray.forEach(stat => {
        const row = document.createElement('tr');
        const totalCpu = stat.cpu.us + stat.cpu.sy;
        row.innerHTML = `
            <td>${stat.date}</td>
            <td>${fmt(stat.disk.kbt)}</td>
            <td>${fmt(stat.disk.tps, 1)}</td>
            <td>${fmt(stat.disk.read_mbs)}</td>
            <td>${fmt(stat.disk.write_mbs)}</td>
            <td>${fmt(stat.cpu.us, 1)}</td>
            <td>${fmt(stat.cpu.sy, 1)}</td>
            <td class="${levelClass(totalCpu, CPU_PERCENT_LEVELS)}">${fmt(totalCpu, 1)}</td>
            <td>${fmt(stat.cpu.id, 1)}</td>
            <td class="${levelClass(stat.mem.used_pct, MEMORY_PERCENT_LEVELS)}">${fmt(stat.mem.used_pct, 1)}% <small>${fmt(stat.mem.used_gb, 1)} GB</small></td>
            <td>${fmtRate(stat.net.rx_sec)}</td>
            <td>${fmtRate(stat.net.tx_sec)}</td>
            ${loadCell(stat.load_average.m1, stat)}
            ${loadCell(stat.load_average.m5, stat)}
            ${loadCell(stat.load_average.m15, stat)}
        `;
        tableBody.appendChild(row);
    });
}

function updateChart() {
    // statsArray is newest-first; reverse so time runs left to right on the chart
    const chronological = statsArray.slice().reverse();
    const labels = chronological.map(stat => stat.date);
    const userData = chronological.map(stat => stat.cpu.us);
    const sysData = chronological.map(stat => stat.cpu.sy);

    lineChart.data.labels = labels;
    lineChart.data.datasets[0].data = userData;
    lineChart.data.datasets[1].data = sysData;
    lineChart.update();
}