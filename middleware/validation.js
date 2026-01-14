const { body, validationResult } = require('express-validator');

/**
 * Validation middleware for article creation/update
 */
exports.validateArticle = [
    body('nom_article')
        .notEmpty()
        .withMessage('nom_article (Niveau 7) is required')
        .isString()
        .withMessage('nom_article must be a string'),

    body('id_niv_6')
        .optional()
        .isInt()
        .withMessage('id_niv_6 must be an integer'),

    body('Niveau_1')
        .optional()
        .isString()
        .withMessage('Niveau_1 must be a string'),

    body('Niveau_2')
        .optional()
        .isString()
        .withMessage('Niveau_2 must be a string'),

    body('Niveau_3')
        .optional()
        .isString()
        .withMessage('Niveau_3 must be a string'),

    body('Niveau_4')
        .optional()
        .isString()
        .withMessage('Niveau_4 must be a string'),

    body('Niveau_5')
        .optional()
        .isString()
        .withMessage('Niveau_5 must be a string'),

    body('Niveau_6')
        .optional()
        .isString()
        .withMessage('Niveau_6 must be a string'),

    body('Unite')
        .optional()
        .isString()
        .withMessage('Unite must be a string'),

    body('Type')
        .optional()
        .isString()
        .withMessage('Type must be a string'),

    body('Expertise')
        .optional()
        .isString()
        .withMessage('Expertise must be a string'),

    body('PU')
        .optional()
        .isString()
        .withMessage('PU must be a string'),

    body('User')
        .optional()
        .isInt()
        .withMessage('User must be an integer'),

    body('Indice_de_confiance')
        .optional()
        .isInt({ min: 1, max: 5 })
        .withMessage('Indice_de_confiance must be an integer between 1 and 5'),

    body('fournisseur')
        .optional()
        .isInt()
        .withMessage('fournisseur must be an integer'),

    // Middleware to check validation results and custom logic
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        // Custom validation: Either id_niv_6 OR complete hierarchy must be provided
        const { id_niv_6, Niveau_1, Niveau_2, Niveau_3, Niveau_6 } = req.body;

        if (!id_niv_6 && !(Niveau_1 && Niveau_2 && Niveau_3 && Niveau_6)) {
            return res.status(400).json({
                success: false,
                message: 'Either id_niv_6 OR complete hierarchy (Niveau_1, Niveau_2, Niveau_3, Niveau_6) is required',
                errors: [{
                    msg: 'Either id_niv_6 OR complete hierarchy (Niveau_1, Niveau_2, Niveau_3, Niveau_6) is required',
                    param: 'id_niv_6 / Niveau hierarchy'
                }]
            });
        }

        next();
    }
];

/**
 * Validation middleware for query parameters
 */
exports.validatePagination = [
    body('page')
        .optional()
        .isInt({ min: 1 })
        .withMessage('page must be a positive integer'),

    body('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('limit must be an integer between 1 and 100'),

    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }
        next();
    }
];
