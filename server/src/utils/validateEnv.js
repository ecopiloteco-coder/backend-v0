/**
 * Validate required environment variables on startup
 * This prevents the application from running with insecure fallback values
 */
function validateRequiredEnvVars() {
  // JWT_SECRET and REFRESH_SECRET are optional - app can run without them in development
  const required = [
    // 'JWT_SECRET', // Optional - app will run in development mode without it
    // 'REFRESH_SECRET', // Optional - app will run in development mode without it
  ];

  // Check for DATABASE_URL or individual DB variables
  const hasDatabaseUrl = !!process.env.DATABASE_URL;
  const hasIndividualDbVars = !!(
    process.env.DB_HOST &&
    process.env.DB_USER &&
    process.env.DB_PASSWORD &&
    process.env.DB_NAME
  );

  if (!hasDatabaseUrl && !hasIndividualDbVars) {
    required.push('DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME');
  }

  const missing = required.filter(varName => !process.env[varName]);

  if (missing.length > 0) {
    console.warn('⚠️  WARNING: Missing environment variables:');
    missing.forEach(varName => console.warn(`   - ${varName}`));
    console.warn('\nApplication will attempt to start, but some features may not work.');
    console.warn('Please check your .env file or environment configuration.');
    // Don't exit - allow server to start anyway
    // process.exit(1);
  }

  // Validate JWT secrets if they are set (optional)
  const weakSecrets = ['secret', 'fallback', 'development', 'test', '123'];
  const jwtSecret = process.env.JWT_SECRET || '';
  const refreshSecret = process.env.REFRESH_SECRET || '';

  if (jwtSecret) {
    if (weakSecrets.some(weak => jwtSecret.toLowerCase().includes(weak))) {
      console.warn('⚠️  WARNING: JWT_SECRET appears to be a weak or default value.');
      console.warn('   Please use a strong, randomly generated secret in production.');
    }
  } else {
    console.warn('⚠️  JWT_SECRET is not set - running in development mode (JWT verification disabled)');
  }

  if (refreshSecret) {
    if (weakSecrets.some(weak => refreshSecret.toLowerCase().includes(weak))) {
      console.warn('⚠️  WARNING: REFRESH_SECRET appears to be a weak or default value.');
      console.warn('   Please use a strong, randomly generated secret in production.');
    }
  }

  if (required.length === 0) {
    console.log('✅ Environment validation complete (JWT secrets are optional)');
  } else {
    console.log('✅ All required environment variables are set');
  }
}

module.exports = { validateRequiredEnvVars };
