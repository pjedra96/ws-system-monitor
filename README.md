# WebSocket Live System Monitor

This is a Node.js-based application that provides **live system usage statistics** (CPU, disk, load average) through a modern web interface. The server collects real-time system data and streams it to connected clients using WebSockets. The frontend displays the data in a responsive table and a live-updating line chart.

---

## Features

- **Live system statistics:** CPU usage, disk activity, and load averages.
- **WebSocket-powered:** Real-time updates without page reloads.
- **Responsive UI:** Table and chart visualization using Chart.js.
- **Cross-platform:** Works on Windows, Linux, and macOS (with platform-specific disk stats).

---

## Project Structure

```
.
├── LICENSE
├── package.json
├── README.md
├── server.js              # Node.js server (main backend logic)
└── public/
    ├── index.html         # Main web page (edit layout/structure here)
    ├── script.js          # Frontend JS (WebSocket, table, chart logic)
    └── style.css          # CSS styles for the web UI
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v20 or newer recommended)
- npm (comes with Node.js)

### Installation

1. **Clone or download** this repository.
2. Open a terminal in the project directory.
3. Install dependencies:
   ```sh
   npm install
   ```

### Running the Application

1. Start the server:
   ```sh
   npm start
   ```
   or
   ```sh
   node server.js
   ```

2. Open your browser and go to:  
   [http://localhost:8000](http://localhost:8000)

   > **Note:** The server listens on port `8000` by default.  
   > If you want to use a different port, set the `PORT` environment variable before starting:
   > ```sh
   > PORT=3000 node server.js
   > ```

---

## Usage

- Click **Start** to begin receiving live system stats.
- Click **Close connection** to stop updates.
- The table and chart will update in real time.

---

## Customization & Key Files

- **Backend logic:**  
  Edit [`server.js`](server.js) to change how system stats are collected or to add new endpoints.

- **Frontend UI:**  
  - **HTML:** [`public/index.html`](public/index.html) (edit layout, add/remove table columns, etc.)
  - **JavaScript:** [`public/script.js`](public/script.js) (WebSocket handling, table/chart updates)
  - **Styles:** [`public/style.css`](public/style.css) (customize look and feel)

- **Dependencies:**  
  See [`package.json`](package.json) for npm packages used.

---

## Notes

- Disk statistics come from `systeminformation` on Linux/macOS (reads `/proc` and `lsblk`, no `iostat` needed) and from Windows performance counters via one background PowerShell process (no `wmic` needed).
- On Linux/macOS the last three columns show the real load average, coloured against the number of CPU cores. Windows has no load average, so they show the average CPU % over 1, 5 and 15 minutes instead.
- The application is for local or LAN use; for public deployment, consider security and firewall settings.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
