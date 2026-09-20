# Profesi Kependidikan Versus v1.2

Website statis berbasis Vite + TypeScript + MediaPipe Hand Landmarker untuk permainan kelas **2 tim besar × 4 sub-tim**.

## Format pertandingan

- Babak 1: A1 vs B1 — 10 Pilihan Ganda
- Babak 2: A2 vs B2 — 10 Benar/Salah
- Babak 3: A3 vs B3 — 5 Menjodohkan
- Babak 4: A4 vs B4 — 10 Pilihan Lebih dari 1

## Perubahan v1.2

- Kamera tampil penuh/transparan sehingga pemain dan tangan tetap terlihat.
- Tim A dan Tim B mendapat **soal berbeda** pada saat bermain.
- Kedua sisi berjalan mandiri; tidak perlu menunggu lawan untuk berpindah soal.
- Setelah jawaban terkunci, soal berikutnya tampil otomatis.
- Tidak ada pembahasan/kunci jawaban yang ditampilkan selama mode VS.
- Jika satu sub-tim selesai lebih cepat, sisi tersebut menunggu sampai lawan menyelesaikan babak.
- Menjodohkan otomatis mengunci setelah semua pasangan terisi.
- Bank soal tetap 35 butir: 10 PG + 10 B/S + 5 matching + 10 multi-select.

## Gesture

- Pilihan Ganda: 1 jari=A, 2=B, 3=C, 4=D.
- Benar/Salah: 👍 Benar, 👎 Salah.
- Menjodohkan: telunjuk sebagai pointer, pinch untuk mengambil, gerakkan, lalu lepas.
- Multi-select: pointer + pinch untuk memilih; kepalan tangan untuk mengunci.

## Menjalankan lokal

```bash
npm install
npm run dev
```

## Pemeriksaan

```bash
npm run check
```

> Akses kamera memerlukan HTTPS atau localhost pada browser modern. Video diproses di browser.
