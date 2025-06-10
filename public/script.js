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
                borderColor: 'green',
                fill: false,
            },
            {
                label: 'System CPU Usage',
                data: [],
                borderColor: 'red',
                fill: false,
            }
        ]
    },
    options: {
        scales: {
            y: {
                beginAtZero: true,
                max: 100
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
        subtitleElem.innerHTML += `<br><span style='color:red;>Connected client ${mobileOS} detected (mobile)</span>`;
    }else{
        if(os === 'Windows'){
            subtitleElem.innerHTML += `<br><span style='color:red;'>Connected client ${os} detected</span>`;
            document.getElementById('additional_stats').textContent = 'avg CPU usage';
            document.getElementById('avg1').textContent ='1-min avg CPU usage';
            document.getElementById('avg5').textContent ='5-min avg CPU usage';
            document.getElementById('avg15').textContent ='15-min avg CPU usage';
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
    webSocket = new WebSocket('ws://localhost:8000/iostat');

    webSocket.onopen = function() {
        console.log('Connection opened.');
    };

    webSocket.onmessage = function(event) {
        dataCounter++;
        // Only process every 2nd data point (adjust as needed)
        if (dataCounter % 2 !== 0) {
            return;
        }

        const data = JSON.parse(event.data);

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
    };
}

function closeWebSocket() {
    if (webSocket) {
        webSocket.close();
    }
}

function updateTable() {
    const tableBody = document.getElementById('statsTableBody'); // <-- Fix the ID here
    tableBody.innerHTML = '';

    statsArray.forEach((stat, index) => {
        const row = document.createElement('tr');
        console.log(stat);
        row.innerHTML = `
            <td>${stat.date}</td>
            <td>${stat.disk.kbt}</td>
            <td>${stat.disk.tps}</td>
            <td>${stat.disk.mbs}</td>
            <td>${stat.cpu.us.toFixed(3)}</td>
            <td>${stat.cpu.sy.toFixed(3)}</td>
            <td>${(stat.cpu.us + stat.cpu.sy).toFixed(3)}</td>
            <td>${stat.cpu.id.toFixed(3)}</td>
            <td>${stat.load_average.m1.toFixed(3)}</td>
            <td>${stat.load_average.m5.toFixed(3)}</td>
            <td>${stat.load_average.m15.toFixed(3)}</td>
        `;
        tableBody.appendChild(row);
    });
}

function updateChart() {
    const labels = statsArray.map(stat => stat.date);
    const userData = statsArray.map(stat => stat.cpu.us);
    const sysData = statsArray.map(stat => stat.cpu.sy);

    lineChart.data.labels = labels;
    lineChart.data.datasets[0].data = userData;
    lineChart.data.datasets[1].data = sysData;
    lineChart.update();
}