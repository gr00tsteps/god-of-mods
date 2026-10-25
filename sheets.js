"use strict";
const API_URL = "COLE_AQUI_A_URL_DO_APPS_SCRIPT"; // termina em /exec

async function apiGet(action) {
  const r = await fetch(API_URL + "?action=" + encodeURIComponent(action) + "&t=" + Date.now());
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}
async function apiPost(body) {
  const r = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
  return r.json();
}