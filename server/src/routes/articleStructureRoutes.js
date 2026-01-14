/**
 * Example API endpoint to get articles with structure information
 * This shows how to use the action field to identify article structure
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/db');

/**
 * GET /api/projects/:projectId/articles-with-structure
 * Returns all articles with their structure information (ouvrage/bloc)
 */
router.get('/projects/:projectId/articles-with-structure', async (req, res) => {
    try {
        const { projectId } = req.params;

        const query = `
            SELECT 
                pa.id,
                pa.article,
                pa.quantite,
                pa.prix_total_ht,
                pa.total_ttc,
                pa.designation_article,
                s.id_structure,
                s.action,
                s.ouvrage,
                s.bloc,
                o.nom_ouvrage,
                o.designation as ouvrage_designation,
                b.nom_bloc,
                b.designation as bloc_designation,
                pl.id_lot as lot,
                pl.designation_lot,
                a."Niveau_5__article" as article_name,
                a."Niveau_6__detail_article" as article_detail,
                a."Unite" as unite,
                a."PU" as pu
            FROM projet_article pa
            INNER JOIN structure s ON s.id_structure = pa.structure
            INNER JOIN ouvrage o ON o.id = s.ouvrage
            LEFT JOIN bloc b ON b.id = s.bloc
            LEFT JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
            LEFT JOIN (
                SELECT * FROM articles
                UNION ALL
                SELECT * FROM articles_2
            ) a ON a."ID" = pa.article
            WHERE pl.id_projet = $1
            ORDER BY 
                pl.id_lot NULLS FIRST,
                o.designation,
                s.action DESC,  -- 'ouvrage' before 'bloc'
                b.designation NULLS FIRST
        `;

        const result = await pool.query(query, [projectId]);

        // Transform results to include helpful metadata
        const articles = result.rows.map(row => ({
            ...row,
            // Add helper fields
            is_in_bloc: row.action === 'bloc',
            is_in_ouvrage_only: row.action === 'ouvrage',
            // Full path for breadcrumbs
            path: row.action === 'bloc'
                ? `${row.designation_lot || 'No Lot'} → ${row.nom_ouvrage} → ${row.nom_bloc}`
                : `${row.designation_lot || 'No Lot'} → ${row.nom_ouvrage}`,
            // Structure type label
            structure_type: row.action === 'bloc' ? 'Bloc' : 'Ouvrage'
        }));

        res.json({
            success: true,
            count: articles.length,
            articles
        });

    } catch (error) {
        console.error('Error fetching articles with structure:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/projects/:projectId/articles-by-structure-type
 * Returns articles grouped by structure type (bloc vs ouvrage)
 */
router.get('/projects/:projectId/articles-by-structure-type', async (req, res) => {
    try {
        const { projectId } = req.params;

        const query = `
            SELECT 
                s.action,
                COUNT(*) as article_count,
                SUM(pa.total_ttc) as total_ttc,
                SUM(pa.prix_total_ht) as total_ht,
                json_agg(
                    json_build_object(
                        'id', pa.id,
                        'article', pa.article,
                        'ouvrage', o.nom_ouvrage,
                        'bloc', b.nom_bloc,
                        'total_ttc', pa.total_ttc
                    )
                ) as articles
            FROM projet_article pa
            INNER JOIN structure s ON s.id_structure = pa.structure
            INNER JOIN ouvrage o ON o.id = s.ouvrage
            LEFT JOIN bloc b ON b.id = s.bloc
            LEFT JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
            WHERE pl.id_projet = $1
            GROUP BY s.action
        `;

        const result = await pool.query(query, [projectId]);

        // Transform to object with bloc and ouvrage keys
        const grouped = {
            bloc: result.rows.find(r => r.action === 'bloc') || {
                article_count: 0,
                total_ttc: 0,
                total_ht: 0,
                articles: []
            },
            ouvrage: result.rows.find(r => r.action === 'ouvrage') || {
                article_count: 0,
                total_ttc: 0,
                total_ht: 0,
                articles: []
            }
        };

        res.json({
            success: true,
            summary: {
                total_articles: parseInt(grouped.bloc.article_count) + parseInt(grouped.ouvrage.article_count),
                articles_in_blocs: parseInt(grouped.bloc.article_count),
                articles_in_ouvrages: parseInt(grouped.ouvrage.article_count)
            },
            data: grouped
        });

    } catch (error) {
        console.error('Error fetching articles by structure type:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
