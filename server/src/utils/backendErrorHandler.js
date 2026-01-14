// Backend error handling utilities
const pool = require('../../config/db');

/**
 * ✅ CRITICAL FIX: Enhanced error handling for backend operations
 */
class BackendErrorHandler {
  /**
   * Handle database errors with user-friendly messages
   */
  static handleDatabaseError(error, operation) {
    console.error(`❌ Database error in ${operation}:`, error);

    // PostgreSQL error codes
    const errorHandlers = {
      '23505': () => this.handleUniqueViolation(error),
      '23503': () => this.handleForeignKeyViolation(error),
      '23502': () => this.handleNotNullViolation(error),
      '23514': () => this.handleCheckViolation(error),
      '42P01': () => this.handleUndefinedTable(error),
      '42501': () => this.handleInsufficientPrivilege(error),
      '40P01': () => this.handleDeadlockDetected(error),
      '57014': () => this.handleQueryCanceled(error),
      '53200': () => this.handleOutOfMemory(error),
      '08003': () => this.handleConnectionDoesNotExist(error),
      '08006': () => this.handleConnectionFailure(error),
      '08001': () => this.handleSqlclientUnableToEstablishSqlconnection(error),
      '08004': () => this.handleSqlserverRejectedEstablishmentOfSqlconnection(error),
      '40001': () => this.handleSerializationFailure(error),
      '08007': () => this.handleTransactionResolutionUnknown(error),
      '2D000': () => this.handleInvalidTransactionTermination(error)
    };

    const handler = errorHandlers[error.code];
    if (handler) {
      return handler();
    }

    // Default error message
    return {
      message: 'Une erreur de base de données s\'est produite',
      details: error.message,
      code: error.code,
      operation
    };
  }

  static handleUniqueViolation(error) {
    const constraint = error.constraint;
    const detail = error.detail || '';

    if (constraint?.includes('nom_bloc')) {
      return {
        message: 'Un bloc avec ce nom existe déjà dans cet ouvrage',
        details: detail,
        code: 'UNIQUE_BLOC_NAME'
      };
    }

    if (constraint?.includes('nom_ouvrage')) {
      return {
        message: 'Un ouvrage avec ce nom existe déjà dans ce projet',
        details: detail,
        code: 'UNIQUE_GBLOC_NAME'
      };
    }

    if (constraint?.includes('designation')) {
      return {
        message: 'Cette désignation est déjà utilisée',
        details: detail,
        code: 'UNIQUE_DESIGNATION'
      };
    }

    if (constraint?.includes('projet_article')) {
      return {
        message: 'Cette combinaison existe déjà dans le projet',
        details: detail,
        code: 'UNIQUE_PROJECT_ARTICLE'
      };
    }

    return {
      message: 'Cette valeur existe déjà',
      details: detail,
      code: 'UNIQUE_VIOLATION'
    };
  }

  static handleForeignKeyViolation(error) {
    const constraint = error.constraint;
    const detail = error.detail || '';

    if (constraint?.includes('projet')) {
      return {
        message: 'Le projet spécifié n\'existe pas',
        details: detail,
        code: 'INVALID_PROJECT'
      };
    }

    if (constraint?.includes('lot')) {
      return {
        message: 'Le lot spécifié n\'existe pas',
        details: detail,
        code: 'INVALID_LOT'
      };
    }

    if (constraint?.includes('ouvrage')) {
      return {
        message: 'L\'ouvrage spécifié n\'existe pas',
        details: detail,
        code: 'INVALID_GBLOC'
      };
    }

    if (constraint?.includes('bloc')) {
      return {
        message: 'Le bloc spécifié n\'existe pas',
        details: detail,
        code: 'INVALID_BLOC'
      };
    }

    if (constraint?.includes('article')) {
      return {
        message: 'L\'article spécifié n\'existe pas',
        details: detail,
        code: 'INVALID_ARTICLE'
      };
    }

    return {
      message: 'Référence invalide',
      details: detail,
      code: 'FOREIGN_KEY_VIOLATION'
    };
  }

  static handleNotNullViolation(error) {
    const column = error.column;
    return {
      message: `Le champ ${column} est obligatoire`,
      details: error.detail,
      code: 'NOT_NULL_VIOLATION',
      column
    };
  }

  static handleCheckViolation(error) {
    const constraint = error.constraint;
    return {
      message: 'La valeur fournie ne respecte pas les contraintes',
      details: error.detail,
      code: 'CHECK_VIOLATION',
      constraint
    };
  }

  static handleUndefinedTable(error) {
    return {
      message: 'Table de base de données introuvable',
      details: error.message,
      code: 'UNDEFINED_TABLE'
    };
  }

  static handleInsufficientPrivilege(error) {
    return {
      message: 'Permissions insuffisantes pour cette opération',
      details: error.message,
      code: 'INSUFFICIENT_PRIVILEGE'
    };
  }

  static handleDeadlockDetected(error) {
    return {
      message: 'Conflit de verrouillage détecté - veuillez réessayer',
      details: error.detail,
      code: 'DEADLOCK_DETECTED'
    };
  }

  static handleQueryCanceled(error) {
    return {
      message: 'Requête annulée - délai dépassé',
      details: error.message,
      code: 'QUERY_CANCELED'
    };
  }

  static handleOutOfMemory(error) {
    return {
      message: 'Mémoire insuffisante pour cette opération',
      details: error.message,
      code: 'OUT_OF_MEMORY'
    };
  }

  static handleConnectionDoesNotExist(error) {
    return {
      message: 'Connexion à la base de données perdue',
      details: error.message,
      code: 'CONNECTION_DOES_NOT_EXIST'
    };
  }

  static handleConnectionFailure(error) {
    return {
      message: 'Échec de connexion à la base de données',
      details: error.message,
      code: 'CONNECTION_FAILURE'
    };
  }

  static handleSqlclientUnableToEstablishSqlconnection(error) {
    return {
      message: 'Impossible d\'établir la connexion SQL',
      details: error.message,
      code: 'SQLCLIENT_CONNECTION_ERROR'
    };
  }

  static handleSqlserverRejectedEstablishmentOfSqlconnection(error) {
    return {
      message: 'Connexion SQL rejetée par le serveur',
      details: error.message,
      code: 'SQLSERVER_CONNECTION_REJECTED'
    };
  }

  static handleSerializationFailure(error) {
    return {
      message: 'Conflit de sérialisation - veuillez réessayer',
      details: error.detail,
      code: 'SERIALIZATION_FAILURE'
    };
  }

  static handleTransactionResolutionUnknown(error) {
    return {
      message: 'État de transaction inconnu - veuillez réessayer',
      details: error.message,
      code: 'TRANSACTION_RESOLUTION_UNKNOWN'
    };
  }

  static handleInvalidTransactionTermination(error) {
    return {
      message: 'Terminaison de transaction invalide',
      details: error.message,
      code: 'INVALID_TRANSACTION_TERMINATION'
    };
  }

  /**
   * Handle validation errors
   */
  static handleValidationError(errors, operation) {
    console.error(`❌ Validation error in ${operation}:`, errors);

    const formattedErrors = errors.map(error => ({
      field: error.field || error.path,
      message: error.message,
      code: error.code || 'VALIDATION_ERROR'
    }));

    return {
      message: 'Erreur de validation des données',
      details: formattedErrors,
      code: 'VALIDATION_ERROR',
      operation
    };
  }

  /**
   * Handle business logic errors
   */
  static handleBusinessLogicError(error, operation) {
    console.error(`❌ Business logic error in ${operation}:`, error);

    // Common business logic errors
    const businessErrors = {
      'DUPLICATE_NAME': 'Ce nom existe déjà',
      'DUPLICATE_DESIGNATION': 'Cette désignation est déjà utilisée',
      'INVALID_HIERARCHY': 'Structure hiérarchique invalide',
      'CIRCULAR_REFERENCE': 'Référence circulaire détectée',
      'INVALID_STATE': 'État invalide pour cette opération',
      'OPERATION_NOT_ALLOWED': 'Cette opération n\'est pas autorisée',
      'RESOURCE_NOT_FOUND': 'Ressource introuvable',
      'ACCESS_DENIED': 'Accès refusé',
      'CONCURRENT_MODIFICATION': 'Modification concurrente détectée'
    };

    const errorCode = error.code || error.type;
    const message = businessErrors[errorCode] || error.message || 'Erreur métier';

    return {
      message,
      details: error.details || error.message,
      code: errorCode || 'BUSINESS_LOGIC_ERROR',
      operation
    };
  }

  /**
   * Handle transaction errors
   */
  static handleTransactionError(error, operation) {
    console.error(`❌ Transaction error in ${operation}:`, error);

    return {
      message: 'Erreur de transaction - veuillez réessayer',
      details: error.message,
      code: 'TRANSACTION_ERROR',
      operation
    };
  }

  /**
   * Handle timeout errors
   */
  static handleTimeoutError(error, operation) {
    console.error(`❌ Timeout error in ${operation}:`, error);

    return {
      message: 'Délai d\'attente dépassé - veuillez réessayer',
      details: error.message,
      code: 'TIMEOUT_ERROR',
      operation
    };
  }

  /**
   * Handle network errors
   */
  static handleNetworkError(error, operation) {
    console.error(`❌ Network error in ${operation}:`, error);

    return {
      message: 'Erreur de connexion - vérifiez votre connexion internet',
      details: error.message,
      code: 'NETWORK_ERROR',
      operation
    };
  }

  /**
   * Handle rate limiting errors
   */
  static handleRateLimitError(error, operation) {
    console.error(`❌ Rate limit error in ${operation}:`, error);

    return {
      message: 'Trop de requêtes - veuillez attendre avant de réessayer',
      details: error.message,
      code: 'RATE_LIMIT_ERROR',
      operation
    };
  }

  /**
   * Generic error handler
   */
  static handleError(error, operation = 'unknown') {
    console.error(`❌ Error in ${operation}:`, error);

    // Check if it's a known error type
    if (error.code) {
      return this.handleDatabaseError(error, operation);
    }

    if (error.name === 'ValidationError') {
      return this.handleValidationError(error.errors || [error], operation);
    }

    if (error.name === 'BusinessLogicError' || error.type === 'business') {
      return this.handleBusinessLogicError(error, operation);
    }

    if (error.name === 'TransactionError') {
      return this.handleTransactionError(error, operation);
    }

    if (error.name === 'TimeoutError' || error.code === 'ETIMEDOUT') {
      return this.handleTimeoutError(error, operation);
    }

    if (error.name === 'NetworkError' || error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return this.handleNetworkError(error, operation);
    }

    if (error.status === 429 || error.code === 'RATE_LIMIT') {
      return this.handleRateLimitError(error, operation);
    }

    // Default error message
    return {
      message: 'Une erreur inattendue s\'est produite',
      details: error.message || error.toString(),
      code: 'UNKNOWN_ERROR',
      operation
    };
  }

  /**
   * Log error to database for monitoring
   */
  static async logErrorToDatabase(error, context = {}) {
    try {
      const errorData = {
        message: error.message || error.toString(),
        stack: error.stack,
        code: error.code,
        context: JSON.stringify(context),
        timestamp: new Date().toISOString(),
        severity: this.getErrorSeverity(error)
      };

      await pool.query(
        'INSERT INTO error_logs (message, stack_trace, error_code, context, timestamp, severity) VALUES ($1, $2, $3, $4, $5, $6)',
        [errorData.message, errorData.stack, errorData.code, errorData.context, errorData.timestamp, errorData.severity]
      );
    } catch (loggingError) {
      console.error('Failed to log error to database:', loggingError);
    }
  }

  static getErrorSeverity(error) {
    const criticalErrors = ['DEADLOCK_DETECTED', 'OUT_OF_MEMORY', 'CONNECTION_FAILURE', 'SERIALIZATION_FAILURE'];
    const warningErrors = ['UNIQUE_VIOLATION', 'FOREIGN_KEY_VIOLATION', 'VALIDATION_ERROR'];
    
    if (criticalErrors.includes(error.code)) {
      return 'CRITICAL';
    }
    
    if (warningErrors.includes(error.code)) {
      return 'WARNING';
    }
    
    return 'ERROR';
  }

  /**
   * Create standardized error response
   */
  static createErrorResponse(error, operation = 'unknown') {
    const handledError = this.handleError(error, operation);
    
    return {
      success: false,
      error: {
        message: handledError.message,
        code: handledError.code,
        details: handledError.details,
        operation: handledError.operation
      },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Create standardized success response
   */
  static createSuccessResponse(data, message = 'Opération réussie') {
    return {
      success: true,
      data,
      message,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = BackendErrorHandler;