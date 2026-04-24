const cron   = require('node-cron');
const { pool } = require('../db/pool');
const twilio = require('twilio');

function getTwilio() {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return null;
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

async function sendSms(phone, message) {
  const client = getTwilio();
  if (!client) return false;
  try {
    await client.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER,
      to:   phone,
      body: message,
    });
    return true;
  } catch (err) {
    console.error(`❌ Automation SMS error to ${phone}:`, err.message);
    return false;
  }
}

async function wasRecentlyNotified(holderId, type, days = 7) {
  const result = await pool.query(
    `SELECT id FROM automation_logs
     WHERE card_holder_id = $1
     AND type = $2
     AND sent_at > NOW() - INTERVAL '${days} days'
     LIMIT 1`,
    [holderId, type]
  );
  return result.rows.length > 0;
}

async function logNotification(holderId, restaurantId, type, phone, message) {
  await pool.query(
    `INSERT INTO automation_logs (card_holder_id, restaurant_id, type, phone, message)
     VALUES ($1, $2, $3, $4, $5)`,
    [holderId, restaurantId, type, phone, message]
  );
}

// ── Job 1 : Clients inactifs depuis 14 jours ──────────────
async function runInactiveJob() {
  console.log('🤖 Automation: checking inactive clients...');

  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (ch.id)
        ch.id, ch.name, ch.phone, ch.serial_number,
        ch.restaurant_id, ch.card_id,
        lc.card_name, r.automation_inactive_enabled,
        r.automation_inactive_days
      FROM card_holders ch
      JOIN loyalty_cards lc ON ch.card_id = lc.id
      JOIN restaurants r ON ch.restaurant_id = r.id
      WHERE ch.phone IS NOT NULL
      AND r.automation_inactive_enabled = TRUE
      AND ch.id NOT IN (
        SELECT DISTINCT card_holder_id FROM scans
        WHERE created_at > NOW() - INTERVAL '14 days'
      )
      AND ch.created_at < NOW() - INTERVAL '14 days'
    `);

    let sent = 0;

    for (const holder of result.rows) {
      // Vérifier qu'on ne l'a pas déjà notifié dans les 7 derniers jours
      const alreadyNotified = await wasRecentlyNotified(holder.id, 'inactive_14d', 7);
      if (alreadyNotified) continue;

      const prenom = holder.name ? ` ${holder.name}` : '';
      const cardUrl = `${process.env.BASE_URL_FRONTEND}/card/${holder.serial_number}`;
      const message = `Bonjour${prenom}, on ne vous a pas vu depuis 2 semaines chez ${holder.card_name}. Votre carte vous attend : ${cardUrl}`;

      const ok = await sendSms(holder.phone, message);
      if (ok) {
        await logNotification(holder.id, holder.restaurant_id, 'inactive_14d', holder.phone, message);
        sent++;
      }
    }

    console.log(`✅ Automation inactive: ${sent} SMS envoyés`);
  } catch (err) {
    console.error('❌ Automation inactive error:', err.message);
  }
}

// ── Job 2 : Clients proches de la récompense ─────────────
async function runNearRewardJob() {
  console.log('🤖 Automation: checking near-reward clients...');

  try {
    const result = await pool.query(`
      SELECT ch.id, ch.name, ch.phone, ch.serial_number,
             ch.stamps, ch.points, ch.restaurant_id,
             lc.card_name, lc.loyalty_type,
             lc.stamp_total, lc.points_for_reward, lc.reward_description,
             r.automation_near_reward_enabled
      FROM card_holders ch
      JOIN loyalty_cards lc ON ch.card_id = lc.id
      JOIN restaurants r ON ch.restaurant_id = r.id
      WHERE ch.phone IS NOT NULL
      AND r.automation_near_reward_enabled = TRUE
      AND (
        (lc.loyalty_type = 'stamp'  AND (lc.stamp_total - ch.stamps) = 1 AND ch.stamps > 0)
        OR
        (lc.loyalty_type = 'points' AND (lc.points_for_reward - ch.points) <= 5 AND ch.points > 0)
      )
    `);

    let sent = 0;

    for (const holder of result.rows) {
      const alreadyNotified = await wasRecentlyNotified(holder.id, 'near_reward', 7);
      if (alreadyNotified) continue;

      const prenom = holder.name ? ` ${holder.name}` : '';
      const cardUrl = `${process.env.BASE_URL_FRONTEND}/card/${holder.serial_number}`;
      let message;

      if (holder.loyalty_type === 'stamp') {
        message = `${holder.card_name}${prenom} : plus qu'1 tampon pour votre recompense "${holder.reward_description}" ! ${cardUrl}`;
      } else {
        const remaining = holder.points_for_reward - holder.points;
        message = `${holder.card_name}${prenom} : encore ${remaining} pts pour votre recompense "${holder.reward_description}" ! ${cardUrl}`;
      }

      const ok = await sendSms(holder.phone, message);
      if (ok) {
        await logNotification(holder.id, holder.restaurant_id, 'near_reward', holder.phone, message);
        sent++;
      }
    }

    console.log(`✅ Automation near-reward: ${sent} SMS envoyés`);
  } catch (err) {
    console.error('❌ Automation near-reward error:', err.message);
  }
}

// ── Démarrer les crons ────────────────────────────────────
function startAutomations() {
  if (!process.env.TWILIO_ACCOUNT_SID) {
    console.log('⚠️ Automations désactivées (Twilio non configuré)');
    return;
  }

  // Tous les jours à 10h00 (heure serveur UTC)
  cron.schedule('0 10 * * *', () => {
    runInactiveJob();
    runNearRewardJob();
  });

  console.log('✅ Automations SMS démarrées (cron: tous les jours à 10h)');
}

module.exports = { startAutomations, runInactiveJob, runNearRewardJob };
