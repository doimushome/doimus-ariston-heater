const fs = require("fs");
const path = require("path");
const fsp = fs.promises;

class VariantStorage {
  constructor(baseDir, log) {
    this.file = path.join(baseDir || process.cwd(), "data", "persist", "ariston-heater-cache.json");
    this.cache = { variants: {} };
    this.log = log || { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  }

  async init() {
    const dir = path.dirname(this.file);
    try { await fsp.mkdir(dir, { recursive: true }); } catch (e) { this.log.warn("Failed to ensure cache directory:", e.message); }
    this.cache = await this._load();
  }

  async _load() {
    try {
      await fsp.access(this.file);
      const txt = await fsp.readFile(this.file, "utf8");
      const parsed = JSON.parse(txt);
      if (parsed && typeof parsed === "object" && parsed.variants && typeof parsed.variants === "object") {
        return parsed;
      }
    } catch (e) { this.log.warn("Failed to load cache:", e.message); }
    return { variants: {} };
  }

  async _save() {
    try {
      const tmp = this.file + ".tmp";
      await fsp.writeFile(tmp, JSON.stringify(this.cache), "utf8");
      try { await fsp.rename(tmp, this.file); } catch { await fsp.writeFile(this.file, JSON.stringify(this.cache), "utf8"); }
    } catch (e) { this.log.warn("Failed to save cache:", e.message); }
  }

  getVariant(plantId) {
    return (this.cache.variants && this.cache.variants[plantId]) || null;
  }

  async setVariant(plantId, variant) {
    if (!this.cache.variants) this.cache.variants = {};
    this.cache.variants[plantId] = { variant, updatedAt: new Date().toISOString() };
    await this._save();
  }
}

module.exports = { VariantStorage };
