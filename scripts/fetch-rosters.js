#!/usr/bin/env node
// ======================================================================
// 從 TheSportsDB 免費 API 拉取球隊名單（NBA + 歐洲 5 大聯賽）
// 輸出到 data/rosters.json
// 用法：node scripts/fetch-rosters.js
// 注意：每個請求間隔 200ms 避免被限速
// ======================================================================

const fs = require('fs');
const path = require('path');
const https = require('https');

const KEY = '3'; // 公開測試 key
const OUT = path.join(__dirname, '..', 'data', 'rosters.json');
const DELAY_MS = 1200;
const MAX_RETRY = 6;  // 重試 6 次，1015 Cloudflare 封鎖通常 1-2 分鐘

// 要拉的聯賽
const LEAGUES = {
  basketball: [
    { name: 'NBA', query: 'NBA' },
  ],
  football: [
    { name: 'Premier League',    query: 'English%20Premier%20League' },
    { name: 'La Liga',           query: 'Spanish%20La%20Liga' },
    { name: 'Bundesliga',        query: 'German%20Bundesliga' },
    { name: 'Serie A',           query: 'Italian%20Serie%20A' },
    { name: 'Ligue 1',           query: 'French%20Ligue%201' },
  ],
};

// ── HTTPS GET 包成 Promise（含 retry） ──────────────
function getOnce(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 roster-fetch' } }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (body.includes('error code') || body.trim() === '') {
          return reject(new Error('rate-limited or empty'));
        }
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Bad JSON: ' + body.slice(0, 80))); }
      });
    }).on('error', reject);
  });
}

async function get(url) {
  let lastErr;
  for (let i = 0; i < MAX_RETRY; i++) {
    try { return await getOnce(url); }
    catch (e) {
      lastErr = e;
      // Cloudflare 限速時退避等待：10s, 30s, 60s, 90s, 120s, 180s
      const waits = [10, 30, 60, 90, 120, 180];
      const wait = (waits[i] || 180) * 1000;
      console.log(`  ↻ retry ${i+1}/${MAX_RETRY} (${e.message}) — 等 ${wait/1000}s`);
      await sleep(wait);
    }
  }
  throw lastErr;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── 拉某聯賽所有隊伍 ────────────────────────────────
async function fetchTeams(leagueQuery) {
  const url = `https://www.thesportsdb.com/api/v1/json/${KEY}/search_all_teams.php?l=${leagueQuery}`;
  const data = await get(url);
  return data.teams || [];
}

// ── 拉一隊的球員名單 ────────────────────────────────
async function fetchRoster(teamId) {
  const url = `https://www.thesportsdb.com/api/v1/json/${KEY}/lookup_all_players.php?id=${teamId}`;
  const data = await get(url);
  return data.player || [];
}

// ── 把 TheSportsDB 的 player 物件壓縮成我們要的最小結構 ──
function normalizePlayer(p) {
  return {
    id:          p.idPlayer,
    jersey:      p.strNumber || '',
    name:        p.strPlayer,
    position:    p.strPosition || '',
    nationality: p.strNationality || '',
  };
}

function loadExisting() {
  try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); }
  catch (_) { return { football: [], basketball: [] }; }
}

// ── 主流程 ──────────────────────────────────────────
async function main() {
  const existing = loadExisting();
  const out = {
    fetchedAt: new Date().toISOString(),
    football:   existing.football   || [],
    basketball: existing.basketball || [],
  };
  const hasTeam = (sport, id) => out[sport].some(t => t.teamId === id);
  const saveProgress = () => {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  };

  for (const [sport, leagues] of Object.entries(LEAGUES)) {
    for (const lg of leagues) {
      console.log(`\n── ${sport} · ${lg.name} ──`);
      let teams = [];
      try { teams = await fetchTeams(lg.query); }
      catch (e) { console.error(`  [ERR] fetch teams: ${e.message}`); continue; }
      console.log(`  找到 ${teams.length} 隊`);

      for (const t of teams) {
        if (hasTeam(sport, t.idTeam)) {
          console.log(`  ${t.strTeam.padEnd(30)} (略過，已存)`);
          continue;
        }
        await sleep(DELAY_MS);
        let players = [];
        try { players = await fetchRoster(t.idTeam); }
        catch (e) { console.error(`  [ERR] ${t.strTeam}: ${e.message}`); continue; }
        const normalized = players
          .filter(p => {
            if (sport === 'basketball' && p.strSport && p.strSport !== 'Basketball') return false;
            if (sport === 'football'   && p.strSport && p.strSport !== 'Soccer') return false;
            return p.strPlayer && p.strPlayer.trim().length > 0;
          })
          .map(normalizePlayer);

        out[sport].push({
          teamId: t.idTeam,
          name:   t.strTeam,
          short:  t.strTeamShort || '',
          league: lg.name,
          logo:   t.strTeamBadge || '',
          players: normalized,
        });
        console.log(`  ${t.strTeam.padEnd(30)} → ${normalized.length} 人`);
        saveProgress();
      }
    }
  }

  // 統計
  const stat = (arr) => arr.reduce((a, t) => a + t.players.length, 0);
  console.log(`\n── 總計 ──`);
  console.log(`  足球：${out.football.length} 隊，${stat(out.football)} 位球員`);
  console.log(`  籃球：${out.basketball.length} 隊，${stat(out.basketball)} 位球員`);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\n輸出：${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
