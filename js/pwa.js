/* =====================================================================
   GUVEL Quality · Instalar como app (Parte A)
   Registra el service worker y maneja el botón "Obtener app": en
   Android/Chrome/Edge dispara el instalador nativo; en iPhone (que no
   tiene ese instalador) muestra los 2 pasos de "Compartir → Agregar a
   inicio".
   ===================================================================== */
import { icon } from "./icons.js";
import { on, openDialog } from "./ui.js";

let deferredPrompt = null;
const isStandalone = () => window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => { navigator.serviceWorker.register("/service-worker.js").catch(() => {}); });
}

/** Deja el botón "Obtener app" listo para mostrarse si: ya hay un instalador disponible (Android/Chrome),
 *  o estamos en iPhone (donde siempre se puede, solo que con los 2 pasos manuales) — y nunca si ya está
 *  instalada. */
export function initInstallButton(renderTopbarExtra) {
  if (isStandalone()) return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    renderTopbarExtra?.();
  });
  window.addEventListener("appinstalled", () => { deferredPrompt = null; renderTopbarExtra?.(); });
}

export const canShowInstallButton = () => !isStandalone() && (!!deferredPrompt || isIOS());

on("pwa-install", async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    return;
  }
  if (isIOS()) {
    openDialog({
      title: "Obtener la app", size: "",
      body: `<div class="stack" style="gap:14px">
        <p>En iPhone/iPad se agrega en 2 pasos, directo desde Safari:</p>
        <div class="note"><b>1.</b> Toca el ícono de Compartir ${icon("share")} en la barra inferior (o superior) de Safari.</div>
        <div class="note"><b>2.</b> Baja y elige «Agregar a inicio».</div>
        <p class="muted" style="font-size:13px">Después de eso, GUVEL Quality queda con su propio ícono, se abre a pantalla completa y podrás recibir notificaciones.</p>
      </div>`,
      footer: `<button class="btn primary" data-close>Entendido</button>`,
    });
    return;
  }
  openDialog({ title: "Obtener la app", body: `<p>Tu navegador todavía no ofrece instalarla directo. Desde Chrome o Edge en Android, intenta de nuevo o usa el menú del navegador → «Instalar app».</p>`, footer: `<button class="btn primary" data-close>Entendido</button>` });
});
