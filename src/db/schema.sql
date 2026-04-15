-- ================================================================
-- LoyalWallet — Schéma PostgreSQL
-- Exécuter : psql -U postgres -d loyalwallet -f schema.sql
-- ================================================================

-- Extension UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Restaurateurs ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS restaurants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  phone         VARCHAR(50),
  address       TEXT,
  logo_url      TEXT,

  -- Plan : 'free' (50 clients max) ou 'pro'
  plan          VARCHAR(20) NOT NULL DEFAULT 'free',
  plan_started_at TIMESTAMPTZ,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Cartes de fidélité ───────────────────────────────────
-- Chaque restaurant peut créer une carte
-- loyalty_type : 'points' ou 'stamp'
CREATE TABLE IF NOT EXISTS loyalty_cards (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,

  -- Design
  card_name           VARCHAR(255) NOT NULL,
  background_color    VARCHAR(7)   NOT NULL DEFAULT '#1a1a1a',
  foreground_color    VARCHAR(7)   NOT NULL DEFAULT '#ffffff',
  label_color         VARCHAR(7)   NOT NULL DEFAULT '#cccccc',
  logo_url            TEXT,

  -- ── Type de fidélité ────────────────────────────────────
  -- 'points' : cumul de points (ex: 1pt/visite, récompense à 50pts)
  -- 'stamp'  : tampon (ex: 10 cases, 1 case/visite, récompense à 10)
  loyalty_type        VARCHAR(10)  NOT NULL DEFAULT 'stamp'
                      CHECK (loyalty_type IN ('points', 'stamp')),

  -- Commun aux deux systèmes
  reward_description  TEXT NOT NULL DEFAULT '1 café offert',

  -- Système POINTS
  -- points_per_visit : combien de points par visite
  -- points_for_reward : seuil pour déclencher la récompense
  points_per_visit    INT NOT NULL DEFAULT 1,
  points_for_reward   INT NOT NULL DEFAULT 50,

  -- Système TAMPON
  -- stamp_total : nombre de cases sur la carte (ex: 10)
  -- stamp_per_visit : tampons donnés par visite (presque toujours 1)
  stamp_total         INT NOT NULL DEFAULT 10,
  stamp_per_visit     INT NOT NULL DEFAULT 1,

  -- Identifiants Apple Wallet
  pass_type_id        VARCHAR(255),
  serial_number_prefix VARCHAR(50) DEFAULT 'LW',

  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Clients (porteurs de cartes) ─────────────────────────
CREATE TABLE IF NOT EXISTS card_holders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id       UUID NOT NULL REFERENCES loyalty_cards(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,

  name          VARCHAR(255),
  phone         VARCHAR(50),
  email         VARCHAR(255),

  -- Système POINTS : valeur courante de points
  points        INT NOT NULL DEFAULT 0,

  -- Système TAMPON : cases cochées sur la carte courante (reset à 0 après récompense)
  stamps        INT NOT NULL DEFAULT 0,

  -- Commun
  total_visits  INT NOT NULL DEFAULT 0,
  total_rewards INT NOT NULL DEFAULT 0,

  serial_number VARCHAR(255) UNIQUE NOT NULL,
  apn_push_token TEXT,
  google_object_id TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Historique des scans ─────────────────────────────────
CREATE TABLE IF NOT EXISTS scans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_holder_id  UUID NOT NULL REFERENCES card_holders(id) ON DELETE CASCADE,
  restaurant_id   UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,

  -- Points (système points)
  points_earned   INT NOT NULL DEFAULT 0,
  points_before   INT NOT NULL DEFAULT 0,
  points_after    INT NOT NULL DEFAULT 0,

  -- Tampons (système stamp)
  stamps_earned   INT NOT NULL DEFAULT 0,
  stamps_before   INT NOT NULL DEFAULT 0,
  stamps_after    INT NOT NULL DEFAULT 0,

  reward_triggered BOOLEAN NOT NULL DEFAULT FALSE,
  scanned_by      VARCHAR(255),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Index ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_card_holders_serial    ON card_holders(serial_number);
CREATE INDEX IF NOT EXISTS idx_card_holders_card_id   ON card_holders(card_id);
CREATE INDEX IF NOT EXISTS idx_scans_holder           ON scans(card_holder_id);
CREATE INDEX IF NOT EXISTS idx_scans_restaurant       ON scans(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_cards_restaurant       ON loyalty_cards(restaurant_id);

-- ─── Trigger updated_at ───────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_restaurants_updated
  BEFORE UPDATE ON restaurants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_cards_updated
  BEFORE UPDATE ON loyalty_cards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_holders_updated
  BEFORE UPDATE ON card_holders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
