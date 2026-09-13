# TestKemungkinan

Project standalone untuk eksperimen analisis statistik angka 3 digit.

> Fokus project: mengolah riwayat hasil, memberi skor kandidat 000–999, menghasilkan Top 10 / Top 3, dan melakukan backtest. Ranking statistik tidak menjamin hasil berikutnya jika sumber angka bersifat acak.

## Arsitektur

```text
LatoLato 3D Result Source
    ↓
Live Collector
    ↓
D1 History Store (optional binding DB)
    ↓
Analyzer / Scoring Engine
    ↓
Rolling Backtest
    ↓
Top 10 → Top 3
    ↓
Cloudflare Web Dashboard
```

## V0.3

V0.3 sudah berisi:

- Cloudflare Worker + static assets
- live collector untuk `https://latolatolotto.com/result3d.php`
- pagination collector (maksimum 20 halaman per request)
- parser period + tiga digit dari asset `ball_N.webp`
- dedup berdasarkan `period`
- API live source tanpa database
- optional D1 persistence melalui binding bernama `DB`
- auto-create schema D1 saat sync pertama
- scheduled collector setiap jam pada menit ke-07 UTC
- dashboard tombol `Ambil Live 30` dan `Sync Collector`
- analyzer seluruh kandidat `000–999`
- ranking Top 10 / Top 3
- rolling backtest tanpa future leak
- smoke test termasuk fixture parser collector

Urutan histori selalu **terbaru → terlama**.

## API

### `GET /api/health`

Status Worker, versi, endpoint aktif, dan apakah D1 binding `DB` sudah tersedia.

### `GET /api/source?pages=5`

Mengambil histori langsung dari source. Tidak membutuhkan database.

Response menyertakan `results` lengkap dan `history` berupa array angka terbaru → terlama.

### `POST /api/collect`

```json
{
  "pages": 2
}
```

Mengambil source dan mencoba menyimpannya ke D1. Jika binding `DB` belum ada, source tetap berhasil diambil tetapi `storage.configured` bernilai `false`.

### `GET /api/history?limit=500`

Membaca histori yang sudah tersimpan di D1. Endpoint ini membutuhkan binding `DB`.

### `POST /api/analyze`

```json
{
  "history": ["572", "187", "900", "240", "571", "840", "828", "983", "236", "620"],
  "decay": 0.9
}
```

### `POST /api/backtest`

```json
{
  "history": ["572", "187", "900", "240", "571", "840", "828", "983", "236", "620", "161", "717"],
  "decay": 0.9,
  "minTrain": 8,
  "maxTrials": 60
}
```

Untuk setiap target historis, engine hanya memakai draw yang lebih lama dari target tersebut sebagai data latihan.

## Mengaktifkan D1 storage

Worker tetap deployable tanpa D1. Untuk persistence otomatis:

1. Buat Cloudflare D1 database, rekomendasi nama `testkemungkinan-db`.
2. Pada Worker `testkemungkinan`, buka tab **Bindings**.
3. Tambahkan **D1 database** dengan variable name tepat `DB`.
4. Pilih database yang baru dibuat dan simpan binding.
5. Klik `Sync Collector` di dashboard atau tunggu scheduled collector berikutnya.

Schema `results_3d` akan dibuat otomatis pada sync pertama. File SQL yang sama juga tersedia di `migrations/0001_results_3d.sql`.

## Lokal

```bash
npm install
npm run check
npm run dev
```

## Catatan interpretasi

`score` adalah skor relatif untuk mengurutkan 1.000 kandidat, **bukan probabilitas bahwa kandidat akan keluar**. Backtest historis juga bukan jaminan performa hasil berikutnya.

## Roadmap

1. V0.1 — Worker + baseline analyzer
2. V0.2 — interactive analyzer + Top 10 / Top 3 + rolling backtest
3. **V0.3 — live collector + optional D1 storage + dedup period + hourly schedule**
4. V0.4 — deep history import + multi-window / multi-model leaderboard
5. V0.5 — calibration, model comparison, monitoring
6. V1.0 — production dashboard + scheduled collection hardened
