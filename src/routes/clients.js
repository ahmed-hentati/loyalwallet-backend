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
