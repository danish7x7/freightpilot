-- rates-service schema (L1). Matches docs/MASTER_PLAN.md §4.1 exactly.
-- Schema only — no seed data here (demo data lives in db/seed/seed.sql, applied by
-- `make seed`, so it never enters the Flyway history or every environment's startup).

CREATE TYPE mode           AS ENUM ('OCEAN','AIR','TRUCK');
CREATE TYPE rate_unit      AS ENUM ('PER_CONTAINER','PER_KG','PER_PALLET','PER_MILE');
CREATE TYPE surcharge_type AS ENUM ('FUEL','PEAK_SEASON','SECURITY','HANDLING');
CREATE TYPE surcharge_calc AS ENUM ('FLAT','PERCENT');

CREATE TABLE lanes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_code   TEXT NOT NULL,        -- UN/LOCODE, e.g. CNSHA
  origin_name   TEXT NOT NULL,        -- Shanghai
  dest_code     TEXT NOT NULL,        -- USOAK
  dest_name     TEXT NOT NULL,
  mode          mode NOT NULL,
  distance_mi   INT,                  -- TRUCK only
  UNIQUE (origin_code, dest_code, mode)
);

CREATE TABLE rate_cards (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lane_id          UUID NOT NULL REFERENCES lanes(id),
  base_rate_cents  BIGINT NOT NULL CHECK (base_rate_cents > 0),
  currency         CHAR(3) NOT NULL DEFAULT 'USD',
  unit             rate_unit NOT NULL,
  transit_days_min INT NOT NULL,
  transit_days_max INT NOT NULL CHECK (transit_days_max >= transit_days_min),
  valid_from       DATE NOT NULL,
  valid_to         DATE NOT NULL CHECK (valid_to > valid_from)
);
CREATE INDEX idx_rate_cards_lookup ON rate_cards (lane_id, valid_from, valid_to);

CREATE TABLE surcharges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_card_id  UUID NOT NULL REFERENCES rate_cards(id),
  type          surcharge_type NOT NULL,
  calc          surcharge_calc NOT NULL,
  amount        BIGINT NOT NULL     -- cents if FLAT, basis points if PERCENT
);
