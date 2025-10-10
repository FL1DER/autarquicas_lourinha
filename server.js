// server.js — API + Site público + Backoffice local (Express + PostgreSQL)
// Requisitos: "type": "module" no package.json

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pg from 'pg';
const { Pool } = pg;
import path from 'path';
import { fileURLToPath } from 'url';

// -------------------------------
// Paths e config base
// -------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ Falta DATABASE_URL no .env');
  process.exit(1);
}

// -------------------------------
// App & DB
// -------------------------------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true); // mantém true se estiveres atrás de proxy/CDN

app.use(helmet({
  contentSecurityPolicy: false,                 // não impõe CSP por agora
  crossOriginEmbedderPolicy: false,             // evita bloquear recursos cross-origin
  crossOriginResourcePolicy: { policy: "cross-origin" } // deixa carregar de CDN
}));

app.use(cors());              // público: /api/snapshot e /api/stream
app.use(express.json());

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
});

// -------------------------------
// Helpers (IPs locais / utilitários)
// -------------------------------
function getClientIp(req) {
  const xfwd = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(xfwd) ? xfwd[0] : (xfwd || '')).split(',')[0].trim()
    || req.socket?.remoteAddress
    || req.ip
    || '';
  return ip;
}
function isLocal(req) {
  const ip = getClientIp(req);
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.endsWith('127.0.0.1') ||     // ::ffff:127.0.0.1
    ip === 'localhost'
  );
}
function requireLocal(req, res, next) {
  if (isLocal(req)) return next();
  return res.status(403).send('Backoffice disponível apenas localmente.');
}
const ZERO_TOTAIS = { votos_ad:0, votos_ps:0, votos_chega:0, votos_cdu:0, brancos:0, nulos:0, validos:0 };
const rowOrZero = (row) => row || { ...ZERO_TOTAIS, mesas_apuradas: 0 };


// ---- Helper: D'Hondt seats ----
function dhondtSeats(votesMap, totalSeats) {
  // votesMap: { AD: number, PS: number, CHEGA: number, CDU: number }
  const parties = Object.keys(votesMap);
  const quotients = [];
  for (const p of parties) {
    for (let d = 1; d <= totalSeats; d++) {
      quotients.push({ party: p, value: votesMap[p] / d });
    }
  }
  quotients.sort((a, b) => b.value - a.value);
  const top = quotients.slice(0, totalSeats);
  const seats = Object.fromEntries(parties.map(p => [p, 0]));
  for (const q of top) seats[q.party]++;
  return seats;
}

// ---- Helper: lugares garantidos dado R "livres" ----
function guaranteedSeatsLowerBound(currentVotes, remainingPotential, totalSeats) {
  const parties = Object.keys(currentVotes);
  // pior caso para cada partido P: atribuir todos os R a um único adversário Q
  const worstFor = Object.fromEntries(parties.map(p => [p, Infinity]));

  for (const q of parties) {
    const scenario = Object.fromEntries(parties.map(p => [p, currentVotes[p]]));
    scenario[q] += remainingPotential; // tudo para Q
    const seats = dhondtSeats(scenario, totalSeats);
    for (const p of parties) {
      worstFor[p] = Math.min(worstFor[p], seats[p]);
    }
  }
  return worstFor; // mínimo garantido por partido
}

// ---- Extrair votos só de freguesias FECHADAS (por ato) ----
function aggregateClosed(parRows) {
  // parRows tem: freguesia_id, inscritos, votos_ad, votos_ps, votos_chega, votos_cdu, mesas_apuradas, mesas_total
  const parties = ['votos_ad','votos_ps','votos_chega','votos_cdu'];
  const totals = { AD:0, PS:0, CHEGA:0, CDU:0 };
  let remainingPotential = 0; // soma de inscritos das NÃO fechadas

  for (const r of parRows) {
    const closed = Number(r.mesas_apuradas) === Number(r.mesas_total) && Number(r.mesas_total) > 0;
    if (closed) {
      totals.AD     += Number(r.votos_ad || 0);
      totals.PS     += Number(r.votos_ps || 0);
      totals.CHEGA  += Number(r.votos_chega || 0);
      totals.CDU    += Number(r.votos_cdu || 0);
    } else {
      remainingPotential += Number(r.inscritos || 0);
    }
  }
  return { currentVotes: totals, remainingPotential };
}


// (Opcional) traduzir chaves para algo mais friendly no JSON final
const mapPretty = (obj) => ({
  AD: obj.AD|0, PS: obj.PS|0, CHEGA: obj.CHEGA|0, CDU: obj.CDU|0
});

// -------------------------------
// API — Leitura pública
// -------------------------------

// Snapshot para o site público
// Snapshot para o site público
app.get('/api/snapshot', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      // inscritos (concelho) + lista de freguesias
      const inscritosMunicipioQ = client.query(`
        SELECT COALESCE(SUM(inscritos),0)::int AS inscritos
        FROM freguesias
      `);
      const freguesiasQ = client.query(`
        SELECT id AS freguesia_id, nome AS freguesia_nome, inscritos::int AS inscritos
        FROM freguesias
        ORDER BY nome
      `);

      // Totais do concelho por ato
      const camaraTotQ = client.query(`
        SELECT
          COALESCE(votos_ad,0)::int       AS votos_ad,
          COALESCE(votos_ps,0)::int       AS votos_ps,
          COALESCE(votos_chega,0)::int    AS votos_chega,
          COALESCE(votos_cdu,0)::int      AS votos_cdu,
          COALESCE(brancos,0)::int        AS brancos,
          COALESCE(nulos,0)::int          AS nulos,
          COALESCE(validos,0)::int        AS validos,
          COALESCE(mesas_apuradas,0)::int AS mesas_apuradas
        FROM v_agg_municipio_por_ato
        WHERE ato='camara'
      `);
      const assemTotQ = client.query(`
        SELECT
          COALESCE(votos_ad,0)::int       AS votos_ad,
          COALESCE(votos_ps,0)::int       AS votos_ps,
          COALESCE(votos_chega,0)::int    AS votos_chega,
          COALESCE(votos_cdu,0)::int      AS votos_cdu,
          COALESCE(brancos,0)::int        AS brancos,
          COALESCE(nulos,0)::int          AS nulos,
          COALESCE(validos,0)::int        AS validos,
          COALESCE(mesas_apuradas,0)::int AS mesas_apuradas
        FROM v_agg_municipio_por_ato
        WHERE ato='assembleia'
      `);

      // Câmara por freguesia (sempre 9 linhas) + mesas_total
      const camaraParQ = client.query(`
        WITH mt AS (
          SELECT freguesia_id, COUNT(*)::int AS mesas_total
          FROM mesas_voto
          GROUP BY freguesia_id
        )
        SELECT
          f.id   AS freguesia_id,
          f.nome AS freguesia_nome,
          f.inscritos::int AS inscritos,
          COALESCE(v.votos_ad,0)::int       AS votos_ad,
          COALESCE(v.votos_ps,0)::int       AS votos_ps,
          COALESCE(v.votos_chega,0)::int    AS votos_chega,
          COALESCE(v.votos_cdu,0)::int      AS votos_cdu,
          COALESCE(v.brancos,0)::int        AS brancos,
          COALESCE(v.nulos,0)::int          AS nulos,
          COALESCE(v.validos,0)::int        AS validos,
          COALESCE(v.mesas_apuradas,0)::int AS mesas_apuradas,
          COALESCE(mt.mesas_total,0)::int   AS mesas_total
        FROM freguesias f
        LEFT JOIN v_agg_freguesia_camara_assembleia v
          ON v.freguesia_id = f.id AND v.ato = 'camara'
        LEFT JOIN mt ON mt.freguesia_id = f.id
        ORDER BY f.nome
      `);

      // Assembleia por freguesia (sempre 9 linhas) + mesas_total
      const assemParQ = client.query(`
        WITH mt AS (
          SELECT freguesia_id, COUNT(*)::int AS mesas_total
          FROM mesas_voto
          GROUP BY freguesia_id
        )
        SELECT
          f.id   AS freguesia_id,
          f.nome AS freguesia_nome,
          f.inscritos::int AS inscritos,
          COALESCE(v.votos_ad,0)::int       AS votos_ad,
          COALESCE(v.votos_ps,0)::int       AS votos_ps,
          COALESCE(v.votos_chega,0)::int    AS votos_chega,
          COALESCE(v.votos_cdu,0)::int      AS votos_cdu,
          COALESCE(v.brancos,0)::int        AS brancos,
          COALESCE(v.nulos,0)::int          AS nulos,
          COALESCE(v.validos,0)::int        AS validos,
          COALESCE(v.mesas_apuradas,0)::int AS mesas_apuradas,
          COALESCE(mt.mesas_total,0)::int   AS mesas_total
        FROM freguesias f
        LEFT JOIN v_agg_freguesia_camara_assembleia v
          ON v.freguesia_id = f.id AND v.ato = 'assembleia'
        LEFT JOIN mt ON mt.freguesia_id = f.id
        ORDER BY f.nome
      `);

      // Juntas por freguesia (com mesas_total, por consistência)
      const juntasQ = client.query(`
        WITH mt AS (
          SELECT freguesia_id, COUNT(*)::int AS mesas_total
          FROM mesas_voto
          GROUP BY freguesia_id
        )
        SELECT
          f.id   AS freguesia_id,
          f.nome AS freguesia_nome,
          f.inscritos::int AS inscritos,
          COALESCE(v.votos_ad,0)::int       AS votos_ad,
          COALESCE(v.votos_ps,0)::int       AS votos_ps,
          COALESCE(v.votos_chega,0)::int    AS votos_chega,
          COALESCE(v.votos_cdu,0)::int      AS votos_cdu,
          COALESCE(v.brancos,0)::int        AS brancos,
          COALESCE(v.nulos,0)::int          AS nulos,
          COALESCE(v.validos,0)::int        AS validos,
          COALESCE(v.mesas_apuradas,0)::int AS mesas_apuradas,
          COALESCE(mt.mesas_total,0)::int   AS mesas_total
        FROM freguesias f
        LEFT JOIN v_agg_freguesia_junta v
          ON v.freguesia_id = f.id
        LEFT JOIN mt ON mt.freguesia_id = f.id
        ORDER BY f.nome
      `);

      // 👇 NOVO: Apuração ANY — freguesia apurada quando TODAS as mesas tiverem ALGUM resultado
      const apuracaoQ = client.query(`
        WITH mt AS (
          SELECT freguesia_id, COUNT(*)::int AS mesas_total
          FROM mesas_voto
          GROUP BY freguesia_id
        ),
        mf_any AS (
          SELECT freguesia_id, COUNT(DISTINCT mesa_voto_id)::int AS mesas_fechadas_any
          FROM resultados
          GROUP BY freguesia_id
        )
        SELECT
          f.id   AS freguesia_id,
          f.nome AS freguesia_nome,
          COALESCE(mt.mesas_total,0)::int            AS mesas_total,
          COALESCE(mf_any.mesas_fechadas_any,0)::int AS mesas_fechadas_any
        FROM freguesias f
        LEFT JOIN mt     ON mt.freguesia_id     = f.id
        LEFT JOIN mf_any ON mf_any.freguesia_id = f.id
        ORDER BY f.nome
      `);

      const [
        inscR, fregR, camTotR, asmTotR, camParR, asmParR, junR, apuR
      ] = await Promise.all([
        inscritosMunicipioQ, freguesiasQ, camaraTotQ, assemTotQ, camaraParQ, assemParQ, juntasQ, apuracaoQ
      ]);

      const inscritos_municipio = Number(inscR.rows[0]?.inscritos || 0);
      const camaraTotais = camTotR.rows[0] || { votos_ad:0,votos_ps:0,votos_chega:0,votos_cdu:0,brancos:0,nulos:0,validos:0,mesas_apuradas:0 };
      const assembleiaTotais = asmTotR.rows[0] || { votos_ad:0,votos_ps:0,votos_chega:0,votos_cdu:0,brancos:0,nulos:0,validos:0,mesas_apuradas:0 };

      const apuList = apuR.rows || [];
      const total_freguesias = apuList.length;
      const apuradas_any = apuList.filter(r => (r.mesas_total > 0) && (r.mesas_fechadas_any >= r.mesas_total)).length;
      const camAgg = aggregateClosed(camParR.rows);
      const asmAgg = aggregateClosed(asmParR.rows);

      // Lugares garantidos (pior caso)
      const camaraGarantidos = guaranteedSeatsLowerBound(camAgg.currentVotes, camAgg.remainingPotential, 7);
      const assembleiaGarantidos = guaranteedSeatsLowerBound(asmAgg.currentVotes, asmAgg.remainingPotential, 21);


      res.set('Cache-Control', 'no-store');
      res.json({
        meta: { lastUpdated: new Date().toISOString() },
        inscritos_municipio,
        freguesias: fregR.rows,
        camara: {
          totais: camaraTotais,
          por_freguesia: camParR.rows,
          garantidos: mapPretty(camaraGarantidos),
          votos_fechar: {
            atuais: camAgg.currentVotes,
            potenciais_restantes: camAgg.remainingPotential
          }
        },
        assembleia: {
          totais: assembleiaTotais,
          por_freguesia: asmParR.rows,
          garantidos: mapPretty(assembleiaGarantidos),
          votos_fechar: {
            atuais: asmAgg.currentVotes,
            potenciais_restantes: asmAgg.remainingPotential
          }
        },
        juntas: junR.rows,
        apuracao: { freguesias: apuList, total_freguesias, apuradas_any }
      });

    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Erro /api/snapshot', err);
    res.status(500).json({ error: 'Erro ao gerar snapshot' });
  }
});



// SSE — eventos em tempo real
const clients = new Set();
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const client = { res };
  clients.add(client);

  // Mensagem inicial (handshake)
  res.write(`event: hello\n`);
  res.write(`data: {"ok":true}\n\n`);

  req.on('close', () => {
    clients.delete(client);
  });
});
function broadcast(obj) {
  const data = `data: ${JSON.stringify(obj)}\n\n`;
  for (const c of clients) {
    try { c.res.write(data); } catch { /* ignore */ }
  }
}
// Ping a cada 25s para manter conexões vivas
setInterval(() => broadcast({ type: 'ping', t: Date.now() }), 25_000);

// -------------------------------
// API — Backoffice (apenas local)
// -------------------------------

// Listar freguesias
app.get('/api/freguesias', requireLocal, async (req, res) => {
  const { rows } = await pool.query('SELECT id, nome, inscritos FROM freguesias ORDER BY nome');
  res.json(rows);
});

// Listar mesas por freguesia
app.get('/api/mesas', requireLocal, async (req, res) => {
  const { freguesia_id } = req.query;
  if (!freguesia_id) return res.status(400).json({ error: 'freguesia_id é obrigatório' });
  const { rows } = await pool.query(
    'SELECT id AS mesa_voto_id, mesa_codigo FROM mesas_voto WHERE freguesia_id = $1 ORDER BY mesa_codigo',
    [freguesia_id]
  );
  res.json(rows);
});

// Inserir resultados
app.post('/api/resultados', requireLocal, async (req, res) => {
  try {
    const {
      freguesia_id,
      mesa_codigo,
      mesa_voto_id,
      ato,
      votos_ad = 0,
      votos_ps = 0,
      votos_chega = 0,
      votos_cdu = 0,
      brancos = 0,
      nulos = 0,
    } = req.body || {};

    if (!freguesia_id) return res.status(400).json({ error: 'freguesia_id é obrigatório' });
    if (!ato || !['camara', 'assembleia', 'junta'].includes(ato)) {
      return res.status(400).json({ error: "ato inválido: use 'camara' | 'assembleia' | 'junta'" });
    }

    let mesaId = mesa_voto_id;
    if (!mesaId) {
      if (!mesa_codigo) return res.status(400).json({ error: 'indique mesa_voto_id ou mesa_codigo' });
      const r = await pool.query(
        'SELECT id FROM mesas_voto WHERE freguesia_id=$1 AND mesa_codigo=$2',
        [freguesia_id, mesa_codigo]
      );
      if (!r.rowCount) return res.status(404).json({ error: 'mesa não encontrada' });
      mesaId = r.rows[0].id;
    }

    // Verificar se já existe registo para (mesa_voto_id, ato)
    const dupQ = await pool.query(
      'SELECT COUNT(*)::int AS n FROM resultados WHERE mesa_voto_id=$1 AND ato=$2',
      [mesaId, ato]
    );
    const hadPrevious = (dupQ.rows[0]?.n || 0) > 0;
    
    // Se já existe, não inserir — devolver 409
    if (hadPrevious) {
      return res.status(409).json({
        ok: false,
        hadPrevious: true,
        error: 'Já existe um registo para esta mesa e este ato.'
      });
    }
    
    // Inserção normal
    const q = `
      INSERT INTO resultados (
        freguesia_id, mesa_voto_id, ato,
        votos_ad, votos_ps, votos_chega, votos_cdu, brancos, nulos
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id
    `;
    const vals = [freguesia_id, mesaId, ato, votos_ad, votos_ps, votos_chega, votos_cdu, brancos, nulos];
    const ins = await pool.query(q, vals);

    // notificar o site público
    broadcast({
      type: 'mesa_result',
      freguesia_id,
      mesa_voto_id: mesaId,
      mesa_codigo: mesa_codigo || null,
      ato,
      votos_ad, votos_ps, votos_chega, votos_cdu, brancos, nulos,
      id: ins.rows[0].id,
    });

    // resposta inclui flag hadPrevious
    res.status(201).json({ ok: true, id: ins.rows[0].id, hadPrevious });
  } catch (err) {
    console.error('Erro /api/resultados', err);
    res.status(500).json({ error: 'Erro ao guardar resultados' });
  }
});

// Reset total — apaga todos os resultados (apenas local)
app.post('/api/reset', requireLocal, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 1) apaga todos os registos de resultados
    await client.query('DELETE FROM resultados');
    // se tiveres tabelas de cache/aggregates locais, poderias limpá-las aqui

    await client.query('COMMIT');

    // notificar clientes SSE para recarregar
    broadcast({ type: 'reset', t: Date.now() });

    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro /api/reset', err);
    res.status(500).json({ error: 'Falha no reset' });
  } finally {
    client.release();
  }
});


// -------------------------------
// Ficheiros estáticos
// -------------------------------

// 1) Site público (só o que estiver na pasta ./public fica acessível)
app.use(express.static(path.join(__dirname, 'public')));

// 2) Backoffice só local — serve ./admin/backoffice.html
app.get('/backoffice', requireLocal, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'backoffice.html'));
});

// 3) Fallback SPA para o index (rotas não-API)
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  next();
});

// -------------------------------
// Start
// -------------------------------
app.listen(PORT, () => {
  console.log(`✅ Servidor a ouvir em http://localhost:${PORT}`);
  console.log(`   Público: /  |  /api/snapshot  |  /api/stream`);
  console.log(`   Local only: /backoffice  |  /api/freguesias  |  /api/mesas  |  /api/resultados`);
});
