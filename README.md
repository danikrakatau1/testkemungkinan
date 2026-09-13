# TestKemungkinan

Project standalone untuk analisis statistik angka 3 digit.

> Fokus project: mengolah riwayat hasil, memberi skor kandidat 000–999, menghasilkan Top 10 / Top 3, dan melakukan backtest. Ranking statistik tidak menjamin hasil berikutnya jika sumber angka bersifat acak.

## Target arsitektur

```text
Result Source
    ↓
Collector (fase berikutnya)
    ↓
History Store
    ↓
Analyzer / Scoring Engine
    ↓
Backtest Engine
    ↓
Top 10 → Top 3
    ↓
Cloudflare Web Dashboard
```

## Baseline V0.1

Baseline pertama berisi:

- Cloudflare Worker entry point
- Web dashboard sederhana
- API `/api/health`
- API `/api/analyze`
- scoring engine 000–999 berbasis histori
- pemisahan `Top 10` dan `Top 3`
- input manual riwayat untuk validasi awal

## Jalankan lokal

```bash
npm install
npm run dev
```

Kemudian buka URL yang diberikan Wrangler.

## Deploy

```bash
npm run deploy
```

Deployment Cloudflare belum dikunci ke akun tertentu di repository. Autentikasi dilakukan melalui Wrangler pada environment pemilik project.

## API

### `GET /api/health`

Mengembalikan status Worker.

### `POST /api/analyze`

Body:

```json
{
  "history": ["187", "900", "240", "571", "840", "828", "983", "236", "620"]
}
```

Urutan `history` adalah **terbaru → terlama**.

Response berisi statistik, Top 10, dan Top 3 kandidat.

## Roadmap

1. V0.1 — manual analyzer + dashboard
2. V0.2 — history collector terpisah
3. V0.3 — storage histori + dedup period
4. V0.4 — rolling backtest tanpa data leakage
5. V0.5 — multi-model scoring & leaderboard model
6. V1.0 — production dashboard + scheduled collection
