const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const { supabase } = require('../utils/supabase');
const fs = require('fs');
const path = require('path');
const pool = require('../../config/db');
const multer = require('multer');
const { buildNormalizedArticlesSubquery } = require('../services/NiveauService');
const LOT_NAME_FIELD = 'COALESCE(lot_niv2.niveau_2, pl.id_lot::text) AS lot_name';
const LOT_NIV2_JOIN = 'INNER JOIN structure s ON s.id_structure = pa.structure INNER JOIN ouvrage o ON o.id = s.ouvrage INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot LEFT JOIN niveau_2 lot_niv2 ON pl.id_lot = lot_niv2.id_niveau_2';
// Prefer ExcelJS in production to preserve styles/images
let ExcelJS;
try { ExcelJS = require('exceljs'); } catch {}

// Memory storage for small Excel uploads (≤10MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

// Debug endpoint to check client table structure
router.get('/debug-client-table', authMiddleware, async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      // Check if client table exists
      const tableExists = await client.query(`SELECT to_regclass('public.client') AS t`);
      
      if (!tableExists.rows[0]?.t) {
        return res.json({ success: false, message: 'Client table does not exist' });
      }

      // Get table structure
      const structure = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = 'client' 
        ORDER BY ordinal_position
      `);

      // Get sample data
      const sampleData = await client.query('SELECT * FROM client LIMIT 3');

      res.json({
        success: true,
        tableExists: true,
        structure: structure.rows,
        sampleData: sampleData.rows
      });
    } finally {
      client.release();
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Create a signed upload URL for direct browser upload to Supabase Storage
router.post('/signed-url', authMiddleware, async (req, res) => {
  try {
    const { filename, contentType, prefix } = req.body || {};
    
    console.log('Upload request received:', { filename, contentType, prefix, user: req.user?.id });
    
    if (!filename) {
      return res.status(400).json({ success: false, message: 'filename is required' });
    }
    
    if (!supabase) {
      console.error('Supabase not initialized. Check environment variables:');
      console.error('SUPABASE_URL:', process.env.SUPABASE_URL ? 'Set' : 'Missing');
      console.error('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Set' : 'Missing');
      return res.status(500).json({ 
        success: false, 
        message: 'Supabase is not initialized on server. Check environment variables.' 
      });
    }

    const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    // Allow only whitelisted prefixes to avoid arbitrary paths
    const allowedPrefixes = ['pending-articles', 'articles', 'project-files'];
    const defaultPrefix = (req.user && req.user.is_admin) ? 'articles' : 'pending-articles';
    const chosenPrefix = allowedPrefixes.includes(String(prefix)) ? String(prefix) : defaultPrefix;
    const path = `${chosenPrefix}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;

    console.log('Creating signed URL for path:', path);

    const { data, error } = await supabase.storage
      .from('upload')
      .createSignedUploadUrl(path);

    if (error) {
      console.error('Supabase storage error:', error);
      return res.status(500).json({ 
        success: false, 
        message: `Storage error: ${error.message}`,
        details: error
      });
    }

    const { signedUrl, token } = data || {};
    const { data: pub } = supabase.storage.from('upload').getPublicUrl(path);

    console.log('Signed URL created successfully');

    return res.json({
      success: true,
      data: {
        signedUrl,
        token,
        path,
        publicUrl: pub?.publicUrl || null,
        contentType: contentType || 'application/octet-stream',
      }
    });
  } catch (err) {
    console.error('Upload route error:', err);
    return res.status(500).json({ 
      success: false, 
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

/**
 * Get sheet names from Excel file (without processing data)
 */
router.post('/import-excel/sheets', authMiddleware, upload.single('excelFile'), async (req, res) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ success: false, message: 'excelFile is required' });
  }
  if (!ExcelJS) {
    return res.status(500).json({ success: false, message: 'ExcelJS not available on server' });
  }

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const sheetNames = workbook.worksheets.map(ws => ws.name);
    return res.json({ success: true, data: { sheetNames, fileName: req.file.originalname } });
  } catch (error) {
    console.error('Error reading Excel sheets:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Import Excel file into project hierarchy (ouvrages → blocs → lots → articles)
 * Form-data: excelFile (.xlsx/.xls), projectId (number), selectedSheets (JSON array of sheet names)
 * First row is header; supports columns (case-insensitive):
 * designation, article, ouvrage, bloc, lot, unite, quantite, prix_unitaire, tva, localisation, description
 * Creates missing lot/ouvrage/bloc by name and inserts projet_article rows with article=NULL.
 * Processes all selected sheets (or first sheet if none selected).
 */
router.post('/import-excel', authMiddleware, upload.single('excelFile'), async (req, res) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ success: false, message: 'excelFile is required' });
  }
  const projectId = parseInt(req.body?.projectId, 10);
  if (!projectId || Number.isNaN(projectId)) {
    return res.status(400).json({ success: false, message: 'projectId is required' });
  }
  if (!ExcelJS) {
    return res.status(500).json({ success: false, message: 'ExcelJS not available on server' });
  }

  const DesignationHelper = require('../utils/designationHelper');
  const { ensureLotId } = require('../utils/lotHelper');

  const normalizeKey = (key) => (key || '').toString().trim().toLowerCase();
  const colMap = {
    designation: ['designation', 'désignation', 'designation_article'],
    article: ['article', 'nom_article'],
    ouvrage: ['ouvrage', 'gbloc', 'g_bloc', 'grand bloc'],
    bloc: ['bloc'],
    // ✅ FIX: Lot is not mapped from columns - it comes from the sheet name
    // lot: ['lot', 'niveau2', 'niveau 2', 'niv2'], // REMOVED - sheet name = lot
    unite: ['unite', 'unité', 'unit'],
    quantite: ['quantite', 'quantité', 'qty', 'qte'],
    prix_unitaire: ['prix_unitaire', 'pu', 'price', 'unit_price'],
    tva: ['tva', 'vat'],
    localisation: ['localisation', 'location'],
    description: ['description', 'desc'],
  };
  const resolveCol = (headerRow) => {
    const mapping = {};
    headerRow.forEach((cell, idx) => {
      const key = normalizeKey(cell);
      for (const target in colMap) {
        if (colMap[target].includes(key)) mapping[target] = idx;
      }
    });
    return mapping;
  };

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(req.file.buffer);
  
  // Get selected sheets from body, or default to first sheet
  let selectedSheets = [];
  try {
    if (req.body.selectedSheets) {
      selectedSheets = JSON.parse(req.body.selectedSheets);
    }
  } catch (e) {
    // If parsing fails, use first sheet
  }
  
  if (!Array.isArray(selectedSheets) || selectedSheets.length === 0) {
    // Default to first sheet if no selection
    selectedSheets = workbook.worksheets.length > 0 ? [workbook.worksheets[0].name] : [];
  }

  const client = await pool.connect();
  const results = { inserted: 0, errors: 0, messages: [], sheetsProcessed: [] };
  
  try {
    await client.query('BEGIN');

    // Process each selected sheet
    for (const sheetName of selectedSheets) {
      const sheet = workbook.getWorksheet(sheetName);
      if (!sheet) {
        results.messages.push(`Sheet "${sheetName}" not found`);
        continue;
      }

      const rows = sheet.getSheetValues().slice(1); // drop ExcelJS leading empty
      if (!rows.length) {
        results.messages.push(`Sheet "${sheetName}" is empty`);
        continue;
      }

      const headerRow = rows.find((r) => Array.isArray(r));
      if (!headerRow) {
        results.messages.push(`Sheet "${sheetName}": Header row not found`);
        continue;
      }
      
      // Get custom mappings from body if provided, otherwise auto-detect
      let mapping = {};
      try {
        if (req.body.columnMappings) {
          const allMappings = JSON.parse(req.body.columnMappings);
          if (allMappings[sheetName]) {
            mapping = allMappings[sheetName];
            // Convert column names/indices to numeric indices if needed
            const normalizedMapping = {};
            Object.entries(mapping).forEach(([field, colIdx]) => {
              if (typeof colIdx === 'number') {
                normalizedMapping[field] = colIdx;
              } else if (typeof colIdx === 'string') {
                // Try to find column index by name
                const idx = headerRow.findIndex(cell => 
                  String(cell).toLowerCase().trim() === colIdx.toLowerCase().trim()
                );
                if (idx >= 0) normalizedMapping[field] = idx;
              }
            });
            mapping = normalizedMapping;
          }
        }
      } catch (e) {
        // If parsing fails, fall back to auto-detect
      }
      
      // Auto-detect if no custom mapping provided
      if (Object.keys(mapping).length === 0) {
        mapping = resolveCol(headerRow);
      }
      
      const requiredKeys = ['designation', 'article', 'ouvrage', 'bloc'];
      const missing = requiredKeys.filter((k) => mapping[k] === undefined);
      if (missing.length) {
        results.messages.push(`Sheet "${sheetName}": Missing required columns: ${missing.join(', ')}`);
        continue;
      }

      const dataRows = rows.slice(rows.indexOf(headerRow) + 1).filter((r) => Array.isArray(r));
      let sheetInserted = 0;
      let sheetErrors = 0;

      // ✅ FIX: Use sheet name as lot name (sheets represent lots in Excel)
      // The lot is not mapped from columns - it comes from the sheet name
      const lotLabel = sheetName ? String(sheetName).trim() : null;
      const lotId = lotLabel ? await ensureLotId(client, lotLabel) : null;

      // ✅ FIX: Create organized hierarchy rows (lot, ouvrage, bloc) before inserting articles
      // Track which hierarchy rows we've already created in this sheet to avoid duplicates
      const hierarchyCreated = new Set();

      // Create lot placeholder row once per sheet (if lot exists)
      if (lotId && !hierarchyCreated.has(`lot-${lotId}`)) {
        const lotCheck = await client.query(
          'SELECT id FROM projet_article WHERE projet = $1 AND lot = $2 AND ouvrage IS NULL AND bloc IS NULL AND article IS NULL',
          [projectId, lotId]
        );
        if (lotCheck.rows.length === 0) {
          await client.query(
            'INSERT INTO projet_article (projet, lot, ouvrage, bloc, article) VALUES ($1, $2, NULL, NULL, NULL)',
            [projectId, lotId]
          );
        }
        hierarchyCreated.add(`lot-${lotId}`);
      }

      for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const hasData = row.some((c) => c !== null && c !== undefined && String(c).trim() !== '');
      if (!hasData) continue;

      const getVal = (key) => {
        const idx = mapping[key];
        return idx !== undefined ? row[idx] : null;
      };

      const ouvrageName = (getVal('ouvrage') || '').toString().trim();
      if (!ouvrageName) {
        results.errors++; sheetErrors++; results.messages.push(`Sheet "${sheetName}", Row ${i + 2}: missing ouvrage`); continue;
      }
      let ouvrageId;
      const ouvrageRes = await client.query(
        'SELECT id FROM ouvrage WHERE LOWER(nom_ouvrage) = LOWER($1) LIMIT 1',
        [ouvrageName]
      );
      if (ouvrageRes.rows.length) {
        ouvrageId = ouvrageRes.rows[0].id;
      } else {
        const designation = await DesignationHelper.getNextOuvrageDesignation(client, projectId, lotId);
        const ins = await client.query(
          'INSERT INTO ouvrage (nom_ouvrage, prix_total, designation) VALUES ($1, $2, $3) RETURNING id',
          [ouvrageName, 0, designation]
        );
        ouvrageId = ins.rows[0].id;
      }

      const blocName = (getVal('bloc') || '').toString().trim();
      if (!blocName) {
        results.errors++; sheetErrors++; results.messages.push(`Sheet "${sheetName}", Row ${i + 2}: missing bloc`); continue;
      }
      let blocId;
      const blocRes = await client.query(
        'SELECT id FROM bloc WHERE LOWER(nom_bloc) = LOWER($1) LIMIT 1',
        [blocName]
      );
      if (blocRes.rows.length) {
        blocId = blocRes.rows[0].id;
      } else {
        const ins = await client.query(
          'INSERT INTO bloc (nom_bloc, designation) VALUES ($1, $2) RETURNING id',
          [blocName, null]
        );
        blocId = ins.rows[0].id;
      }

      // ✅ Create placeholder rows for organized hierarchy (only once per unique ouvrage/bloc combination)
      const ouvrageKey = `ouvrage-${lotId}-${ouvrageId}`;
      const blocKey = `bloc-${lotId}-${ouvrageId}-${blocId}`;

      // 2. Create ouvrage placeholder row (lot=value, ouvrage=value, bloc=NULL, article=NULL)
      if (lotId && ouvrageId && !hierarchyCreated.has(ouvrageKey)) {
        const ouvrageCheck = await client.query(
          'SELECT id FROM projet_article WHERE projet = $1 AND lot = $2 AND ouvrage = $3 AND bloc IS NULL AND article IS NULL',
          [projectId, lotId, ouvrageId]
        );
        if (ouvrageCheck.rows.length === 0) {
          await client.query(
            'INSERT INTO projet_article (projet, lot, ouvrage, bloc, article) VALUES ($1, $2, $3, NULL, NULL)',
            [projectId, lotId, ouvrageId]
          );
        }
        hierarchyCreated.add(ouvrageKey);
      }

      // 3. Create bloc placeholder row (lot=value, ouvrage=value, bloc=value, article=NULL)
      if (lotId && ouvrageId && blocId && !hierarchyCreated.has(blocKey)) {
        const blocCheck = await client.query(
          'SELECT id FROM projet_article WHERE projet = $1 AND lot = $2 AND ouvrage = $3 AND bloc = $4 AND article IS NULL',
          [projectId, lotId, ouvrageId, blocId]
        );
        if (blocCheck.rows.length === 0) {
          await client.query(
            'INSERT INTO projet_article (projet, lot, ouvrage, bloc, article) VALUES ($1, $2, $3, $4, NULL)',
            [projectId, lotId, ouvrageId, blocId]
          );
        }
        hierarchyCreated.add(blocKey);
      }

      const designationArticle = (getVal('designation') || '').toString().trim() || null;
      const nomArticle = (getVal('article') || '').toString().trim() || null;
      const unite = (getVal('unite') || '').toString().trim() || null;
      const quantite = Number(getVal('quantite') || 0) || 0;
      const pu = Number(getVal('prix_unitaire') || 0) || 0;
      const tva = Number(getVal('tva') || 0) || 0;
      const localisation = (getVal('localisation') || '').toString().trim() || null;
      const description = (getVal('description') || '').toString().trim() || null;
      const prix_total_ht = pu * quantite;
      const total_ttc = prix_total_ht * (1 + tva / 100);

      // Optional columns presence check
      const optionalMap = {
        nom_article: nomArticle,
        unite: unite,
        prix_unitaire: pu,
      };
      const optionalCols = [];
      const optionalVals = [];
      for (const col of Object.keys(optionalMap)) {
        const check = await client.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = 'projet_article' AND column_name = $1 LIMIT 1`,
          [col]
        );
        if (check.rows.length) {
          optionalCols.push(col);
          optionalVals.push(optionalMap[col]);
        }
      }

      const baseCols = ['projet', 'lot', 'ouvrage', 'bloc', 'article', 'quantite', 'prix_total_ht', 'tva', 'total_ttc', 'localisation', 'description', 'designation_article'];
      const baseVals = [projectId, lotId, ouvrageId, blocId, null, quantite, prix_total_ht, tva, total_ttc, localisation, description, designationArticle];
      const finalCols = baseCols.concat(optionalCols);
      const finalVals = baseVals.concat(optionalVals);
      const placeholders = finalVals.map((_, idx) => `$${idx + 1}`);

      await client.query(
        `INSERT INTO projet_article (${finalCols.join(',')}) VALUES (${placeholders.join(',')})`,
        finalVals
      );

      results.inserted++;
      sheetInserted++;
      } // End of dataRows loop

      results.sheetsProcessed.push({ name: sheetName, inserted: sheetInserted, errors: sheetErrors });
    } // End of selectedSheets loop

    await client.query('COMMIT');
    return res.json({ success: true, data: results });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Import Excel error:', error);
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
});

// ✅ NEW: Get DPGF3 data as JSON (for Excel editor)
// Returns the same data structure as DPGF3 export but as JSON
router.get('/dpgf3-data/:projectId', authMiddleware, async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId, 10);
    if (isNaN(projectId)) {
      return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    const client = await pool.connect();
    try {
      // Use the same query logic as DPGF3 export (using constants defined at top of file)
      const { rows: entries } = await client.query(
        `SELECT pa.id, pa.quantite, pa.prix_total_ht,
                pa.article AS article_id,
                pa.designation_article,
                pl.designation_lot,
                a."Niveau_6__detail_article" AS nom_article,
                a."Unite" AS unite,
                ${LOT_NAME_FIELD},
                b.nom_bloc AS bloc_name,
                b.designation AS bloc_designation,
                s.ouvrage AS gbloc_id,
                o.nom_ouvrage AS gbloc_name,
                o.designation AS gbloc_designation
         FROM projet_article pa
         ${LOT_NIV2_JOIN}
         LEFT JOIN ${buildNormalizedArticlesSubquery('a')} ON a."ID" = pa.article
         LEFT JOIN bloc b ON b.id = s.bloc
         LEFT JOIN ouvrage o ON o.id = s.ouvrage
         WHERE pl.id_projet = $1 AND pa.article IS NOT NULL
         ORDER BY o.designation NULLS FIRST, pl.designation_lot NULLS FIRST, b.designation NULLS FIRST, pa.designation_article ASC`,
        [projectId]
      );

      const builtRows = entries.map((e, idx) => {
        const quantity = Number(e.quantite || 0);
        const unitPrice = quantity > 0 ? Number(e.prix_total_ht || 0) / quantity : 0;
        return {
          art: e.designation_article || e.article_id || (idx + 1),
          designation: e.nom_article || '',
          unit: e.unite || '',
          quantity,
          unitPrice,
          totalHt: Number(e.prix_total_ht || 0),
          lotName: e.lot_name || '',
          blocName: e.bloc_name || '',
          gblocName: e.gbloc_name || e.gbloc_id || '',
          lotDesignation: e.designation_lot || '',
          blocDesignation: e.bloc_designation || '',
          gblocDesignation: e.gbloc_designation || '',
        };
      });

      return res.json({ success: true, data: builtRows });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error getting DPGF3 data:', err);
    console.error('Error stack:', err.stack);
    return res.status(500).json({ 
      success: false, 
      message: err.message,
      error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// DPGF export using Template 3 (no template, generated from scratch)
// Body: { header?, rows?, projectId?, tvaRatePercent? }
// Columns: N° ART | DESIGNATION DES OUVRAGES | U | QT | PU | TOTAL HT
// Footer: Montant Total HT, TVA, Montant Total TTC
router.post('/export-excel/dpgf3', authMiddleware, async (req, res) => {
  try {
    const {
      header = {},
      rows = [],
      projectId,
      tvaRatePercent = 20,
      useEditorData = false, // ✅ NEW: Allow using modified data from editor
      editorData = null, // ✅ NEW: Raw spreadsheet data from editor
      editorStyles = null, // ✅ NEW: Cell styles from editor
    } = req.body || {};

    // ✅ NEW: If useEditorData is true and editorData is provided, export the modified data directly
    if (useEditorData && editorData && Array.isArray(editorData) && editorData.length > 0) {
      return await exportEditorDataToExcel(res, editorData, header, tvaRatePercent, editorStyles);
    }

    // Otherwise, rebuild rows from DB when projectId is provided to ensure correct hierarchy (gbloc → lot → bloc → articles)
    let builtRows = [];
    if (projectId) {
      try {
        const client = await pool.connect();
        try {
        const { rows: entries } = await client.query(
            `SELECT pa.id, pa.quantite, pa.prix_total_ht,
                    pa.article AS article_id,
                    pa.designation_article,
                    pl.designation_lot,
                    a."Niveau_6__detail_article" AS nom_article,
                    a."Unite" AS unite,
                    ${LOT_NAME_FIELD},
                    b.nom_bloc AS bloc_name,
                    b.designation AS bloc_designation,
                    s.ouvrage AS gbloc_id,
                    o.nom_ouvrage AS gbloc_name,
                    o.designation AS gbloc_designation
             FROM projet_article pa
             ${LOT_NIV2_JOIN}
            LEFT JOIN ${buildNormalizedArticlesSubquery('a')} ON a."ID" = pa.article
             LEFT JOIN bloc b ON b.id = s.bloc
             LEFT JOIN ouvrage o ON o.id = s.ouvrage
             WHERE pl.id_projet = $1 AND pa.article IS NOT NULL
             ORDER BY o.designation NULLS FIRST, pl.designation_lot NULLS FIRST, b.designation NULLS FIRST, pa.designation_article ASC`,
            [projectId]
          );
          builtRows = entries.map((e, idx) => {
            const quantity = Number(e.quantite || 0);
            const unitPrice = quantity > 0 ? Number(e.prix_total_ht || 0) / quantity : 0;
            return {
              art: e.designation_article || e.article_id || (idx + 1),
              designation: e.nom_article || '',
              unit: e.unite || '',
              quantity,
              unitPrice,
              totalHt: Number(e.prix_total_ht || 0),
              lotName: e.lot_name || '',
              blocName: e.bloc_name || '',
              gblocName: e.gbloc_name || e.gbloc_id || '',
              lotDesignation: e.designation_lot || '',
              blocDesignation: e.bloc_designation || '',
              gblocDesignation: e.gbloc_designation || '',
            };
          });
        } finally { client.release(); }
      } catch {}
    }

    // Compute totals
    let montantTotalHt = 0;
    for (const r of builtRows) {
      const q = Number(r.quantity || 0);
      const pu = Number(r.unitPrice || 0);
      const tht = r.totalHt != null ? Number(r.totalHt) : Number((q * pu).toFixed(2));
      montantTotalHt += isFinite(tht) ? tht : 0;
    }
    const tvaRate = Number(tvaRatePercent || 0);
    const tvaAmount = Number((montantTotalHt * (tvaRate / 100)).toFixed(2));
    const montantTtc = Number((montantTotalHt + tvaAmount).toFixed(2));

    // Prefer ExcelJS for richer formatting; otherwise fall back to xlsx
    if (ExcelJS) {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('DPGF');

      // Header row (titles)
      const headerRow = [
        'N° ART',
        'DESIGNATION DES OUVRAGES',
        'U',
        'QT',
        'PU',
        'TOTAL HT'
      ];
      ws.addRow(headerRow);
      const hdr = ws.getRow(1);
      hdr.font = { bold: true };
      hdr.alignment = { vertical: 'middle', horizontal: 'center' };

      // Optional document header (project name, address) above table
      const docTitle = (header && (header.projectName || header.title)) ? String(header.projectName || header.title) : '';
      if (docTitle) {
        ws.spliceRows(1, 0, []);
        ws.mergeCells('A1:F1');
        ws.getCell('A1').value = docTitle;
        ws.getCell('A1').font = { bold: true, size: 14 };
        ws.getCell('A1').alignment = { horizontal: 'center' };
      }

      // Data rows with hierarchical headers in column B (gbloc -> lot -> bloc)
      const startRowIdx = docTitle ? 3 : 2; // table header at row 2 when doc title exists
      if (docTitle) {
        // Re-apply header bold since we shifted
        const tableHeaderRow = ws.getRow(2);
        tableHeaderRow.font = { bold: true };
        tableHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };
      }

      let lastG = null;
      let lastLot = null;
      let lastBloc = null;
      builtRows.forEach((r) => {
        const q = Number(r.quantity || 0);
        const pu = Number(r.unitPrice || 0);
        const tht = r.totalHt != null ? Number(r.totalHt) : Number((q * pu).toFixed(2));

        // GBloc header (designation in N° ART column, name in designation column)
        if (r.gblocName && r.gblocName !== lastG) {
          const gNumber = r.gblocDesignation || '';
          const gLabel = r.gblocName;
          const hdr = [ gNumber, gLabel, '', '', '', '' ];
          ws.addRow(hdr);
          const rr = ws.lastRow.number;
          ws.getCell(`A${rr}`).font = { bold: true };
          ws.getCell(`B${rr}`).font = { bold: true };
          lastG = r.gblocName;
          lastLot = null;
          lastBloc = null;
        }
        // Lot header (designation in N° ART column, name in designation column)
        if (r.lotName && r.lotName !== lastLot) {
          const lotNumber = r.lotDesignation || '';
          const lotLabel = r.lotName;
          const hdr = [ lotNumber, lotLabel, '', '', '', '' ];
          ws.addRow(hdr);
          const rr = ws.lastRow.number;
          ws.getCell(`A${rr}`).font = { bold: true };
          ws.getCell(`B${rr}`).font = { bold: true };
          lastLot = r.lotName;
          lastBloc = null;
        }
        // Bloc header (designation in N° ART column, name in designation column)
        if (r.blocName && r.blocName !== lastBloc) {
          const blocNumber = r.blocDesignation || '';
          const blocLabel = r.blocName;
          const hdr = [ blocNumber, blocLabel, '', '', '', '' ];
          ws.addRow(hdr);
          const rr = ws.lastRow.number;
          ws.getCell(`A${rr}`).font = { italic: true };
          ws.getCell(`B${rr}`).font = { italic: true };
          lastBloc = r.blocName;
        }

        // Article row (A: article id only, B: article designation)
        ws.addRow([
          r.art ?? '',
          r.designation ?? '',
          r.unit ?? '',
          q || '',
          pu || '',
          tht || '',
        ]);
      });

      // Column widths
      ws.getColumn(1).width = 12; // N° ART
      ws.getColumn(2).width = 50; // DESIGNATION
      ws.getColumn(3).width = 8;  // U
      ws.getColumn(4).width = 10; // QT
      ws.getColumn(5).width = 12; // PU
      ws.getColumn(6).width = 14; // TOTAL HT

      // Numeric formatting for PU and TOTAL HT
      const numericStartRow = docTitle ? 3 : 2; // first table row (header row is at 2 when doc title exists)
      const lastWrittenRow = ws.lastRow ? ws.lastRow.number : numericStartRow;
      for (let r = numericStartRow + 1; r <= lastWrittenRow; r += 1) {
        ws.getCell(`E${r}`).numFmt = '0.00';
        ws.getCell(`F${r}`).numFmt = '0.00';
      }

      // Footer totals
      const footerStart = (ws.lastRow ? ws.lastRow.number : numericStartRow) + 2;
      ws.getCell(`E${footerStart}`).value = 'Montant Total HT';
      ws.getCell(`F${footerStart}`).value = montantTotalHt;
      ws.getCell(`F${footerStart}`).numFmt = '0.00';

      ws.getCell(`E${footerStart + 1}`).value = `TVA (${tvaRate}%)`;
      ws.getCell(`F${footerStart + 1}`).value = tvaAmount;
      ws.getCell(`F${footerStart + 1}`).numFmt = '0.00';

      ws.getCell(`E${footerStart + 2}`).value = 'Montant Total TTC';
      ws.getCell(`F${footerStart + 2}`).value = montantTtc;
      ws.getCell(`F${footerStart + 2}`).numFmt = '0.00';

      // Bold footer labels
      ws.getCell(`E${footerStart}`).font = { bold: true };
      ws.getCell(`E${footerStart + 1}`).font = { bold: true };
      ws.getCell(`E${footerStart + 2}`).font = { bold: true };

      const out = await wb.xlsx.writeBuffer();
      const base = (projectId && !Number.isNaN(Number(projectId))) ? `projet_${Number(projectId)}` : 'projet';
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${base}_dpgf3.xlsx"`);
      return res.status(200).send(Buffer.from(out));
    }

    // Fallback: ExcelJS basic export
    const wb2 = new ExcelJS.Workbook();
    const ws2 = wb2.addWorksheet('DPGF');
    // Add data to worksheet
    let currentRow = 1;
    
    // Optional title row
    const docTitle2 = (header && (header.projectName || header.title)) ? String(header.projectName || header.title) : '';
    if (docTitle2) {
      ws2.getCell(`A${currentRow}`).value = docTitle2;
      currentRow++;
    }
    
    // Header row
    ws2.getCell(`A${currentRow}`).value = 'N° ART';
    ws2.getCell(`B${currentRow}`).value = 'DESIGNATION DES OUVRAGES';
    ws2.getCell(`C${currentRow}`).value = 'U';
    ws2.getCell(`D${currentRow}`).value = 'QT';
    ws2.getCell(`E${currentRow}`).value = 'PU';
    ws2.getCell(`F${currentRow}`).value = 'TOTAL HT';
    currentRow++;
    
    // Data rows with hierarchical headers in column B
    let lastGX = null;
    let lastLotX = null;
    let lastBlocX = null;
    builtRows.forEach((r) => {
      const q = Number(r.quantity || 0);
      const pu = Number(r.unitPrice || 0);
      const tht = r.totalHt != null ? Number(r.totalHt) : Number((q * pu).toFixed(2));
      if (r.gblocName && r.gblocName !== lastGX) {
        ws2.getCell(`A${currentRow}`).value = r.gblocDesignation || '';
        ws2.getCell(`B${currentRow}`).value = String(r.gblocName);
        currentRow++;
        lastGX = r.gblocName;
        lastLotX = null;
        lastBlocX = null;
      }
      if (r.lotName && r.lotName !== lastLotX) {
        ws2.getCell(`A${currentRow}`).value = r.lotDesignation || '';
        ws2.getCell(`B${currentRow}`).value = String(r.lotName);
        currentRow++;
        lastLotX = r.lotName;
        lastBlocX = null;
      }
      if (r.blocName && r.blocName !== lastBlocX) {
        ws2.getCell(`A${currentRow}`).value = r.blocDesignation || '';
        ws2.getCell(`B${currentRow}`).value = String(r.blocName);
        currentRow++;
        lastBlocX = r.blocName;
      }
      ws2.getCell(`A${currentRow}`).value = r.art ?? '';
      ws2.getCell(`B${currentRow}`).value = r.designation ?? '';
      ws2.getCell(`C${currentRow}`).value = r.unit ?? '';
      ws2.getCell(`D${currentRow}`).value = q || '';
      ws2.getCell(`E${currentRow}`).value = pu || '';
      ws2.getCell(`F${currentRow}`).value = tht || '';
      currentRow++;
    });
    
    // Totals footer
    ws2.getCell(`E${currentRow}`).value = 'Montant Total HT';
    ws2.getCell(`F${currentRow}`).value = montantTotalHt;
    currentRow++;
    ws2.getCell(`E${currentRow}`).value = `TVA (${tvaRate}%)`;
    ws2.getCell(`F${currentRow}`).value = tvaAmount;
    currentRow++;
    ws2.getCell(`E${currentRow}`).value = 'Montant Total TTC';
    ws2.getCell(`F${currentRow}`).value = montantTtc;
    
    const out2 = await wb2.xlsx.writeBuffer();
    const base2 = (projectId && !Number.isNaN(Number(projectId))) ? `projet_${Number(projectId)}` : 'projet';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${base2}_dpgf3.xlsx"`);
    return res.status(200).send(Buffer.from(out2));
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

// Excel export from template
router.post('/export-excel', authMiddleware, async (req, res) => {
  try {
    const { templateName, values } = req.body || {};
    if (!templateName) {
      return res.status(400).json({ success: false, message: 'templateName is required' });
    }

    const safeTemplate = String(templateName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const templatePath = path.join(__dirname, '..', 'templates', safeTemplate);

    // Check file existence asynchronously
    try {
      await fs.promises.access(templatePath);
    } catch {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    const tplBuf = await fs.promises.readFile(templatePath);

    // If ExcelJS is available, load and write using it to preserve template styling
    if (ExcelJS) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(tplBuf);
      if (values && typeof values === 'object') {
        Object.entries(values).forEach(([sheetName, cellMap]) => {
          const sheet = wb.getWorksheet(sheetName) || wb.worksheets[0];
          if (!sheet || typeof cellMap !== 'object') return;
          Object.entries(cellMap).forEach(([cellAddress, cellValue]) => {
            sheet.getCell(String(cellAddress)).value = cellValue;
          });
        });
      }
      const outBuffer = await wb.xlsx.writeBuffer();
      const downloadName = `export-${Date.now()}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
      return res.status(200).send(Buffer.from(outBuffer));
    }

    // Fallback to ExcelJS basic read/write
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(tplBuf);

    if (values && typeof values === 'object') {
      Object.entries(values).forEach(([sheetName, cellMap]) => {
        const worksheet = workbook.getWorksheet(sheetName);
        if (!worksheet || typeof cellMap !== 'object') return;
        Object.entries(cellMap).forEach(([cellAddress, cellValue]) => {
          const cell = worksheet.getCell(cellAddress);
          cell.value = cellValue;
        });
      });
    }

    const outBuffer = await workbook.xlsx.writeBuffer();
    const downloadName = `export-${Date.now()}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    return res.status(200).send(Buffer.from(outBuffer));
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Flexible Excel template editing/export using ExcelJS with styling and images
// Body: { templateName, sheetName?, operations: Array<EditOp>, downloadName? }
// Supported operations (examples):
// { type: 'setCell', address: 'B5', value: 'Text or number or date' }
// { type: 'setStyles', address: 'B5', style: { font: { bold: true }, alignment: { horizontal: 'center' }, numFmt: '0.00', fill: { type:'pattern', pattern:'solid', fgColor:{argb:'FFFFE599'} }, border: { top:{style:'thin'} } } }
// { type: 'merge', range: 'B5:F5' }
// { type: 'setColumnWidth', col: 2, width: 35 }
// { type: 'setRowHeight', row: 5, height: 22 }
// { type: 'insertRows', row: 15, count: 3 }
// { type: 'insertColumns', col: 3, count: 1 }
// { type: 'removeRows', row: 20, count: 2 }
// { type: 'removeColumns', col: 4, count: 1 }
// { type: 'addImage', base64: 'data:image/png;base64,...', range: 'F1:F3' }
// { type: 'tableRow', startRow: 13, map: { A: 'id', B: 'name', C: 'u', D: 'q', E: 'pu', F: 'pt' }, rows: [...] }
router.post('/export-excel/custom', authMiddleware, async (req, res) => {
  try {
    const { templateName, sheetName, operations = [], downloadName } = req.body || {};
    if (!templateName) {
      return res.status(400).json({ success: false, message: 'templateName is required' });
    }
    if (!ExcelJS) {
      return res.status(500).json({ success: false, message: 'ExcelJS is required for styled export' });
    }

    const safeTemplate = String(templateName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const templatePath = path.join(__dirname, '..', 'templates', safeTemplate);
    
    // Check file existence asynchronously
    try {
      await fs.promises.access(templatePath);
    } catch {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }
    
    const tplBuf = await fs.promises.readFile(templatePath);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tplBuf);
    let ws = sheetName ? (wb.getWorksheet(sheetName) || null) : null;
    if (!ws) ws = wb.worksheets[0];
    if (!ws) return res.status(500).json({ success: false, message: 'Worksheet not found' });

    function setStyles(cell, style) {
      if (!style || typeof style !== 'object') return;
      if (style.font) cell.font = style.font;
      if (style.alignment) cell.alignment = style.alignment;
      if (style.border) cell.border = style.border;
      if (style.fill) cell.fill = style.fill;
      if (style.numFmt) cell.numFmt = style.numFmt;
    }

    // Preload images map to avoid repeated parsing
    for (const op of operations) {
      const t = op && op.type;
      if (t === 'setCell') {
        const cell = ws.getCell(String(op.address));
        cell.value = op.value;
        if (op.style) setStyles(cell, op.style);
      } else if (t === 'setStyles') {
        const cell = ws.getCell(String(op.address));
        setStyles(cell, op.style);
      } else if (t === 'merge') {
        try { ws.mergeCells(String(op.range)); } catch {}
      } else if (t === 'setColumnWidth') {
        const col = Number(op.col);
        if (col > 0 && op.width) ws.getColumn(col).width = Number(op.width);
      } else if (t === 'setRowHeight') {
        const row = Number(op.row);
        if (row > 0 && op.height) ws.getRow(row).height = Number(op.height);
      } else if (t === 'insertRows') {
        ws.spliceRows(Number(op.row) || 1, 0, ...Array(Number(op.count) || 1).fill([]));
      } else if (t === 'insertColumns') {
        ws.spliceColumns(Number(op.col) || 1, 0, ...Array(Number(op.count) || 1).fill([]));
      } else if (t === 'removeRows') {
        ws.spliceRows(Number(op.row) || 1, Number(op.count) || 1);
      } else if (t === 'removeColumns') {
        ws.spliceColumns(Number(op.col) || 1, Number(op.count) || 1);
      } else if (t === 'addImage') {
        try {
          const base64 = String(op.base64 || '');
          const imgId = wb.addImage({ base64, extension: (base64.startsWith('data:image/png') ? 'png' : 'jpeg') });
          if (op.range && typeof op.range === 'string') {
            ws.addImage(imgId, op.range);
          } else if (op.tl && op.ext) {
            ws.addImage(imgId, { tl: op.tl, ext: op.ext, editAs: op.editAs || 'oneCell' });
          }
        } catch {}
      } else if (t === 'tableRow') {
        const startRow = Number(op.startRow) || 1;
        const map = op.map || {};
        const data = Array.isArray(op.rows) ? op.rows : [];
        let r = startRow;
        for (const rowObj of data) {
          for (const [colLetter, key] of Object.entries(map)) {
            const cell = ws.getCell(`${String(colLetter).toUpperCase()}${r}`);
            cell.value = rowObj[key];
          }
          r += 1;
        }
      }
    }

    const out = await wb.xlsx.writeBuffer();
    const name = String(downloadName || templateName.replace(/\.xlsx$/i, '') + '-edited.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    return res.status(200).send(Buffer.from(out));
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

function inferCellType(value) {
  if (value == null) return 's';
  if (typeof value === 'number') return 'n';
  if (typeof value === 'boolean') return 'b';
  if (value instanceof Date) return 'd';
  return 's';
}

/**
 * ✅ NEW: Export editor data directly to Excel
 * This allows users to modify data in the editor and export their changes
 * @param {Object} res - Express response object
 * @param {Array} editorData - 2D array of cell values
 * @param {Object} header - Header information (projectName, etc.)
 * @param {Number} tvaRatePercent - TVA rate percentage
 * @param {Object} editorStyles - Object mapping cell keys (row-col) to style objects
 */
async function exportEditorDataToExcel(res, editorData, header = {}, tvaRatePercent = 20, editorStyles = null) {
  if (!ExcelJS) {
    return res.status(500).json({ success: false, message: 'ExcelJS not available' });
  }

  // Debug: Log received styles
  if (editorStyles) {
    console.log('Received editorStyles:', {
      type: typeof editorStyles,
      isObject: typeof editorStyles === 'object',
      keysCount: Object.keys(editorStyles || {}).length,
      sampleKeys: Object.keys(editorStyles || {}).slice(0, 5)
    });
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DPGF');

  // Find the header row (typically row with 'LOT', 'BLOC', etc. or 'N° ART', 'DESIGNATION')
  let headerRowIndex = -1;
  for (let i = 0; i < editorData.length; i++) {
    const row = editorData[i];
    if (Array.isArray(row)) {
      const firstCell = String(row[0] || '').toUpperCase().trim();
      if (firstCell === 'LOT' || firstCell === 'N° ART' || firstCell === 'ART' || firstCell === 'ARTICLE') {
        headerRowIndex = i;
        break;
      }
    }
  }

  // Add document title if provided
  const docTitle = (header && (header.projectName || header.title)) ? String(header.projectName || header.title) : '';
  if (docTitle) {
    ws.mergeCells('A1:F1');
    ws.getCell('A1').value = docTitle;
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.getCell('A1').alignment = { horizontal: 'center' };
  }

  // Write all rows from editor data
  let startRow = docTitle ? 2 : 1;
  let totalHT = 0;
  let actualExcelRow = startRow; // Track actual row number in Excel (accounting for title)

  for (let i = 0; i < editorData.length; i++) {
    const row = editorData[i];
    if (!Array.isArray(row)) continue;

    // Skip empty rows at the beginning (before header)
    if (i < headerRowIndex && row.every(cell => !cell || String(cell).trim() === '')) {
      continue;
    }

    // Add row to worksheet
    const excelRow = ws.addRow(row.map(cell => {
      // Try to convert numeric strings to numbers
      if (cell === null || cell === undefined || cell === '') return '';
      const strVal = String(cell).trim();
      // Check if it's a number (including decimals)
      const numVal = parseFloat(strVal.replace(/\s/g, '').replace(',', '.'));
      if (!isNaN(numVal) && /^[\d\s,.\-]+$/.test(strVal.replace('€', '').trim())) {
        return numVal;
      }
      return cell;
    }));

    // ✅ NEW: Apply custom styles from editor if provided
    // Use original row index (i) to match the key format from editor: `${row}-${col}`
    if (editorStyles && typeof editorStyles === 'object' && Object.keys(editorStyles).length > 0) {
      let hasCustomStylesForRow = false;
      // Apply styles to all cells in the row (even if cell value is empty)
      const maxCols = Math.max(row.length, 6); // Ensure we check at least 6 columns (DPGF3 format)
      for (let colIndex = 0; colIndex < maxCols; colIndex++) {
        const cellKey = `${i}-${colIndex}`;
        const style = editorStyles[cellKey];
        if (style) {
          hasCustomStylesForRow = true;
          const excelCell = excelRow.getCell(colIndex + 1);
          
          // Apply background color
          if (style.backgroundColor) {
            // Convert hex to ARGB (remove # if present, add FF prefix for opacity)
            let hex = String(style.backgroundColor).replace('#', '').trim();
            if (hex.length === 6) {
              excelCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF' + hex.toUpperCase() }
              };
            } else if (hex.length === 3) {
              // Handle 3-digit hex (e.g., #FFF)
              const expanded = hex.split('').map(c => c + c).join('');
              excelCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF' + expanded.toUpperCase() }
              };
            } else if (hex.length === 8) {
              // Handle ARGB format (already has alpha)
              excelCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: hex.toUpperCase() }
              };
            }
          }
          
          // Apply text color
          if (style.color) {
            let hex = String(style.color).replace('#', '').trim();
            if (hex.length === 6) {
              excelCell.font = {
                ...(excelCell.font || {}),
                color: { argb: 'FF' + hex.toUpperCase() }
              };
            } else if (hex.length === 3) {
              // Handle 3-digit hex
              const expanded = hex.split('').map(c => c + c).join('');
              excelCell.font = {
                ...(excelCell.font || {}),
                color: { argb: 'FF' + expanded.toUpperCase() }
              };
            } else if (hex.length === 8) {
              // Handle ARGB format
              excelCell.font = {
                ...(excelCell.font || {}),
                color: { argb: hex.toUpperCase() }
              };
            }
          }
          
          // Apply font weight
          if (style.fontWeight === 'bold') {
            excelCell.font = {
              ...(excelCell.font || {}),
              bold: true
            };
          }
          
          // Apply text alignment
          if (style.textAlign) {
            excelCell.alignment = {
              ...(excelCell.alignment || {}),
              horizontal: style.textAlign
            };
          }
        }
      }
      
      // Don't apply default header styling if custom styles are present
      if (hasCustomStylesForRow && i === headerRowIndex) {
        // Custom styles override default header styling
      }
    } else {
      // Style header row (bold) - only if no custom styles provided
      if (i === headerRowIndex) {
        excelRow.font = { bold: true };
        excelRow.alignment = { vertical: 'middle', horizontal: 'center' };
        excelRow.eachCell(cell => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF1E293B' }
          };
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        });
      }
    }

    // Accumulate totals from data rows (assuming last column or second-to-last is TOTAL HT)
    if (i > headerRowIndex && row.length > 5) {
      // Try to find a numeric value that looks like a total
      // Usually PRIX TOTAL HT is around column 7-8 (index 6-7) or last numeric column
      for (let colIdx = row.length - 1; colIdx >= Math.max(0, row.length - 4); colIdx--) {
        const cellVal = row[colIdx];
        if (cellVal !== null && cellVal !== undefined && cellVal !== '') {
          const numVal = parseFloat(String(cellVal).replace(/\s/g, '').replace(',', '.').replace('€', ''));
          if (!isNaN(numVal) && numVal > 0) {
            totalHT += numVal;
            break;
          }
        }
      }
    }
  }

  // Set column widths
  ws.getColumn(1).width = 12;
  ws.getColumn(2).width = 15;
  ws.getColumn(3).width = 40;
  ws.getColumn(4).width = 30;
  ws.getColumn(5).width = 10;
  ws.getColumn(6).width = 12;
  ws.getColumn(7).width = 14;
  ws.getColumn(8).width = 14;
  ws.getColumn(9).width = 10;
  ws.getColumn(10).width = 14;
  ws.getColumn(11).width = 20;
  ws.getColumn(12).width = 12;

  // Add footer totals
  const tvaRate = Number(tvaRatePercent || 0);
  const tvaAmount = Number((totalHT * (tvaRate / 100)).toFixed(2));
  const totalTTC = Number((totalHT + tvaAmount).toFixed(2));

  const footerStart = (ws.lastRow ? ws.lastRow.number : 1) + 2;
  
  // Determine which column to put totals (based on header row structure)
  let totalLabelCol = 'E';
  let totalValueCol = 'F';
  if (headerRowIndex >= 0 && editorData[headerRowIndex]) {
    const headerLen = editorData[headerRowIndex].length;
    if (headerLen > 8) {
      totalLabelCol = String.fromCharCode(65 + headerLen - 3); // 2 cols before last
      totalValueCol = String.fromCharCode(65 + headerLen - 2); // 1 col before last
    }
  }

  ws.getCell(`${totalLabelCol}${footerStart}`).value = 'Montant Total HT';
  ws.getCell(`${totalValueCol}${footerStart}`).value = totalHT;
  ws.getCell(`${totalValueCol}${footerStart}`).numFmt = '0.00';
  ws.getCell(`${totalLabelCol}${footerStart}`).font = { bold: true };

  ws.getCell(`${totalLabelCol}${footerStart + 1}`).value = `TVA (${tvaRate}%)`;
  ws.getCell(`${totalValueCol}${footerStart + 1}`).value = tvaAmount;
  ws.getCell(`${totalValueCol}${footerStart + 1}`).numFmt = '0.00';
  ws.getCell(`${totalLabelCol}${footerStart + 1}`).font = { bold: true };

  ws.getCell(`${totalLabelCol}${footerStart + 2}`).value = 'Montant Total TTC';
  ws.getCell(`${totalValueCol}${footerStart + 2}`).value = totalTTC;
  ws.getCell(`${totalValueCol}${footerStart + 2}`).numFmt = '0.00';
  ws.getCell(`${totalLabelCol}${footerStart + 2}`).font = { bold: true };

  // Generate and send the file
  const out = await wb.xlsx.writeBuffer();
  const filename = header.projectName ? `projet_${header.projectName}_modified.xlsx` : 'projet_modified.xlsx';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^a-zA-Z0-9_.-]/g, '_')}"`);
  return res.status(200).send(Buffer.from(out));
}


