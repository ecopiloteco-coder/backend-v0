const pool = require('../../config/db');
const bcrypt = require('bcryptjs');

class User {
  constructor(data) {
    this.id = data.id;
    this.nom_utilisateur = data.nom_utilisateur;
    this.email = data.email;
    this.titre_poste = data.titre_poste;
    this.mot_de_passe = data.mot_de_passe;
    this.date_creation_compte = data.date_creation_compte;
    this.is_admin = data.is_admin || false;
  }

  // Create a new user
  static async create(userData) {
    try {
      const { nom_utilisateur, email, titre_poste, mot_de_passe, is_admin } = userData;
      const hashedPassword = await bcrypt.hash(mot_de_passe, 12);

      const query = `
        INSERT INTO users (nom_utilisateur, email, titre_poste, mot_de_passe, is_admin)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, nom_utilisateur, email, titre_poste, date_creation_compte, is_admin
      `;

      const values = [nom_utilisateur, email, titre_poste, hashedPassword, is_admin];
      const result = await pool.query(query, values);

      return new User(result.rows[0]);
    } catch (error) {
      throw error;
    }
  }

  // Get all users
  static async findAll(limit = 10, offset = 0) {
    const query = `
      SELECT id, nom_utilisateur, email, titre_poste, date_creation_compte, is_admin
      FROM users
      ORDER BY date_creation_compte DESC
      LIMIT $1 OFFSET $2
    `;
    const result = await pool.query(query, [limit, offset]);
    return result.rows.map(row => new User(row));
  }

  // Find user by ID
  static async findById(id) {
    const query = `
      SELECT id, nom_utilisateur, email, titre_poste, date_creation_compte, is_admin
      FROM users
      WHERE id = $1
    `;
    const result = await pool.query(query, [id]);
    return result.rows.length ? new User(result.rows[0]) : null;
  }

  // Find user by email
  static async findByEmail(email) {
    const query = `SELECT * FROM users WHERE email = $1`;
    const result = await pool.query(query, [email]);
    return result.rows.length ? new User(result.rows[0]) : null;
  }
// Add this static method to your User class

static async updateById(id, userData) {
  const { nom_utilisateur, email, titre_poste, is_admin } = userData;
  const query = `
    UPDATE users
    SET nom_utilisateur = $1, email = $2, titre_poste = $3, is_admin = $4
    WHERE id = $5
    RETURNING id, nom_utilisateur, email, titre_poste, date_creation_compte, is_admin
  `;
  const values = [nom_utilisateur, email, titre_poste, is_admin, id];
  const result = await pool.query(query, values);
  return result.rows.length ? new User(result.rows[0]) : null;
}
static async deleteById(id) {
  const query = `DELETE FROM users WHERE id = $1 RETURNING id`;
  const result = await pool.query(query, [id]);
  return result.rows.length > 0;
}
  // Update user
  static async update(id, userData) {
    const { nom_utilisateur, email, titre_poste, is_admin } = userData;
    const query = `
      UPDATE users
      SET nom_utilisateur = $1, email = $2, titre_poste = $3, is_admin = $4
      WHERE id = $5
      RETURNING id, nom_utilisateur, email, titre_poste, date_creation_compte, is_admin
    `;
    const values = [nom_utilisateur, email, titre_poste, is_admin, id];
    const result = await pool.query(query, values);
    return result.rows.length ? new User(result.rows[0]) : null;
  }

  // Update password
  static async updatePassword(id, newPassword) {
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const query = `
      UPDATE users
      SET mot_de_passe = $1
      WHERE id = $2
      RETURNING id
    `;
    const result = await pool.query(query, [hashedPassword, id]);
    return result.rows.length > 0;
  }

  // Delete user
  static async delete(id) {
    const query = `DELETE FROM users WHERE id = $1 RETURNING id`;
    const result = await pool.query(query, [id]);
    return result.rows.length > 0;
  }

  // Search users
  static async search(searchTerm, limit = 10, offset = 0) {
    const query = `
      SELECT id, nom_utilisateur, email, titre_poste, date_creation_compte, is_admin
      FROM users
      WHERE nom_utilisateur ILIKE $1
         OR email ILIKE $1
         OR ID::text ILIKE $1
         OR titre_poste ILIKE $1
      ORDER BY date_creation_compte DESC
      LIMIT $2 OFFSET $3
    `;
    const searchPattern = `%${searchTerm}%`;
    const result = await pool.query(query, [searchPattern, limit, offset]);
    return result.rows.map(row => new User(row));
  }

  // Count users
  static async count() {
    const query = `SELECT COUNT(*) as total FROM users`;
    const result = await pool.query(query);
    return parseInt(result.rows[0].total);
  }

  // Verify password
  async verifyPassword(password) {
    return await bcrypt.compare(password, this.mot_de_passe);
  }

  // JSON without password
  toJSON() {
    const { mot_de_passe, ...userWithoutPassword } = this;
    return userWithoutPassword;
  }
}

module.exports = User;
