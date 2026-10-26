"use strict";
const TOP = 50;
let players = new Map(), list = null;
const CODES = {};
const $ = id => document.getElementById(id);
const norm = s => s.toLowerCase().replace(/\[[^\]]*\]/g, "").replace(/[^a-z0-9]/g, "");
const strip = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = n => n.toLocaleString("pt-BR");
const fp = n => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = s => parseFloat(String(s ?? "").replace(/\./g, "").replace(",", ".")) || 0;

/* ---- leitor mínimo de SQLite (sem bibliotecas externas) ---- */
function vi(a, o) { let v = 0; for (let i = 0; i < 8; i++) { const b = a[o + i]; v = v * 128 + (b & 127); if (b < 128) return [v, i + 1]; } return [v * 256 + a[o + 8], 9]; }
function parseRec(d) {
  const [hs, l] = vi(d, 0); let o = l, types = [];
  while (o < hs) { const [t, n] = vi(d, o); types.push(t); o += n; }
  let p = hs; const out = [];
  for (const t of types) {
    let sz = 0, v = null;
    if (t === 0) v = null;
    else if (t >= 1 && t <= 6) { sz = [0, 1, 2, 3, 4, 6, 8][t]; let x = 0; for (let i = 0; i < sz; i++) x = x * 256 + d[p + i]; if (d[p] & 128) x -= Math.pow(256, sz); v = x; }
    else if (t === 7) { sz = 8; v = new DataView(d.buffer, d.byteOffset + p, 8).getFloat64(0); }
    else if (t === 8) v = 0; else if (t === 9) v = 1;
    else if (t >= 12) { sz = t % 2 === 0 ? (t - 12) / 2 : (t - 13) / 2; const s = d.subarray(p, p + sz); v = t % 2 === 0 ? s.slice() : new TextDecoder().decode(s); }
    p += sz; out.push(v);
  }
  return out;
}
function readTable(buf, tbl) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  if (new TextDecoder().decode(u8.subarray(0, 15)) !== "SQLite format 3") throw new Error("não é um banco SQLite");
  let ps = dv.getUint16(16); if (ps === 1) ps = 65536;
  const U = ps - u8[20];
  function cell(c) {
    let [pl, a] = vi(u8, c); const [, b] = vi(u8, c + a); const p = c + a + b, X = U - 35;
    if (pl <= X) return parseRec(u8.slice(p, p + pl));
    const M = Math.floor((U - 12) * 32 / 255) - 23; let K = M + ((pl - M) % (U - 4)); if (K > X) K = M;
    const data = new Uint8Array(pl); data.set(u8.subarray(p, p + K));
    let got = K, ov = dv.getUint32(p + K);
    while (ov && got < pl) { const ob = (ov - 1) * ps, n = Math.min(U - 4, pl - got); data.set(u8.subarray(ob + 4, ob + 4 + n), got); got += n; ov = dv.getUint32(ob); }
    return parseRec(data);
  }
  function walk(pg, cb) {
    const b = (pg - 1) * ps, h = b + (pg === 1 ? 100 : 0), t = u8[h], n = dv.getUint16(h + 3);
    if (t === 13) for (let i = 0; i < n; i++) cb(cell(b + dv.getUint16(h + 8 + 2 * i)));
    else if (t === 5) { for (let i = 0; i < n; i++) walk(dv.getUint32(b + dv.getUint16(h + 12 + 2 * i)), cb); walk(dv.getUint32(h + 8), cb); }
  }
  let root = 0; walk(1, r => { if (r[0] === "table" && r[1] === tbl) root = r[3]; });
  if (!root) throw new Error("tabela " + tbl + " não encontrada");
  const rows = []; walk(root, r => rows.push(r)); return rows;
}
async function gunzip(u8) {
  if (u8[0] !== 0x1f || u8[1] !== 0x8b) return new TextDecoder().decode(u8);
  return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

/* ---- importação do scores.db ---- */
async function importDb(file) {
  const rows = readTable(await file.arrayBuffer(), "song_scores");
  let n = 0;
  for (const [dir, blob] of rows) {
    const xml = new DOMParser().parseFromString((await gunzip(blob)).trim(), "text/xml");
    const song = dir.replace(/\/+$/, "").split("/").pop(), pack = dir.split("/")[1] || "";
    for (const st of xml.getElementsByTagName("Steps")) {
      const stype = st.getAttribute("StepsType") || "", meter = st.getAttribute("Meter") || "", desc = st.getAttribute("Description") || "";
      const chart = (stype === "pump-double" ? "D" : stype === "pump-single" ? "S" : stype) + meter + (desc && !/^[SD]\d+$/.test(desc) ? " · " + desc : "");
      for (const hs of st.getElementsByTagName("HighScore")) {
        const g = t => hs.getElementsByTagName(t)[0]?.textContent || "";
        if (g("Disqualified") === "1") continue;
        const ps = parseInt(g("PhoenixScore"), 10); if (!(ps >= 0)) continue;
        const guid = g("PlayerGuid") || "desconhecido", key = dir + "|" + stype + "|" + meter + "|" + desc;
        const P = players.get(guid) || { guid, name: g("ScoreName") || guid, recs: new Map() };
        players.set(guid, P);
        const pb = g("PhoenixPlate");
        if (!P.recs.has(key)) P.recs.set(key, []);
        P.recs.get(key).push({ key, song, pack, chart, lvl: parseInt(meter, 10), ps, pts: 0, pct: parseFloat(g("PercentScore")) || 0, grade: g("PhoenixGrade"), plate: pb ? pb + " Game" : "" });
        if (g("ScoreName")) P.name = g("ScoreName");
        n++;
      }
    }
  }
  return n;
}

/* ---- pontuação (prévia na tela; o valor oficial é calculado no Apps Script) ---- */
const PLP = { perfect: 1, ultimate: .9, extreme: .85, superb: .8, marvelous: .75, talented: .7, fair: .5, rough: .25 };
const NTP = { "SSS+": 1, "SSS": .95, "SS+": .9, "SS": .85, "S+": .8, "S": .75, "AAA+": .7, "AAA": .65, "AA+": .6, "AA": .5, "A+": .25, "A": .1 };
function ptsOf(r, e) {
  const p = PLP[(r.plate || "").toLowerCase().replace(" game", "").trim()];
  if (p === undefined) return 0;
  return r.ps / 1000000 * (e.lvlPts + e.bonus) + e.notaPts * (NTP[(r.grade || "").toUpperCase()] || 0) + e.platePts * p;
}
function records(P) {
  let recs = [...P.recs.values()].flat();
  if (list) {
    const best = new Map();
    for (const r of recs) {
      const s = norm(r.song); let m = -1, ml = 0;
      list.forEach((e, i) => { if (e.n.length >= 3 && s.includes(e.n) && (!e.lvl || e.lvl === r.lvl) && e.n.length > ml) { m = i; ml = e.n.length; } });
      if (m < 0) continue; const e = list[m];
      const c = { ...r, entry: e.name, pts: ptsOf(r, e), invalid: !r.plate };
      const b = best.get(m); if (!b || c.pts > b.pts || (c.pts === b.pts && c.ps > b.ps)) best.set(m, c);
    }
    recs = [...best.values()];
    list.forEach((e, i) => { if (!best.has(i)) recs.push({ song: e.name, pack: "", chart: e.lvl ? "Lvl " + e.lvl : "", lvl: e.lvl, ps: 0, pts: 0, grade: "", plate: "", entry: e.name, played: false }); });
  }
  recs.sort((a, b) => b.pts - a.pts || b.ps - a.ps || a.song.localeCompare(b.song));
  recs.forEach((r, i) => r.top = r.played !== false && !r.invalid && i < TOP);
  return recs;
}
function render() {
  const all = [...players.values()].map(P => { const r = records(P); return { P, r, n: r.filter(y => y.played !== false).length, total: r.filter(x => x.top).reduce((s, x) => s + x.pts, 0) }; });
  all.sort((a, b) => b.total - a.total);
  $("res").hidden = !all.length;
  $("lb").innerHTML = "<tr><th>#</th><th>Jogador</th><th class='n'>Pontuação geral</th><th class='n'>Músicas contadas</th><th class='n'>Músicas com score</th><th>Código</th><th></th></tr>" +
    all.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.P.name)}</td><td class="n tot">${fp(x.total)}</td><td class="n">${Math.min(x.n, TOP)}/${TOP}</td><td class="n">${x.n}${list ? "/" + x.r.length : ""}</td><td><input class="code" data-g="${esc(x.P.guid)}" value="${esc(CODES[x.P.guid] || "")}" placeholder="Código" autocomplete="off"></td><td><button class="pri send1" data-g="${esc(x.P.guid)}">Enviar</button></td></tr>`).join("");
  $("players").innerHTML = all.map(x => `<details><summary><span class="nm">${esc(x.P.name)}</span><span class="pill">${x.n}${list ? "/" + x.r.length : ""} scores</span><span class="tot">${fp(x.total)}</span></summary><div class="scroll"><table><tr><th>#</th><th>Música</th><th>Pacote</th><th>Chart</th><th class="n">Score</th><th>Grade</th><th>Plate</th><th class="n">Pontos</th><th>Top ${TOP}</th></tr>` +
    x.r.map((r, i) => `<tr class="${r.top ? "" : "out"}"><td>${i + 1}</td><td>${esc(r.song)}</td><td>${esc(r.pack)}</td><td>${esc(r.chart)}</td><td class="n">${r.played === false ? "—" : fmt(r.ps)}</td><td>${esc(r.grade)}</td><td>${esc(r.plate)}</td><td class="n tot">${r.played === false ? "Não jogada" : r.invalid ? "Sem pass" : fp(r.pts)}</td><td>${r.top ? "✓" : ""}</td></tr>`).join("") +
    `</table></div></details>`).join("");
  window._all = all;
}

/* ---- exportação CSV ---- */
$("exp").onclick = () => {
  const q = s => '"' + String(s).replace(/"/g, '""') + '"';
  const L = [["Jogador", "Posição", "Música", "Pacote", "Chart", "Score", "Grade", "Plate", "Pontos", "Conta no Top " + TOP].map(q).join(";")];
  for (const x of window._all) x.r.forEach((r, i) => L.push([x.P.name, i + 1, r.song, r.pack, r.chart, r.played === false ? "" : r.ps, r.grade, r.played === false ? "Não jogada" : r.plate, r.pts.toFixed(2).replace(".", ","), r.top ? "Sim" : "Não"].map(q).join(";")));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff" + L.join("\r\n")], { type: "text/csv" }));
  a.download = "gods-of-mods-scores.csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  const m = $("msgexp"); m.className = "msg ok"; m.textContent = "Arquivo gerado. Abra o CSV no Excel ou Google Planilhas.";
};

/* ---- importar arquivos ---- */
async function handleDb(files) {
  const m = $("msgdb"); m.className = "msg"; m.textContent = "Lendo…";
  try {
    let n = 0; for (const f of files) n += await importDb(f);
    render(); if (!list) loadList(); m.className = "msg ok"; m.textContent = `${files.length} arquivo(s) importado(s): ${n} scores lidos, ${players.size} jogador(es) no total.`;
  } catch (e) { m.className = "msg err"; m.textContent = "Erro ao ler o arquivo: " + e.message; }
}
const drop = $("drop");
drop.onclick = () => $("fdb").click();
$("fdb").onchange = e => { handleDb([...e.target.files]); e.target.value = ""; };
drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); handleDb([...e.dataTransfer.files]); };

/* ---- lista de músicas (vem do Apps Script) ---- */
async function loadList() {
  const m = $("msglist"); m.className = "msg"; m.textContent = "Lendo a lista…";
  try {
    const d = await apiGet("list"), seen = new Set();
    list = d.list.map(x => ({ ...x, n: norm(x.name) })).filter(x => x.n && !seen.has(x.n + "|" + x.lvl) && seen.add(x.n + "|" + x.lvl));
    m.className = "msg ok"; m.textContent = list.length + " músicas na lista do evento."; render();
  } catch (e) { list = null; m.className = "msg err"; m.textContent = "Não foi possível ler a lista: " + (e.message || ""); }
}
$("loadlist").onclick = loadList;
loadList();

/* ---- envio com código do jogador ---- */
$("lb").oninput = e => { if (e.target.classList.contains("code")) CODES[e.target.dataset.g] = e.target.value; };
$("lb").onclick = e => { const b = e.target.closest(".send1"); if (b) sendOne(b.dataset.g, b); };
async function sendOne(g, btn) {
  const x = window._all.find(y => y.P.guid === g), m = $("msgsend"), code = (CODES[g] || "").trim();
  m.className = "msg";
  if (!code) { m.className = "msg err"; m.textContent = "Digite o código do jogador " + x.P.name + "."; return; }
  if (!list) await loadList();
  if (!list) { m.className = "msg err"; m.textContent = "Não foi possível carregar a lista de músicas."; return; }
  const scores = x.r.filter(r => r.played !== false && !r.invalid).map(r => ({ entry: r.entry, lvl: r.lvl, ps: r.ps, pct: r.pct, grade: r.grade, plate: r.plate }));
  btn.disabled = true; m.textContent = "Enviando " + x.P.name + "…";
  try {
    const res = await apiPost({ action: "submit", code, guid: g, scores });
    if (!res.ok) throw new Error(res.error || "falha no envio");
    m.className = "msg ok"; m.textContent = res.message;
  } catch (err) { m.className = "msg err"; m.textContent = "Erro ao enviar: " + (err.message || ""); }
  btn.disabled = false;
}

/* ---- ranking geral (leitura pública, a cada 30 s) ---- */
let rkTimer = null, rkBusy = false;
async function loadRanking() {
  if (rkBusy) return; rkBusy = true;
  const m = $("rkmsg"); m.className = "msg";
  try {
    const d = await apiGet("ranking"), rows = d.rows || [], med = ["🥇", "🥈", "🥉"];
    $("rktb").innerHTML = "<tr><th>Rank</th><th>Jogador</th><th class='n'>Godbility</th></tr>" + (rows.length ? rows.map((r, i) => `<tr><td>${i < 3 ? med[i] + "🏅" : ""}{esc(r[0] || i + 1)}</td><td>${esc(r[1])}</td><td class="n tot">${esc(r[2] || "0,00")}</td></tr>`).join("") : "<tr><td colspan='3'>Nenhum jogador no ranking ainda.</td></tr>");
    m.textContent = "Atualizado às " + new Date().toLocaleTimeString("pt-BR") + " (a cada 30 s)";
  } catch (e) { m.className = "msg err"; m.textContent = "Não foi possível ler o ranking."; }
  rkBusy = false;
}

/* ---- ranking por música ---- */
let SD = null, SL = [], SAt = 0, SCUR = null, ST = 0;
async function loadSongs() {
  const m = $("smsg"); m.className = "msg"; m.textContent = "Lendo os dados dos jogadores…";
  try {
    const d = await apiGet("songs"), names = new Map(), D = new Map();
    d.list.forEach(x => names.set(norm(x.name) + "|" + x.lvl, { name: x.name, lvl: x.lvl }));
    for (const pl of d.players) {
      for (const r of pl.rows) {
        const l = parseInt(r[1], 10) || 0, k = norm(r[2]) + "|" + l;
        if (!names.has(k)) names.set(k, { name: r[2], lvl: l });
        if (!(r[4] || num(r[8]) > 0)) continue;
        if (!D.has(k)) D.set(k, []);
        D.get(k).push({ p: pl.tab, nota: r[4] || "", plate: r[5] || "", score: r[6] || "", pct: r[7] || "", pts: r[8] || "0", v: num(r[8]) });
      }
    }
    SD = D; SAt = Date.now();
    SL = [...names].map(([key, o]) => ({ key, ...o })).sort((a, b) => a.name.localeCompare(b.name) || a.lvl - b.lvl);
    m.textContent = "Atualizado às " + new Date().toLocaleTimeString("pt-BR");
    fillSongs();
  } catch (e) { m.className = "msg err"; m.textContent = "Não foi possível ler os dados."; }
}
let SO = { by: "name", dir: 1 };
function sortSongs(a) {
  const d = SO.dir;
  return a.sort((x, y) => SO.by === "lvl"
    ? (x.lvl - y.lvl) * d || x.name.localeCompare(y.name)
    : x.name.localeCompare(y.name) * d || x.lvl - y.lvl);
}
function updSort() {
  const ar = SO.dir === 1 ? " ↑" : " ↓";
  $("so-name").classList.toggle("on", SO.by === "name");
  $("so-lvl").classList.toggle("on", SO.by === "lvl");
  $("so-name").textContent = "Nome" + (SO.by === "name" ? ar : "");
  $("so-lvl").textContent = "Nível" + (SO.by === "lvl" ? ar : "");
}
function setSort(by) {
  if (SO.by === by) SO.dir *= -1; else { SO.by = by; SO.dir = 1; }
  updSort(); if (SD) fillSongs();
}
let SO = { by: "name", dir: 1 };
function sortSongs(a) {
  const d = SO.dir;
  return a.sort((x, y) => SO.by === "lvl"
    ? (x.lvl - y.lvl) * d || x.name.localeCompare(y.name)
    : x.name.localeCompare(y.name) * d || x.lvl - y.lvl);
}
function updSort() {
  const ar = SO.dir === 1 ? " ↑" : " ↓", n = $("so-name"), l = $("so-lvl");
  if (!n || !l) return;
  n.classList.toggle("on", SO.by === "name");
  l.classList.toggle("on", SO.by === "lvl");
  n.textContent = "Nome" + (SO.by === "name" ? ar : "");
  l.textContent = "Nível" + (SO.by === "lvl" ? ar : "");
}
function setSort(by) {
  if (SO.by === by) SO.dir *= -1; else { SO.by = by; SO.dir = 1; }
  updSort(); if (SD) fillSongs();
}
function fillSongs() {
   const q = norm($("sq").value), arr = sortSongs(SL.filter(s => !q || norm(s.name).includes(q)));
  $("scount").textContent = arr.length + " música" + (arr.length === 1 ? "" : "s");
  $("ssel").innerHTML = arr.map(s => `<button class="song${s.key === SCUR ? " on" : ""}" data-k="${esc(s.key)}"><span>${esc(s.name)}</span><b class="lv ${s.lvl >= 20 ? "hi" : ""}">${s.lvl || "?"}</b></button>`).join("") || "<div class='msg'>Nenhuma música encontrada.</div>";
  renderSong();
}
const PC = { perfect: "#e6a700", ultimate: "#a23cf0", extreme: "#e0453a", superb: "#2f7de1", marvelous: "#1aa36b", talented: "#14a3a3", fair: "#8a8aa0", rough: "#8a8aa0" };
function renderSong() {
  const s = SL.find(x => x.key === SCUR), box = $("sres");
  if (!s) { box.innerHTML = ""; $("smenu").hidden = false; box.hidden = true; return; }
  const rows = (SD.get(s.key) || []).slice().sort((a, b) => b.v - a.v);
  const hd = `<button id="sback" class="back">← Voltar à lista</button><div class="rhead"><h3>${esc(s.name)}</h3><b class="lv ${s.lvl >= 20 ? "hi" : ""}">Lv ${s.lvl}</b><span class="pill">${rows.length} jogador${rows.length === 1 ? "" : "es"}</span></div>`;
  box.innerHTML = hd + (rows.length ? rows.map((r, i) => {
    const c = PC[strip(r.plate).replace("game", "")] || "#8a8aa0";
    return `<div class="rk r${i + 1}"><div class="pos">${i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</div><div class="who"><b>${esc(r.p)}</b><span><i class="pl" style="background:${c}"></i>${esc(r.plate) || "—"}${r.nota ? " · " + esc(r.nota) : ""}</span></div><div class="sc"><span>${esc(r.score)}</span><small>${r.pct ? esc(r.pct) + "%" : ""}</small></div><div class="gb">${esc(r.pts)}</div></div>`;
  }).join("") : "<div class='empty'>Ninguém jogou esta música ainda.</div>");
}
function setSongView(res) {
  if (res) ST = $("ssel").scrollTop;
  $("smenu").hidden = res; $("sres").hidden = !res;
  if (!res) $("ssel").scrollTop = ST;
}
$("sq").oninput = () => { if (SD) fillSongs(); };
$("sres").onclick = e => { if (e.target.closest("#sback")) setSongView(false); };
$("ssel").onclick = e => { const b = e.target.closest(".song"); if (!b) return; SCUR = b.dataset.k; $("ssel").querySelectorAll(".song").forEach(x => x.classList.toggle("on", x === b)); renderSong(); setSongView(true); };
$("sref").onclick = loadSongs;
if ($("so-name")) $("so-name").onclick = () => setSort("name");
if ($("so-lvl")) $("so-lvl").onclick = () => setSort("lvl");

/* ---- abas ---- */
function showTab(t) {
  for (const k of ["imp", "rk", "song"]) { $("tab-" + k).hidden = t !== k; $("t-" + k).classList.toggle("on", t === k); }
  clearInterval(rkTimer);
  if (t === "rk") { loadRanking(); rkTimer = setInterval(loadRanking, 30000); }
  if (t === "song" && (!SD || Date.now() - SAt > 60000)) loadSongs();
}
$("t-imp").onclick = () => showTab("imp");
$("t-rk").onclick = () => showTab("rk");
$("t-song").onclick = () => showTab("song");
$("rkref").onclick = loadRanking;

/* ---- tema claro/escuro ---- */
const curTheme = () => document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
function applyTheme(t) { document.documentElement.dataset.theme = t; $("theme").textContent = t === "dark" ? "☀️ Tema claro" : "🌙 Tema escuro"; }
try { const s = localStorage.getItem("gom-theme"); if (s) document.documentElement.dataset.theme = s; } catch (e) {}
applyTheme(curTheme());
$("theme").onclick = () => { const t = curTheme() === "dark" ? "light" : "dark"; applyTheme(t); try { localStorage.setItem("gom-theme", t); } catch (e) {} };
$("clr").onclick = () => { players = new Map(); $("msgdb").textContent = ""; render(); };
