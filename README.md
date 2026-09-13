# TestKemungkinan

Project standalone untuk eksperimen analisis statistik angka 3 digit.

> Fokus project: mengolah histori hasil, memberi skor kandidat 000–999, membandingkan beberapa model, melakukan rolling backtest tanpa future leak, lalu menguji apakah performa historis juga melewati baseline random dan holdout yang dikunci. Semua skor tetap bukan jaminan hasil berikutnya.

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
Rolling Backtest + Random Baseline Evidence
    ↓
Calibration Window → Locked Newest Holdout
    ↓
Validation Gate
    ├─ FAIL → Weighted Ensemble tetap eksperimen
    └─ PASS → Weighted Ensemble boleh di-unlock
    ↓
Top 10 → Top 3
```

## V0.5 — Validation Hardened

V0.5 menambahkan lapisan validasi di atas V0.4:

- random reference Top 3 = `0.3%`, Top 10 = `1%`, Top 25 = `2.5%`
- random theoretical mean rank = `500.5`
- exact binomial tail untuk mengecek hit-rate vs random
- one-sided normal approximation untuk mean-rank evidence
- `meanRankDelta`: positif berarti mean rank historis lebih baik daripada random reference
- baseline verdict per model (`below-random-rank`, `promising`, `validated-edge`, dll.)
- confidence evidence konservatif; **bukan win probability**
- chronological calibration window menggunakan target yang lebih lama
- newest holdout dikunci dan tidak ikut menentukan bobot
- calibration-derived weights untuk empat model dasar
- weighted ensemble diuji pada holdout yang sama sekali tidak dipakai saat tuning
- weighted ensemble tetap **LOCKED** sampai gate konservatif lolos
- dashboard Validation Gate + weight breakdown + holdout comparison
- Model Lab sekarang menampilkan delta vs random dan baseline status
- rolling backtest sekarang menampilkan hit count, random mean-rank reference, p-value, dan evidence status
- Sync Collector mencoba hingga 20 halaman source per sync

Urutan histori selalu **terbaru → terlama**.

## Validation Gate

Default split menggunakan sekitar 25% target eligible terbaru sebagai holdout, minimum 8 dan maksimum 20. Sisanya dipakai sebagai calibration target.

Gate weighted ensemble saat ini mensyaratkan:

- minimal 20 calibration trials
- minimal 10 locked holdout trials
- holdout mean rank lebih baik daripada `500.5`
- `p(Top10) <= 0.10`
- `p(mean rank) <= 0.20`

Jika syarat belum terpenuhi, dashboard tetap boleh menampilkan **experimental weighted Top 3**, tetapi ranking tersebut tidak menggantikan Top 3 utama.

## Model

| ID | Fokus |
| --- | --- |
| `balanced` | kombinasi posisi, transisi, pair, dan frekuensi global |
| `position` | menekankan frekuensi digit per posisi |
| `transition` | menekankan transisi digit antar-draw |
| `pair` | menekankan pasangan digit bersebelahan |
| `ensemble` | equal-weight Borda dari empat model dasar |

Calibration weights V0.5 tidak mengubah model dasar. Bobot hanya dipakai untuk eksperimen weighted ensemble yang kemudian harus melewati locked holdout.

## API

### `GET /api/health`

Status Worker, versi, D1 binding, daftar model, mode validation, dan endpoint aktif.

### `GET /api/models`

Mengembalikan daftar model yang tersedia.

### `GET /api/source?pages=5`

Mengambil histori langsung dari source tanpa database.

### `POST /api/collect`

```json
{
  "pages": 20
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

### `POST /api/backtest`

Response V0.5 selain summary juga mempunyai `evidence` berisi mean-rank delta, expected random hits, p-values, confidence evidence, dan baseline verdict.

### `POST /api/leaderboard`

Setiap row leaderboard sekarang mempunyai `evidence` sendiri. Model #1 tetap berarti terbaik **di antara model yang diuji**, bukan otomatis lebih baik daripada random.

### `POST /api/validate`

```json
{
  "history": ["226", "572", "187", "900"],
  "decay": 0.9,
  "minTrain": 8,
  "maxTrials": 60
}
```

Pada data nyata gunakan histori D1 yang cukup panjang. Response berisi:

- `gate`
- `weights`
- `calibration`
- `holdout.weighted`
- `holdout.borda`
- `currentWeighted.top3/top10`

## D1 storage

Worker menggunakan binding D1 bernama tepat `DB` dan database `testkemungkinan-db`. Binding sudah dikunci melalui `wrangler.toml`, sehingga deploy GitHub berikutnya tidak seharusnya menghapus koneksi D1.

## Lokal

```bash
npm install
npm run check
npm run dev
```

## Catatan interpretasi

`score`, `leaderScore`, `confidenceScore`, p-value, model weights, dan ranking semuanya adalah alat evaluasi statistik historis. Tidak ada metrik tersebut yang berarti probabilitas bahwa suatu nomor akan keluar pada draw berikutnya.

## Roadmap

1. V0.1 — Worker + baseline analyzer
2. V0.2 — interactive analyzer + Top 10 / Top 3 + rolling backtest
3. V0.3 — live collector + D1 storage + dedup period + hourly schedule
4. V0.4 — multi-model analyzer + Ensemble Borda + model leaderboard
5. **V0.5 — random baseline evidence + calibration + locked holdout + weighted validation gate**
6. V0.6 — deeper history import + stability windows + drift monitoring
7. V1.0 — production dashboard + hardened scheduled collection
