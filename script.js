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
async
