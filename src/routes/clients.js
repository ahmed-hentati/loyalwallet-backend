// ─── routes/clients.js ────────────────────────────────────
const express = require('express');
const router = express.Router();
const { pool } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

// GET /api/clients — liste des clients du restaurant
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const { limit = 50, offset = 0, search } = req.query;
    let query = `
      SELECT ch.id, ch.name, ch.phone, ch.email, ch.points,
             ch.total_visits, ch.total_rewards, ch.serial_number, ch.created_at,
             lc.card_name
      FROM card_holders ch
      JOIN loyalty_cards lc ON ch.card_id = lc.id
      WHERE ch.restaurant_id = $1
    `;
    const params = [req.restaurant.id];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (ch.name ILIKE $${params.length} OR ch.phone ILIKE $${params.length})`;
    }

    query += ` ORDER BY ch.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// GET /api/clients/stats — stats globales pour le dashboard
router.get('/stats', authMiddleware, async (req, res, next) => {
  try {
    const id = req.restaurant.id;

    const [clients, scans, rewards] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM card_holders WHERE restaurant_id = $1', [id]),
      pool.query('SELECT COUNT(*) FROM scans WHERE restaurant_id = $1', [id]),
      pool.query('SELECT SUM(total_rewards) FROM card_holders WHERE restaurant_id = $1', [id]),
    ]);

    res.json({
      total_clients:  parseInt(clients.rows[0].count),
      total_scans:    parseInt(scans.rows[0].count),
      total_rewards:  parseInt(rewards.rows[0].sum) || 0,
    });
  } catch (err) { next(err); }
});

module.exports = router;

// ── GET /api/clients/:id ──────────────────────────────────
router.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;
    const restaurantId = req.restaurant.id;

    const result = await pool.query(
      `SELECT ch.*, lc.card_name, lc.loyalty_type, lc.stamp_total,
              lc.points_for_reward, lc.reward_description,
              lc.background_color, lc.foreground_color, lc.label_color
       FROM card_holders ch
       JOIN loyalty_cards lc ON ch.card_id = lc.id
       WHERE ch.id = $1 AND ch.restaurant_id = $2`,
      [id, restaurantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client introuvable' });
    }

    const holder = result.rows[0];

    // Derniers scans
    const scans = await pool.query(
      `SELECT * FROM scans WHERE card_holder_id = $1
       ORDER BY created_at DESC LIMIT 10`,
      [id]
    );

    res.json({
      holder: {
        id: holder.id,
        name: holder.name,
        phone: holder.phone,
        email: holder.email,
        serial_number: holder.serial_number,
        points: holder.points,
        stamps: holder.stamps,
        total_visits: holder.total_visits,
        total_rewards: holder.total_rewards,
        created_at: holder.created_at,
      },
      card: {
        name: holder.card_name,
        loyalty_type: holder.loyalty_type,
        stamp_total: holder.stamp_total,
        points_for_reward: holder.points_for_reward,
        reward_description: holder.reward_description,
        background_color: holder.background_color,
        foreground_color: holder.foreground_color,
        label_color: holder.label_color,
      },
      scans: scans.rows,
    });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/clients/:id ────────────────────────────────
// Mettre à jour le numéro de téléphone
router.patch('/:id', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { phone, name, email } = req.body;
    const restaurantId = req.restaurant.id;

    const result = await pool.query(
      `UPDATE card_holders
       SET phone = COALESCE($1, phone),
           name  = COALESCE($2, name),
           email = COALESCE($3, email)
       WHERE id = $4 AND restaurant_id = $5
       RETURNING *`,
      [phone || null, name || null, email || null, id, restaurantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client introuvable' });
    }

    res.json({ success: true, holder: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/clients/:id/send-link ──────────────────────
// Envoyer le lien de la carte par SMS via Twilio
router.post('/:id/send-link', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;
    const restaurantId = req.restaurant.id;

    const result = await pool.query(
      `SELECT ch.*, lc.card_name FROM card_holders ch
       JOIN loyalty_cards lc ON ch.card_id = lc.id
       WHERE ch.id = $1 AND ch.restaurant_id = $2`,
      [id, restaurantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client introuvable' });
    }

    const holder = result.rows[0];

    if (!holder.phone) {
      return res.status(400).json({ error: 'Ce client n\'a pas de numéro de téléphone' });
    }

    const { sendCardLink } = require('../services/smsService');
    await sendCardLink({
      phone: holder.phone,
      name: holder.name,
      cardName: holder.card_name,
      serialNumber: holder.serial_number,
    });

    res.json({ success: true, message: `SMS envoyé à ${holder.phone}` });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/clients/analytics ────────────────────────────
// Stats de rétention pour le dashboard
router.get('/analytics/retention', authMiddleware, async (req, res, next) => {
  try {
    const restaurantId = req.restaurant.id;

    const [
      totalClients,
      activeThisMonth,
      activeLastMonth,
      newThisMonth,
      newLastMonth,
      returningClients,
      avgVisitsPerClient,
      topClients,
      visitsByDay,
      rewardsGiven,
    ] = await Promise.all([

      // Total clients
      pool.query(
        'SELECT COUNT(*) FROM card_holders WHERE restaurant_id = $1',
        [restaurantId]
      ),

      // Actifs ce mois (ont scanné dans les 30 derniers jours)
      pool.query(
        `SELECT COUNT(DISTINCT card_holder_id) FROM scans
         WHERE restaurant_id = $1 AND created_at > NOW() - INTERVAL '30 days'`,
        [restaurantId]
      ),

      // Actifs le mois dernier
      pool.query(
        `SELECT COUNT(DISTINCT card_holder_id) FROM scans
         WHERE restaurant_id = $1
         AND created_at BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days'`,
        [restaurantId]
      ),

      // Nouveaux clients ce mois
      pool.query(
        `SELECT COUNT(*) FROM card_holders
         WHERE restaurant_id = $1 AND created_at > NOW() - INTERVAL '30 days'`,
        [restaurantId]
      ),

      // Nouveaux clients le mois dernier
      pool.query(
        `SELECT COUNT(*) FROM card_holders
         WHERE restaurant_id = $1
         AND created_at BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days'`,
        [restaurantId]
      ),

      // Clients qui sont revenus (+ de 1 visite)
      pool.query(
        `SELECT COUNT(*) FROM card_holders
         WHERE restaurant_id = $1 AND total_visits > 1`,
        [restaurantId]
      ),

      // Moyenne de visites par client
      pool.query(
        `SELECT ROUND(AVG(total_visits)::numeric, 1) as avg
         FROM card_holders WHERE restaurant_id = $1 AND total_visits > 0`,
        [restaurantId]
      ),

      // Top 5 clients les plus fidèles
      pool.query(
        `SELECT ch.name, ch.serial_number, ch.total_visits, ch.total_rewards,
                lc.card_name, ch.stamps, ch.points,
                lc.loyalty_type, lc.stamp_total, lc.points_for_reward
         FROM card_holders ch
         JOIN loyalty_cards lc ON ch.card_id = lc.id
         WHERE ch.restaurant_id = $1
         ORDER BY ch.total_visits DESC LIMIT 5`,
        [restaurantId]
      ),

      // Visites par jour sur les 30 derniers jours
      pool.query(
        `SELECT DATE(created_at) as day, COUNT(*) as visits
         FROM scans WHERE restaurant_id = $1
         AND created_at > NOW() - INTERVAL '30 days'
         GROUP BY DATE(created_at)
         ORDER BY day ASC`,
        [restaurantId]
      ),

      // Récompenses accordées ce mois
      pool.query(
        `SELECT COUNT(*) FROM scans
         WHERE restaurant_id = $1
         AND reward_triggered = TRUE
         AND created_at > NOW() - INTERVAL '30 days'`,
        [restaurantId]
      ),
    ]);

    const total   = parseInt(totalClients.rows[0].count);
    const active  = parseInt(activeThisMonth.rows[0].count);
    const returning = parseInt(returningClients.rows[0].count);

    // Taux de rétention = clients actifs / total
    const retentionRate = total > 0 ? Math.round((active / total) * 100) : 0;

    // Taux de retour = clients avec + d'1 visite / total
    const returnRate = total > 0 ? Math.round((returning / total) * 100) : 0;

    // Évolution clients ce mois vs mois dernier
    const newCurrent  = parseInt(newThisMonth.rows[0].count);
    const newPrevious = parseInt(newLastMonth.rows[0].count);
    const newGrowth   = newPrevious > 0
      ? Math.round(((newCurrent - newPrevious) / newPrevious) * 100)
      : 0;

    // Évolution actifs ce mois vs mois dernier
    const activeCurrent  = parseInt(activeThisMonth.rows[0].count);
    const activePrevious = parseInt(activeLastMonth.rows[0].count);
    const activeGrowth   = activePrevious > 0
      ? Math.round(((activeCurrent - activePrevious) / activePrevious) * 100)
      : 0;

    res.json({
      overview: {
        total_clients:   total,
        active_30d:      activeCurrent,
        active_growth:   activeGrowth,
        new_this_month:  newCurrent,
        new_growth:      newGrowth,
        retention_rate:  retentionRate,
        return_rate:     returnRate,
        avg_visits:      parseFloat(avgVisitsPerClient.rows[0]?.avg ?? 0),
        rewards_this_month: parseInt(rewardsGiven.rows[0].count),
      },
      top_clients: topClients.rows,
      visits_by_day: visitsByDay.rows,
    });

  } catch (err) {
    next(err);
  }
});
