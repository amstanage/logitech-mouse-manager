/**
 * Logitech HID++ Protocol Implementation
 * Supports HID++ 2.0 for mouse configuration via WebHID.
 */

const LOGITECH_VENDOR_ID = 0x046d;

const HIDPP_SHORT = 0x10;
const HIDPP_LONG  = 0x11;
const REPORT_ID   = HIDPP_LONG;
const REPORT_DATA_LEN = 19;

const FEATURES = {
  ROOT:                 0x0000,
  FEATURE_SET:          0x0001,
  DEVICE_NAME:          0x0005,
  BATTERY_UNIFIED:      0x1000,
  BATTERY_VOLTAGE:      0x1001,
  UNIFIED_BATTERY:      0x1004,
  ADJUSTABLE_DPI:       0x2201,
  REPORT_RATE:          0x8060,
  EXTENDED_REPORT_RATE: 0x8061,
};

class HidPPDevice {
  constructor() {
    this.device = null;
    this.deviceIndex = 0x01;
    this.featureIndex = {};
    this.protocolVersion = null;
    this._pendingRequests = new Map();
    this._requestId = 0;
    this._onLog = null;
  }

  set onLog(fn) { this._onLog = fn; }

  _log(type, msg) {
    if (this._onLog) this._onLog(type, msg);
  }

  _hex(arr) {
    return arr.map(b => b.toString(16).padStart(2, '0')).join(' ');
  }

  async connect() {
    if (!navigator.hid) throw new Error('WebHID API not available');

    const selected = await navigator.hid.requestDevice({
      filters: [{ vendorId: LOGITECH_VENDOR_ID }],
    });
    if (selected.length === 0) throw new Error('No device selected');

    // Find the HID++ interface among all granted devices
    const allDevices = await navigator.hid.getDevices();
    const logitechDevices = allDevices.filter(d => d.vendorId === LOGITECH_VENDOR_ID);
    this._log('info', `Found ${logitechDevices.length} Logitech HID interface(s)`);

    let hidppDevice = null;
    for (const dev of logitechDevices) {
      const hasLong = dev.collections?.some(c =>
        c.outputReports?.some(r => r.reportId === HIDPP_LONG)
      );
      if (hasLong) { hidppDevice = dev; break; }
    }
    if (!hidppDevice) {
      for (const dev of logitechDevices) {
        const hasShort = dev.collections?.some(c =>
          c.outputReports?.some(r => r.reportId === HIDPP_SHORT)
        );
        if (hasShort) { hidppDevice = dev; break; }
      }
    }

    this.device = hidppDevice || selected[0];
    if (!this.device.opened) await this.device.open();

    for (const col of this.device.collections || []) {
      const inIds = col.inputReports?.map(r => '0x' + r.reportId.toString(16)) || [];
      const outIds = col.outputReports?.map(r => '0x' + r.reportId.toString(16)) || [];
      this._log('info', `Collection in=[${inIds}] out=[${outIds}]`);
    }

    this.device.addEventListener('inputreport', (e) => this._onInputReport(e));
    this._log('info', `Opened: ${this.device.productName}`);

    await this._detectDeviceIndex();
    await this._detectProtocol();
    await this._discoverFeatures();
    return true;
  }

  async _detectDeviceIndex() {
    for (const idx of [0x01, 0x02, 0x03, 0xff]) {
      try {
        this.deviceIndex = idx;
        const resp = await this._sendCommand(idx, 0x00, 0x01, [], 2000);
        if (resp && resp[0] > 0) {
          this._log('info', `Device at index 0x${idx.toString(16)} (v${resp[0]}.${resp[1]})`);
          return;
        }
      } catch {
        // try next
      }
    }
    this.deviceIndex = 0x01;
    this._log('info', 'Defaulting to index 0x01');
  }

  async disconnect() {
    if (this.device?.opened) {
      await this.device.close();
      this._log('info', 'Disconnected');
    }
    this.device = null;
    this.featureIndex = {};
    this.protocolVersion = null;
  }

  get productName() { return this.device?.productName || 'Unknown Device'; }
  get isConnected() { return this.device?.opened === true; }

  async _detectProtocol() {
    try {
      const resp = await this._request(0x00, 0x01, []);
      this.protocolVersion = `${resp[0]}.${resp[1]}`;
      this._log('info', `HID++ v${this.protocolVersion}`);
    } catch {
      this.protocolVersion = '1.0';
      this._log('info', 'Assuming HID++ 1.0');
    }
  }

  async _discoverFeatures() {
    if (this.protocolVersion?.startsWith('1.')) return;

    const features = [
      [FEATURES.DEVICE_NAME,          'DeviceName'],
      [FEATURES.BATTERY_UNIFIED,      'BatteryUnified'],
      [FEATURES.BATTERY_VOLTAGE,      'BatteryVoltage'],
      [FEATURES.UNIFIED_BATTERY,      'UnifiedBattery'],
      [FEATURES.ADJUSTABLE_DPI,       'AdjustableDPI'],
      [FEATURES.REPORT_RATE,          'ReportRate'],
      [FEATURES.EXTENDED_REPORT_RATE, 'ExtReportRate'],
    ];

    for (const [id, name] of features) {
      try {
        const resp = await this._request(0x00, 0x00, [(id >> 8) & 0xff, id & 0xff]);
        const idx = resp[0];
        if (idx > 0) {
          this.featureIndex[id] = idx;
          this._log('info', `  ${name} -> idx ${idx}`);
        }
      } catch {}
    }
    this._log('info', `Discovery: ${Object.keys(this.featureIndex).length} features`);
  }

  // ===== Battery =====

  async getBattery() {
    if (this.featureIndex[FEATURES.UNIFIED_BATTERY]) {
      // funcId 0x01 = get_status (0x00 is get_capabilities, not battery level)
      const resp = await this._request(this.featureIndex[FEATURES.UNIFIED_BATTERY], 0x01, []);
      const statusNames = ['Discharging', 'Charging', 'Wireless Charging', 'Fully Charged'];
      return { percent: resp[0], status: statusNames[resp[2]] || 'Unknown' };
    }
    if (this.featureIndex[FEATURES.BATTERY_UNIFIED]) {
      const resp = await this._request(this.featureIndex[FEATURES.BATTERY_UNIFIED], 0x00, []);
      const statusNames = { 0: 'Discharging', 1: 'Recharging', 3: 'Charge Complete' };
      return { percent: resp[0], status: statusNames[resp[2]] || 'Unknown' };
    }
    if (this.featureIndex[FEATURES.BATTERY_VOLTAGE]) {
      const resp = await this._request(this.featureIndex[FEATURES.BATTERY_VOLTAGE], 0x00, []);
      const mv = (resp[0] << 8) | resp[1];
      const pct = mv >= 4100 ? 100 : mv >= 3900 ? 75 : mv >= 3700 ? 50 : mv >= 3500 ? 25 : mv >= 3300 ? 10 : 5;
      return { percent: pct, status: `${mv}mV` };
    }
    throw new Error('No battery feature');
  }

  // ===== DPI =====

  async getDPI() {
    const feat = this.featureIndex[FEATURES.ADJUSTABLE_DPI];
    if (!feat) throw new Error('DPI not supported');

    // getSensorDPI: funcId=1, param=sensorIdx
    const resp = await this._request(feat, 0x01, [0x00]);
    this._log('info', `DPI READ raw: [${this._hex(resp)}]`);

    // Try all possible parse offsets to find valid DPI
    const candidates = [];
    for (let i = 0; i + 1 < resp.length; i++) {
      const val = (resp[i] << 8) | resp[i + 1];
      if (val >= 100 && val <= 32000) {
        candidates.push({ offset: i, dpi: val });
      }
    }
    this._log('info', `DPI candidates: ${candidates.map(c => `[${c.offset}]=${c.dpi}`).join(', ')}`);

    // Standard parse: sensorIdx at [0], DPI at [1..2]
    const standardDpi = (resp[1] << 8) | resp[2];
    // Alt parse: DPI at [0..1] (no sensorIdx echo)
    const altDpi = (resp[0] << 8) | resp[1];

    // Pick whichever gives a reasonable gaming DPI (prefer standard)
    let currentDpi = standardDpi;
    if (standardDpi < 100 || standardDpi > 32000) {
      currentDpi = altDpi;
    }

    this._log('info', `DPI parsed: standard=${standardDpi}, alt=${altDpi}, using=${currentDpi}`);

    // getDPIList: funcId=2
    let dpiMin = 100, dpiMax = 32000, dpiStep = 50;
    try {
      const listResp = await this._request(feat, 0x02, [0x00]);
      this._log('info', `DPI LIST raw: [${this._hex(listResp)}]`);

      let dpiValues = [];
      for (let i = 0; i + 1 < listResp.length; i += 2) {
        const val = (listResp[i] << 8) | listResp[i + 1];
        if (val === 0) break;
        if (val >= 0xe000) {
          dpiStep = val & 0x1fff;
          this._log('info', `  step marker: 0x${val.toString(16)} -> step=${dpiStep}`);
        } else {
          dpiValues.push(val);
          this._log('info', `  dpi entry: ${val}`);
        }
      }
      if (dpiValues.length >= 2) {
        dpiMin = dpiValues[0];
        dpiMax = dpiValues[dpiValues.length - 1];
      }
    } catch (err) {
      this._log('info', `DPI list failed: ${err.message}, using defaults`);
    }

    this._log('info', `DPI result: current=${currentDpi}, min=${dpiMin}, max=${dpiMax}, step=${dpiStep}`);
    return { current: currentDpi, min: dpiMin, max: dpiMax, step: dpiStep };
  }

  async setDPI(dpi) {
    const feat = this.featureIndex[FEATURES.ADJUSTABLE_DPI];
    if (!feat) throw new Error('DPI not supported');

    this._log('info', `DPI SET: sending ${dpi} (0x${dpi.toString(16)})`);
    const msb = (dpi >> 8) & 0xff;
    const lsb = dpi & 0xff;

    // setSensorDPI: funcId=3
    const setResp = await this._request(feat, 0x03, [0x00, msb, lsb]);
    this._log('info', `DPI SET response raw: [${this._hex(setResp)}]`);

    return dpi;
  }

  // ===== Polling Rate =====
  //
  // Instead of guessing function IDs, we auto-probe at connect time.
  // We try calling each funcId 0-3 and check which one returns a valid
  // rate code (1-7) in resp[0]. That's the getRate function.
  // The rate list function is getRate+1, and set is getRate+2.

  _rateFuncs = null; // { featIdx, funcGet, funcList, funcSet }

  _rateCodeToHz(code) {
    // Rate codes are the polling interval in ms (powers of 2)
    return { 1: 1000, 2: 500, 4: 250, 8: 125 }[code] || 0;
  }

  _hzToRateCode(hz) {
    return { 1000: 1, 500: 2, 250: 4, 125: 8 }[hz] || 0;
  }

  _parseRateFlags(flags) {
    // Flag bits use ascending Hz order (different from rate codes)
    const rates = [];
    if (flags & 0x01) rates.push(125);
    if (flags & 0x02) rates.push(250);
    if (flags & 0x04) rates.push(500);
    if (flags & 0x08) rates.push(1000);
    if (flags & 0x10) rates.push(2000);
    if (flags & 0x20) rates.push(4000);
    if (flags & 0x40) rates.push(8000);
    return rates;
  }

  async _probeRateFunctions() {
    // 0x8061 (Extended Report Rate) has an extra getDeviceCapabilities at func 0:
    //   func 0 = getDeviceCapabilities
    //   func 1 = getReportRateList
    //   func 2 = getReportRate
    //   func 3 = setReportRate
    //
    // 0x8060 (Report Rate) layout:
    //   func 0 = getReportRateList
    //   func 1 = getReportRate
    //   func 2 = setReportRate
    if (this.featureIndex[FEATURES.EXTENDED_REPORT_RATE]) {
      const featIdx = this.featureIndex[FEATURES.EXTENDED_REPORT_RATE];
      this._log('info', `RATE: using ExtReportRate idx ${featIdx} (list=func1, get=func2, set=func3)`);
      return { featIdx, funcList: 1, funcGet: 2, funcSet: 3 };
    }
    if (this.featureIndex[FEATURES.REPORT_RATE]) {
      const featIdx = this.featureIndex[FEATURES.REPORT_RATE];
      this._log('info', `RATE: using ReportRate idx ${featIdx} (list=func0, get=func1, set=func2)`);
      return { featIdx, funcList: 0, funcGet: 1, funcSet: 2 };
    }
    return null;
  }

  async getPollingRate() {
    if (!this._rateFuncs) {
      this._rateFuncs = await this._probeRateFunctions();
    }
    if (!this._rateFuncs) throw new Error('Report rate not supported');

    const { featIdx, funcGet, funcList } = this._rateFuncs;

    // Get current rate
    const resp = await this._request(featIdx, funcGet, []);
    this._log('info', `RATE READ (func=${funcGet}): [${this._hex(resp.slice(0, 4))}]`);
    const currentHz = this._rateCodeToHz(resp[0]);
    this._log('info', `RATE current: code=${resp[0]} -> ${currentHz}Hz`);

    // Get supported rate list
    let supported = [];
    try {
      const listResp = await this._request(featIdx, funcList, []);
      this._log('info', `RATE LIST (func=${funcList}): [${this._hex(listResp.slice(0, 6))}]`);

      // Scan first 4 bytes for the flags byte (most set bits = most rates)
      let bestFlags = 0;
      let bestCount = 0;
      for (let i = 0; i < Math.min(listResp.length, 4); i++) {
        const f = listResp[i];
        const rates = this._parseRateFlags(f);
        this._log('info', `  byte[${i}]=0x${f.toString(16)} (${f.toString(2).padStart(8, '0')}) -> [${rates.join(',')}]`);
        if (rates.length > bestCount) {
          bestFlags = f;
          bestCount = rates.length;
        }
      }
      supported = this._parseRateFlags(bestFlags);
    } catch (err) {
      this._log('info', `RATE list error: ${err.message}`);
    }

    if (supported.length === 0) supported = [125, 250, 500, 1000];

    // Force-enable standard rates that are between reported rates
    // (some devices don't advertise all rates they actually support)
    const stdRates = [125, 250, 500, 1000];
    if (supported.length > 0) {
      const minRate = Math.min(...supported);
      const maxRate = Math.max(...supported);
      for (const r of stdRates) {
        if (r >= minRate && r <= maxRate && !supported.includes(r)) {
          supported.push(r);
        }
      }
    }

    if (currentHz > 0 && !supported.includes(currentHz)) {
      supported.push(currentHz);
    }
    supported.sort((a, b) => a - b);

    this._log('info', `RATE result: ${currentHz}Hz, supported=[${supported.join(', ')}]`);
    return { current: currentHz, supported };
  }

  async setPollingRate(hz) {
    if (!this._rateFuncs) {
      this._rateFuncs = await this._probeRateFunctions();
    }
    if (!this._rateFuncs) throw new Error('Report rate not supported');

    const { featIdx, funcSet, funcGet } = this._rateFuncs;
    const code = this._hzToRateCode(hz);
    if (!code) throw new Error(`Invalid rate: ${hz}`);

    this._log('info', `RATE SET: ${hz}Hz code=${code} func=${funcSet}`);
    const resp = await this._request(featIdx, funcSet, [code]);
    this._log('info', `RATE SET response: [${this._hex(resp.slice(0, 4))}]`);

    // Read back
    const rb = await this._request(featIdx, funcGet, []);
    const actualHz = this._rateCodeToHz(rb[0]);
    this._log('info', `RATE readback: code=${rb[0]} -> ${actualHz}Hz`);
    return actualHz;
  }

  // ===== HID++ Communication =====

  async _request(featureIndex, funcId, params = []) {
    return this._sendCommand(this.deviceIndex, featureIndex, funcId, params, 3000);
  }

  async _sendCommand(deviceIdx, featureIndex, funcId, params = [], timeoutMs = 3000) {
    this._requestId = (this._requestId % 15) + 1;
    const swId = this._requestId;
    const funcSwId = ((funcId & 0x0f) << 4) | (swId & 0x0f);

    const data = new Uint8Array(REPORT_DATA_LEN);
    data[0] = deviceIdx;
    data[1] = featureIndex;
    data[2] = funcSwId;
    for (let i = 0; i < params.length && (3 + i) < REPORT_DATA_LEN; i++) {
      data[3 + i] = params[i];
    }

    this._log('send', `TX 0x${REPORT_ID.toString(16)} [${this._hex(Array.from(data.slice(0, 3 + Math.max(params.length, 1))))}]`);

    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pendingRequests.delete(swId);
        reject(new Error(`Timeout feat=0x${featureIndex.toString(16)} func=${funcId}`));
      }, timeoutMs);

      this._pendingRequests.set(swId, { resolve, reject, timeout, featureIndex, funcId });

      try {
        await this.device.sendReport(REPORT_ID, data);
      } catch (err) {
        clearTimeout(timeout);
        this._pendingRequests.delete(swId);
        reject(new Error(`Send failed: ${err.message}`));
      }
    });
  }

  _onInputReport(event) {
    const { reportId, data } = event;

    // Read bytes from DataView using getUint8 - guaranteed correct regardless
    // of underlying ArrayBuffer offset. No Uint8Array buffer tricks.
    const len = data.byteLength;
    const bytes = [];
    for (let i = 0; i < len; i++) {
      bytes.push(data.getUint8(i));
    }

    this._log('receive', `RX 0x${reportId.toString(16)} [${this._hex(bytes.slice(0, Math.min(len, 12)))}${len > 12 ? '...' : ''}] (${len}b)`);

    if (reportId !== HIDPP_SHORT && reportId !== HIDPP_LONG) return;
    if (len < 4) return;

    const subId = bytes[1];

    // HID++ 2.0 error
    if (subId === 0xff && len >= 5) {
      const errSwId = bytes[3] & 0x0f;
      const errCode = bytes[4];
      const errNames = {
        0: 'NoError', 1: 'Unknown', 2: 'InvalidArgument', 3: 'OutOfRange',
        4: 'HWError', 5: 'LogitechInternal', 6: 'InvalidFeatureIndex',
        7: 'InvalidFunctionId', 8: 'Busy', 9: 'Unsupported',
      };
      this._log('error', `ERR feat=0x${bytes[2].toString(16)} ${errNames[errCode] || errCode}`);
      const p = this._pendingRequests.get(errSwId);
      if (p) {
        clearTimeout(p.timeout);
        this._pendingRequests.delete(errSwId);
        p.reject(new Error(`HID++ error: ${errNames[errCode] || errCode}`));
      }
      return;
    }

    // HID++ 1.0 error
    if (subId === 0x8f && len >= 5) {
      this._log('error', `HID++ 1.0 error: ${bytes[4]}`);
      for (const [swId, p] of this._pendingRequests) {
        clearTimeout(p.timeout);
        this._pendingRequests.delete(swId);
        p.reject(new Error(`HID++ 1.0 error: ${bytes[4]}`));
        break;
      }
      return;
    }

    // Normal response
    const swId = bytes[2] & 0x0f;
    const payload = bytes.slice(3);

    const p = this._pendingRequests.get(swId);
    if (p) {
      clearTimeout(p.timeout);
      this._pendingRequests.delete(swId);
      p.resolve(payload);
    }
  }
}
