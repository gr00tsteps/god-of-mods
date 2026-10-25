"use strict";
const API_URL = "https://script.google.com/macros/s/AKfycbz3ZUOa38sK8TMIYimgnz6yb7GjjsMgsMTV1eqZdiBJuJNMS5LqvTolbuBRVlVje2qMKw/exec"; // termina em /exec

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
