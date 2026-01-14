const http = require('http')

function req(path) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const req = http.request({ host: 'localhost', port: 3001, path, method: 'GET' }, res => {
      res.on('data', () => {})
      res.on('end', () => resolve(Date.now() - start))
    })
    req.on('error', reject)
    req.end()
  })
}

async function run() {
  const paths = ['/api/projects?page=1&limit=10', '/api/projects/1']
  const results = []
  for (let i = 0; i < 10; i += 1) {
    for (const p of paths) {
      try { results.push({ path: p, ms: await req(p) }) } catch {}
    }
  }
  const byPath = results.reduce((m, r) => { (m[r.path] ||= []).push(r.ms); return m }, {})
  Object.entries(byPath).forEach(([p, arr]) => {
    arr.sort((a, b) => a - b)
    const avg = arr.reduce((s, v) => s + v, 0) / arr.length
    const p95 = arr[Math.floor(arr.length * 0.95) - 1] || null
    console.log(p, { avg: Math.round(avg), p95 })
  })
}

run().catch(err => { console.error(err.message) })