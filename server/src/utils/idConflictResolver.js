const pool = require('../../config/db');

/**
 * ID Conflict Resolver Utility
 * 
 * Ensures that bloc IDs and ouvrage IDs never conflict by checking
 * for existing IDs in both tables and incrementing when necessary.
 */

/**
 * Get the next available bloc ID that doesn't conflict with any ouvrage ID
 * Checks both the ouvrage table and structure table for conflicts
 * @param {number} proposedBlocId - The proposed bloc ID (usually auto-increment)
 * @returns {Promise<number>} - The next available bloc ID
 */
async function getNextAvailableBlocId(proposedBlocId) {
    try {
        let candidateId = proposedBlocId;
        let attempts = 0;
        const maxAttempts = 1000; // Safety limit

        while (attempts < maxAttempts) {
            // Check if this ID exists in the ouvrage table
            const ouvrageTableCheck = await pool.query(
                'SELECT id FROM ouvrage WHERE id = $1 LIMIT 1',
                [candidateId]
            );

            // Check if this ID exists as an ouvrage in structure table
            const structureTableCheck = await pool.query(
                'SELECT id_structure FROM structure WHERE ouvrage = $1 AND action = $2 LIMIT 1',
                [candidateId, 'ouvrage']
            );

            // If no conflict found in either table, this ID is available
            if (ouvrageTableCheck.rows.length === 0 && structureTableCheck.rows.length === 0) {
                if (candidateId !== proposedBlocId) {
                    console.log(`[ID Conflict Resolver] Bloc ID ${proposedBlocId} conflicts with ouvrage. Using ${candidateId} instead.`);
                }
                return candidateId;
            }

            // Conflict found, increment and try next ID
            candidateId++;
            attempts++;
        }

        throw new Error(`Could not find available bloc ID after ${maxAttempts} attempts`);
    } catch (error) {
        console.error('[ID Conflict Resolver] Error in getNextAvailableBlocId:', error);
        throw error;
    }
}

/**
 * Get the next available ouvrage ID that doesn't conflict with any bloc ID
 * Checks both the bloc table and structure table for conflicts
 * @param {number} proposedOuvrageId - The proposed ouvrage ID (usually auto-increment)
 * @returns {Promise<number>} - The next available ouvrage ID
 */
async function getNextAvailableOuvrageId(proposedOuvrageId) {
    try {
        let candidateId = proposedOuvrageId;
        let attempts = 0;
        const maxAttempts = 1000; // Safety limit

        while (attempts < maxAttempts) {
            // Check if this ID exists in the bloc table
            const blocTableCheck = await pool.query(
                'SELECT id FROM bloc WHERE id = $1 LIMIT 1',
                [candidateId]
            );

            // Check if this ID exists as a bloc in structure table
            const structureTableCheck = await pool.query(
                'SELECT id_structure FROM structure WHERE bloc = $1 AND action = $2 LIMIT 1',
                [candidateId, 'bloc']
            );

            // If no conflict found in either table, this ID is available
            if (blocTableCheck.rows.length === 0 && structureTableCheck.rows.length === 0) {
                if (candidateId !== proposedOuvrageId) {
                    console.log(`[ID Conflict Resolver] Ouvrage ID ${proposedOuvrageId} conflicts with bloc. Using ${candidateId} instead.`);
                }
                return candidateId;
            }

            // Conflict found, increment and try next ID
            candidateId++;
            attempts++;
        }

        throw new Error(`Could not find available ouvrage ID after ${maxAttempts} attempts`);
    } catch (error) {
        console.error('[ID Conflict Resolver] Error in getNextAvailableOuvrageId:', error);
        throw error;
    }
}

/**
 * Get the next auto-increment value from a table's sequence
 * @param {string} tableName - Name of the table (e.g., 'bloc', 'ouvrage')
 * @returns {Promise<number>} - The next sequence value
 */
async function getNextSequenceValue(tableName) {
    try {
        const seqName = `${tableName}_id_seq`;
        const result = await pool.query(`SELECT nextval('${seqName}') as next_id`);
        return parseInt(result.rows[0].next_id);
    } catch (error) {
        console.error(`[ID Conflict Resolver] Error getting sequence value for ${tableName}:`, error);
        throw error;
    }
}

/**
 * Set a sequence to a specific value
 * @param {string} tableName - Name of the table (e.g., 'bloc', 'ouvrage')
 * @param {number} value - The value to set
 */
async function setSequenceValue(tableName, value) {
    try {
        const seqName = `${tableName}_id_seq`;
        await pool.query(`SELECT setval('${seqName}', $1, false)`, [value]);
        console.log(`[ID Conflict Resolver] Set ${seqName} to ${value}`);
    } catch (error) {
        console.error(`[ID Conflict Resolver] Error setting sequence value for ${tableName}:`, error);
        throw error;
    }
}

module.exports = {
    getNextAvailableBlocId,
    getNextAvailableOuvrageId,
    getNextSequenceValue,
    setSequenceValue
};
