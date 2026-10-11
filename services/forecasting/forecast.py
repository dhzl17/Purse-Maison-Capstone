"""
Purse Maison sales forecast job.

Reads monthly sales per brand from Supabase, fits one ARIMA model per brand,
measures its accuracy (MAE), and writes the forecast back to Supabase.

  python forecast.py                full run (nightly schedule, or by hand)
  python forecast.py --queued-only  only runs if a manager queued "Regenerate Forecast"
"""

import itertools
import math
import os
import sys
import warnings
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import requests
from dotenv import load_dotenv
from statsmodels.tsa.arima.model import ARIMA

warnings.filterwarnings("ignore")  # ARIMA prints many harmless fitting warnings

load_dotenv()  # reads .env on your computer; GitHub passes these values in directly
API = os.environ["SUPABASE_URL"].rstrip("/").removesuffix("/rest/v1") + "/rest/v1"
KEY = os.environ["SUPABASE_SECRET_KEY"]

MANILA = timezone(timedelta(hours=8))
HOLDOUT_MONTHS = 3      # months hidden from the model to measure accuracy (MAE)
CONFIDENCE = 0.95       # width of the low-to-high forecast range
ORDERS = list(itertools.product(range(3), range(2), range(3)))  # (p, d, q) settings to try
STUCK_AFTER = timedelta(hours=2)


# ---------- Talking to Supabase ----------

def api(method, table, params=None, body=None, prefer=None):
    headers = {"apikey": KEY, "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    response = requests.request(method, f"{API}/{table}", headers=headers,
                                params=params, json=body, timeout=60)
    if not response.ok:
        raise RuntimeError(f"{method} {table} failed ({response.status_code}): {response.text}")
    return response.json() if response.text else None


def load_settings():
    rows = api("GET", "app_settings", {
        "select": "key,value",
        "key": "in.(forecast_horizon_months,forecast_min_history_months)"})
    return {row["key"]: int(row["value"]) for row in rows}


def release_stuck_runs():
    """A run left 'running' for hours means an earlier job crashed; mark it failed."""
    cutoff = (datetime.now(timezone.utc) - STUCK_AFTER).isoformat()
    api("PATCH", "forecast_runs",
        {"status": "eq.running", "started_at": f"lt.{cutoff}"},
        {"status": "failed", "error_message": "Stopped responding; marked failed by a later run"})


def claim_run(queued_only):
    """Take a queued request if there is one; otherwise start a new run (unless queued-only)."""
    queued = api("GET", "forecast_runs", {
        "select": "id,horizon_months,brands", "status": "eq.queued",
        "order": "requested_at", "limit": "1"})
    if queued:
        run = queued[0]
        api("PATCH", "forecast_runs", {"id": f"eq.{run['id']}"}, {"status": "running"})
        return run
    if queued_only:
        return None
    return api("POST", "forecast_runs", body={"status": "running"},
               prefer="return=representation")[0]


def load_history():
    rows, offset = [], 0
    while True:
        page = api("GET", "monthly_brand_sales", {
            "select": "sale_month,brand_key,brand,units_sold,revenue",
            "order": "brand_key,sale_month", "limit": "1000", "offset": str(offset)})
        rows += page
        if len(page) < 1000:
            break
        offset += 1000
    history = pd.DataFrame(rows, columns=["sale_month", "brand_key", "brand", "units_sold", "revenue"])
    history["sale_month"] = pd.to_datetime(history["sale_month"])
    history["units_sold"] = history["units_sold"].astype(float)
    history["revenue"] = history["revenue"].astype(float)
    return history


# ---------- The forecasting itself ----------

def monthly_series(group, column, last_month):
    """One value per month, with months that had no sales filled in as 0."""
    series = group.set_index("sale_month")[column]
    months = pd.date_range(series.index.min(), last_month, freq="MS")
    return series.reindex(months, fill_value=0.0).astype(float)


def best_fit(series):
    """Try each ARIMA setting and keep the one with the lowest AIC."""
    best = None
    for order in ORDERS:
        try:
            fitted = ARIMA(series, order=order).fit()
        except Exception:
            continue
        if np.isfinite(fitted.aic) and (best is None or fitted.aic < best[1].aic):
            best = (order, fitted)
    if best is None:
        raise ValueError("no ARIMA setting could be fitted to this brand's sales")
    return best


def forecast_series(series, horizon):
    """Measure accuracy on the last few months, then forecast `horizon` months ahead."""
    train, test = series[:-HOLDOUT_MONTHS], series[-HOLDOUT_MONTHS:]
    order, fitted = best_fit(train)
    predicted = np.clip(np.asarray(fitted.forecast(HOLDOUT_MONTHS)), 0, None)
    mae = float(np.mean(np.abs(test.to_numpy() - predicted)))

    final = ARIMA(series, order=order).fit().get_forecast(horizon)
    mean = np.clip(np.asarray(final.predicted_mean), 0, None)
    bounds = np.clip(np.asarray(final.conf_int(alpha=1 - CONFIDENCE)), 0, None)
    return order, mae, mean, bounds


def num(value):
    value = float(value)
    return round(value, 2) if math.isfinite(value) else None


def run_forecast(run, settings):
    horizon = run.get("horizon_months") or settings["forecast_horizon_months"]
    min_months = max(settings["forecast_min_history_months"], HOLDOUT_MONTHS + 6)
    wanted = set(run.get("brands") or [])

    this_month = pd.Timestamp(datetime.now(MANILA).date()).replace(day=1)
    last_month = this_month - pd.DateOffset(months=1)   # the current month isn't over yet
    forecast_months = pd.date_range(this_month, periods=horizon, freq="MS")

    history = load_history()
    history = history[history["sale_month"] < this_month]
    if wanted:
        history = history[history["brand_key"].isin(wanted)]

    models, results = [], []
    for brand_key, group in history.groupby("brand_key"):
        brand = group["brand"].iloc[0]
        revenue = monthly_series(group, "revenue", last_month)
        model = {"run_id": run["id"], "brand_key": brand_key, "brand": brand,
                 "months_of_history": len(revenue), "outcome": None,
                 "arima_order": None, "mae": None, "notes": None}

        if len(revenue) < min_months:
            model.update(outcome="skipped_insufficient_data",
                         notes=f"Only {len(revenue)} month(s) of history; needs {min_months}")
            models.append(model)
            print(f"  {brand}: skipped, only {len(revenue)} month(s) of history")
            continue

        try:
            order, mae, revenue_mean, revenue_bounds = forecast_series(revenue, horizon)
        except Exception as error:
            model.update(outcome="failed", notes=str(error)[:500])
            models.append(model)
            print(f"  {brand}: failed ({error})")
            continue

        try:
            units = monthly_series(group, "units_sold", last_month)
            _, _, units_mean, _ = forecast_series(units, horizon)
        except Exception:
            units_mean = None

        model.update(outcome="forecasted", arima_order="(%d,%d,%d)" % order, mae=num(mae))
        models.append(model)

        for i, month in enumerate(forecast_months):
            results.append({
                "run_id": run["id"],
                "brand_key": brand_key,
                "forecast_month": month.strftime("%Y-%m-%d"),
                "predicted_units": None if units_mean is None else num(units_mean[i]),
                "predicted_revenue": num(revenue_mean[i]) or 0,
                "revenue_lower": num(revenue_bounds[i, 0]),
                "revenue_upper": num(revenue_bounds[i, 1]),
                "confidence_level": CONFIDENCE,
            })
        print(f"  {brand}: ARIMA{model['arima_order']}, MAE {mae:,.2f}")

    forecasted = sum(1 for m in models if m["outcome"] == "forecasted")
    if forecasted == 0:
        raise RuntimeError("No brand had enough sales history to forecast")

    api("POST", "forecast_brand_models", body=models)
    api("POST", "forecast_results", body=results)
    return forecasted


def main():
    queued_only = "--queued-only" in sys.argv
    release_stuck_runs()
    run = claim_run(queued_only)
    if run is None:
        print("No forecast requested. Nothing to do.")
        return

    print(f"Forecast run {run['id']} started")
    try:
        count = run_forecast(run, load_settings())
        api("PATCH", "forecast_runs", {"id": f"eq.{run['id']}"}, {"status": "completed"})
        print(f"Finished: {count} brand(s) forecasted")
    except Exception as error:
        api("PATCH", "forecast_runs", {"id": f"eq.{run['id']}"},
            {"status": "failed", "error_message": str(error)[:1000]})
        print(f"Forecast failed: {error}")
        sys.exit(1)


if __name__ == "__main__":
    main()