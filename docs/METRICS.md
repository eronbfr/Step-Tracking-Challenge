# How the metrics are calculated

All health numbers are **estimates derived from step counts** — they're for motivation, not medical use.
Team-level numbers use population defaults; the *Me* page uses your height/weight if you enter them
(stored only on your device).

| Metric | Formula | Default |
|---|---|---|
| Stride length | 41.4% of height | 0.762 m |
| Distance | steps × stride | — |
| Walking time | steps ÷ 100 steps/min | — |
| Active calories | 2.5 MET × weight (kg) × walking hours | 70 kg |
| Fat-energy equivalent | kcal ÷ 7,700 kcal/kg | — |
| CO₂ “avoided” | km × 0.15 kg (average car) | — |
| WHO weekly activity | Σ max(0, daily steps − 5,000) ÷ 100 per day this week, vs 150 min | — |
| BMI | weight ÷ height² (only if both are entered) | — |
| Daily average | total of fully finished days ÷ number of finished days (day 1 uses today) | — |
| Projection | finished-days total + average × remaining days | — |

**Why 2.5 MET?** Brisk walking is ≈ 3.5 MET (Compendium of Physical Activities); subtracting 1 MET of
resting metabolism gives *active* calories — the number most fitness apps show.

**Why 100 steps/min?** ≈ the cadence threshold for moderate-intensity walking in adults
(Tudor-Locke et al., *Br J Sports Med*, 2018).

## Activity levels — Tudor-Locke & Bassett, *Sports Medicine* (2004)

| Average steps/day | Level |
|---|---|
| < 5,000 | 🛋️ Sedentary |
| 5,000 – 7,499 | 🚶 Low active |
| 7,500 – 9,999 | 🙂 Somewhat active |
| 10,000 – 12,499 | 💪 Active |
| ≥ 12,500 | 🚀 Highly active |

## Evidence cards in the app

- **Paluch et al., *The Lancet Public Health* (2022)** — meta-analysis of 15 cohorts (47,471 adults): the
  reduction in all-cause mortality levelled off at ~8,000–10,000 steps/day for adults < 60 and ~6,000–8,000 for ≥ 60.
- **Banach et al., *European Journal of Preventive Cardiology* (2023)** — each +1,000 steps/day was associated
  with 15% lower all-cause mortality; +500 steps/day with 7% lower cardiovascular mortality.
- **del Pozo Cruz et al., *JAMA Neurology* (2022)** — ~9,800 steps/day associated with ~50% lower dementia risk;
  ~3,800 steps/day with ~25% lower risk.
- **WHO guidelines on physical activity (2020)** — adults: 150–300 min/week of moderate-intensity activity.

## Team expedition

Milestones are straight-line (great-circle) distances between team home cities, computed in
[`js/metrics.js`](../js/metrics.js) with the haversine formula, plus a marathon (42.2 km) and the
Camino de Santiago (French Way, ~780 km). Team distance uses the default stride.

## Badges

17 badges — single-day peaks (10K/15K/20K/30K), goal streaks (3/7/14), Perfect Week (Mon–Sun), Weekend Warrior,
Comeback (goal right after a < 5K day), Never Miss (7 days logged in a row), distance (42.2 km / 100 km),
totals (250K, 10K × every day) and Autopilot (auto-sync on).
