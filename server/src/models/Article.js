const pool = require('../../config/db');
const EventNotificationService = require('../services/EventNotificationService');
const NiveauService = require('../services/NiveauService');
const Project = require('./Project');

const Gbloc = require('./Gbloc');

const ARTICLE_HIERARCHY_JOIN = NiveauService.getArticleHierarchyJoin('a');
const ARTICLE_HIERARCHY_SELECT_FIELDS = NiveauService.getArticleHierarchySelectFields('a');

// Function to ensure articles table has the new columns
async function ensureArticlesTableColumns() {
	const client = await pool.connect();
	try {
		// Add new columns if they don't exist
		await client.query('ALTER TABLE articles ADD COLUMN IF NOT EXISTS "Indice_de_confiance" INTEGER DEFAULT 3');
		await client.query('ALTER TABLE articles ADD COLUMN IF NOT EXISTS "fournisseur" INTEGER REFERENCES fournisseur(id_fournisseur)');
		console.log('Articles table columns ensured');
	} catch (err) {
		console.error('Error ensuring articles table columns:', err);
	} finally {
		client.release();
	}
}


class Article {
	static async findAll({
		page = 1,
		limit = 10,
		searchTerm = '',
		expertise = '',
		date = '',
		niveau1 = '',
		niveau2 = '',
	} = {}) {
		const client = await pool.connect();
		try {
			const offset = (page - 1) * limit;
			const searchTermValue = typeof searchTerm === 'string' ? searchTerm.trim() : '';

			const joinClause = ARTICLE_HIERARCHY_JOIN;

			const selectFragment = `
				a.*,
				${ARTICLE_HIERARCHY_SELECT_FIELDS}
			`;

			const whereClauses = ['1=1'];
			const params = [];

			if (searchTermValue) {
				const idx = params.length + 1;
				const termPattern = `%${searchTermValue}%`;
				whereClauses.push(`
					(
						unaccent(LOWER(a."nom_article")) LIKE unaccent(LOWER($${idx}))
						OR (niv6.niveau_6 IS NOT NULL AND unaccent(LOWER(niv6.niveau_6)) LIKE unaccent(LOWER($${idx})))
						OR a."PU"::text LIKE $${idx}
					)
				`);
				params.push(termPattern);
			}

			if (expertise && expertise.trim() !== '') {
				const idx = params.length + 1;
				whereClauses.push(`unaccent(LOWER(a."Expertise")) = unaccent(LOWER($${idx}))`);
				params.push(expertise.trim());
			}

			if (niveau1 && niveau1.trim() !== '') {
				const idx = params.length + 1;
				whereClauses.push(`unaccent(LOWER(niv1.niveau_1)) = unaccent(LOWER($${idx}))`);
				params.push(niveau1.trim());
			}

			if (niveau2 && niveau2.trim() !== '') {
				const idx = params.length + 1;
				whereClauses.push(`unaccent(LOWER(niv2.niveau_2)) = unaccent(LOWER($${idx}))`);
				params.push(niveau2.trim());
			}

			if (date && date.trim() !== '') {
				const normalizedDate = date.trim();
				const parsedDate = new Date(normalizedDate);
				if (!Number.isNaN(parsedDate.getTime())) {
					const idx = params.length + 1;
					whereClauses.push(`a."Date"::text LIKE $${idx}`);
					params.push(`%${normalizedDate}%`);
				}
			}

			const whereClause = whereClauses.join(' AND ');

			const dataQuery = `
				SELECT ${selectFragment}
				FROM articles a
				${joinClause}
				WHERE ${whereClause}
				ORDER BY a."ID"
				LIMIT $${params.length + 1}
				OFFSET $${params.length + 2}
			`;

			const countQuery = `
				SELECT COUNT(*) AS total
				FROM articles a
				${joinClause}
				WHERE ${whereClause}
			`;

			const dataParams = [...params, limit, offset];
			const [articlesResult, countResult] = await Promise.all([
				client.query(dataQuery, dataParams),
				client.query(countQuery, params),
			]);

			const totalCount = parseInt(countResult.rows[0]?.total || '0', 10);
			const totalPages = Math.ceil(totalCount / limit);

			return {
				data: articlesResult.rows,
				count: articlesResult.rows.length,
				totalCount,
				totalPages,
				currentPage: page,
			};
		} catch (error) {
			console.error('=== FINDALL ERROR ===', error);
			throw error;
		} finally {
			client.release();
		}
	}

	static async create({
		Date,
		Niveau_1,
		Niveau_2__lot,
		Niveau_3,
		Niveau_4,
		Orientation_localisation,
		Niveau_5__article,
		Niveau_6__detail_article,
		Unite,
		Type,
		Expertise,
		Fourniture,
		Cadence,
		Accessoires,
		Pertes,
		PU,
		Prix_Cible,
		Prix_estime,
		Prix_consulte,
		Rabais,
		Commentaires,
		userId,   // note the name here, e.g. userId
		Indice_de_confiance,
		fournisseur,
		files,
		file_urls,
		id_niv_6,
		article_name,
	}) {
		let processedFiles = null;
		if (files) {
			if (typeof files === 'string' && files.trim() !== '') {
				processedFiles = files;
			} else if (Array.isArray(files)) {
				processedFiles = JSON.stringify(files);
			}
		}

		const client = await pool.connect();
		try {
			const hierarchyResult = await NiveauService.resolveHierarchyId(client, {
				id_niv_6,
				Niveau_1,
				Niveau_2__lot,
				Niveau_3,
				Niveau_4,
				Orientation_localisation,
				Niveau_5__article,
			});

			if (!hierarchyResult?.id_niveau_6) {
				throw new Error('Unable to resolve article hierarchy. Please provide Niveau 1-6 values.');
			}

			const finalArticleName = article_name || Niveau_6__detail_article || null;

			const values = [
				Date || null,
				finalArticleName,
				hierarchyResult.id_niveau_6,
				Unite || null,
				Type || null,
				Expertise || null,
				Fourniture || null,
				Cadence || null,
				Accessoires || null,
				Pertes || null,
				PU || null,
				Prix_Cible || null,
				Prix_estime || null,
				Prix_consulte || null,
				Rabais || null,
				Commentaires || null,
				userId || null,
				Indice_de_confiance || 3,
				fournisseur || null,
				processedFiles || null,
			];

			const result = await client.query(
				`INSERT INTO public.articles (
					"Date", "nom_article", "id_niv_6", "Unite", "Type", "Expertise", "Fourniture", "Cadence",
					"Accessoires", "Pertes", "PU", "Prix_Cible", "Prix_estime", "Prix_consulte", "Rabais",
					"Commentaires", "User", "Indice_de_confiance", "fournisseur", "files"
				) VALUES (
					$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
				) RETURNING *`,
				values
			);

			return result.rows[0];
		} finally {
			client.release();
		}
	}

	static async update(id, data) {
		const {
			Date,
			Unite,
			Type,
			Expertise,
			Fourniture,
			Cadence,
			Accessoires,
			Pertes,
			PU,
			Prix_Cible,
			Prix_estime,
			Prix_consulte,
			Rabais,
			Commentaires,
			Indice_de_confiance,
			files,
		} = data;

		const client = await pool.connect();
		try {
			let processedFiles = null;
			if (files !== undefined) {
				if (typeof files === 'string') {
					processedFiles = files;
				} else if (Array.isArray(files)) {
					processedFiles = JSON.stringify(files);
				}
			}

			const hierarchyResult = await NiveauService.resolveHierarchyId(client, data);
			const articleNamePayload = data.article_name ?? data.Niveau_6__detail_article;

			const setFragments = [];
			const values = [];
			let idx = 1;

			const addField = (column, value) => {
				if (value === undefined) return;
				setFragments.push(`"${column}" = $${idx}`);
				values.push(value);
				idx++;
			};

			addField('Date', Date);
			addField('Unite', Unite);
			addField('Type', Type);
			addField('Expertise', Expertise);
			addField('Fourniture', Fourniture);
			addField('Cadence', Cadence);
			addField('Accessoires', Accessoires);
			addField('Pertes', Pertes);
			addField('PU', PU);
			addField('Prix_Cible', Prix_Cible);
			addField('Prix_estime', Prix_estime);
			addField('Prix_consulte', Prix_consulte);
			addField('Rabais', Rabais);
			addField('Commentaires', Commentaires);
			addField('nom_article', articleNamePayload);

			if (hierarchyResult?.id_niveau_6) {
				addField('id_niv_6', hierarchyResult.id_niveau_6);
			}

			if (Indice_de_confiance !== undefined) {
				addField('Indice_de_confiance', Indice_de_confiance);
			}

			if (data.fournisseur !== undefined) {
				const fournisseurValue = data.fournisseur === null ? null : Number(data.fournisseur);
				addField('fournisseur', fournisseurValue);
			}

			if (processedFiles !== null) {
				addField('files', processedFiles);
			}

			if (setFragments.length === 0) {
				throw new Error('No valid fields provided for article update');
			}

			values.push(id);

			const updateSql = `UPDATE articles SET ${setFragments.join(', ')} WHERE "ID" = $${idx} RETURNING *`;

			const result = await client.query(updateSql, values);
			return result.rows[0];
		} finally {
			client.release();
		}
	}

	static async findById(id) {
		const client = await pool.connect();
		try {
			const joinClause = ARTICLE_HIERARCHY_JOIN;
			const selectFragment = `
				a.*,
				${ARTICLE_HIERARCHY_SELECT_FIELDS},
				f.nom_fournisseur,
				f.type AS fournisseur_type
			`;

			const result = await client.query(
				`SELECT ${selectFragment}
				 FROM articles a
				 ${joinClause}
				 LEFT JOIN fournisseur f ON a."fournisseur" = f."id_fournisseur"
				 WHERE a."ID" = $1`,
				[id]
			);
			// Files are now stored as JSON strings with Supabase URLs, no processing needed
			return result.rows[0];
		} catch (error) {
			throw error;
		} finally {
			client.release();
		}
	}

	static async delete(id) {
		const client = await pool.connect();
		try {
			await client.query('BEGIN');

			// First, fetch the article to get all its data
			const articleResult = await client.query('SELECT * FROM articles WHERE "ID" = $1', [id]);
			if (articleResult.rows.length === 0) {
				await client.query('ROLLBACK');
				return null;
			}
			const article = articleResult.rows[0];

			// Ensure articles_supprime has all needed columns, especially id_niv_6
			try {
				await client.query('ALTER TABLE articles_supprime ADD COLUMN IF NOT EXISTS "files" TEXT');
				await client.query('ALTER TABLE articles_supprime ADD COLUMN IF NOT EXISTS "Indice_de_confiance" INTEGER DEFAULT 3');
				await client.query('ALTER TABLE articles_supprime ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(255)');
				await client.query('ALTER TABLE articles_supprime ADD COLUMN IF NOT EXISTS "fournisseur" INTEGER REFERENCES fournisseur(id_fournisseur)');
				await client.query('ALTER TABLE articles_supprime ADD COLUMN IF NOT EXISTS "nom_article" TEXT');
				await client.query('ALTER TABLE articles_supprime ADD COLUMN IF NOT EXISTS "id_niv_6" INTEGER REFERENCES niveau_6(id_niveau_6)');
			} catch (colErr) {
				console.warn('Error ensuring articles_supprime columns:', colErr.message);
			}

			// Archive the article into articles_supprime with explicit column listing
			// This ensures id_niv_6 is properly saved
			const archiveResult = await client.query(
				`INSERT INTO articles_supprime (
					"ID", "Date", "nom_article", "id_niv_6", "Unite", "Type", "Expertise", "Fourniture", "Cadence",
					"Accessoires", "Pertes", "PU", "Prix_Cible", "Prix_estime", "Prix_consulte", "Rabais",
					"Commentaires", "User", "Indice_de_confiance", "files", "fournisseur"
				) VALUES (
					$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
				) RETURNING *`,
				[
					article.ID,
					article.Date,
					article.nom_article,
					article.id_niv_6, // Explicitly include id_niv_6
					article.Unite,
					article.Type,
					article.Expertise,
					article.Fourniture,
					article.Cadence,
					article.Accessoires,
					article.Pertes,
					article.PU,
					article.Prix_Cible,
					article.Prix_estime,
					article.Prix_consulte,
					article.Rabais,
					article.Commentaires,
					article.User,
					article.Indice_de_confiance || 3,
					article.files,
					article.fournisseur
				]
			);

			// Now delete from main table
			const deleteResult = await client.query('DELETE FROM articles WHERE "ID" = $1 RETURNING *', [id]);
			await client.query('COMMIT');
			return deleteResult.rows[0];
		} catch (e) {
			await client.query('ROLLBACK');
			throw e;
		} finally {
			client.release();
		}
	}

	static async _searchHierarchyDistinct(definition, searchTerm = '', filters = {}) {
		const client = await pool.connect();
		try {
			const baseAlias = definition.alias;
			const whereClauses = ['1=1'];
			const params = [];

			if (searchTerm && searchTerm.trim() !== '') {
				const idx = params.length + 1;
				whereClauses.push(`unaccent(TRIM(LOWER(${baseAlias}.${definition.labelColumn}))) LIKE unaccent(TRIM(LOWER($${idx})))`);
				params.push(`%${searchTerm.trim()}%`);
			}

			for (const [filterColumn, filterValue] of Object.entries(filters)) {
				const filterDef = NiveauService.getLevelDefinitionByColumn(filterColumn);
				if (!filterDef || filterValue === undefined || filterValue === null) continue;
				const idx = params.length + 1;
				whereClauses.push(`unaccent(TRIM(LOWER(${filterDef.alias}.${filterDef.labelColumn}))) = unaccent(TRIM(LOWER($${idx})))`);
				params.push(filterValue.toString().trim());
			}

			const joinClauses = [];
			for (let level = definition.level; level > 1; level--) {
				const currentDef = NiveauService.getLevelDefinitionByKey(`niveau${level}`);
				const parentDef = NiveauService.getLevelDefinitionByKey(`niveau${level - 1}`);
				if (!currentDef || !parentDef) continue;
				joinClauses.push(`LEFT JOIN ${parentDef.table} ${parentDef.alias} ON ${currentDef.alias}.${currentDef.parentIdColumn} = ${parentDef.alias}.${parentDef.idColumn}`);
			}

			const query = `
				SELECT DISTINCT ${baseAlias}.${definition.labelColumn} AS value
				FROM ${definition.table} ${baseAlias}
				${joinClauses.join('\n')}
				WHERE ${whereClauses.join(' AND ')}
				ORDER BY ${baseAlias}.${definition.labelColumn}
				LIMIT 10
			`;

			const result = await client.query(query, params);
			return result.rows.map(row => row.value).filter(Boolean);
		} finally {
			client.release();
		}
	}

	static async searchDistinct(column, searchTerm = '') {
		const hierarchyDef = NiveauService.getLevelDefinitionByColumn(column);
		if (hierarchyDef) {
			return this._searchHierarchyDistinct(hierarchyDef, searchTerm);
		}

		const client = await pool.connect();
		try {
			let query;
			const params = [];
			if (searchTerm) {
				query = `SELECT DISTINCT "${column}" FROM articles 
						 WHERE unaccent(LOWER("${column}")) LIKE unaccent(LOWER($1))
						 AND "${column}" IS NOT NULL AND "${column}" != ''
						 ORDER BY "${column}"`;
				params.push(`%${searchTerm}%`);
			} else {
				query = `SELECT DISTINCT "${column}" FROM articles 
						 WHERE "${column}" IS NOT NULL AND "${column}" != ''
						 ORDER BY "${column}"`;
			}

			const result = await client.query(query, params);
			return result.rows.map(row => row[column]);
		} catch (error) {
			console.error('Error in searchDistinct:', error);
			throw error;
		} finally {
			client.release();
		}
	}

	static async checkArticleExists({ name, datePrix, expertise, fournisseurId = null }) {
		const client = await pool.connect();
		try {
			console.log('=== CHECK ARTICLE EXISTS ===');
			console.log('Parameters:', { name, datePrix, expertise, fournisseurId });

			if (!name || !datePrix || !expertise) {
				throw new Error('Missing required fields: name, datePrix, and expertise are required');
			}

			const testDate = new Date(datePrix);
			if (isNaN(testDate.getTime())) {
				throw new Error('Invalid date format. Please use YYYY-MM-DD format');
			}

			// Enhanced query to get all relevant fields including fournisseur
			const query = `
				SELECT a."ID", a."PU", a."Prix_consulte", a."Prix_estime", a."Prix_Cible", a."fournisseur",
					   a."nom_article" AS "article_name", a."Date", a."Expertise", 
					   f."nom_fournisseur", f."type" as fournisseur_type
				FROM articles a
				LEFT JOIN fournisseur f ON a."fournisseur" = f."id_fournisseur"
				WHERE LOWER(a."nom_article") = LOWER($1)
				AND a."Date" = $2
				AND LOWER(a."Expertise") = LOWER($3)
				AND a."fournisseur" = $4
			`;
			const values = [name, datePrix, expertise, fournisseurId];
			const result = await client.query(query, values);

			console.log('=== DETAILED QUERY RESULT ===');
			console.log('Number of matching records:', result.rows.length);

			if (result.rows.length > 0) {
				result.rows.forEach((row, index) => {
					console.log(`Record ${index + 1}:`, {
						ID: row.ID,
						PU: `"${row.PU}" (type: ${typeof row.PU})`,
						Prix_consulte: `"${row.Prix_consulte}" (type: ${typeof row.Prix_consulte})`,
						Prix_estime: `"${row.Prix_estime}" (type: ${typeof row.Prix_estime})`,
						Prix_Cible: `"${row.Prix_Cible}" (type: ${typeof row.Prix_Cible})`,
						fournisseur: row.fournisseur,
						fournisseur_type: row.fournisseur_type,
						nom_fournisseur: row.nom_fournisseur,
					});
				});
			}

			if (result.rows.length > 0) {
				const article = result.rows[0];
				let origin = null;

				console.log('=== ORIGIN DETECTION PROCESS ===');

				// Check if there's a fournisseur and determine origin from fournisseur type
				if (article.fournisseur && article.fournisseur_type) {
					console.log('Fournisseur found:', {
						id: article.fournisseur,
						type: article.fournisseur_type,
						name: article.nom_fournisseur
					});

					// Map fournisseur type to origin
					if (article.fournisseur_type === 'entreprise') {
						origin = 'consulte'; // entreprise uses consulte pricing
					} else if (article.fournisseur_type === 'fournisseur') {
						origin = 'consulte'; // fournisseur uses consulte pricing
					} else if (article.fournisseur_type === 'négociant') {
						origin = 'consulte'; // négociant uses consulte pricing
					}

					console.log('Origin determined from fournisseur type:', origin);
				} else {
					console.log('No fournisseur found, falling back to price-based detection');

					// Fallback to price-based detection with enhanced logging
					const puRaw = article.PU;
					const prixConsulteRaw = article.Prix_consulte;
					const prixEstimeRaw = article.Prix_estime;
					const prixCibleRaw = article.Prix_Cible;

					console.log('Raw price values:', {
						puRaw: `"${puRaw}"`,
						prixConsulteRaw: `"${prixConsulteRaw}"`,
						prixEstimeRaw: `"${prixEstimeRaw}"`,
						prixCibleRaw: `"${prixCibleRaw}"`
					});

					const pu = parseFloat(puRaw || '0');
					const prixConsulte = parseFloat(prixConsulteRaw || '0');
					const prixEstime = parseFloat(prixEstimeRaw || '0');
					const prixCible = parseFloat(prixCibleRaw || '0');

					console.log('Parsed price values:', { pu, prixConsulte, prixEstime, prixCible });
					console.log('Price checks:');
					console.log('  prixConsulte > 0:', prixConsulte > 0);
					console.log('  prixEstime > 0:', prixEstime > 0);
					console.log('  prixCible > 0:', prixCible > 0);
					console.log('  pu > 0:', pu > 0);

					if (prixConsulte > 0) {
						origin = 'consulte';
						console.log('Origin set to consulte (prixConsulte > 0)');
					} else if (prixEstime > 0) {
						origin = 'estime';
						console.log('Origin set to estime (prixEstime > 0)');
					} else if (prixCible > 0) {
						origin = 'cible';
						console.log('Origin set to cible (prixCible > 0)');
					} else if (pu > 0) {
						origin = 'cible';
						console.log('Origin set to cible (pu > 0, default fallback)');
					}
				}

				// If we still can't determine origin
				if (!origin) {
					console.warn('Could not determine origin for existing article:', article);
					console.log('=== DATA QUALITY ISSUE ===');
					console.log('This suggests the article has no meaningful price data or fournisseur');
					console.log('Consider checking the data integrity for this record');

					// For now, let's assume 'cible' as default when we can't determine
					origin = 'cible';
					console.log('Defaulting origin to cible');
				}

				const finalPu = parseFloat(article.PU || '0');
				console.log('=== FINAL RESULT ===');
				console.log('Final origin:', origin);
				console.log('Final PU:', finalPu);

				return {
					exists: true,
					origin: origin,
					pu: finalPu.toString(),
					fournisseur_id: article.fournisseur,
					fournisseur_type: article.fournisseur_type,
				};
			}

			console.log('No matching records found');
			return { exists: false };
		} catch (error) {
			console.error('Error in checkArticleExists:', error);
			throw error;
		} finally {
			client.release();
		}
	}

	static async searchDistinctWithFilter(column, searchTerm = '', filters = {}) {
		const hierarchyDef = NiveauService.getLevelDefinitionByColumn(column);
		if (hierarchyDef) {
			return this._searchHierarchyDistinct(hierarchyDef, searchTerm, filters);
		}

		const client = await pool.connect();
		try {
			const whereClauses = ['1=1'];
			const params = [];
			let paramIndex = 1;

			if (searchTerm && searchTerm.trim() !== '') {
				whereClauses.push(
					`unaccent(TRIM(LOWER("${column}"))) LIKE unaccent(TRIM(LOWER($${paramIndex})))`
				);
				params.push(`%${searchTerm.trim()}%`);
				paramIndex++;
			}

			for (const [key, value] of Object.entries(filters)) {
				if (value === undefined || value === null || value.toString().trim() === '') continue;
				whereClauses.push(
					`unaccent(TRIM(LOWER("${key}"))) = unaccent(TRIM(LOWER($${paramIndex})))`
				);
				params.push(value.toString().trim());
				paramIndex++;
			}

			const whereClause = `WHERE ${whereClauses.join(' AND ')}`;

			const query = `
				SELECT DISTINCT "${column}"
				FROM articles
				${whereClause}
				ORDER BY "${column}"
			`;

			const result = await client.query(query, params);
			return result.rows.map(row => row[column]).filter(Boolean);
		} catch (error) {
			console.error('Error in searchDistinctWithFilter:', error);
			throw error;
		} finally {
			client.release();
		}
	}

	static async searchSuggestions(searchTerm = '', limit = 8) {
		const client = await pool.connect();
		try {
			if (!searchTerm || searchTerm.trim() === '') {
				return [];
			}

			const query = `
				WITH article_suggestions AS (
					SELECT DISTINCT 
						a."nom_article" AS text,
						'article' AS type,
						COUNT(*) AS count
					FROM articles a
					WHERE a."nom_article" IS NOT NULL 
					AND a."nom_article" != ''
					AND unaccent(LOWER(a."nom_article")) LIKE unaccent(LOWER($1))
					GROUP BY a."nom_article"
					ORDER BY count DESC, a."nom_article"
					LIMIT $2
				),
				niveau_suggestions AS (
					SELECT DISTINCT 
						niv6.niveau_6 AS text,
						'niveau' AS type,
						COUNT(*) AS count
					FROM articles a
					LEFT JOIN niveau_6 niv6 ON a."id_niv_6" = niv6.id_niveau_6
					WHERE niv6.niveau_6 IS NOT NULL 
					AND niv6.niveau_6 != ''
					AND unaccent(LOWER(niv6.niveau_6)) LIKE unaccent(LOWER($1))
					GROUP BY niv6.niveau_6
					ORDER BY count DESC, niv6.niveau_6
					LIMIT $2
				),
				price_suggestions AS (
					SELECT DISTINCT 
						"PU" AS text,
						'price' AS type,
						COUNT(*) AS count
					FROM articles 
					WHERE "PU" IS NOT NULL 
					AND "PU" != ''
					AND "PU"::text LIKE $1
					GROUP BY "PU"
					ORDER BY CAST("PU" AS DECIMAL) ASC
					LIMIT $2
				)
				SELECT * FROM article_suggestions
				UNION ALL
				SELECT * FROM niveau_suggestions
				UNION ALL
				SELECT * FROM price_suggestions
			`;

			const result = await client.query(query, [`%${searchTerm}%`, limit]);
			return result.rows;
		} catch (error) {
			console.error('Error in searchSuggestions:', error);
			throw error;
		} finally {
			client.release();
		}
	}

	/**
	 * Update article in project
	 */
	static async updateInProject(projectId, articleId, updateData, userId, blocId = null, gblocId = null, projetArticleId = null) {
		const client = await pool.connect();
		try {
			await client.query('BEGIN');

			// Get current article data
			// If projetArticleId is provided, update only that specific row; otherwise use blocId or update all rows
			let currentResult;
			if (projetArticleId !== null) {
				// Update specific row by projet_article.id
				currentResult = await client.query(
					`SELECT pa.* 
                     FROM projet_article pa
                     INNER JOIN structure s ON s.id_structure = pa.structure
                     WHERE pa.id = $1 AND s.ouvrage = $2 AND pa.article = $3`,
					[projetArticleId, gblocId, articleId]
				);
			} else if (blocId !== null) {
				// Update specific row: if blocId is provided, find the row with that bloc
				currentResult = await client.query(
					`SELECT pa.* 
                     FROM projet_article pa
                     INNER JOIN structure s ON s.id_structure = pa.structure
                     WHERE s.ouvrage = $1 AND pa.article = $2 AND s.bloc = $3`,
					[gblocId, articleId, blocId]
				);
			} else {
				// Update all rows with this article (legacy behavior)
				currentResult = await client.query(
					`SELECT pa.* 
                     FROM projet_article pa
                     INNER JOIN structure s ON s.id_structure = pa.structure
                     INNER JOIN ouvrage o ON o.id = s.ouvrage
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     WHERE pl.id_projet = $1 AND pa.article = $2`,
					[projectId, articleId]
				);
			}
			if (currentResult.rows.length === 0) {
				throw new Error('Article not found in project');
			}
			const current = currentResult.rows[0];

			// Use provided blocId/gblocId if available, otherwise use from current row
			const finalBlocId = blocId !== null ? blocId : (current.bloc || null);
			const finalGblocId = gblocId !== null ? gblocId : (current.ouvrage || current.g_bloc || null);

			const { quantite, prix_unitaire, tva, localisation, description, nouv_prix, designation_article } = updateData;

			// Calculate new totals
			const qNum = quantite !== undefined ? Number(quantite) : current.quantite;
			// Use nouv_prix if provided, otherwise use prix_unitaire, otherwise calculate from existing data
			let puNum;
			if (nouv_prix !== undefined && nouv_prix !== null) {
				puNum = Number(nouv_prix);
			} else if (prix_unitaire !== undefined) {
				puNum = Number(prix_unitaire);
			} else if (current.nouv_prix !== null) {
				puNum = Number(current.nouv_prix);
			} else {
				puNum = current.prix_total_ht / current.quantite;
			}
			const tvaNum = tva !== undefined ? Number(tva) : current.tva;
			const prixTotalHt = puNum * qNum;
			const totalTtc = prixTotalHt * (1 + tvaNum / 100);

			// Build SET clauses and params dynamically
			const setClauses = [
				'quantite = COALESCE($1, quantite)',
				'prix_total_ht = $2',
				'tva = COALESCE($3, tva)',
				'total_ttc = $4'
			];
			const updateParams = [qNum, prixTotalHt, tvaNum, totalTtc];
			let paramIndex = 5;

			// Add localisation if provided (including empty string)
			if (localisation !== undefined) {
				setClauses.push(`localisation = $${paramIndex}`);
				updateParams.push(localisation === '' ? '' : (localisation || null));
				paramIndex++;
			}

			// Add description if provided (including empty string)
			if (description !== undefined) {
				setClauses.push(`description = $${paramIndex}`);
				updateParams.push(description === '' ? '' : (description || null));
				paramIndex++;
			}

			// Add nouv_prix
			const nouvPrixValue = nouv_prix !== undefined ? (nouv_prix > 0 ? nouv_prix : null) : current.nouv_prix;
			setClauses.push(`nouv_prix = $${paramIndex}`);
			updateParams.push(nouvPrixValue);
			paramIndex++;

			// Add designation_article if provided (including empty string)
			if (designation_article !== undefined) {
				setClauses.push(`designation_article = $${paramIndex}`);
				updateParams.push(designation_article === '' ? '' : (designation_article || null));
				paramIndex++;
			}

			// Build WHERE clause
			// Check if projet column exists in projet_article table
			const projetColCheck = await client.query(`
			SELECT column_name FROM information_schema.columns
			WHERE table_name = 'projet_article' AND column_name = 'projet'
		`);
			const hasProjetCol = projetColCheck.rows.length > 0;

			let whereClause;
			if (projetArticleId !== null) {
				// When specific projet_article.id is provided, we can just use that
				// The route handler already validated it belongs to the correct project
				if (hasProjetCol) {
					whereClause = `WHERE id = $${paramIndex++} AND projet = $${paramIndex++} AND article = $${paramIndex++}`;
					updateParams.push(projetArticleId, projectId, articleId);
				} else {
					// Structure-based schema: just use id since validation was done via structure JOIN
					whereClause = `WHERE id = $${paramIndex++}`;
					updateParams.push(projetArticleId);
				}
			} else if (finalBlocId !== null) {
				if (hasProjetCol) {
					whereClause = `WHERE projet = $${paramIndex++} AND article = $${paramIndex++} AND bloc = $${paramIndex++}`;
					updateParams.push(projectId, articleId, finalBlocId);
				} else {
					// Structure-based schema: need to join with structure to filter by project
					whereClause = `WHERE id IN (
					SELECT pa.id FROM projet_article pa
					INNER JOIN structure s ON s.id_structure = pa.structure
					INNER JOIN ouvrage o ON o.id = s.ouvrage
					INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
					WHERE pl.id_projet = $${paramIndex++} AND pa.article = $${paramIndex++} AND s.bloc = $${paramIndex++}
				)`;
					updateParams.push(projectId, articleId, finalBlocId);
				}
			} else {
				if (hasProjetCol) {
					whereClause = `WHERE projet = $${paramIndex++} AND article = $${paramIndex++}`;
					updateParams.push(projectId, articleId);
				} else {
					// Structure-based schema: need to join with structure to filter by project
					whereClause = `WHERE id IN (
					SELECT pa.id FROM projet_article pa
					INNER JOIN structure s ON s.id_structure = pa.structure
					INNER JOIN ouvrage o ON o.id = s.ouvrage
					INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
					WHERE pl.id_projet = $${paramIndex++} AND pa.article = $${paramIndex++}
				)`;
					updateParams.push(projectId, articleId);
				}
			}

			const updateSql = `
                UPDATE projet_article SET
                    ${setClauses.join(',\n                    ')}
                ${whereClause}
                RETURNING *
            `;

			const result = await client.query(updateSql, updateParams);

			console.log('🔍 Article update query executed, rows affected:', result.rows.length);

			// Track changes and create event
			if (result.rows.length > 0 && userId) {
				console.log('🔍 Tracking changes for event creation...');
				const changes = {};
				// Helper to normalize null/empty string for comparison
				const normalizeValue = (val) => {
					if (val === null || val === undefined) return null;
					if (typeof val === 'string' && val.trim() === '') return '';
					return val;
				};
				// Helper to check if values are different (handling null vs empty string)
				const isDifferent = (val1, val2) => {
					const norm1 = normalizeValue(val1);
					const norm2 = normalizeValue(val2);
					return norm1 !== norm2;
				};

				if (quantite !== undefined && quantite !== current.quantite) changes.quantite = { from: current.quantite, to: quantite };
				if (prix_unitaire !== undefined && puNum !== (current.prix_total_ht / current.quantite)) changes.prix_unitaire = { from: (current.prix_total_ht / current.quantite), to: prix_unitaire };
				if (tva !== undefined && tva !== current.tva) changes.tva = { from: current.tva, to: tva };
				// ✅ FIX: Track localisation changes including when field is cleared (empty string or null)
				if (localisation !== undefined && isDifferent(localisation, current.localisation)) {
					changes.localisation = { from: current.localisation, to: localisation };
				}
				// ✅ FIX: Track description changes including when field is cleared (empty string or null)
				if (description !== undefined && isDifferent(description, current.description)) {
					changes.description = { from: current.description, to: description };
				}
				if (nouv_prix !== undefined && nouv_prix !== current.nouv_prix) changes.nouv_prix = { from: current.nouv_prix, to: nouv_prix };

				console.log('🔍 Changes detected:', changes);

				if (Object.keys(changes).length > 0) {
					try {
						// Resolve lot name for event
						const lotId = current.lot;
						let lotNameForEvent = null;
						if (lotId) {
							try {
								let lotResult = await client.query('SELECT niveau_2 FROM niveau_2 WHERE id_niveau_2 = $1', [lotId]);
								lotNameForEvent = lotResult.rows[0]?.niveau_2 || null;
								if (!lotNameForEvent) {
									lotResult = await client.query('SELECT "Niveau_2__lot" FROM niveau_2 WHERE id_niveau_2 = $1', [lotId]);
									lotNameForEvent = lotResult.rows[0]?.Niveau_2__lot || null;
								}
							} catch (lotErr) {
								console.warn('⚠️ Failed to resolve lot name for update event:', lotErr.message);
							}
						}

						// Use finalBlocId and finalGblocId which come from the specific row being updated
						console.log('🔍 Calling EventNotificationService.articleUpdated with:', {
							projectId,
							articleId,
							userId,
							changes,
							finalBlocId,
							finalGblocId,
							lotNameForEvent
						});
						await EventNotificationService.articleUpdated(projectId, articleId, userId, changes, finalBlocId, finalGblocId, lotNameForEvent);
					} catch (eventError) {
						console.error('❌ Failed to create article update event:', eventError);
					}
				} else {
					console.log('⚠️ No changes detected, skipping event creation');
				}
			}

			// Recalculate ouvrage prix_total if this article belongs to an ouvrage
			const updatedRow = result.rows[0];
			if (updatedRow && updatedRow.structure) {
				// Get the ouvrage ID from the structure table
				try {
					const structureResult = await client.query(
						'SELECT ouvrage FROM structure WHERE id_structure = $1',
						[updatedRow.structure]
					);
					const ouvrageId = structureResult.rows[0]?.ouvrage;
					if (ouvrageId && ouvrageId > 0) {
						await Gbloc.recalculatePrixTotal(ouvrageId, projectId, client);
					}
				} catch (structureError) {
					console.error('❌ Failed to get ouvrage from structure:', structureError);
				}
			}

			// ✅ FIX: Recalculate bloc pt/pu if article was updated in a bloc
			// Get the bloc ID from the structure table via the updated row's structure
			if (updatedRow && updatedRow.structure) {
				try {
					const structureResult = await client.query(
						'SELECT bloc FROM structure WHERE id_structure = $1',
						[updatedRow.structure]
					);
					const blocIdFromStructure = structureResult.rows[0]?.bloc;

					if (blocIdFromStructure && blocIdFromStructure > 0) {
						try {
							// Sum all article totals for this bloc
							const totalResult = await client.query(
								`SELECT COALESCE(SUM(pa.total_ttc), 0)::float AS total_ttc 
								 FROM projet_article pa
								 INNER JOIN structure s ON s.id_structure = pa.structure
								 INNER JOIN ouvrage o ON o.id = s.ouvrage
								 INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
								 WHERE pl.id_projet = $1 AND s.bloc = $2`,
								[projectId, blocIdFromStructure]
							);
							const total = totalResult.rows[0]?.total_ttc || 0;

							// Get bloc quantite
							const quantiteResult = await client.query('SELECT quantite FROM bloc WHERE id = $1', [blocIdFromStructure]);
							const quantite = Number(quantiteResult.rows[0]?.quantite) || 0;

							// Calculate pu
							const pu = quantite > 0 ? total / quantite : null;

							// Update bloc pt and pu
							await client.query('UPDATE bloc SET pt = $1, pu = $2 WHERE id = $3', [total, pu, blocIdFromStructure]);
							console.log(`✅ Updated bloc ${blocIdFromStructure}: pt=${total}, pu=${pu}`);
						} catch (blocError) {
							console.error(`❌ Failed to update bloc ${blocIdFromStructure} pt/pu:`, blocError);
						}
					}
				} catch (structureError) {
					console.error('❌ Failed to get bloc from structure:', structureError);
				}
			}

			await client.query('COMMIT');
			// Recompute project's selling price based on projet_article totals
			try { await Project.recalculatePrixVente(projectId); } catch { }
			return result.rows[0];
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally {
			client.release();
		}
	}

	/**
	 * Remove article from project
	 */
	static async removeFromProject(projectId, articleId, userId) {
		const client = await pool.connect();
		try {
			await client.query('BEGIN');

			// Get article name, bloc, gbloc, and lot before deletion
			let articleName = null;
			let blocIdForEvent = null;
			let gblocId = null;
			let lotNameForEvent = null;
			if (userId) {
				const articleResult = await client.query(
					`SELECT a."nom_article" AS "article_name", s.ouvrage as g_bloc, s.bloc, pl.id_lot as lot
                     FROM projet_article pa 
                     INNER JOIN structure s ON s.id_structure = pa.structure
                     INNER JOIN ouvrage o ON o.id = s.ouvrage
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     JOIN articles a ON a."ID" = pa.article 
                     WHERE pl.id_projet = $1 AND pa.article = $2`,
					[projectId, articleId]
				);
				const row = articleResult.rows[0];
				articleName = row?.article_name;
				gblocId = row?.g_bloc; // This is now ouvrage column aliased as g_bloc
				blocIdForEvent = row?.bloc;
				const lotId = row?.lot;
				// Get lot name if lotId exists
				if (lotId) {
					try {
						// Try niveau_2 first (most common), then Niveau_2__lot as fallback
						let lotResult;
						try {
							lotResult = await client.query('SELECT niveau_2 FROM niveau_2 WHERE id_niveau_2 = $1', [lotId]);
							lotNameForEvent = lotResult.rows[0]?.niveau_2 || null;
						} catch (e1) {
							// Fallback to Niveau_2__lot if niveau_2 doesn't exist
							try {
								lotResult = await client.query('SELECT "Niveau_2__lot" FROM niveau_2 WHERE id_niveau_2 = $1', [lotId]);
								lotNameForEvent = lotResult.rows[0]?.Niveau_2__lot || null;
							} catch (e2) {
								console.error('❌ Both column names failed in Article.js:', e1.message, e2.message);
							}
						}
						console.log('🔍 Fetched lot name for deletion event (Article.js):', { lotId, lotNameForEvent });
					} catch (lotError) {
						console.error('❌ Failed to fetch lot name for event:', lotError.message, lotError);
					}
				} else {
					console.log('⚠️ lotId is null or undefined in Article.js, cannot fetch lot name');
				}
			}

			// Delete article from project
			const result = await client.query(
				'DELETE FROM projet_article WHERE projet = $1 AND article = $2 RETURNING id',
				[projectId, articleId]
			);

			// Recalculate gbloc prix_total if this article belonged to a gbloc
			if (result.rows.length > 0 && gblocId) {
				await Gbloc.recalculatePrixTotal(gblocId, projectId, client);
			}

			// Create event and notifications
			if (result.rows.length > 0 && userId && articleName) {
				try {
					await EventNotificationService.articleDeleted(projectId, articleId, userId, articleName, blocIdForEvent || null, gblocId || null, lotNameForEvent);
				} catch (eventError) {
					console.error('Failed to create article deletion event:', eventError);
				}
			}

			// Recompute project's selling price after deletion (inside transaction)
			// This ensures prix_vente is updated based on ALL remaining projet_article rows
			try {
				await Project.recalculatePrixVente(projectId, client);
				console.log(`✅ Recalculated prix_vente after removing article from project (articleId: ${articleId}, projectId: ${projectId})`);
			} catch (recalcError) {
				console.error('❌ Failed to recalculate prix_vente after removing article from project:', recalcError);
				// Don't throw - the article was removed successfully
			}

			await client.query('COMMIT');
			return result.rows.length > 0;
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally {
			client.release();
		}
	}

	static async searchNormalizedDistinct(column, searchTerm = '', filters = {}) {
		const client = await pool.connect();
		try {
			const params = [];
			const whereClauses = ['1=1'];

			if (searchTerm && searchTerm.trim() !== '') {
				params.push(`%${searchTerm.trim()}%`);
				whereClauses.push(`unaccent(TRIM(LOWER(na."${column}"))) LIKE unaccent(TRIM(LOWER($${params.length})))`);
			}

			for (const [filterColumn, filterValue] of Object.entries(filters)) {
				if (!filterValue || filterValue.toString().trim() === '') continue;
				params.push(filterValue.toString().trim());
				whereClauses.push(`unaccent(TRIM(LOWER(na."${filterColumn}"))) = unaccent(TRIM(LOWER($${params.length})))`);
			}

			const normalizedSubquery = NiveauService.buildNormalizedArticlesSubquery('na');

			const query = `
				SELECT DISTINCT na."${column}" AS value
				FROM ${normalizedSubquery}
				WHERE ${whereClauses.join(' AND ')}
				ORDER BY na."${column}"
			`;

			const result = await client.query(query, params);
			const values = result.rows.map(row => row.value).filter(Boolean);

			// Additional deduplication: remove duplicates by normalizing and comparing
			// This ensures that even if database returns duplicates (e.g., due to case/whitespace differences),
			// we only return unique values
			const seen = new Set();
			const uniqueValues = [];
			for (const value of values) {
				// Normalize the value for comparison (lowercase, trim, remove accents)
				const normalized = value
					.toString()
					.toLowerCase()
					.normalize('NFD')
					.replace(/[\u0300-\u036f]/g, '')
					.trim();

				if (!seen.has(normalized)) {
					seen.add(normalized);
					uniqueValues.push(value);
				}
			}

			return uniqueValues;
		} finally {
			client.release();
		}
	}
}

module.exports = Article;