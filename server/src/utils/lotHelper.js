const pool = require('../../config/db');

function normalizeLotLabel(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const str = String(value).trim();
    return str === '' ? null : str;
}

async function executeQuery(client, sql, params) {
    if (client && typeof client.query === 'function') {
        return client.query(sql, params);
    }
    return pool.query(sql, params);
}

async function findLotIdByLabel(client, label, options = {}) {
    const normalized = normalizeLotLabel(label);
    if (!normalized) {
        return null;
    }

    const selectSql = `
        SELECT id_niveau_2 
        FROM niveau_2 
        WHERE LOWER(TRIM(niveau_2)) = LOWER(TRIM($1))
        LIMIT 1
    `;
    const selectResult = await executeQuery(client, selectSql, [normalized]);
    if (selectResult.rows.length > 0) {
        return selectResult.rows[0].id_niveau_2;
    }

    if (options.allowInsert === false) {
        return null;
    }

    try {
        // Use SAVEPOINT if we're in a transaction (client provided) to prevent aborting it on error
        if (client) await executeQuery(client, 'SAVEPOINT insert_lot_sp', []);
        
        const insertSql = `
            INSERT INTO niveau_2 (niveau_2)
            VALUES ($1)
            RETURNING id_niveau_2
        `;
        const insertResult = await executeQuery(client, insertSql, [normalized]);
        
        if (client) await executeQuery(client, 'RELEASE SAVEPOINT insert_lot_sp', []);
        
        return insertResult.rows[0]?.id_niveau_2 || null;
    } catch (error) {
        // Rollback to savepoint if we're in a transaction
        if (client) {
            try {
                await executeQuery(client, 'ROLLBACK TO SAVEPOINT insert_lot_sp', []);
            } catch (rollbackError) {
                // Ignore rollback error if transaction is already closed/aborted (unlikely here but safe)
            }
        }
        
        if (error?.code === '23505') {
            const retry = await executeQuery(client, selectSql, [normalized]);
            if (retry.rows.length > 0) {
                return retry.rows[0].id_niveau_2;
            }
        }
        throw error;
    }
}

async function ensureLotId(client, lotValue, options = {}) {
    if (lotValue === null || lotValue === undefined) {
        return null;
    }

    if (typeof lotValue === 'number') {
        if (Number.isInteger(lotValue) && lotValue > 0) {
            return lotValue;
        }
        return null;
    }

    const coercedNumber = Number(lotValue);
    if (!Number.isNaN(coercedNumber) && Number.isInteger(coercedNumber) && coercedNumber > 0) {
        return coercedNumber;
    }

    if (typeof lotValue === 'string') {
        return findLotIdByLabel(client, lotValue, options);
    }

    return null;
}

function buildLotJoinClause({ alias = 'pa', aliasName = 'lot_niv2' } = {}) {
    return `LEFT JOIN niveau_2 ${aliasName} ON ${alias}.lot = ${aliasName}.id_niveau_2`;
}

function buildLotNameSelect(aliasName = 'lot_niv2') {
    return `${aliasName}.niveau_2 AS lot_name`;
}

/**
 * Get the lot designation (e.g., "Lot 1: lot name", "Lot 2: lot name")
 * based on the order in which lots were first created in the project
 * @param {object} client - Database client
 * @param {number} projectId - Project ID
 * @param {number} lotId - Lot ID
 * @returns {Promise<string|null>} Lot designation or null if lot not found
 */
async function getLotDesignation(client, projectId, lotId) {
    if (!lotId || !projectId) {
        return null;
    }

    // First, check if designation_lot already exists for this lot in the project
    const existingDesignationQuery = `
        SELECT pa.designation_lot 
        FROM projet_article pa
        INNER JOIN structure s ON s.id_structure = pa.structure
        INNER JOIN ouvrage o ON o.id = s.ouvrage
        INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
        WHERE pl.id_projet = $1 AND pl.id_lot = $2 AND pa.designation_lot IS NOT NULL 
        LIMIT 1
    `;
    const existingResult = await executeQuery(client, existingDesignationQuery, [projectId, lotId]);
    
    if (existingResult.rows.length > 0 && existingResult.rows[0].designation_lot) {
        return existingResult.rows[0].designation_lot;
    }

    // If not found, calculate it based on finding the maximum existing lot number + 1
    // This prevents duplicates when lots are deleted and new ones are created
    const maxLotNumberQuery = `
        SELECT pa.designation_lot 
        FROM projet_article pa
        INNER JOIN structure s ON s.id_structure = pa.structure
        INNER JOIN ouvrage o ON o.id = s.ouvrage
        INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
        WHERE pl.id_projet = $1 AND pa.designation_lot IS NOT NULL
    `;
    const maxLotNumberResult = await executeQuery(client, maxLotNumberQuery, [projectId]);
    
    // Parse existing lot numbers to find the maximum
    let maxLotNumber = 0;
    for (const row of maxLotNumberResult.rows) {
        const designation = row.designation_lot || '';
        // Parse "Lot X: ..." format to extract X
        const match = designation.match(/^Lot\s+(\d+)/i);
        if (match) {
            const num = parseInt(match[1], 10);
            if (!isNaN(num) && num > maxLotNumber) {
                maxLotNumber = num;
            }
        }
    }
    
    // New lot number is max + 1
    const lotNumber = maxLotNumber + 1;
    
    // Get the lot name
    const lotNameQuery = `SELECT niveau_2 FROM niveau_2 WHERE id_niveau_2 = $1`;
    const lotNameResult = await executeQuery(client, lotNameQuery, [lotId]);
    const lotName = lotNameResult.rows[0]?.niveau_2 || '';
    
    return `Lot ${lotNumber}: ${lotName}`;
}

module.exports = {
    ensureLotId,
    buildLotJoinClause,
    buildLotNameSelect,
    getLotDesignation
};

