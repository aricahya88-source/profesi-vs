# Profesi Kependidikan Versus v1.3

Website statis berbasis Vite + TypeScript + MediaPipe Hand Landmarker untuk permainan kelas **2 tim besar × 4 sub-tim**.

## Format pertandingan

- Babak 1: A1 vs B1 — 10 Pilihan Ganda
- Babak 2: A2 vs B2 — 10 Benar/Salah
- Babak 3: A3 vs B3 — 5 Menjodohkan
- Babak 4: A4 vs B4 — 10 Pilihan Lebih dari 1

## Perubahan v1.3

- Kamera tampil penuh/transparan sehingga pemain dan tangan tetap terlihat.
- Tim A dan Tim B mendapat **soal berbeda** pada saat bermain.
- Kedua sisi berjalan mandiri; tidak perlu menunggu lawan untuk berpindah soal.
- Setelah jawaban terkunci, soal berikutnya tampil otomatis.
- Tidak ada pembahasan/kunci jawaban yang ditampilkan selama mode VS.
- Jika satu sub-tim selesai lebih cepat, sisi tersebut menunggu sampai lawan menyelesaikan babak.
- Menjodohkan dapat diperbaiki sampai pemain melakukan gesture ✊ KUNCI.
- Bank soal tetap 35 butir: 10 PG + 10 B/S + 5 matching + 10 multi-select.

## Gesture

- Pilihan Ganda: ☝️ A, ✌️ B, 🤟 C (`ILoveYou`), ✋ D, lalu ✊ KUNCI.
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


## Perubahan v1.3
- Pilihan ganda memakai gesture **☝️ A, ✌️ B, 🤟 C (`ILoveYou`), ✋ D**.
- **✊ Closed Fist = KUNCI**. Pilihan PG dan Benar/Salah dapat diubah berkali-kali sebelum dikunci.
- Setelah jawaban dikunci, pemain otomatis masuk ke soal berikutnya.
- Menjodohkan tidak lagi otomatis submit ketika semua pasangan terisi; pemain dapat mengubah pasangan lalu ✊ mengunci.
- Setiap babak memiliki **timer bersama 7 menit**. Saat 00:00, babak berakhir dan hanya skor jawaban yang sudah dikunci yang disimpan.


## Perubahan v1.4
- Gesture **C** diubah menjadi **🤟 ILoveYou**.
- Deteksi C menggunakan pola landmark: telunjuk + kelingking + ibu jari terbuka; jari tengah + manis terlipat.
- Pilihan tetap dapat diubah sebelum **✊ KUNCI**.
- Setelah dikunci, otomatis lanjut ke soal berikutnya.
- Timer tetap **7 menit per babak**.
