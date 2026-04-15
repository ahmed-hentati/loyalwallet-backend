const express = require('express');
const router = express.Router();
const { pool } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

// GET /api/restaurants/me
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, phone, logo_url, plan, created_at FROM restaurants WHERE id = $1',
      [req.restaurant.id]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// PUT /api/restaurants/me
router.put('/me', authMiddleware, async (req, res, next) => {
  try {
    const { name, phone, address } = req.body;
    const result = await pool.query(
      'UPDATE restaurants SET name=$1, phone=$2, address=$3 WHERE id=$4 RETURNING id, name, email, phone, plan',
      [name, phone, address, req.restaurant.id]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
