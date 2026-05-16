"use client";

import { useState } from "react";

type MetricView = "day" | "month" | "year";

type MetricsControlsProps = {
  day: string;
  month: string;
  view: MetricView;
  year: string;
};

export function MetricsControls({ day, month, view, year }: MetricsControlsProps) {
  const [selectedView, setSelectedView] = useState<MetricView>(view);

  return (
    <form className="flex flex-wrap items-end gap-2" method="get">
      <label className="grid gap-1">
        <span className="label">Vista</span>
        <select
          className="field w-32"
          name="metricView"
          onChange={(event) => setSelectedView(event.target.value as MetricView)}
          value={selectedView}
        >
          <option value="day">Día</option>
          <option value="month">Mes</option>
          <option value="year">Año</option>
        </select>
      </label>

      {selectedView === "day" ? (
        <label className="grid gap-1">
          <span className="label">Día</span>
          <input className="field w-44" defaultValue={day} name="metricDay" type="date" />
        </label>
      ) : null}

      {selectedView === "month" ? (
        <label className="grid gap-1">
          <span className="label">Mes</span>
          <input className="field w-44" defaultValue={month} name="metricMonth" type="month" />
        </label>
      ) : null}

      {selectedView === "year" ? (
        <label className="grid gap-1">
          <span className="label">Año</span>
          <input className="field w-32" defaultValue={year} min="2020" name="metricYear" type="number" />
        </label>
      ) : null}

      <button className="secondary-button" type="submit">
        Ver métricas
      </button>
    </form>
  );
}
