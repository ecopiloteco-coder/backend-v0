const LEVEL_SEQUENCE = [
	'niveau1',
	'niveau2',
	'niveau3',
	'niveau4',
	'niveau5',
	'niveau6',
];

const LEVEL_DEFINITIONS = {
	niveau1: {
		level: 1,
		table: 'niveau_1',
		alias: 'niv1',
		labelColumn: 'niveau_1',
		idColumn: 'id_niveau_1',
		parentKey: null,
		parentIdColumn: null,
	},
	niveau2: {
		level: 2,
		table: 'niveau_2',
		alias: 'niv2',
		labelColumn: 'niveau_2',
		idColumn: 'id_niveau_2',
		parentKey: 'niveau1',
		parentIdColumn: 'id_niv_1',
	},
	niveau3: {
		level: 3,
		table: 'niveau_3',
		alias: 'niv3',
		labelColumn: 'niveau_3',
		idColumn: 'id_niveau_3',
		parentKey: 'niveau2',
		parentIdColumn: 'id_niv_2',
	},
	niveau4: {
		level: 4,
		table: 'niveau_4',
		alias: 'niv4',
		labelColumn: 'niveau_4',
		idColumn: 'id_niveau_4',
		parentKey: 'niveau3',
		parentIdColumn: 'id_niv_3',
	},
	niveau5: {
		level: 5,
		table: 'niveau_5',
		alias: 'niv5',
		labelColumn: 'niveau_5',
		idColumn: 'id_niveau_5',
		parentKey: 'niveau4',
		parentIdColumn: 'id_niv_4',
	},
	niveau6: {
		level: 6,
		table: 'niveau_6',
		alias: 'niv6',
		labelColumn: 'niveau_6',
		idColumn: 'id_niveau_6',
		parentKey: 'niveau5',
		parentIdColumn: 'id_niv_5',
		articleIdColumn: 'id_niv_6',
	},
};

const REQUEST_FIELD_MAP = {
	Niveau_1: 'niveau1',
	Niveau_2__lot: 'niveau2',
	Niveau_3: 'niveau3',
	Niveau_4: 'niveau4',
	Orientation_localisation: 'niveau5',
	Niveau_5__article: 'niveau6',
};

const COLUMN_TO_LEVEL = {
	Niveau_1: LEVEL_DEFINITIONS.niveau1,
	Niveau_2__lot: LEVEL_DEFINITIONS.niveau2,
	Niveau_3: LEVEL_DEFINITIONS.niveau3,
	Niveau_4: LEVEL_DEFINITIONS.niveau4,
	Orientation_localisation: LEVEL_DEFINITIONS.niveau5,
	Niveau_5__article: LEVEL_DEFINITIONS.niveau6,
};

function normalizeValue(value) {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return trimmed === '' ? null : trimmed;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value).trim();
	}
	return null;
}

function extractLevelValues(data = {}) {
	const normalized = {};
	for (const [fieldName, levelKey] of Object.entries(REQUEST_FIELD_MAP)) {
		const raw = data[fieldName];
		if (raw === undefined) continue;
		const value = normalizeValue(raw);
		if (value) {
			normalized[levelKey] = value;
		}
	}
	return normalized;
}

function getLevelDefinitionByColumn(columnName) {
	return COLUMN_TO_LEVEL[columnName] || null;
}

function getLevelDefinitionByKey(levelKey) {
	return LEVEL_DEFINITIONS[levelKey] || null;
}

async function findOrCreateLevel(client, config, label, parentId = null) {
	const searchParams = [label];
	let query = `SELECT ${config.idColumn} FROM ${config.table} WHERE unaccent(TRIM(LOWER(${config.labelColumn}))) = unaccent(TRIM(LOWER($1)))`;

	if (config.parentIdColumn) {
		if (!parentId) {
			return null;
		}
		query += ` AND ${config.parentIdColumn} = $2`;
		searchParams.push(parentId);
	}

	query += ' LIMIT 1';

	const existing = await client.query(query, searchParams);
	if (existing.rows.length > 0) {
		return existing.rows[0][config.idColumn];
	}

	const columns = [config.labelColumn];
	const placeholders = ['$1'];
	const insertParams = [label];

	if (config.parentIdColumn) {
		columns.push(config.parentIdColumn);
		placeholders.push('$2');
		insertParams.push(parentId);
	}

	const insertSql = `INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING ${config.idColumn}`;

	try {
		const inserted = await client.query(insertSql, insertParams);
		return inserted.rows[0][config.idColumn];
	} catch (error) {
		// Handle race condition in case another process inserted the same row concurrently
		if (error.code === '23505') {
			const retry = await client.query(query, searchParams);
			if (retry.rows.length > 0) {
				return retry.rows[0][config.idColumn];
			}
		}
		throw error;
	}
}

// Special function for niveau5 which always requires id_niv_3, and optionally id_niv_4
// IMPORTANT: id_niv_3 is always required in niveau_5 table
async function findOrCreateNiveau5(client, label, idNiv4 = null, idNiv3 = null) {
	// id_niv_3 is always required
	if (!idNiv3) {
		return null; // niveau5 always needs id_niv_3
	}

	// Search for existing niveau5 with this label, id_niv_3, and optionally id_niv_4
	const searchParams = [label, idNiv3];
	let query = `SELECT id_niveau_5 FROM niveau_5 WHERE unaccent(TRIM(LOWER(niveau_5))) = unaccent(TRIM(LOWER($1))) AND id_niv_3 = $2`;
	
	if (idNiv4) {
		// When id_niv_4 is provided, also check for matching id_niv_4
		query += ` AND id_niv_4 = $3`;
		searchParams.push(idNiv4);
	} else {
		// When id_niv_4 is NOT provided, check that id_niv_4 IS NULL
		query += ` AND id_niv_4 IS NULL`;
	}
	
	query += ' LIMIT 1';

	const existing = await client.query(query, searchParams);
	if (existing.rows.length > 0) {
		// Reuse existing niveau_5 row
		return existing.rows[0].id_niveau_5;
	}

	// Create new niveau5 - always include id_niv_3, optionally include id_niv_4
	const columns = ['niveau_5', 'id_niv_3'];
	const placeholders = ['$1', '$2'];
	const insertParams = [label, idNiv3];

	if (idNiv4) {
		// When id_niv_4 is provided, include it along with id_niv_3
		columns.push('id_niv_4');
		placeholders.push('$3');
		insertParams.push(idNiv4);
	}

	const insertSql = `INSERT INTO niveau_5 (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id_niveau_5`;

	try {
		const inserted = await client.query(insertSql, insertParams);
		return inserted.rows[0].id_niveau_5;
	} catch (error) {
		// Handle race condition in case another process inserted the same row concurrently
		if (error.code === '23505') {
			const retry = await client.query(query, searchParams);
			if (retry.rows.length > 0) {
				return retry.rows[0].id_niveau_5;
			}
		}
		throw error;
	}
}

// Special function for niveau6 which can have id_niv_5 OR id_niv_4 OR id_niv_3 (skip-levels, but id_niv_3 is always required)
// IMPORTANT: Check for existing niveau_6 with same niveau_6, id_niv_5, id_niv_4, id_niv_3 before creating new row
async function findOrCreateNiveau6(client, label, idNiv5 = null, idNiv4 = null, idNiv3 = null) {
	if (!idNiv3) {
		return null; // niveau6 always needs id_niv_3
	}

	// Search for existing niveau6 with this label and matching parent IDs
	const searchParams = [label];
	let query = `SELECT id_niveau_6 FROM niveau_6 WHERE unaccent(TRIM(LOWER(niveau_6))) = unaccent(TRIM(LOWER($1)))`;
	
	const conditions = [];
	if (idNiv5) {
		conditions.push(`id_niv_5 = $${searchParams.length + 1}`);
		searchParams.push(idNiv5);
	} else {
		conditions.push(`id_niv_5 IS NULL`);
	}
	
	if (idNiv4) {
		conditions.push(`id_niv_4 = $${searchParams.length + 1}`);
		searchParams.push(idNiv4);
	} else {
		conditions.push(`id_niv_4 IS NULL`);
	}
	
	conditions.push(`id_niv_3 = $${searchParams.length + 1}`);
	searchParams.push(idNiv3);
	
	query += ` AND ${conditions.join(' AND ')} LIMIT 1`;

	const existing = await client.query(query, searchParams);
	if (existing.rows.length > 0) {
		// Reuse existing niveau_6 row
		return existing.rows[0].id_niveau_6;
	}

	// Create new niveau6 only if no matching row exists
	const columns = ['niveau_6', 'id_niv_3'];
	const placeholders = ['$1', '$2'];
	const insertParams = [label, idNiv3];

	if (idNiv4) {
		columns.push('id_niv_4');
		placeholders.push(`$${insertParams.length + 1}`);
		insertParams.push(idNiv4);
	}

	if (idNiv5) {
		columns.push('id_niv_5');
		placeholders.push(`$${insertParams.length + 1}`);
		insertParams.push(idNiv5);
	}

	const insertSql = `INSERT INTO niveau_6 (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id_niveau_6`;

	try {
		const inserted = await client.query(insertSql, insertParams);
		return inserted.rows[0].id_niveau_6;
	} catch (error) {
		// Handle race condition in case another process inserted the same row concurrently
		if (error.code === '23505') {
			const retry = await client.query(query, searchParams);
			if (retry.rows.length > 0) {
				return retry.rows[0].id_niveau_6;
			}
		}
		throw error;
	}
}

async function ensureHierarchyIds(client, payload = {}) {
	try {
		const values = extractLevelValues(payload);
		const ids = {};

		// Required: niveau1, niveau2, niveau3, niveau6
		if (!values['niveau1'] || !values['niveau2'] || !values['niveau3'] || !values['niveau6']) {
			const missing = [];
			if (!values['niveau1']) missing.push('Niveau_1');
			if (!values['niveau2']) missing.push('Niveau_2__lot');
			if (!values['niveau3']) missing.push('Niveau_3');
			if (!values['niveau6']) missing.push('Niveau_5__article');
			throw new Error(`Missing required hierarchy levels: ${missing.join(', ')}`);
		}

		// Create niveau1 (no parent)
		const config1 = getLevelDefinitionByKey('niveau1');
		const idNiv1 = await findOrCreateLevel(client, config1, values['niveau1'], null);
		if (!idNiv1) {
			throw new Error(`Failed to create or find niveau1: ${values['niveau1']}`);
		}
		ids[config1.idColumn] = idNiv1;

		// Create niveau2 (parent: niveau1)
		const config2 = getLevelDefinitionByKey('niveau2');
		const idNiv2 = await findOrCreateLevel(client, config2, values['niveau2'], idNiv1);
		if (!idNiv2) {
			throw new Error(`Failed to create or find niveau2: ${values['niveau2']}`);
		}
		ids[config2.idColumn] = idNiv2;

		// Create niveau3 (parent: niveau2)
		const config3 = getLevelDefinitionByKey('niveau3');
		const idNiv3 = await findOrCreateLevel(client, config3, values['niveau3'], idNiv2);
		if (!idNiv3) {
			throw new Error(`Failed to create or find niveau3: ${values['niveau3']}`);
		}
		ids[config3.idColumn] = idNiv3;

		// Optional niveau4: if provided, create it (parent: niveau3)
		// Case 1: N4 null - skip this, idNiv4 stays null
		// Case 2: N4 provided - create it
		// Case 3: N4 provided - create it
		let idNiv4 = null;
		if (values['niveau4']) {
			const config4 = getLevelDefinitionByKey('niveau4');
			idNiv4 = await findOrCreateLevel(client, config4, values['niveau4'], idNiv3);
			if (!idNiv4) {
				throw new Error(`Failed to create or find niveau4: ${values['niveau4']}`);
			}
			ids[config4.idColumn] = idNiv4;
		}

		// Optional niveau5: if provided, create it (always requires id_niv_3, optionally id_niv_4)
		// Case 1: N5 null - skip this, idNiv5 stays null
		// Case 2: N5 null - skip this, idNiv5 stays null
		// Case 3: N5 provided - create it with id_niv_3 (required) and optionally id_niv_4
		let idNiv5 = null;
		if (values['niveau5']) {
			// findOrCreateNiveau5 always requires id_niv_3, and optionally includes id_niv_4 if provided
			idNiv5 = await findOrCreateNiveau5(client, values['niveau5'], idNiv4, idNiv3);
			if (!idNiv5) {
				throw new Error(`Failed to create or find niveau5: ${values['niveau5']}`);
			}
			ids['id_niv_5'] = idNiv5;
		}

		// Required niveau6: find existing or create new based on niveau_6, id_niv_5, id_niv_4, id_niv_3
		// Case 1: id_niv_5=NULL, id_niv_4=NULL, id_niv_3=idNiv3
		// Case 2: id_niv_5=NULL, id_niv_4=idNiv4, id_niv_3=idNiv3
		// Case 3: id_niv_5=idNiv5, id_niv_4=idNiv4, id_niv_3=idNiv3
		// findOrCreateNiveau6 checks for existing row with same combination before creating new
		const idNiv6 = await findOrCreateNiveau6(client, values['niveau6'], idNiv5, idNiv4, idNiv3);
		if (!idNiv6) {
			throw new Error(`Failed to create or find niveau6: ${values['niveau6']}`);
		}
		ids['id_niveau_6'] = idNiv6;
		ids['id_niv_6'] = idNiv6; // articleIdColumn alias

		return ids;
	} catch (error) {
		// Re-throw error instead of silently returning null
		// This allows Article.create() to catch and handle it properly
		throw error;
	}
}

/**
 * Attempt to resolve the final nivo identifier (id_niv_6) either from the payload
 * or by creating/finding the hierarchy nodes for each level.
 */
async function resolveHierarchyId(client, payload = {}) {
	const maybeId = payload.id_niv_6 ? Number(payload.id_niv_6) : null;
	if (maybeId && Number.isInteger(maybeId) && maybeId > 0) {
		return { id_niveau_6: maybeId, id_niv_6: maybeId };
	}

	const ids = await ensureHierarchyIds(client, payload);
	if (!ids) {
		return null;
	}
	const idNiv6 = ids['id_niveau_6'] || ids['id_niv_6'];
	if (!idNiv6) {
		return null;
	}
	return { id_niveau_6: idNiv6, id_niv_6: idNiv6, ids };
}

function getArticleHierarchyJoin(articleAlias = 'a') {
	const alias = articleAlias;
	return `
		LEFT JOIN niveau_6 niv6 ON ${alias}."id_niv_6" = niv6.id_niveau_6
		LEFT JOIN niveau_5 niv5 ON niv6.id_niv_5 = niv5.id_niveau_5
		LEFT JOIN niveau_4 niv4 ON COALESCE(niv5.id_niv_4, niv6.id_niv_4) = niv4.id_niveau_4
		LEFT JOIN niveau_3 niv3 ON COALESCE(niv4.id_niv_3, niv6.id_niv_3) = niv3.id_niveau_3
		LEFT JOIN niveau_2 niv2 ON niv3.id_niv_2 = niv2.id_niveau_2
		LEFT JOIN niveau_1 niv1 ON niv2.id_niv_1 = niv1.id_niveau_1
	`;
}

function getArticleHierarchySelectFields(articleAlias = 'a') {
	return [
		'niv1.niveau_1 AS "Niveau_1"',
		'niv2.niveau_2 AS "Niveau_2__lot"',
		'niv3.niveau_3 AS "Niveau_3"',
		'niv4.niveau_4 AS "Niveau_4"',
		'niv5.niveau_5 AS "Orientation_localisation"',
		'niv6.niveau_6 AS "Niveau_5__article"',
		`${articleAlias}."nom_article" AS "Niveau_6__detail_article"`
	].join(',\n\t\t');
}

function buildNormalizedArticlesSubquery(alias = 'normalized_articles') {
	const joinClause = getArticleHierarchyJoin('a');
	const selectFields = getArticleHierarchySelectFields('a');
	return `(
		SELECT 
			a.*,
			${selectFields}
		FROM articles a
		${joinClause}
	) ${alias}`;
}

/**
 * Search hierarchy tables directly (for autocomplete during article creation)
 * This bypasses the articles table and searches niveau_1 through niveau_6 tables directly
 * Special handling for niveau_6 which has shortcut columns (id_niv_4, id_niv_3)
 */
async function searchHierarchyTableDirect(client, levelKey, searchTerm = '', parentFilters = {}) {
	const config = getLevelDefinitionByKey(levelKey);
	if (!config) {
		throw new Error(`Invalid level key: ${levelKey}`);
	}

	const whereClauses = ['1=1'];
	const params = [];

	// Add search term filter
	if (searchTerm && searchTerm.trim() !== '') {
		params.push(`%${searchTerm.trim()}%`);
		whereClauses.push(`unaccent(TRIM(LOWER(${config.alias}.${config.labelColumn}))) LIKE unaccent(TRIM(LOWER($${params.length})))`);
	}

	// Build joins for parent filters
	// Special handling for niveau_6 which has shortcut columns
	const joinClauses = [];
	if (levelKey === 'niveau6') {
		// niveau_6 has special shortcuts: can reference niv5, niv4 (via id_niv_4), or niv3 (via id_niv_3)
		joinClauses.push(`LEFT JOIN niveau_5 niv5 ON niv6.id_niv_5 = niv5.id_niveau_5`);
		joinClauses.push(`LEFT JOIN niveau_4 niv4 ON COALESCE(niv5.id_niv_4, niv6.id_niv_4) = niv4.id_niveau_4`);
		joinClauses.push(`LEFT JOIN niveau_3 niv3 ON COALESCE(niv4.id_niv_3, niv6.id_niv_3) = niv3.id_niveau_3`);
		joinClauses.push(`LEFT JOIN niveau_2 niv2 ON niv3.id_niv_2 = niv2.id_niveau_2`);
		joinClauses.push(`LEFT JOIN niveau_1 niv1 ON niv2.id_niv_1 = niv1.id_niveau_1`);
	} else {
		// Standard hierarchical joins for other levels
		for (let level = config.level; level > 1; level--) {
			const currentDef = getLevelDefinitionByKey(`niveau${level}`);
			const parentDef = getLevelDefinitionByKey(`niveau${level - 1}`);
			if (!currentDef || !parentDef) continue;
			
			joinClauses.push(
				`LEFT JOIN ${parentDef.table} ${parentDef.alias} ON ${currentDef.alias}.${currentDef.parentIdColumn} = ${parentDef.alias}.${parentDef.idColumn}`
			);
		}
	}

	// Add parent filters
	for (const [filterLevelKey, filterValue] of Object.entries(parentFilters)) {
		const filterDef = getLevelDefinitionByKey(filterLevelKey);
		if (!filterDef || !filterValue || filterValue.toString().trim() === '') continue;
		
		params.push(filterValue.toString().trim());
		whereClauses.push(
			`unaccent(TRIM(LOWER(${filterDef.alias}.${filterDef.labelColumn}))) = unaccent(TRIM(LOWER($${params.length})))`
		);
	}

	const query = `
		SELECT DISTINCT ${config.alias}.${config.labelColumn} AS value
		FROM ${config.table} ${config.alias}
		${joinClauses.join('\n')}
		WHERE ${whereClauses.join(' AND ')}
		ORDER BY ${config.alias}.${config.labelColumn}
		LIMIT 50
	`;

	const result = await client.query(query, params);
	return result.rows.map(row => row.value).filter(Boolean);
}

module.exports = {
	LEVEL_SEQUENCE,
	LEVEL_DEFINITIONS,
	REQUEST_FIELD_MAP,
	COLUMN_TO_LEVEL,
	normalizeValue,
	extractLevelValues,
	getLevelDefinitionByColumn,
	getLevelDefinitionByKey,
	ensureHierarchyIds,
	resolveHierarchyId,
	getArticleHierarchyJoin,
	getArticleHierarchySelectFields,
	buildNormalizedArticlesSubquery,
	searchHierarchyTableDirect,
};

