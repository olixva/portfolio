// La entrada ya no arranca sola: espera al click de la puerta, que es el gesto
// sin el cual ningun navegador deja sonar el audio. Los tests tienen que
// abrirla igual que un visitante, asi que todos pasan por aqui.
//
// Devuelve false cuando no hay puerta que abrir: con prefers-reduced-motion o
// sin WebGL no se pinta, y esas pruebas siguen valiendo tal cual.
module.exports = async function openGate(page, timeout = 30000) {
  const ready = await page.waitForFunction(() => {
    const gate = document.getElementById('ao-gate');
    if (!gate || getComputedStyle(gate).display === 'none') return 'sin-puerta';
    const enter = document.getElementById('ao-gate-enter');
    return enter && !enter.disabled ? 'lista' : false;
  }, { timeout }).then(handle => handle.jsonValue());
  if (ready === 'sin-puerta') return false;
  await page.click('#ao-gate-enter');
  return true;
};
