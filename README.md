# Profesi Kependidikan Versus

Website statis **2 tim besar × 4 sub-tim** berbasis MediaPipe Hand Landmarker untuk materi **Profesionalisme, Etika, dan Ekosistem Tenaga Kependidikan**.

## Format tim

- **Tim A** memiliki sub-tim A1, A2, A3, A4.
- **Tim B** memiliki sub-tim B1, B2, B3, B4.
- Nama tim besar dan seluruh sub-tim dapat diganti pada layar awal.
- Skor sub-tim otomatis dijumlahkan menjadi skor total tim besar.

## Babak dan pasangan aktif

1. **A1 vs B1** — Pilihan Ganda — 10 soal — gesture 1–4 jari untuk A–D.
2. **A2 vs B2** — Benar/Salah — 10 soal — thumbs up / thumbs down.
3. **A3 vs B3** — Menjodohkan — 5 soal — pointer + pinch drag & drop.
4. **A4 vs B4** — Pilihan Lebih dari 1 — 10 soal — pointer + pinch, kepalan untuk submit.

Pada setiap ronde, kedua sub-tim aktif menerima **soal dan urutan opsi yang sama**. Urutan soal diacak ulang ketika pertandingan dimulai. Setelah babak berakhir, pemain di depan kamera berganti ke pasangan sub-tim berikutnya.

## Menjalankan lokal

```bash
npm install
npm run dev
```

Buka alamat localhost yang diberikan Vite. Kamera hanya dapat digunakan pada `localhost` atau situs HTTPS.

## Build

```bash
npm run build
```

Hasil build berada di folder `dist/` dan dapat di-deploy sebagai website statis ke Vercel/Netlify.

## Catatan

- Video kamera diproses di browser.
- Mouse/touch mode tersedia untuk pengujian tanpa kamera.
- Bank soal berada di `src/data/questions.json`.
