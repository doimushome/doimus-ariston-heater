const { AristonClient } = require("./client");

let client = null;
let deviceId = null;
let pollTimer = null;
let refreshInFlight = null;
let consecutiveFailures = 0;
let config = {};
let minTemp = 40;
let maxTemp = 65;
let cached = { temperature: null, target_temp: null, heating_state: null };
let apiRef = null;

function generateUUID(seed) {
  const crypto = require("crypto");
  const hash = crypto.createHash("sha256").update(seed).digest("hex");
  return [
    hash.substring(0, 8), hash.substring(8, 12),
    "5" + hash.substring(12, 15),
    ((parseInt(hash.substring(15, 17), 16) & 0x3f) | 0x80).toString(16) + hash.substring(17, 19),
    hash.substring(19, 31),
  ].join("-");
}

module.exports = {
  start(cfg, api) {
    config = cfg;
    apiRef = api;

    minTemp = Math.max(1, Number(config.minTemp ?? 40));
    maxTemp = Math.max(minTemp + 1, Number(config.maxTemp ?? 65));
    const pollInterval = Math.max(300, Number(config.pollInterval) || 1800);
    const debug = !!config.debug;

    const seed = "ariston-heater-" + (config.gateway || config.username);
    deviceId = generateUUID(seed);

    client = new AristonClient({
      username: config.username,
      password: config.password,
      log: { info: (m) => api.log("info", m), warn: (m) => api.log("warn", m), error: (m) => api.log("error", m), debug: (m) => { if (debug) api.log("debug", m); } },
      debug,
      cacheDir: process.cwd(),
    });

    api.registerDevice({
      id: deviceId,
      name: config.name || "Ariston Heater",
      type: "thermostat",
      capabilities: ["temperature", "target_temp", "heating_state", "heating_mode"],
      state: { temperature: 0, target_temp: minTemp, heating_state: 0, heating_mode: 0 },
    });

    api.onCommand((id, key, value) => {
      if (id !== deviceId) return;

      if (key === "target_temp") {
        setTargetTemp(Number(value));
      } else if (key === "heating_mode") {
        const on = value === 1 || value === true;
        setPower(on);
      }
    });

    initialize(pollInterval);
  },

  stop() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    client = null;
  },
};

async function initialize(pollInterval) {
  try {
    apiRef.log("info", "Initializing Ariston connection...");
    await client.init();
    await client.login();
    apiRef.log("info", "Login successful");

    let plantId = config.gateway || null;
    if (!plantId) {
      plantId = await client.discoverPlantId();
      if (!plantId) throw new Error("No Ariston device found");
      apiRef.log("info", "Discovered device: " + plantId);
    }

    const variant = await client.discoverVariant(plantId);
    apiRef.log("info", "Using variant: " + variant);

    await refresh(plantId, variant);
    pollTimer = setInterval(() => refresh(plantId, variant), pollInterval * 1000);
    if (pollTimer.unref) pollTimer.unref();

    apiRef.log("info", "Device ready");
  } catch (e) {
    apiRef.log("error", "Initialization failed: " + e.message);
    setTimeout(() => initialize(pollInterval), 60000);
  }
}

async function refresh(plantId, variant) {
  if (!plantId || !variant) return;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const data = await client.getPlantData(plantId, variant);
      if (data) {
        updateState(data);
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
        apiRef.log("warn", "Failed to get data (attempt " + consecutiveFailures + ")");
      }
    } catch (e) {
      consecutiveFailures++;
      apiRef.log("warn", "Refresh error: " + (e.message || e));
      const backoff = Math.min(300, 30 * consecutiveFailures);
      apiRef.log("info", "Backing off for " + backoff + "s");
      await new Promise((r) => setTimeout(r, backoff * 1000));
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

function updateState(data) {
  const updates = {};

  if (typeof data.currentTemp === "number" && data.currentTemp > 0) {
    cached.temperature = data.currentTemp;
    updates.temperature = data.currentTemp;
  }

  if (typeof data.targetTemp === "number" && data.targetTemp > 0) {
    cached.target_temp = Math.max(minTemp, Math.min(maxTemp, data.targetTemp));
    updates.target_temp = cached.target_temp;
  }

  if (typeof data.power === "boolean") {
    cached.heating_state = data.power ? 1 : 0;
    updates.heating_state = cached.heating_state;
    updates.heating_mode = cached.heating_state;
  }

  if (Object.keys(updates).length > 0) {
    apiRef.updateDeviceState(deviceId, updates);
  }
}

async function setTargetTemp(newTemp) {
  if (!client) return;
  const oldTemp = cached.target_temp || minTemp;
  apiRef.log("info", "Setting temperature: " + oldTemp + "C -> " + newTemp + "C");

  cached.target_temp = newTemp;
  apiRef.updateDeviceState(deviceId, { target_temp: newTemp });

  const plantId = config.gateway || null;
  const variant = null; // will be resolved from cache

  // We need plantId and variant. If not in config, we fetch them again.
  // For simplicity, we use the stored plantId from config or re-discover
  try {
    await client.login();
    let pid = config.gateway || null;
    if (!pid) pid = await client.discoverPlantId();
    if (!pid) throw new Error("Cannot resolve plant ID");

    const cachedVariant = client.storage.getVariant(pid);
    const v = cachedVariant ? cachedVariant.variant : null;
    if (!v) throw new Error("Cannot resolve variant");

    const success = await client.setTemperature(pid, v, oldTemp, newTemp);
    if (success) {
      setTimeout(() => refreshIfReady(pid, v), 5000);
    } else {
      cached.target_temp = oldTemp;
      apiRef.updateDeviceState(deviceId, { target_temp: oldTemp });
      apiRef.log("error", "Failed to set temperature");
    }
  } catch (e) {
    cached.target_temp = oldTemp;
    apiRef.updateDeviceState(deviceId, { target_temp: oldTemp });
    apiRef.log("error", "Set temperature failed: " + e.message);
  }
}

async function setPower(on) {
  if (!client) return;
  apiRef.log("info", "Setting power: " + (on ? "ON" : "OFF"));

  const prev = cached.heating_state;
  cached.heating_state = on ? 1 : 0;
  apiRef.updateDeviceState(deviceId, { heating_state: cached.heating_state, heating_mode: cached.heating_state });

  try {
    await client.login();
    let pid = config.gateway || null;
    if (!pid) pid = await client.discoverPlantId();
    if (!pid) throw new Error("Cannot resolve plant ID");

    const cachedVariant = client.storage.getVariant(pid);
    const v = cachedVariant ? cachedVariant.variant : null;
    if (!v) throw new Error("Cannot resolve variant");

    const success = await client.setPower(pid, v, on);
    if (success) {
      setTimeout(() => refreshIfReady(pid, v), 5000);
    } else {
      cached.heating_state = prev;
      apiRef.updateDeviceState(deviceId, { heating_state: prev, heating_mode: prev });
      apiRef.log("error", "Failed to set power");
    }
  } catch (e) {
    cached.heating_state = prev;
    apiRef.updateDeviceState(deviceId, { heating_state: prev, heating_mode: prev });
    apiRef.log("error", "Set power failed: " + e.message);
  }
}

async function refreshIfReady(plantId, variant) {
  if (plantId && variant) await refresh(plantId, variant);
}
