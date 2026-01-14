const { LRUCache } = require('../utils/cache')

describe('LRUCache', () => {
  test('set/get works', () => {
    const c = new LRUCache(2, 1000)
    c.set(['k', 1], { a: 1 })
    expect(c.get(['k', 1])).toEqual({ a: 1 })
  })

  test('evicts oldest', () => {
    const c = new LRUCache(2, 1000)
    c.set('a', 1)
    c.set('b', 2)
    c.set('c', 3)
    expect(c.get('a')).toBeNull()
    expect(c.get('b')).toEqual(2)
    expect(c.get('c')).toEqual(3)
  })

  test('ttl expires', () => {
    const c = new LRUCache(2, 1)
    c.set('x', 1)
    return new Promise(resolve => setTimeout(resolve, 5)).then(() => {
      expect(c.get('x')).toBeNull()
    })
  })
})