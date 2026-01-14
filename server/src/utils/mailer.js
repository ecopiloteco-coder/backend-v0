const nodemailer = require('nodemailer');

const EMAIL_FROM = process.env.EMAIL_FROM || 'Eco-Pilote <ecopiloteno-reply@eco-pilote.com>';
const EMAIL_TRANSPORT_URL = process.env.EMAIL_TRANSPORT_URL;
const EMAIL_HOST = process.env.EMAIL_HOST;
const EMAIL_PORT = parseInt(process.env.EMAIL_PORT || '587', 10);
const EMAIL_SECURE = (process.env.EMAIL_SECURE || 'false').toLowerCase() === 'true';
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

let transporter = null;

if (EMAIL_TRANSPORT_URL) {
  transporter = nodemailer.createTransport(EMAIL_TRANSPORT_URL);
} else if (EMAIL_HOST && EMAIL_USER && EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    secure: EMAIL_SECURE,
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS,
    },
  });
}

if (process.env.NODE_ENV !== 'production') {
  console.log('📦 Nodemailer Config:', {
    hasTransport: !!transporter,
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    secure: EMAIL_SECURE,
    from: EMAIL_FROM,
  });
}

async function sendWithRetry({ to, subject, html }, attempts = 2) {
  if (!transporter) {
    const err = new Error('Email transporter not configured – provide SMTP credentials');
    err.code = 'TRANSPORTER_MISSING';
    throw err;
  }

  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const info = await transporter.sendMail({
        from: EMAIL_FROM,
        to,
        subject,
        html,
      });
      return { messageId: info.messageId || info.messageId };
    } catch (err) {
      lastErr = err;
      const code = err && (err.code || err.responseCode);
      const transient = ['EDNS', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 421, 429, 500, 502, 503].includes(code);
      if (!transient || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 500 + i * 750));
    }
  }
  throw lastErr;
}

/**
 * Send credentials email with login link
 * @param {string} to - Recipient email
 * @param {string} username - User email/username
 * @param {string} password - User password
 * @param {string} loginUrl - Login page URL
 */
const sendCredentialsEmail = async (to, username, password, loginUrl) => {
  try {
    const info = await sendWithRetry({
      to,
      subject: "Vos identifiants de connexion",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <p>Bonjour,</p>
          <p>Voici vos identifiants :</p>
          <ul>
            <li><strong>Email:</strong> ${username}</li>
            <li><strong>Mot de passe:</strong> ${password}</li>
          </ul>
          <p>Vous pouvez vous connecter directement en cliquant sur le bouton ci-dessous :</p>
          <div style="text-align: center; margin: 20px 0;">
            <a href="${loginUrl}" style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
              Se connecter
            </a>
          </div>
          <p>Merci de ne pas partager ces informations.</p>
        </div>
      `,
    });
    console.log("✅ Credentials email sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("❌ Error sending credentials email:", error);
    throw error;
  }
};

/**
 * Send password reset email
 * @param {string} to - Recipient email
 * @param {string} resetUrl - Password reset URL
 */
const sendPasswordResetEmail = async (to, resetUrl) => {
  try {
    const info = await sendWithRetry({
      to,
      subject: 'Réinitialisation de votre mot de passe',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Réinitialisation de votre mot de passe</h2>
          <p>Bonjour,</p>
          <p>Vous avez demandé la réinitialisation de votre mot de passe.</p>
          <p>Cliquez sur le bouton ci-dessous pour créer un nouveau mot de passe :</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
              Réinitialiser mon mot de passe
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">
            Ce lien est valide pendant 1 heure seulement.<br>
            Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.
          </p>
          <p style="color: #666; font-size: 12px;">
            Si le bouton ne fonctionne pas, copiez et collez ce lien dans votre navigateur :<br>
            ${resetUrl}
          </p>
        </div>
      `,
    });
    console.log("✅ Password reset email sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("❌ Error sending password reset email:", error);
    throw error;
  }
};

module.exports = {
  sendCredentialsEmail,
  sendPasswordResetEmail,
  transporter,
};
