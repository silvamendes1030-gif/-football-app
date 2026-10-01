const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());

// CORS: permite abrir a página noutro endereço. Defina CORS_ORIGIN para restringir.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  next();
});
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_FOOTBALL_KEY;
const SEASON = process.env.SEASON || 2026;

if (!API_KEY) {
  console.error("ERRO: defina a variável API_FOOTBALL_KEY (ficheiro .env)");
  process.exit(1);
}

const API_URL = "https://v3.football.api-sports.io";

// Cache em memória para poupar pedidos (a API tem limite diário)
const cache = new Map();

async function football(endpoint, params = {}, ttlSeconds = 300) {
  const url = new URL(API_URL + endpoint);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const cacheKey = url.toString();
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.data;

  const response = await fetch(url, {
    headers: { "x-apisports-key": API_KEY }
  });

  if (!response.ok) {
    throw new Error(`API-Football respondeu ${response.status}`);
  }

  const data = await response.json();

  if (data.errors && Object.keys(data.errors).length > 0) {
    throw new Error(JSON.stringify(data.errors));
  }

  cache.set(cacheKey, { data, expires: Date.now() + ttlSeconds * 1000 });
  return data;
}

const route = (handler) => async (req, res) => {
  try {
    res.json(await handler(req));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ============ ENDPOINTS ORIGINAIS ============ */

app.get("/api/football/status", route(() => football("/status", {}, 0)));

app.get("/api/football/team/:teamId/fixtures", route((req) =>
  football("/fixtures", { team: req.params.teamId, next: req.query.next || 20 })
));

app.get("/api/football/team/:teamId/results", route((req) =>
  football("/fixtures", { team: req.params.teamId, last: 5 })
));

app.get("/api/football/league/:leagueId/fixtures", route((req) =>
  football("/fixtures", { league: req.params.leagueId, season: req.query.season || SEASON })
));

app.get("/api/football/leagues", route(() => football("/leagues", {}, 3600)));

app.get("/api/football/team/:teamId", route((req) =>
  football("/teams", { id: req.params.teamId })
));

app.get("/api/football/league/:leagueId/standings", route((req) =>
  football("/standings", { league: req.params.leagueId, season: req.query.season || SEASON })
));

/* ============ ENDPOINTS DO APP (país > liga > time) ============ */

// Países
app.get("/api/countries", route(async () => {
  const data = await football("/countries", {}, 86400);
  return data.response
    .map((c) => ({ name: c.name, code: c.code, flag: c.flag }))
    .sort((a, b) => a.name.localeCompare(b.name));
}));

// Ligas de um país (todas as divisões que a API tiver)
app.get("/api/leagues", route(async (req) => {
  const { country } = req.query;
  if (!country) throw new Error("Falta o parâmetro country");
  const data = await football("/leagues", { country, season: SEASON }, 3600);
  return data.response
    .map((r) => ({ id: r.league.id, name: r.league.name, type: r.league.type, logo: r.league.logo }))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "League" ? -1 : 1));
}));

// Times de uma liga
app.get("/api/teams", route(async (req) => {
  const { league } = req.query;
  if (!league) throw new Error("Falta o parâmetro league");
  const data = await football("/teams", { league, season: SEASON }, 3600);
  return data.response
    .map((r) => ({ id: r.team.id, name: r.team.name, logo: r.team.logo }))
    .sort((a, b) => a.name.localeCompare(b.name));
}));

// Próximo jogo de um time (o adversário vem do calendário real)
app.get("/api/next", route(async (req) => {
  const { team } = req.query;
  if (!team) throw new Error("Falta o parâmetro team");
  const data = await football("/fixtures", { team, next: 1 }, 600);
  const f = data.response[0];
  if (!f) return null;
  return {
    id: f.fixture.id,
    date: f.fixture.date,
    venue: f.fixture.venue && f.fixture.venue.name,
    competition: f.league.name,
    home: { id: f.teams.home.id, name: f.teams.home.name, logo: f.teams.home.logo },
    away: { id: f.teams.away.id, name: f.teams.away.name, logo: f.teams.away.logo }
  };
}));

// Últimos 5 jogos terminados de um time
async function lastFive(teamId) {
  const data = await football("/fixtures", { team: teamId, last: 5 }, 1800);
  return data.response.map((f) => {
    const isHome = f.teams.home.id === Number(teamId);
    const gf = isHome ? f.goals.home : f.goals.away;
    const ga = isHome ? f.goals.away : f.goals.home;
    return {
      fixtureId: f.fixture.id,
      date: f.fixture.date,
      opponent: isHome ? f.teams.away.name : f.teams.home.name,
      home: isHome,
      gf,
      ga,
      result: gf > ga ? "V" : gf < ga ? "D" : "E"
    };
  });
}

// Total de escanteios (ambos os times) num jogo terminado
async function cornersOf(fixtureId) {
  const data = await football("/fixtures/statistics", { fixture: fixtureId }, 86400);
  let total = 0;
  let found = false;
  for (const t of data.response) {
    const c = t.statistics.find((s) => s.type === "Corner Kicks");
    if (c && c.value !== null) {
      total += Number(c.value);
      found = true;
    }
  }
  return found ? total : null;
}

// Tudo o que o app precisa para analisar um jogo
app.get("/api/match/:fixtureId", route(async (req) => {
  const fixtureId = req.params.fixtureId;
  const withCorners = req.query.corners !== "0";

  const pred = await football("/predictions", { fixture: fixtureId }, 3600);
  const p = pred.response[0];
  if (!p) throw new Error("Sem previsão disponível para este jogo");

  const homeId = p.teams.home.id;
  const awayId = p.teams.away.id;
  const [homeLast, awayLast] = await Promise.all([lastFive(homeId), lastFive(awayId)]);

  let corners = null;
  if (withCorners) {
    const ids = [...homeLast, ...awayLast].map((g) => g.fixtureId);
    const totals = (await Promise.all(ids.map((id) => cornersOf(id).catch(() => null))))
      .filter((n) => n !== null);
    if (totals.length) {
      corners = {
        average: totals.reduce((a, b) => a + b, 0) / totals.length,
        samples: totals.length
      };
    }
  }

  const num = (s) => (s ? parseFloat(String(s).replace("%", "")) : null);

  return {
    percent: {
      home: num(p.predictions.percent.home),
      draw: num(p.predictions.percent.draw),
      away: num(p.predictions.percent.away)
    },
    advice: p.predictions.advice,
    home: { id: homeId, name: p.teams.home.name, logo: p.teams.home.logo, last5: homeLast },
    away: { id: awayId, name: p.teams.away.name, logo: p.teams.away.logo, last5: awayLast },
    corners
  };
}));

app.get("/api/health", (req, res) => {
  res.json({ app: "Football Calendar API", status: "online", liveMatches: false });
});

app.listen(PORT, () => {
  console.log(`Football API funcionando na porta ${PORT}`);
});
