# Freight domain notes

One page of real freight structure, enough to make the synthetic seed data credible and to answer "do you understand freight?" in an interview. All figures are order-of-magnitude industry norms (2024–2026), used to size the seed — not quotes from any real carrier.

## Modes and how they're priced

### Ocean (FCL — full container load)
- Priced **per container**. Container sizes: **TEU** = 20 ft, **FEU** = 40 ft (≈ 2 TEU). Our seed prices FEU-class moves as `PER_CONTAINER`.
- Transpacific eastbound (China → US West Coast), e.g. **Shanghai (CNSHA) → Oakland (USOAK)**: **$2,000–4,000 / FEU**, transit **14–20 days**. West Coast is faster/cheaper than East Coast.
- Transatlantic (N. Europe → US East Coast), e.g. **Rotterdam (NLRTM) → New York (USNYC)**: **$1,500–3,000 / FEU**, transit **12–18 days**.
- Rates swing seasonally: peak season (roughly Aug–Oct, pre-holiday) pushes spot rates up; annual contract rates are steadier and often *below* peak spot. This is why the seed gives busy lanes **overlapping validity windows** — an annual base card and shorter seasonal cards can all be valid on the same date, and "cheapest valid on date X" is a real query.

### Air
- Priced **per kg** of **chargeable weight** = `max(actual_kg, volumetric_kg)`, where volumetric_kg = volume_cbm × 167 (IATA 1:6000 factor). *The chargeable-weight calculation is quote logic (L2); the seed only stores the per-kg rate.*
- **$4–8 / kg**, transit **2–5 days**. Example: **Hong Kong (HKHKG) → Los Angeles (USLAX)**.
- Far pricier per unit than ocean; used for time-sensitive or high-value cargo.

### Truck (drayage / FTL)
- Domestic road. Priced **per mile** (FTL long-haul) or flat (short drayage). Our seed uses `PER_MILE` with `distance_mi` on the lane.
- **$2.00–4.00 / mile** typical for FTL dry van; short lanes carry a higher effective per-mile rate. Example: **Oakland (USOAK) → Los Angeles (USLAX)**, ≈ 372 mi.

## Surcharges (composed on top of the base rate — composition ordering is L2)

| Type | Real name | Typical form | Rough magnitude |
|---|---|---|---|
| `FUEL` | BAF / fuel (bunker adjustment) | **PERCENT** of base | 10–20% |
| `PEAK_SEASON` | PSS (peak season surcharge) | **FLAT** per container | $200–600 / FEU |
| `SECURITY` | ISPS / security | **FLAT** | $50–150 |
| `HANDLING` | terminal / documentation handling | **FLAT** | $75–250 |

In the schema, `surcharges.amount` is **cents** when `calc = FLAT` and **basis points** when `calc = PERCENT` (e.g. 1500 = 15.00%). Money is always integer cents/bps — never floats.

## Units in the schema (§4.1)

- `rate_unit`: `PER_CONTAINER` (ocean FCL), `PER_KG` (air), `PER_MILE` (truck FTL), `PER_PALLET` (LCL-style, unused in the current seed).
- All monetary base rates are `base_rate_cents` (BIGINT). Dates are `DATE`; validity is `[valid_from, valid_to]` inclusive.

## Seed lanes at a glance

~16 lanes across all three modes: transpacific + transatlantic ocean (both directions on the busiest pairs), air out of Asia/Europe to US gateways, and short US drayage/FTL truck lanes. Busy ocean lanes get 2–3 rate cards with **overlapping** windows; each card carries 1–3 surcharges. See `services/rates/src/main/resources/db/seed/seed.sql`.
