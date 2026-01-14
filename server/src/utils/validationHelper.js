/**
 * Validation helper for project data
 * Provides validation functions for ouvrages and blocs
 */

/**
 * Validate nom field
 */
function validateNom(nom, type = 'ouvrage') {
    const errors = [];
    const cleanedValue = nom ? String(nom).trim() : '';

    if (!cleanedValue) {
        errors.push(`Le nom ${type === 'ouvrage' ? 'd\'ouvrage' : 'de bloc'} est requis`);
    } else if (cleanedValue.length < 2) {
        errors.push(`Le nom ${type === 'ouvrage' ? 'd\'ouvrage' : 'de bloc'} doit contenir au moins 2 caractères`);
    } else if (cleanedValue.length > 100) {
        errors.push(`Le nom ${type === 'ouvrage' ? 'd\'ouvrage' : 'de bloc'} ne peut pas dépasser 100 caractères`);
    }

    return {
        isValid: errors.length === 0,
        errors,
        cleanedValue
    };
}

/**
 * Validate designation field
 */
function validateDesignation(designation, type = 'ouvrage') {
    const errors = [];
    const cleanedValue = designation ? String(designation).trim() : '';

    if (cleanedValue && cleanedValue.length > 500) {
        errors.push(`La désignation ${type === 'ouvrage' ? 'd\'ouvrage' : 'de bloc'} ne peut pas dépasser 500 caractères`);
    }

    return {
        isValid: errors.length === 0,
        errors,
        cleanedValue
    };
}

/**
 * Check if nom is unique within a project
 */
async function checkNomUniqueness(client, projectId, nom, type, excludeId = null) {
    const table = type === 'ouvrage' ? 'ouvrage' : 'bloc';
    const nameColumn = type === 'ouvrage' ? 'nom_ouvrage' : 'nom_bloc';

    let query;
    let params = [nom.trim(), projectId];

    if (type === 'ouvrage') {
        query = `
            SELECT COUNT(*) as count
            FROM ${table} o
            INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
            WHERE o.${nameColumn} = $1 AND pl.id_projet = $2
        `;
    } else {
        // For blocs: bloc → ouvrage → projet_lot → projet
        query = `
            SELECT COUNT(*) as count
            FROM ${table} b
            INNER JOIN ouvrage o ON o.id = b.ouvrage
            INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
            WHERE b.${nameColumn} = $1 AND pl.id_projet = $2
        `;
    }

    if (excludeId) {
        if (type === 'ouvrage') {
            query += ` AND o.id != $3`;
        } else {
            query += ` AND b.id != $3`;
        }
        params.push(excludeId);
    }

    const result = await client.query(query, params);
    return parseInt(result.rows[0].count) === 0;
}

/**
 * Check if designation is unique within a project
 */
async function checkDesignationUniqueness(client, projectId, designation, type, excludeId = null) {
    const table = type === 'ouvrage' ? 'ouvrage' : 'bloc';
    const designationColumn = type === 'ouvrage' ? 'designation' : 'designation';

    let query;
    let params = [designation.trim(), projectId];

    if (type === 'ouvrage') {
        query = `
            SELECT COUNT(*) as count
            FROM ${table} o
            INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
            WHERE o.${designationColumn} = $1 AND pl.id_projet = $2
        `;
    } else {
        // For blocs: bloc → ouvrage → projet_lot → projet
        query = `
            SELECT COUNT(*) as count
            FROM ${table} b
            INNER JOIN ouvrage o ON o.id = b.ouvrage
            INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
            WHERE b.${designationColumn} = $1 AND pl.id_projet = $2
        `;
    }

    if (excludeId) {
        if (type === 'ouvrage') {
            query += ` AND o.id != $3`;
        } else {
            query += ` AND b.id != $3`;
        }
        params.push(excludeId);
    }

    const result = await client.query(query, params);
    return parseInt(result.rows[0].count) === 0;
}

/**
 * Validate ouvrage data
 */
async function validateOuvrageData(client, projectId, data, excludeId = null) {
    const errors = [];
    const warnings = [];
    const validatedData = {};

    // Validation du nom
    const nomValidation = validateNom(data.nom_ouvrage || data.nom, 'ouvrage');
    if (!nomValidation.isValid) {
        errors.push(...nomValidation.errors);
    } else {
        validatedData.nom_ouvrage = nomValidation.cleanedValue;

        // ✅ REMOVED: Project-wide uniqueness check for ouvrage names
        // Ouvrages can have the same name within a project
        // This allows creating multiple ouvrages with the same name
    }

    // Validation de la désignation
    const designationValidation = validateDesignation(data.designation, 'ouvrage');
    if (!designationValidation.isValid) {
        errors.push(...designationValidation.errors);
    } else {
        validatedData.designation = designationValidation.cleanedValue;

        // ✅ REMOVED: Project-wide uniqueness check for ouvrage designations
        // Ouvrages can have the same designation within a project
        // This allows creating multiple ouvrages with the same designation
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings,
        validatedData
    };
}

/**
 * Validate bloc data
 */
async function validateBlocData(client, projectId, data, excludeId = null) {
    const errors = [];
    const warnings = [];
    const validatedData = {};

    // Validation du nom
    const nomValidation = validateNom(data.nom_bloc || data.nom, 'bloc');
    if (!nomValidation.isValid) {
        errors.push(...nomValidation.errors);
    } else {
        validatedData.nom_bloc = nomValidation.cleanedValue;

        // ✅ REMOVED: Project-wide uniqueness check for bloc names
        // Blocs can have the same name as long as they belong to different ouvrages
        // This allows creating multiple blocs with the same name across different ouvrages
    }

    // Validation de la désignation
    const designationValidation = validateDesignation(data.designation, 'bloc');
    if (!designationValidation.isValid) {
        errors.push(...designationValidation.errors);
    } else {
        validatedData.designation = designationValidation.cleanedValue;

        // ✅ REMOVED: Project-wide uniqueness check for bloc designations
        // Blocs can have the same designation as long as they belong to different ouvrages
        // This allows creating multiple blocs with the same designation across different ouvrages
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings,
        validatedData
    };
}

module.exports = {
    validateNom,
    validateDesignation,
    checkNomUniqueness,
    checkDesignationUniqueness,
    validateOuvrageData,
    validateBlocData
};