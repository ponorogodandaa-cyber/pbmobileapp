// blaze-pedia/README.md
# BLAZE PEDIA — Storefront + License Panel

Toko cheat berbasis web dengan:

- halaman publik: Beranda, Paket, Cara Pasang, Cek Lisensi, Update
- panel owner: tab/dashboard yang dipakai di HP sekalipun (Ringkas, Order, Key, Katalog, Update, Setelan)
- invoice + QRIS
- lisensi unik, expiry, binding 1 device, revoke, extend, canary per pembeli
- download userscript yang diisi key, API URL, dan canary otomatis
- webhook QRIS dengan HMAC

## Struktur

```text
blaze-pedia/
  package.json
  server.js
  README.md
  data/
    template.user.js      # template userscript berlisensi
    db.json               # dibuat otomatis saat pertama jalan
  public/
    index.html            # toko + panel owner
