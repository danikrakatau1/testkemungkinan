# TestKemungkinan

Project standalone untuk eksperimen analisis statistik angka 3 digit.

> Fokus project: mengolah histori hasil, memberi skor kandidat 000–999, menghasilkan Top 10 / Top 3, membandingkan beberapa model, dan melakukan rolling backtest tanpa future leak. Ranking statistik tidak menjamin hasil berikutnya jika sumber angka bersifat acak.

## Arsitektur

```text
LatoLato 3D Result Source
    ↓
Live Collector
    ↓
Cloudflare D1 History Store
    ↓
Multi-Model Analyzer
    ├─ Balanced
    ├─ Position Focus
    ├─ Transition Focus
    ├─ Pair Focus
    └─ Ensemble Borda
    ↓
Rolling Backtest / Model Leaderboard
    ↓
Top 10 → Top 3
    ↓
Cloudflare Web Dashboard
```

## V0.4

V0.4 menambahkan Model Lab di atas fondasi collector + D1 V0.3:

- lima pilihan model: `balanced`, `position`, `transition`, `pair`, dan `ensemble`
- Ensemble Borda menggabungkan percentile rank dari empat model dasar
- consensus metadata untuk kandidat Ensemble (`Top 3` / `Top 10` votes)
- API daftar model
- API multi-model leaderboard
- rolling backtest per model tanpa future leak
- perbandingan semua model pada target historis yang sama
- leaderboard metric: Top 3 hit-rate, Top 10 hit-rate, Top 25 hit-rate, mean target rank, dan composite leader score
- tombol **Compare Models** pada dashboard
- model selector untuk langsung mengganti model aktif
- tombol **Muat D1** untuk memakai histori permanen
- **Sync Collector** sekarang mencoba sampai 10 halaman source lalu memuat keseluruhan histori D1 kembali ke analyzer
- smoke test untuk analyzer, ensemble, leaderboard, backtest, dan collector parser

Urutan histori selalu **terbaru → terlama**.

## Model

| ID | Fokus |
| --- | --- |
| `balanced` | kombinasi posisi, transisi, pair, dan frekuensi global |
| `position` | menekankan frekuensi digit per posisi |
| `transition` | menekankan transisi digit antar-draw |
| `pair` | menekankan pasangan digit bersebelahan |
| `ensemble` | rata-rata percentile rank keempat model dasar |

Bobot model adalah hipotesis eksploratif. Model Lab dipakai untuk melihat apakah satu pendekatan menunjukkan perilaku historis yang lebih baik daripada model lain pada data yang sama.

## API

### `GET /api/health`

Status Worker, versi, D1 binding, daftar model, dan endpoint aktif.

### `GET /api/models`

Mengembalikan daftar model yang tersedia.

### `GET /api/source?pages=5`

Mengambil histori langsung dari source tanpa membutuhkan database.

### `POST /api/collect`

```json
{
  "pages": 10
}
```

Mengambil source dan menyimpan period baru ke D1 melalui binding `DB`. Dedup memakai `period` sebagai primary key.

### `GET /api/history?limit=500`

Membaca histori permanen dari D1, terbaru → terlama.

### `POST /api/analyze`

```json
{
  "history": ["226", "572", "187", "900", "240", "571", "840", "828", "983"],
  "decay": 0.9,
  "modelId": "ensemble"
}
```

Response berisi statistik histori, Top 10, Top 3, dan metadata model aktif.

### `POST /api/backtest`

```json
{
  "history": ["226", "572", "187", "900", "240", "571", "840", "828", "983", "236", "620", "161", "717"],
  "decay": 0.9,
  "modelId": "balanced",
  "minTrain": 8,
  "maxTrials": 60
}
```

Setiap target hanya memakai draw yang lebih lama dari target tersebut sebagai data latihan.

### `POST /api/leaderboard`

```json
{
  "history": ["226", "572", "187", "900", "240", "571", "840", "828", "983", "236", "620", "161", "717"],
  "decay": 0.9,
  "minTrain": 8,
  "maxTrials": 60
}
```

Semua model diuji pada trial yang sama. Response berisi model pemenang historis, leaderboard, current Top 3 tiap model, serta metrik perbandingan.

## D1 storage

Worker menggunakan binding D1 bernama tepat `DB` dan database yang saat ini dipakai adalah `testkemungkinan-db`.

Schema `results_3d` dibuat otomatis saat sync pertama. File SQL juga tersedia di `migrations/0001_results_3d.sql`.

## Lokal

```bash
npm install
npm run check
npm run dev
```

## Catatan interpretasi

`score`, `leaderScore`, dan posisi leaderboard adalah **skor relatif/historis, bukan probabilitas hasil berikutnya**. Backtest yang baik pun tidak membuktikan bahwa proses sumber dapat diprediksi jika draw memang acak.

## Roadmap

1. V0.1 — Worker + baseline analyzer
2. V0.2 — interactive analyzer + Top 10 / Top 3 + rolling backtest
3. V0.3 — live collector + D1 storage + dedup period + hourly schedule
4. **V0.4 — multi-model analyzer + Ensemble Borda + model leaderboard**
5. V0.5 — larger-history evaluation, calibration, stability windows, monitoring
6. V1.0 — production dashboard + hardened scheduled collection
