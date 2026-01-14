const { sequelize } = require('../config/database');

/**
 * Generate a unique ID that doesn't exist in either bloc or ouvrage tables
 * @param {Object} transaction - Sequelize transaction object
 * @returns {Promise<number>} The next unique ID
 */
async function generateUniqueId(transaction) {
    try {
        // Get the maximum ID from both tables
        const [blocMaxResult] = await sequelize.query(
            'SELECT COALESCE(MAX(id), 0) as max_id FROM bloc',
            { transaction }
        );
        
        const [ouvrageMaxResult] = await sequelize.query(
            'SELECT COALESCE(MAX(id), 0) as max_id FROM ouvrage',
            { transaction }
        );
        
        const blocMaxId = blocMaxResult[0].max_id;
        const ouvrageMaxId = ouvrageMaxResult[0].max_id;
        
        // Return the maximum of both + 1 to ensure uniqueness across both tables
        const nextId = Math.max(blocMaxId, ouvrageMaxId) + 1;
        
        return nextId;
    } catch (error) {
        console.error('Error generating unique ID:', error);
        throw error;
    }
}

module.exports = { generateUniqueId };