require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { testConnection } = require('./db/pool');

const authRoutes = require('./routes/auth');
const restaurantRoutes = require('./routes/restaurants');
const cardRoutes = require('./routes/cards');
const clientRoutes = require('./routes/clients');
const scanRoutes = require('./routes/scans');
const passRoutes = require('./routes/passes');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────
app.use(cors({
  origin: [
    'http://localhost:4200',
    'https://loyalwallet-dashboard.vercel.app',
    /\.vercel\.app$/
  ],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Routes ──────────────────────────────────────────────
app.use('/api/auth',        authRoutes);
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/cards',       cardRoutes);
app.use('/api/clients',     clientRoutes);
app.use('/api/scans',       scanRoutes);
app.use('/api/passes',      passRoutes);

// Route Apple Wallet (WebService — requise par Apple)
app.use('/wallet', require('./routes/wallet'));

// ─── Health check ─────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

// ─── Global error handler ─────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

// ─── Start ────────────────────────────────────────────────
async function start() {
  await testConnection();
  app.listen(PORT, () => {
    console.log(`🚀 LoyalWallet backend running on port ${PORT}`);
  });
}

start();
