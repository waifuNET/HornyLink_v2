const { SERVER_URL } = require('../cfg');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

async function hasInternetConnection(debug = false, url = SERVER_URL, timeoutMs = 4000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  if(debug) console.log("[TEST] Запрос:", url);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });

    clearTimeout(timeout);

    if(debug) console.log("[TEST] Ответ от сервера:");
    if(debug) console.log("status:", res.status);
    if(debug) console.log("statusText:", res.statusText);

    const text = await res.text();
    if(debug) console.log("body:", text.slice(0, 200));

    return res.status > 0 && res.status < 500;
  } catch (err) {
    clearTimeout(timeout);
    if(debug) console.log("[TEST] Ошибка запроса:");
    if(debug) console.log(err.name, err.message);
    return false;
  }
}

module.exports = {
  hasInternetConnection,
  fetch,
};