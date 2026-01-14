const DesignationHelper = require('./designationHelper');

/**
 * DESIGNATION ENFORCEMENT SYSTEM
 * 
 * This system ensures that designations are ALWAYS recalculated correctly
 * after any operation that modifies the project hierarchy.
 * 
 * RULES:
 * 1. ALL hierarchy mutations MUST go through this enforcer
 * 2. Recalculation happens AFTER the mutation completes successfully
 * 3. Recalculation uses the appropriate lotId context when available
 * 4. Transactions are managed automatically
 */

class DesignationEnforcer {
    /**
     * Wrap a hierarchy mutation operation and ensure designations are recalculated
     * 
     * @param {object} options
     * @param {number} options.projectId - Project ID
     * @param {Function} options.operation - Async function that performs the mutation
     * @param {object} options.context - Context for recalculation
     * @param {number|null} options.context.lotId - Lot ID for lot-specific recalculation
     * @param {number|null} options.context.targetOuvrageId - Specific ouvrage to recalculate (if known)
     * @param {string|null} options.context.startingDesignation - Starting designation for recalculation
     * @param {boolean} options.context.skipRecalculation - Skip recalculation (use with caution)
     * @param {object} options.client - Database client (optional, for transactions)
     * @returns {Promise<any>} Result from the operation
     */
    static async withDesignationRecalculation(options) {
        const {
            projectId,
            operation,
            context = {},
            client = null
        } = options;

        if (!projectId) {
            throw new Error('DesignationEnforcer: projectId is required');
        }

        if (!operation || typeof operation !== 'function') {
            throw new Error('DesignationEnforcer: operation must be a function');
        }

        // If skipRecalculation is explicitly set to true, just run the operation
        if (context.skipRecalculation === true) {
            console.warn(`⚠️ DesignationEnforcer: Skipping recalculation for project ${projectId} (skipRecalculation=true)`);
            return await operation();
        }

        const shouldManageClient = !client;
        let dbClient = client;
        const pool = require('../config/db');

        try {
            // Get client if not provided
            if (shouldManageClient) {
                dbClient = await pool.connect();
                await dbClient.query('BEGIN');
            }

            // Execute the operation
            const result = await operation(dbClient);

            // After successful operation, recalculate designations
            try {
                const { lotId = null, targetOuvrageId = null, startingDesignation = null } = context;
                
                console.log(`🔄 DesignationEnforcer: Recalculating designations for project ${projectId}`, {
                    lotId,
                    targetOuvrageId,
                    startingDesignation
                });

                await DesignationHelper.recalculateProjectDesignations(
                    projectId,
                    dbClient,
                    startingDesignation,
                    targetOuvrageId,
                    lotId
                );

                console.log(`✅ DesignationEnforcer: Designations recalculated successfully for project ${projectId}`);
            } catch (recalcError) {
                // Log but don't fail the operation if recalculation fails
                // This allows operations to succeed even if there's a designation issue
                console.error('❌ DesignationEnforcer: Recalculation failed (non-fatal):', recalcError);
                
                // If it's a permissions or missing table error, continue silently
                if (recalcError && (recalcError.code === '42501' || recalcError.code === '42P01')) {
                    console.warn('⚠️ DesignationEnforcer: Skipping recalculation due to DB permissions/table issue');
                } else {
                    // For other errors, log but continue
                    console.warn('⚠️ DesignationEnforcer: Continuing despite recalculation error');
                }
            }

            // Commit transaction if we managed it
            if (shouldManageClient) {
                await dbClient.query('COMMIT');
            }

            return result;
        } catch (error) {
            // Rollback if we managed the transaction
            if (shouldManageClient && dbClient) {
                try {
                    await dbClient.query('ROLLBACK');
                } catch (rollbackError) {
                    console.error('Failed to rollback transaction:', rollbackError);
                }
            }
            throw error;
        } finally {
            // Release client if we created it
            if (shouldManageClient && dbClient) {
                dbClient.release();
            }
        }
    }

    /**
     * Extract lot ID from projet_article for a given project and ouvrage/bloc
     * Helper method to determine lot context
     */
    static async getLotIdForRecalculation(client, projectId, ouvrageId = null, blocId = null) {
        try {
            let query;
            let params;

            if (ouvrageId) {
                query = `
                    SELECT DISTINCT lot 
                    FROM projet_article 
                    WHERE projet = $1 AND ouvrage = $2 AND lot IS NOT NULL 
                    LIMIT 1
                `;
                params = [projectId, ouvrageId];
            } else if (blocId) {
                query = `
                    SELECT DISTINCT lot 
                    FROM projet_article 
                    WHERE projet = $1 AND bloc = $2 AND lot IS NOT NULL 
                    LIMIT 1
                `;
                params = [projectId, blocId];
            } else {
                return null;
            }

            const result = await client.query(query, params);
            return result.rows.length > 0 ? result.rows[0].lot : null;
        } catch (error) {
            console.warn('DesignationEnforcer: Failed to get lot ID:', error);
            return null;
        }
    }

    /**
     * Recalculate designations for a specific context
     * Use this when you need to manually trigger recalculation
     */
    static async recalculate(context) {
        const {
            projectId,
            lotId = null,
            targetOuvrageId = null,
            startingDesignation = null,
            client = null
        } = context;

        if (!projectId) {
            throw new Error('DesignationEnforcer.recalculate: projectId is required');
        }

        const shouldManageClient = !client;
        let dbClient = client;
        const pool = require('../config/db');

        try {
            if (shouldManageClient) {
                dbClient = await pool.connect();
            }

            await DesignationHelper.recalculateProjectDesignations(
                projectId,
                dbClient,
                startingDesignation,
                targetOuvrageId,
                lotId
            );

            return { success: true };
        } catch (error) {
            if (error && (error.code === '42501' || error.code === '42P01')) {
                console.warn('DesignationEnforcer: Skipping recalculation due to DB error:', error.message);
                return { skipped: true };
            }
            throw error;
        } finally {
            if (shouldManageClient && dbClient) {
                dbClient.release();
            }
        }
    }
}

module.exports = DesignationEnforcer;

