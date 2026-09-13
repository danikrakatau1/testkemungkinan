# TestKemungkinan

Project standalone untuk eksperimen analisis statistik angka 3 digit.

> Fokus project: mengolah riwayat hasil, memberi skor kandidat 000–999, menghasilkan Top 10 / Top 3, dan melakukan backtest. Ranking statistik tidak menjamin hasil berikutnya jika sumber angka bersifat acak.

## Arsitektur

```text
Result Source
    ↓
Collector (fase berikutnya)
    ↓
History Store (fase berikutnya)
    ↓
Analyzer / Scoring Engine
    ↓
Rolling Backtest
    ↓
Top 10 → Top 3
    ↓
Cloudflare Web Dashboard
```

## V0.2

V0.2 sudah berisi:

- Cloudflare Worker + static assets
- dashboard responsif untuk input histori manual
- API `GET /api/health`
- API `POST /api/analyze`
- API `POST /api/backtest`
- scoring seluruh kandidat `000–999`
- recency weighting / decay
- frekuensi digit per posisi ratusan, puluhan, satuan
- transition score antar-draw
- adjacent-pair score
- penalti pengulangan kandidat yang baru muncul
- ranking Top 10 dan penyaringan Top 3
- rolling-origin backtest tanpa future leak
- smoke test lokal melalui `npm run check`

Urutan histori selalu **terbaru → terlama**.

## Menjalankan lokal

```bash
npm install
npm run check
npm run dev
```

Kemudian buka URL yang diberikan Wrangler.

## Deploy

```bash
npm run deploy
```

Repository dapat dihubungkan langsung ke Cloudflare Workers Builds. Konfigurasi Worker berada di `wrangler.toml`.

## API

### `GET /api/health`

Mengembalikan status Worker dan versi aktif.

### `POST /api/analyze`

```json
{
  "history": ["572", "187", "900", "240", "571", "840", "828", "983", "236", "620"],
  "decay": 0.9
}
```

Response berisi ringkasan histori, statistik posisi, Top 10, dan Top 3.

### `POST /api/backtest`

```json
{
  "history": ["572", "187", "900", "240", "571", "840", "828", "983", "236", "620", "161", "717"],
  "decay": 0.9,
  "minTrain": 8,
  "maxTrials": 60
}
```

Untuk setiap target historis, engine hanya memakai draw yang lebih lama dari target tersebut sebagai data latihan. Ini mencegah future leakage.

## Catatan interpretasi

`score` adalah skor relatif untuk mengurutkan 1.000 kandidat, **bukan probabilitas bahwa kandidat akan keluar**. Backtest juga hanya menunjukkan perilaku model pada histori yang diberikan, bukan jaminan hasil masa depan.

## Roadmap

1. V0.1 — Worker + baseline analyzer
2. **V0.2 — interactive analyzer + Top 10 / Top 3 + rolling backtest**
3. V0.3 — collector histori + storage + dedup period
4. V0.4 — multi-window / multi-model backtest leaderboard
5. V0.5 — calibration, model comparison, monitoring
6. V1.0 — production dashboard + scheduled collection
