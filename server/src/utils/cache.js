const crypto = require('crypto')

class LRUCache {
  constructor(maxEntries = 500, ttlMs = 30000) {
    this.max = maxEntries
    this.ttl = ttlMs
    this.map = new Map()
  }
  _now() { return Date.now() }
  _key(parts) { return crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex') }
  set(parts, value) {
    const key = Array.isArray(parts) ? this._key(parts) : String(parts)
    const entry = { value, expires: this._now() + this.ttl }
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, entry)
    if (this.map.size > this.max) {
      const firstKey = this.map.keys().next().value
      this.map.delete(firstKey)
    }
    return key
  }
  get(parts) {
    const key = Array.isArray(parts) ? this._key(parts) : String(parts)
    const entry = this.map.get(key)
    if (!entry) return null
    if (entry.expires < this._now()) { this.map.delete(key); return null }
    this.map.delete(key)
    this.map.set(key, entry)
    return entry.value
  }
  del(parts) {
    const key = Array.isArray(parts) ? this._key(parts) : String(parts)
    this.map.delete(key)
  }
  clear() { this.map.clear() }
}

const cache = new LRUCache()

module.exports = { LRUCache, cache }