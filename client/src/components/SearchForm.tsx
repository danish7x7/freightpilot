import { useState } from "react";
import type { Mode, SearchParams, ShipmentSpec } from "../api/hooks";

const MODES: Mode[] = ["OCEAN", "AIR", "TRUCK"];

export interface SearchSubmission {
  params: SearchParams;
  // Prepared now so selecting a card can POST /quotes/calculate without re-asking:
  // search uses origin/dest/mode/ship_date; calculate also needs cargo.
  shipment: ShipmentSpec;
}

export function SearchForm({ onSearch }: { onSearch: (s: SearchSubmission) => void }) {
  const [origin, setOrigin] = useState("CNSHA");
  const [dest, setDest] = useState("USOAK");
  const [mode, setMode] = useState<Mode>("OCEAN");
  const [shipDate, setShipDate] = useState("2026-08-01");
  const [weightKg, setWeightKg] = useState("12000");
  const [description, setDescription] = useState("General cargo");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const params: SearchParams = { origin, dest, mode, ship_date: shipDate };
    const shipment: ShipmentSpec = {
      origin_code: origin,
      dest_code: dest,
      mode,
      ship_date: shipDate,
      cargo: { weight_kg: Number(weightKg), description },
    };
    onSearch({ params, shipment });
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Rate search">
      <label>
        Origin
        <input name="origin" value={origin} onChange={(e) => setOrigin(e.target.value)} required />
      </label>
      <label>
        Destination
        <input name="dest" value={dest} onChange={(e) => setDest(e.target.value)} required />
      </label>
      <label>
        Mode
        <select name="mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label>
        Ship date
        <input
          name="ship_date"
          type="date"
          value={shipDate}
          onChange={(e) => setShipDate(e.target.value)}
          required
        />
      </label>
      <label>
        Cargo weight (kg)
        <input
          name="weight_kg"
          type="number"
          min="1"
          value={weightKg}
          onChange={(e) => setWeightKg(e.target.value)}
          required
        />
      </label>
      <label>
        Description
        <input
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
      </label>
      <button type="submit">Search rates</button>
    </form>
  );
}
