const cron     = require('node-cron');
const { exec } = require('child_process');
const nodemailer = require('nodemailer');
const fs       = require('fs');
const path     = require('path');

// ── Envoyer le backup par email ───────────────────────────
async function sendBackupEmail(filePath, fileName) {
  if (!process.env.BACKUP_EMAIL || !process.env.SMTP_PASSWORD) {
    console.log('⚠️ Backup email non configuré (BACKUP_EMAIL ou SMTP_PASSWORD manquant)');
    return;
  }

  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER || process.env.BACKUP_EMAIL,
      pass: process.env.SMTP_PASSWORD,
    },
  });

  try {
    await transporter.sendMail({
      from:    `LoyalWallet Backup <${process.env.SMTP_USER || process.env.BACKUP_EMAIL}>`,
      to:      process.env.BACKUP_EMAIL,
      subject: `🗄️ LoyalWallet Backup — ${new Date().toLocaleDateString('fr-FR')}`,
      text:    `Backup automatique de la base de données LoyalWallet.\nFichier : ${fileName}\nDate : ${new Date().toLocaleString('fr-FR')}`,
      attachments: [{
        filename: fileName,
        path: filePath,
      }],
    });
    console.log(`✅ Backup envoyé par email à ${process.env.BACKUP_EMAIL}`);
  } catch (err) {
    console.error('❌ Backup email error:', err.message);
  }
}

// ── Créer le backup pg_dump ───────────────────────────────
async function createBackup() {
  console.log('🗄️ Starting database backup...');

  const fileName = `loyalwallet_backup_${new Date().toISOString().split('T')[0]}.sql`;
  const filePath = path.join('/tmp', fileName);
  const dbUrl    = process.env.DATABASE_URL;

  if (!dbUrl) {
    console.error('❌ DATABASE_URL not set');
    return;
  }

  return new Promise((resolve) => {
    exec(`pg_dump "${dbUrl}" > "${filePath}"`, async (err) => {
      if (err) {
        console.error('❌ pg_dump error:', err.message);
        resolve(false);
        return;
      }

      const stats = fs.statSync(filePath);
      const sizeMb = (stats.size / 1024 / 1024).toFixed(2);
      console.log(`✅ Backup créé : ${fileName} (${sizeMb} MB)`);

      // Envoyer par email
      await sendBackupEmail(filePath, fileName);

      // Supprimer le fichier temporaire
      fs.unlinkSync(filePath);
      resolve(true);
    });
  });
}

// ── Démarrer le cron backup ───────────────────────────────
function startBackupCron() {
  // Tous les lundis à 3h du matin (UTC)
  cron.schedule('0 3 * * 1', () => {
    createBackup();
  });

  console.log('✅ Backup cron démarré (tous les lundis à 3h)');
}

module.exports = { startBackupCron, createBackup };
