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
