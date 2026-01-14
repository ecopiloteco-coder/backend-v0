const xlsx = require('xlsx');
const { sequelize, Projet, Lot, Ouvrage, Bloc, Article, Structure, ProjetLot, ProjetArticle, Niveau2 } = require('../models');
const { generateUniqueId } = require('../utils/idGenerator');

/**
 * Preview DPGF - Return list of sheets
 * POST /api/projets/preview-dpgf
 */
exports.previewDPGF = async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const workbook = xlsx.read(file.buffer, { type: 'buffer' });
        const sheets = workbook.SheetNames;

        res.status(200).json({
            success: true,
            sheets: sheets
        });
    } catch (error) {
        console.error('Error previewing DPGF:', error);
        res.status(500).json({ success: false, message: 'Error reading file', error: error.message });
    }
};

/**
 * Preview single sheet rows to help user select header/columns
 * POST /api/projets/preview-dpgf-sheet
 */
exports.previewDPGFSheetStructure = async (req, res) => {
    try {
        const file = req.file;
        const sheetName = req.body.sheetName;

        if (!file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }
        if (!sheetName) {
            return res.status(400).json({ success: false, message: 'No sheet name provided' });
        }

        const workbook = xlsx.read(file.buffer, { type: 'buffer' });
        if (!workbook.Sheets[sheetName]) {
            return res.status(400).json({ success: false, message: 'Sheet not found' });
        }

        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
        const maxRows = Math.min(data.length, 40);
        const rows = data.slice(0, maxRows).map(row => (row || []).map(cell => (cell === undefined || cell === null) ? '' : String(cell)));

        return res.status(200).json({
            success: true,
            rows
        });
    } catch (error) {
        console.error('Error previewing DPGF sheet structure:', error);
        res.status(500).json({ success: false, message: 'Error reading sheet', error: error.message });
    }
};

/**
 * Parse DPGF and return Hierarchy (Lots > Ouvrages > Articles)
 * POST /api/projets/parse-dpgf
 */
exports.parseDPGF = async (req, res) => {
    try {
        const file = req.file;
        const selectedSheets = req.body.selectedSheets ? JSON.parse(req.body.selectedSheets) : [];
        const headerRowParam = req.body.headerRow ? parseInt(req.body.headerRow, 10) : null;
        const colDesignationParam = req.body.colDesignation ? parseInt(req.body.colDesignation, 10) : null;
        const colTypeParam = req.body.colType ? parseInt(req.body.colType, 10) : null;
        const colUniteParam = req.body.colUnite ? parseInt(req.body.colUnite, 10) : null;
        const colQteParam = req.body.colQte ? parseInt(req.body.colQte, 10) : null;
        const colPuParam = req.body.colPu ? parseInt(req.body.colPu, 10) : null;
        const colPrixTotalParam = req.body.colPrixTotal ? parseInt(req.body.colPrixTotal, 10) : null;

        if (!file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const workbook = xlsx.read(file.buffer, { type: 'buffer' });
        const parsedData = [];

        for (const sheetName of selectedSheets) {
            if (!workbook.Sheets[sheetName]) continue;

            const worksheet = workbook.Sheets[sheetName];
            const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

            const lotData = {
                name: sheetName,
                ouvrages: []
            };

            let currentOuvrage = null;
            let currentBloc = null; // Should be part of structure, but for parsing we group articles under ouvrages

            let startIndex = 0;
            let headerRowIndex = -1;

            if (headerRowParam && headerRowParam > 0) {
                headerRowIndex = headerRowParam - 1;
                startIndex = headerRowIndex + 1;
            } else {
                const headerKeywords = ['designation', 'ouvrage', 'bloc', 'projet article', 'unité', 'quantité', 'pu', 'poste'];

                for (let r = 0; r < Math.min(data.length, 20); r++) {
                    const row = data[r];
                    if (!row) continue;

                    const rowText = row.map(cell => String(cell).toLowerCase()).join(' ');
                    const keywordMatches = headerKeywords.filter(keyword =>
                        rowText.includes(keyword)
                    ).length;

                    if (keywordMatches >= 3) {
                        headerRowIndex = r;
                        startIndex = r + 1;
                        break;
                    }
                }

                if (headerRowIndex === -1 && data.length > 0) {
                    const firstRow = data[0].map(cell => String(cell).toLowerCase());
                    if (firstRow.some(c => c.includes('designation') || c.includes('poste'))) {
                        startIndex = 1;
                    }
                }
            }

            let indexColumn = 0;
            const indexPattern = /^[0-9]+(\.[0-9]+)+$/;

            if (data.length > 0) {
                const maxRowsToScan = Math.min(data.length, 50);
                const colCount = data
                    .slice(startIndex, maxRowsToScan)
                    .reduce((max, row) => Math.max(max, row ? row.length : 0), 0);

                let bestScore = 0;

                for (let col = 0; col < colCount; col++) {
                    let score = 0;
                    for (let r = startIndex; r < maxRowsToScan; r++) {
                        const row = data[r];
                        if (!row) continue;
                        const value = row[col] ? String(row[col]).trim() : '';
                        if (indexPattern.test(value)) {
                            score++;
                        }
                    }
                    if (score > bestScore) {
                        bestScore = score;
                        indexColumn = col;
                    }
                }
            }

            const designationColIndex = colDesignationParam && colDesignationParam > 0 ? colDesignationParam - 1 : 1;
            const typeColIndex = colTypeParam && colTypeParam > 0 ? colTypeParam - 1 : null;
            const uniteColIndex = colUniteParam && colUniteParam > 0 ? colUniteParam - 1 : 2;
            const qteColIndex = colQteParam && colQteParam > 0 ? colQteParam - 1 : 3;
            const puColIndex = colPuParam && colPuParam > 0 ? colPuParam - 1 : 4;
            const prixTotalColIndex = colPrixTotalParam && colPrixTotalParam > 0 ? colPrixTotalParam - 1 : null;

            for (let i = startIndex; i < data.length; i++) {
                const row = data[i];
                if (!row || row.length === 0) continue;

                const col0 = row[0] ? String(row[0]).trim() : ''; // Poste (fallback)
                const col1 = row[designationColIndex] ? String(row[designationColIndex]).trim() : '';
                const colType = typeColIndex !== null && row[typeColIndex] !== undefined ? String(row[typeColIndex]).trim() : '';
                const col2 = row[uniteColIndex] ? String(row[uniteColIndex]).trim() : '';
                const col3 = row[qteColIndex];
                const col4 = row[puColIndex];
                const colTotal = prixTotalColIndex !== null && row[prixTotalColIndex] !== undefined ? row[prixTotalColIndex] : null;

                const indexValue = row[indexColumn] ? String(row[indexColumn]).trim() : col0;

                if (!indexValue && !col1) continue;

                const isOuvrage = (indexValue.match(/^[0-9]+(\.[0-9]+)?$/)) && !col3 && !col4;
                const isArticle = (col3 || col4) || (indexValue.match(/^[0-9]+\.[0-9]+\.[0-9]+$/));

                if (isOuvrage) {
                    currentOuvrage = {
                        name: col1 || 'Ouvrage ' + col0,
                        designation: col1,
                        excelType: colType || '',
                        unite: col2 || '',
                        qte: col3 !== undefined && col3 !== null && col3 !== '' ? parseFloat(col3) || 0 : null,
                        pu: col4 !== undefined && col4 !== null && col4 !== '' ? parseFloat(col4) || 0 : null,
                        prixTotal: colTotal !== null && colTotal !== '' ? (parseFloat(colTotal) || 0) : null,
                        articles: []
                    };
                    lotData.ouvrages.push(currentOuvrage);
                } else if (isArticle) {
                    if (!currentOuvrage) {
                        currentOuvrage = {
                            name: 'Ouvrage Général',
                            designation: 'Ouvrage Général',
                            articles: []
                        };
                        lotData.ouvrages.push(currentOuvrage);
                    }

                    currentOuvrage.articles.push({
                        index: indexValue,
                        designation: col1 || '',
                        excelType: colType,
                        unite: col2 || 'u',
                        qte: parseFloat(col3) || 0,
                        pu: parseFloat(col4) || 0,
                        prixTotal: colTotal !== null ? parseFloat(colTotal) || 0 : 0
                    });
                }
            }

            // Only add lot if it has content
            if (lotData.ouvrages.length > 0) {
                parsedData.push(lotData);
            }
        }

        res.status(200).json({
            success: true,
            data: parsedData
        });

    } catch (error) {
        console.error('Error parsing DPGF:', error);
        res.status(500).json({ success: false, message: 'Error parsing DPGF', error: error.message });
    }
};

/**
 * Import Parsed DPGF Data
 * POST /api/projets/:id/import-dpgf-data
 */
exports.importDPGFData = async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const { id } = req.params;
        const { data } = req.body; // Hierarchy obtained from parse step, optionally with lotId per lot

        if (!data || !Array.isArray(data)) {
            await transaction.rollback();
            return res.status(400).json({ success: false, message: 'Invalid data format' });
        }

        const project = await Projet.findByPk(id);
        if (!project) {
            await transaction.rollback();
            return res.status(404).json({ success: false, message: 'Project not found' });
        }

        let processedCount = 0;

        for (const lotItem of data) {
            // LOT Creation
            let niveau2;

            // If frontend provided explicit lotId (standard lot), use it directly
            if (lotItem.lotId) {
                niveau2 = { id_niveau_2: lotItem.lotId };
            } else {
                // Fallback to previous behavior: match or create by name
                niveau2 = await sequelize.query(
                    "SELECT id_niveau_2 FROM niveau_2 WHERE niveau_2 = :name LIMIT 1",
                    { replacements: { name: lotItem.name }, type: sequelize.QueryTypes.SELECT, transaction }
                ).then(r => r[0]);

                if (!niveau2) {
                    const [nextN2] = await sequelize.query("SELECT COALESCE(MAX(id_niveau_2), 0) + 1 as next_id FROM niveau_2", { transaction });
                    const n2Id = nextN2[0].next_id;
                    await sequelize.query(
                        "INSERT INTO niveau_2 (id_niveau_2, niveau_2, id_niveau_1) VALUES (:id, :name, 1)",
                        { replacements: { id: n2Id, name: lotItem.name }, transaction }
                    );
                    niveau2 = { id_niveau_2: n2Id };
                }
            }

            const [nextLotId] = await sequelize.query("SELECT COALESCE(MAX(id_projet_lot), 0) + 1 as next_id FROM projet_lot", { transaction });
            const lotId = nextLotId[0].next_id;

            await ProjetLot.create({
                id_projet_lot: lotId,
                id_projet: id,
                id_lot: niveau2.id_niveau_2,
                prix_total: 0,
                prix_vente: 0,
                etat: 'En cours'
            }, { transaction });

            const currentLot = { id: lotId };

            for (const ouvrageItem of lotItem.ouvrages) {
                // Remove check for 'selected' here if frontend sends only selected items
                // Assuming frontend filters data before sending

                // OUVRAGE Creation
                const [nextOuvrageId] = await sequelize.query("SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM ouvrage", { transaction });
                const ouvrageId = nextOuvrageId[0].next_id;

                const currentOuvrage = await Ouvrage.create({
                    id: ouvrageId,
                    nom_ouvrage: ouvrageItem.name,
                    designation: ouvrageItem.designation,
                    projet_lot: currentLot.id,
                    unite: 'Ens'
                }, { transaction });

                // BLOC Creation (One per Ouvrage for structure)
                const nextBlocId = await generateUniqueId(transaction);
                const currentBloc = await Bloc.create({
                    id: nextBlocId,
                    nom_bloc: 'Postes',
                    designation: 'Postes',
                    ouvrage: currentOuvrage.id,
                }, { transaction });

                const [nextStructId] = await sequelize.query("SELECT COALESCE(MAX(id_structure), 0) + 1 as next_id FROM structure", { transaction });
                await Structure.create({
                    id_structure: nextStructId[0].next_id,
                    ouvrage: currentOuvrage.id,
                    bloc: currentBloc.id,
                    action: 'bloc'
                }, { transaction });

                // ARTICLES Creation
                for (const articleItem of ouvrageItem.articles) {
                    const [nextArtId] = await sequelize.query("SELECT COALESCE(MAX(\"ID\"), 0) + 1 as next_id FROM articles", { transaction });

                    const articleLib = await Article.create({
                        ID: nextArtId[0].next_id,
                        nom_article: articleItem.designation,
                        Unite: articleItem.unite,
                        Prix_estime: articleItem.pu,
                        Type: 'Fourniture et Pose'
                    }, { transaction });

                    const [structResult] = await sequelize.query(
                        "SELECT id_structure FROM structure WHERE bloc = :blocId LIMIT 1",
                        { replacements: { blocId: currentBloc.id }, type: sequelize.QueryTypes.SELECT, transaction }
                    );

                    if (structResult) {
                        const parentStructureId = structResult.id_structure;
                        const [nextPaId] = await sequelize.query("SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM projet_article", { transaction });

                        await ProjetArticle.create({
                            id: nextPaId[0].next_id,
                            article: articleLib.ID,
                            structure: parentStructureId,
                            quantite: articleItem.qte,
                            nouv_prix: articleItem.pu,
                            designation_article: articleItem.designation,
                        }, { transaction });

                        processedCount++;
                    }
                }
            }
        }

        await transaction.commit();

        res.status(200).json({
            success: true,
            message: `Importation terminée. ${processedCount} articles importés.`
        });

    } catch (error) {
        await transaction.rollback();
        console.error('Error importing DPGF data:', error);
        res.status(500).json({ success: false, message: 'Error importing data', error: error.message });
    }
};
