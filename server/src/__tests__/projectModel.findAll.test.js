jest.mock('../../config/db', () => ({ query: jest.fn(async () => ({ rows: [] })) }))
const pool = require('../../config/db')
const Project = require('../models/Project')

describe('Project.findAll', () => {
  test('non-admin adds EXISTS team filter', async () => {
    await Project.findAll({ search: '', page: 1, limit: 10, userId: 5, isAdmin: false })
    const sql = pool.query.mock.calls[0][0]
    expect(sql).toContain('EXISTS (SELECT 1 FROM projet_equipe pe')
    expect(sql).toContain('pe.equipe = $')
  })

  test('admin does not add team filter', async () => {
    pool.query.mockClear()
    await Project.findAll({ search: '', page: 1, limit: 10, userId: 5, isAdmin: true })
    const sql = pool.query.mock.calls[0][0]
    expect(sql).not.toContain('EXISTS (SELECT 1 FROM projet_equipe pe')
  })
})