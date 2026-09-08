const { VariantStorage } = require("./storage");

const API_BASE = "https://www.ariston-net.remotethermo.com/api/v2/";
const DEFAULT_TIMEOUT_MS = 30000;
const VARIANTS = [
  "sePlantData",
  "medPlantData",
  "slpPlantData",
  "onePlantData",
  "evoPlantData",
];

class AristonClient {
  constructor(opts = {}) {
    this.username = opts.username;
    this.password = opts.password;
    this.log = opts.log || { info() {}, warn() {}, error() {}, debug() {} };
    this.debug = !!opts.debug;
    this.token = null;
    this.loginPromise = null;
    this.initPromise = null;
    this.baseURL = opts.baseURL || API_BASE;

    this.storage = new VariantStorage(opts.cacheDir, this.log);
  }

  async init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      await this.storage.init();
    })();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  async _request(method, url, body, isRetry = false) {
    const headers = {
      "User-Agent": "okhttp/4.9.3",
      "Content-Type": "application/json",
    };
    if (this.token) headers["ar.authToken"] = this.token;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    let res;
    try {
      res = await fetch(this.baseURL + url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name === "AbortError") {
        return { status: 0, statusText: "Timeout", data: null };
      }
      throw e;
    }
    clearTimeout(timeoutId);

    if (res.status === 401 && !isRetry && !url.includes("accounts/login")) {
      await this.login();
      return this._request(method, url, body, true);
    }

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      // Response body is not JSON
    }
    return { status: res.status, statusText: res.statusText, data };
  }

  async login() {
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = (async () => {
      const res = await this._request("POST", "accounts/login", {
        usr: this.username,
        pwd: this.password,
        imp: false,
        notTrack: true,
        appInfo: {
          os: 2,
          appVer: "6.0.10.40276",
          appId: "com.remotethermo.aristonnet",
        },
      });
      if (res.status !== 200 || !res.data || !res.data.token) {
        this.token = null;
        this.loginPromise = null;
        const errMsg =
          (res.data && res.data.message) ||
          res.statusText ||
          String(res.status);
        throw new Error("Ariston login failed: " + errMsg);
      }
      this.token = res.data.token;
      if (this.debug) this.log.debug("Ariston login successful");
      this.loginPromise = null;
    })();
    return this.loginPromise;
  }

  async discoverPlantId() {
    await this.login();
    for (const p of ["velis/medPlants", "velis/plants"]) {
      const res = await this._request("GET", p);
      if (
        res.status >= 200 &&
        res.status < 300 &&
        Array.isArray(res.data) &&
        res.data.length > 0
      ) {
        const plant = res.data[0];
        return plant.gw || plant.gateway || plant.id || plant.plantId || null;
      }
    }
    return null;
  }

  async discoverVariant(plantId) {
    const cached = this.storage.getVariant(plantId);
    if (cached) {
      if (this.debug) this.log.debug("Using cached variant:", cached.variant);
      return cached.variant;
    }
    await this.login();
    this.log.info("Discovering variant for", plantId);
    for (const variant of VARIANTS) {
      try {
        const url = "velis/" + variant + "/" + encodeURIComponent(plantId);
        const res = await this._request("GET", url);
        if (
          res.status >= 200 &&
          res.status < 300 &&
          res.data &&
          typeof res.data === "object"
        ) {
          if (
            res.data.temp !== undefined ||
            res.data.reqTemp !== undefined ||
            res.data.on !== undefined
          ) {
            this.log.info("Found working variant:", variant);
            await this.storage.setVariant(plantId, variant);
            return variant;
          }
        }
        await this._delay(1000);
      } catch (e) {
        if (this.debug)
          this.log.debug("Variant", variant, "failed:", e.message);
        await this._delay(1000);
      }
    }
    throw new Error("Could not find working variant for this device");
  }

  async getPlantData(plantId, variant) {
    await this.login();
    const url = "velis/" + variant + "/" + encodeURIComponent(plantId);
    const res = await this._request("GET", url);
    if (res.status >= 200 && res.status < 300) {
      if (!res.data || typeof res.data !== "object") return null;
      return this._parsePlantData(res.data, variant);
    }
    if (res.status === 429 || res.status >= 500) {
      this.log.warn("API transient error; returning cached data if available");
      return null;
    }
    return null;
  }

  async setTemperature(plantId, variant, oldTemp, newTemp) {
    await this.login();
    const url =
      "velis/" + variant + "/" + encodeURIComponent(plantId) + "/temperature";
    const res = await this._request("POST", url, {
      eco: false,
      old: oldTemp,
      new: newTemp,
    });
    return res.status >= 200 && res.status < 300;
  }

  async setPower(plantId, variant, on) {
    await this.login();
    const url =
      "velis/" + variant + "/" + encodeURIComponent(plantId) + "/switch";
    const res = await this._request("POST", url, on);
    return res.status >= 200 && res.status < 300;
  }

  async setMode(plantId, variant, mode) {
    await this.login();
    const url =
      "velis/" + variant + "/" + encodeURIComponent(plantId) + "/mode";
    const res = await this._request("POST", url, { new: mode });
    return res.status >= 200 && res.status < 300;
  }

  _parsePlantData(raw, variant) {
    // Normalize power to boolean — the Ariston API may return 1/0 (number),
    // true/false (boolean), or "1"/"0" (string) depending on device variant.
    const rawPower = raw.on ?? raw.power;
    const power =
      rawPower === true ||
      rawPower === 1 ||
      rawPower === "1" ||
      rawPower === "true";

    return {
      currentTemp: raw.temp ?? raw.wtrTemp ?? raw.currentTemp,
      targetTemp: raw.reqTemp ?? raw.procReqTemp ?? raw.targetTemp,
      power,
      antiLeg: raw.antiLeg ?? raw.antiLegionella,
      heatReq: raw.heatReq ?? raw.heatingReq,
      avShw: raw.avShw ?? raw.availableShowers,
      maxAvShw: raw.maxAvShw ?? raw.maxShw ?? raw.maxAvailableShowers,
      mode: raw.mode,
      boost: raw.boost ?? raw.boostOn,
    };
  }

  _delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

module.exports = { AristonClient };
