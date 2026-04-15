# LoyalWallet — Backend

Backend Node.js/Express pour les cartes de fidélité Apple Wallet & Google Wallet.

## Stack
- **Node.js + Express** — API REST
- **PostgreSQL** — base de données
- **passkit-generator** — génération des .pkpass Apple
- **APNs** — push notifications pour mise à jour Wallet

---

## Installation

```bash
npm install
cp .env.example .env
# Remplir les variables dans .env
```

## Base de données

```bash
# Créer la base
psql -U postgres -c "CREATE DATABASE loyalwallet;"

# Appliquer le schéma
psql -U postgres -d loyalwallet -f src/db/schema.sql
```

## Lancer en dev

```bash
npm run dev
```

---

## Certificats Apple (requis pour générer les .pkpass)

1. Aller sur [developer.apple.com](https://developer.apple.com)
2. Certificates, IDs & Profiles → Identifiers → Pass Type IDs
3. Créer un **Pass Type ID** (ex: `pass.com.tonapp.loyalwallet`)
4. Créer un certificat pour ce Pass Type ID
5. Exporter en `.p12`, puis convertir en `.pem` :

```bash
# Convertir le certificat
openssl pkcs12 -in certificate.p12 -clcerts -nokeys -out certs/signerCert.pem
openssl pkcs12 -in certificate.p12 -nocerts -out certs/signerKey.pem

# Télécharger le certificat Apple WWDR
curl -o certs/wwdr.pem https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer
```

6. Pour les push (APNs Wallet), créer une **APNs Auth Key** (.p8) sur le portail Developer

---

## API Reference

### Auth
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/auth/register` | Inscription restaurateur |
| POST | `/api/auth/login` | Connexion |
| GET  | `/api/auth/me` | Profil connecté |

### Cartes
| Méthode | Route | Description |
|---------|-------|-------------|
| GET  | `/api/cards` | Lister ses cartes |
| POST | `/api/cards` | Créer une carte |
| PUT  | `/api/cards/:id` | Modifier une carte |

### Clients
| Méthode | Route | Description |
|---------|-------|-------------|
| GET  | `/api/clients` | Lister ses clients |
| GET  | `/api/clients/stats` | Stats du dashboard |

### Passes
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/passes/create` | Créer client + générer .pkpass |
| GET  | `/api/passes/:serialNumber` | Télécharger un pass |

### Scans (usage caissier)
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/scans` | Scanner QR → ajouter points |
| GET  | `/api/scans` | Historique des scans |

### Apple Wallet WebService (protocole Apple)
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/wallet/v1/devices/:id/registrations/:passTypeId/:serial` | Enregistrer push token |
| DELETE | `/wallet/v1/devices/:id/registrations/:passTypeId/:serial` | Désenregistrer |
| GET  | `/wallet/v1/passes/:passTypeId/:serial` | Pass mis à jour |

---

## Flux principal

```
1. Restaurateur crée sa carte (POST /api/cards)
2. Client arrive → restaurateur crée son pass (POST /api/passes/create)
   → reçoit un .pkpass → l'ajoute à son Wallet
3. Client revient → caissier scanne son QR (POST /api/scans)
   → points crédités → push APNs → Wallet mis à jour automatiquement
```
