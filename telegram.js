'use strict';

const API_BASE = 'https://api.telegram.org/bot';
const STATE_TTL = 30 * 60 * 1000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const esc = value => String(value == null ? '' : value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const rupiah = value => 'Rp' + Number(value || 0).toLocaleString('id-ID');
const keyboard = rows => ({ inline_keyboard: rows });

module.exports = function startTelegramBot(config) {
  const token = String(config.token || '').trim();
  const ownerId = String(config.ownerId || '').trim();
  const log = config.log || (() => {});

  if (!token) return null;

  const call = async (method, payload) => {
    const response = await fetch(API_BASE + token + '/' + method, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.description || ('HTTP ' + response.status));
    }
    return data.result;
  };

  const sendText = (chatId, text, markup) => call('sendMessage', {
    chat_id: String(chatId),
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(markup ? { reply_markup: markup } : {})
  });

  const answer = callbackId => call('answerCallbackQuery', {
    callback_query_id: callbackId
  }).catch(() => {});

  const states = new Map();

  const stateFor = chatId => {
    let state = states.get(chatId);
    if (!state || state.updatedAt < Date.now() - STATE_TTL) {
      state = { step: 'idle', updatedAt: Date.now() };
      states.set(chatId, state);
    }
    state.updatedAt = Date.now();
    return state;
  };

  const clearState = chatId => {
    states.set(chatId, { step: 'idle', updatedAt: Date.now() });
  };

  const sendQris = async (chatId, qris, caption) => {
    const source = String(qris || '');
    if (!source) return;

    const dataUrl = source.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
    if (dataUrl) {
      const ext = dataUrl[1].toLowerCase() === 'png' ? 'png' : 'jpg';
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
      const bytes = Buffer.from(dataUrl[2], 'base64');
      const form = new FormData();
      form.append('chat_id', String(chatId));
      form.append('caption', caption);
      form.append('photo', new Blob([bytes], { type: mime }), 'qris.' + ext);
      try {
        const response = await fetch(API_BASE + token + '/sendPhoto', {
          method: 'POST',
          body: form
        });
        const data = await response.json().catch(() => ({}));
        if (!data.ok) log('upload QRIS gagal: ' + (data.description || response.status));
      } catch (error) {
        log('upload QRIS gagal: ' + error.message);
      }
      return;
    }

    if (/^https?:\/\//i.test(source)) {
      try {
        await call('sendPhoto', { chat_id: String(chatId), photo: source, caption });
      } catch (error) {
        log('kirim QRIS URL gagal: ' + error.message);
      }
    }
  };

  const mainMenu = () => keyboard([
    [{ text: 'Pesan Akses', callback_data: 'order' }],
    [
      { text: 'Cek Invoice', callback_data: 'invoice' },
      { text: 'Cek Lisensi', callback_data: 'license' }
    ],
    [{ text: 'Bantuan', callback_data: 'help' }]
  ]);

  const showHome = chatId => sendText(
    chatId,
    '<b>BLAZE PEDIA</b>\nAkses PB Kit langsung dari bot.\n\nPilih menu di bawah.',
    mainMenu()
  );

  const showHelp = chatId => sendText(
    chatId,
    '<b>Bantuan</b>\n/order — buat invoice\n/invoice — cek status pembayaran\n/license — cek key\n/cancel — batalkan\n\nBayar QRIS, kirim bukti ke owner. Owner menekan tombol Lunas di bot, lalu key dan file .user.js dikirim otomatis ke sini.',
    mainMenu()
  );

  const showProducts = async chatId => {
    const products = config.getProducts() || [];
    if (!products.length) {
      return sendText(chatId, 'Belum ada produk aktif.', mainMenu());
    }
    const rows = products.map(product => [
      { text: String(product.name).slice(0, 50), callback_data: 'p:' + String(product.id).slice(0, 40) }
    ]);
    rows.push([{ text: 'Kembali', callback_data: 'home' }]);
    return sendText(chatId, '<b>Pilih paket:</b>', keyboard(rows));
  };

  const showDurations = (chatId, productId) => {
    const product = (config.getProducts() || []).find(item => item.id === productId);
    if (!product) return sendText(chatId, 'Produk tidak ditemukan.', mainMenu());
    return sendText(
      chatId,
      '<b>' + esc(product.name) + '</b>\nPilih durasi:',
      keyboard([
        [
          { text: '7 hari · ' + rupiah(product.prices[7]), callback_data: 'd:7' },
          { text: '30 hari · ' + rupiah(product.prices[30]), callback_data: 'd:30' },
          { text: '90 hari · ' + rupiah(product.prices[90]), callback_data: 'd:90' }
        ],
        [{ text: 'Kembali', callback_data: 'order' }]
      ])
    );
  };

  const showInvoice = async (chatId, invoice) => {
    const order = config.getOrder(invoice);
    if (!order) return sendText(chatId, 'Invoice tidak ditemukan.', mainMenu());

    let text = '<b>' + esc(order.invoice) + '</b>\n';
    text += 'Status: <b>' + (order.paid ? 'LUNAS' : 'MENUNGGU BAYAR') + '</b>\n';
    text += esc(order.productName) + ' · ' + order.days + ' hari · ' + rupiah(order.price) + '\n';
    text += 'Nama: ' + esc(order.buyer);

    if (order.licenseKey) {
      text += '\n\nKey: <code>' + esc(order.licenseKey) + '</code>';
      text += '\nExpiry: ' + esc(String(order.expiresAt).slice(0, 10));
    }

    const rows = [[{ text: 'Cek Ulang', callback_data: 'st:' + order.invoice }]];
    const base = String(config.publicUrl() || '').replace(/\/+$/, '');
    if (order.licenseKey && base) {
      rows.push([{
        text: 'Download .user.js',
        url: base + config.makeDownload(order.licenseKey)
      }]);
    }
    rows.push([{ text: 'Menu Utama', callback_data: 'home' }]);

    return sendText(chatId, text, keyboard(rows));
  };

  const showLicense = async (chatId, key) => {
    const license = config.getLicense(key);
    if (!license) return sendText(chatId, 'Lisensi tidak ditemukan.', mainMenu());

    let text = '<b>' + esc(license.key) + '</b>\n';
    text += 'Status: <b>' + esc(String(license.status).toUpperCase()) + '</b>\n';
    text += 'Expiry: ' + esc(String(license.expiresAt).slice(0, 10)) + '\n';
    text += esc(license.productName || '');

    if (license.status === 'active' && Date.parse(license.expiresAt) > Date.now()) {
      const base = String(config.publicUrl() || '').replace(/\/+$/, '');
      if (base) {
        text += '\n' + base + config.makeDownload(license.key);
      }
    }

    return sendText(chatId, text, mainMenu());
  };

  const notifyOwner = async order => {
    if (!ownerId) return;
    const text = '<b>ORDER BARU</b>\n';
    const detail = esc(order.invoice) + '\n' + esc(order.buyer) + ' · ' + esc(order.contact) + '\n' +
      esc(order.productName) + ' · ' + order.days + ' hari · ' + rupiah(order.price);
    try {
      await sendText(ownerId, text + detail, keyboard([
        [
          { text: 'Tandai Lunas', callback_data: 'pay:' + order.invoice },
          { text: 'Cek', callback_data: 'st:' + order.invoice }
        ]
      ]));
    } catch (error) {
      log('notifikasi owner gagal: ' + error.message);
    }
  };

  const confirmPaid = async (chatId, invoice) => {
    if (ownerId && String(chatId) !== ownerId) {
      return sendText(chatId, 'Tombol ini hanya untuk owner.');
    }

    const order = config.getOrder(invoice);
    if (!order) return sendText(chatId, 'Invoice tidak ditemukan.');
    if (order.paid) return sendText(chatId, 'Invoice ini sudah lunas.');

    const license = config.markPaid(invoice);
    if (!license) return sendText(chatId, 'Gagal mengaktifkan invoice.');

    await sendText(
      chatId,
      'Invoice <b>' + esc(invoice) + '</b> lunas.\nKey: <code>' + esc(license.key) + '</code>'
    );

    const buyer = order.telegramChat || '';
    if (!buyer) return;

    try {
      await sendText(
        buyer,
        'Pembayaran <b>' + esc(invoice) + '</b> dikonfirmasi.\n\n' +
          'License key: <code>' + esc(license.key) + '</code>\n' +
          'Expiry: ' + esc(String(license.expiresAt).slice(0, 10)) + '\n\n' +
          'Simpan key ini. File .user.js dikirim berikutnya.',
        keyboard([[{
          text: 'Cek Lisensi',
          callback_data: 'ck:' + license.key
        }]])
      );
    } catch (error) {
      log('kirim key ke pembeli gagal: ' + error.message);
    }

    const base = String(config.publicUrl() || '').replace(/\/+$/, '');
    if (!base) return;

    try {
      await call('sendDocument', {
        chat_id: String(buyer),
        document: base + config.makeDownload(license.key),
        caption: 'File userscript BLAZE PEDIA. Pasang lewat Tampermonkey di Chrome PC.'
      });
    } catch (error) {
      log('kirim file ke pembeli gagal: ' + error.message);
      await sendText(buyer, 'Download manual: ' + base + config.makeDownload(license.key));
    }
  };

  const handleCallback = async callback => {
    await answer(callback.id);
    const chatId = callback.message ? callback.message.chat.id : callback.from.id;
    const data = String(callback.data || '');
    const state = stateFor(chatId);

    if (data === 'home') {
      clearState(chatId);
      return showHome(chatId);
    }
    if (data === 'help') return showHelp(chatId);
    if (data === 'order') {
      state.step = 'idle';
      return showProducts(chatId);
    }
    if (data === 'invoice') {
      state.step = 'invoice';
      return sendText(chatId, 'Ketik nomor invoice:');
    }
    if (data === 'license') {
      state.step = 'license';
      return sendText(chatId, 'Ketik license key:');
    }
    if (data.indexOf('p:') === 0) {
      state.productId = data.slice(2);
      state.step = 'product';
      return showDurations(chatId, state.productId);
    }
    if (data.indexOf('d:') === 0) {
      state.days = Number(data.slice(2));
      state.step = 'buyer';
      return sendText(chatId, 'Kirim nama kamu:');
    }
    if (data.indexOf('st:') === 0) return showInvoice(chatId, data.slice(3));
    if (data.indexOf('ck:') === 0) return showLicense(chatId, data.slice(3));
    if (data.indexOf('pay:') === 0) return confirmPaid(chatId, data.slice(4));

    return sendText(chatId, 'Menu tidak dikenal.', mainMenu());
  };

  const handleMessage = async message => {
    const chatId = message.chat.id;
    const text = String(message.text || '').trim();
    const state = stateFor(chatId);

    log('chat ' + chatId + ': ' + text.slice(0, 60));

    if (text === '/start' || text === '/home') {
      clearState(chatId);
      return showHome(chatId);
    }
    if (text === '/order') {
      state.step = 'idle';
      return showProducts(chatId);
    }
    if (text === '/invoice') {
      state.step = 'invoice';
      return sendText(chatId, 'Ketik nomor invoice:');
    }
    if (text === '/license') {
      state.step = 'license';
      return sendText(chatId, 'Ketik license key:');
    }
    if (text === '/cancel') {
      clearState(chatId);
      return sendText(chatId, 'Dibatalkan.', mainMenu());
    }
    if (text.indexOf('/') === 0) {
      return sendText(chatId, 'Perintah: /start /order /invoice /license /cancel', mainMenu());
    }

    if (state.step === 'buyer') {
      state.buyer = text.slice(0, 80);
      state.step = 'contact';
      return sendText(chatId, 'Kirim kontak (Telegram / WhatsApp / email):');
    }

    if (state.step === 'contact') {
      try {
        const order = config.createOrder({
          productId: state.productId,
          days: state.days,
          buyer: state.buyer,
          contact: text,
          telegramChat: chatId
        });
        clearState(chatId);

        const settings = config.getSettings();
        await sendText(
          chatId,
          '<b>Invoice ' + esc(order.invoice) + '</b>\n' +
            esc(order.productName) + ' · ' + order.days + ' hari · ' + rupiah(order.price) + '\n\n' +
            'Bayar QRIS, lalu kirim bukti ke owner. Setelah dikonfirmasi, key dan file .user.js dikirim ke bot ini.',
          keyboard([
            [{ text: 'Cek Status', callback_data: 'st:' + order.invoice }],
            [{ text: 'Menu Utama', callback_data: 'home' }]
          ])
        );

        await sendQris(chatId, settings.qris, 'QRIS ' + esc(settings.storeName || 'BLAZE PEDIA'));

        if (settings.supportUrl) {
          await sendText(chatId, 'Support: ' + esc(settings.supportUrl));
        }

        await notifyOwner(order);
      } catch (error) {
        await sendText(chatId, 'Gagal membuat invoice: ' + esc(error.message), mainMenu());
      }
      return;
    }

    if (state.step === 'invoice') {
      clearState(chatId);
      return showInvoice(chatId, text.toUpperCase());
    }

    if (state.step === 'license') {
      clearState(chatId);
      return showLicense(chatId, text.toUpperCase());
    }

    return sendText(chatId, 'Pilih menu dulu.', mainMenu());
  };

  let offset = 0;
  let running = true;

  const poll = async () => {
    if (!running) return;

    try {
      const updates = await call('getUpdates', {
        offset,
        timeout: 25,
        allowed_updates: ['message', 'callback_query']
      });

      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);
        try {
          if (update.callback_query) await handleCallback(update.callback_query);
          else if (update.message) await handleMessage(update.message);
        } catch (error) {
          log('handle error: ' + error.message);
        }
      }
    } catch (error) {
      log('poll error: ' + error.message);
      await sleep(3000);
    }

    setTimeout(poll, 250);
  };

  poll();

  return {
    stop: () => { running = false; }
  };
};
