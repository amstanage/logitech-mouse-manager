const mouse = new HidPPDevice();
let batteryInterval = null;

// DOM
const connectSection = document.getElementById('connect-section');
const dashboard = document.getElementById('dashboard');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const browserWarning = document.getElementById('browser-warning');
const deviceNameEl = document.getElementById('device-name');
const batteryFill = document.getElementById('battery-fill');
const batteryPercent = document.getElementById('battery-percent');
const batteryStatus = document.getElementById('battery-status');
const refreshBatteryBtn = document.getElementById('refresh-battery-btn');
const dpiValue = document.getElementById('dpi-value');
const dpiInput = document.getElementById('dpi-input');
const applyDpiBtn = document.getElementById('apply-dpi-btn');
const pollingValue = document.getElementById('polling-value');
const applyPollingBtn = document.getElementById('apply-polling-btn');
const logEl = document.getElementById('log');
const clearLogBtn = document.getElementById('clear-log-btn');

if (!navigator.hid) {
  connectBtn.disabled = true;
  browserWarning.style.display = 'block';
}

// Logging
mouse.onLog = (type, msg) => {
  if (type === 'send' || type === 'receive') return;
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  entry.innerHTML = `<span class="time">[${time}]</span> ${escapeHtml(msg)}`;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function log(type, msg) {
  if (mouse._onLog) mouse._onLog(type, msg);
}

// Connect
connectBtn.addEventListener('click', async () => {
  try {
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting...';
    await mouse.connect();

    deviceNameEl.textContent = mouse.productName;
    connectSection.style.display = 'none';
    dashboard.style.display = 'block';
    enableControls(true);

    // Load sequentially - HID++ is single-channel
    await loadBattery();
    await loadDPI();
    await loadPollingRate();
    startBatteryAutoRefresh();
  } catch (err) {
    log('error', `Connection failed: ${err.message}`);
    alert(`Failed to connect: ${err.message}`);
  } finally {
    connectBtn.disabled = false;
    connectBtn.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2a8 8 0 0 0-8 8v4a8 8 0 0 0 16 0v-4a8 8 0 0 0-8-8z"/>
        <line x1="12" y1="2" x2="12" y2="10"/>
      </svg>
      Connect Mouse`;
  }
});

disconnectBtn.addEventListener('click', async () => {
  stopBatteryAutoRefresh();
  await mouse.disconnect();
  dashboard.style.display = 'none';
  connectSection.style.display = 'flex';
  enableControls(false);
});

function enableControls(enabled) {
  dpiInput.disabled = !enabled;
  applyDpiBtn.disabled = !enabled;
  applyPollingBtn.disabled = !enabled;
  document.querySelectorAll('.btn-preset').forEach(b => b.disabled = !enabled);
  document.querySelectorAll('input[name="polling"]').forEach(r => r.disabled = !enabled);
}

// ===== Battery =====

function startBatteryAutoRefresh() {
  stopBatteryAutoRefresh();
  batteryInterval = setInterval(loadBattery, 10000);
}

function stopBatteryAutoRefresh() {
  if (batteryInterval) {
    clearInterval(batteryInterval);
    batteryInterval = null;
  }
}

async function loadBattery() {
  try {
    const battery = await mouse.getBattery();
    batteryPercent.textContent = `${battery.percent}%`;
    batteryStatus.textContent = battery.status;
    batteryFill.style.width = `${battery.percent}%`;
    batteryFill.classList.remove('low', 'medium');
    if (battery.percent <= 15) batteryFill.classList.add('low');
    else if (battery.percent <= 40) batteryFill.classList.add('medium');
  } catch (err) {
    batteryPercent.textContent = 'N/A';
    batteryStatus.textContent = 'Not supported';
  }
}

refreshBatteryBtn.addEventListener('click', loadBattery);

// ===== DPI =====

function showWIP(card) {
  const content = card.querySelector('.card-content');
  if (content) content.style.display = 'none';
  const existing = card.querySelector('.wip-overlay');
  if (existing) return;
  const wip = document.createElement('div');
  wip.className = 'wip-overlay';
  wip.innerHTML = `
    <span class="wip-label">Work in Progress</span>
    <div class="wip-bar"><div class="wip-bar-fill"></div></div>
  `;
  card.appendChild(wip);
}

async function loadDPI() {
  try {
    const dpi = await mouse.getDPI();
    dpiValue.textContent = dpi.current;
    dpiInput.value = dpi.current;
    dpiInput.min = dpi.min;
    dpiInput.max = dpi.max;
    dpiInput.step = dpi.step;
  } catch (err) {
    log('error', `DPI: ${err.message}`);
    showWIP(dpiValue.closest('.card'));
  }
}

document.querySelectorAll('.btn-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    dpiInput.value = btn.dataset.dpi;
  });
});

applyDpiBtn.addEventListener('click', async () => {
  const targetDpi = parseInt(dpiInput.value);
  if (isNaN(targetDpi) || targetDpi < 100 || targetDpi > 32000) {
    alert('Enter a DPI between 100 and 32000');
    return;
  }

  log('info', `UI: Apply DPI clicked, input value = ${targetDpi}`);

  try {
    applyDpiBtn.disabled = true;
    applyDpiBtn.textContent = 'Applying...';
    const actual = await mouse.setDPI(targetDpi);
    dpiValue.textContent = actual;
    dpiInput.value = actual;
  } catch (err) {
    log('error', `Set DPI: ${err.message}`);
    alert(`Failed to set DPI: ${err.message}`);
  } finally {
    applyDpiBtn.disabled = false;
    applyDpiBtn.textContent = 'Apply DPI';
  }
});

// ===== Polling Rate =====

async function loadPollingRate() {
  try {
    const rate = await mouse.getPollingRate();
    pollingValue.textContent = rate.current;

    document.querySelectorAll('input[name="polling"]').forEach(radio => {
      const val = parseInt(radio.value);
      const isSupported = rate.supported.includes(val);
      radio.disabled = !isSupported;
      radio.closest('.radio-option').style.display = isSupported ? '' : 'none';
      if (val === rate.current) radio.checked = true;
    });
  } catch (err) {
    log('error', `Polling rate: ${err.message}`);
    showWIP(pollingValue.closest('.card'));
  }
}

applyPollingBtn.addEventListener('click', async () => {
  const selected = document.querySelector('input[name="polling"]:checked');
  if (!selected) { alert('Select a polling rate'); return; }

  try {
    applyPollingBtn.disabled = true;
    applyPollingBtn.textContent = 'Applying...';
    const actualHz = await mouse.setPollingRate(parseInt(selected.value));
    pollingValue.textContent = actualHz || selected.value;
  } catch (err) {
    log('error', `Set polling: ${err.message}`);
    alert(`Failed: ${err.message}`);
  } finally {
    applyPollingBtn.disabled = false;
    applyPollingBtn.textContent = 'Apply Polling Rate';
  }
});

clearLogBtn.addEventListener('click', () => { logEl.innerHTML = ''; });

document.addEventListener('keydown', (e) => {
  if (e.key === '~' || e.key === '`') {
    const logCard = document.getElementById('log-card');
    logCard.style.display = logCard.style.display === 'none' ? '' : 'none';
  }
});

navigator.hid?.addEventListener('disconnect', (event) => {
  if (mouse.device && event.device === mouse.device) {
    log('error', 'Device disconnected');
    stopBatteryAutoRefresh();
    mouse.device = null;
    dashboard.style.display = 'none';
    connectSection.style.display = 'flex';
    enableControls(false);
  }
});
