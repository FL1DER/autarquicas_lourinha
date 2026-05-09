	// ================================
	// Config & utils
	// ================================
	const PARTY_ORDER = ["AD", "PS", "CHEGA", "CDU"];
	const PARTY_COLORS = {
		AD: "#FFA500",
		PS: "#ec4899",
		CHEGA: "#1e3a8a",
		CDU: "#dc2626",
	};

	const API_BASE = "";
	const MAP_URL = "lourinha-map.svg";

	// Mapeia nomes -> IDs reais da tua BD (ajusta os IDs aos teus)
	const MAP_NAME_TO_ID = {
	  "Lourinhã": 'LOURINHA',
	  "Atalaia": 'ATALAIA',
	  "Miragaia e Marteleira": 'MIRAGAIA_MARTELEIRA',
	  "Moita dos Ferreiros": 'MOITA_DOS_FERREIROS',
	  "Reguengo Grande": 'REGUENGO_GRANDE',
	  "Ribamar": 'RIBAMAR',	  
	  "Santa Bárbara": 'SANTA_BARBARA',
	  "São Bartolomeu dos Galegos e Moledo": 'SAO_BARTOLOMEU_E_MOLEDO',
	  "Vimeiro": 'VIMEIRO',
	};

	
	// índice normalizado -> id (com algumas variantes úteis)
	const MAP_INDEX = (() => {
	  const idx = new Map();
	  const add = (k, id) => idx.set(normalizeName(k), id);

	  for (const [nome, id] of Object.entries(MAP_NAME_TO_ID)) {
		add(nome, id);
		// variantes frequentes
		add(nome.replace(/^S\.\s+/i, 'Sao '), id);      // "S. ..." -> "Sao ..."
		add(nome.replace(/^Sta\.\s+/i, 'Santa '), id);  // "Sta. ..." -> "Santa ..."
		add(nome.replace(/^Sto\.\s+/i, 'Santo '), id);  // "Sto. ..." -> "Santo ..."
		add(nome.replace(/-/g, ' '), id);               // hífen -> espaço
	  }
	  return idx;
	})();

	function normalizeName(s){
	  return String(s||'')
		.normalize('NFD').replace(/[\u0300-\u036f]/g,'')  // remove acentos
		.replace(/[\u200B-\u200D\uFEFF]/g,' ')       	  // remove zero-width spaces
		.replace(/\u00A0/g,' ')                           // NBSP → espaço normal
		.replace(/&/g,' e ')                              // & → " e "
		.replace(/[.\-_,:;()/]+/g,' ')                    // pontuação comum → espaço
		.toLowerCase()
		.replace(/\bs\b/g, 'sao')  						  // "s bartolomeu" → "sao bartolomeu"
		.replace(/\s+/g,' ')                               // colapsa espaços
		.trim();
	}
	
	function findRowByIdOrName(rows, sel){
	  if (!Array.isArray(rows)) return null;

	  // 1) por id direto
	  if (sel?.id != null){
		const r = rows.find(x => String(x.freguesia_id) === String(sel.id));
		if (r) return r;
	  }

	  // 2) por nome (normalizado / contém)
	  if (sel?.name){
		const n = normalizeName(sel.name);
		let r = rows.find(x => normalizeName(x.freguesia_nome) === n);
		if (r) return r;
		r = rows.find(x => {
		  const m = normalizeName(x.freguesia_nome);
		  return m.includes(n) || n.includes(m);
		});
		if (r) return r;
	  }
	  return null;
	}

	// Lê o SVG, injeta inline e marca cada freguesia com data-* para a tua lógica
	function inlineSvgInto(containerId, act){
	  const container = document.getElementById(containerId);
	  if (!container) return;
	  fetch(MAP_URL, { cache: "no-store" })
		.then(r => r.text())
		.then(txt => {
		  container.innerHTML = txt;
		  const svg = container.querySelector('svg');
		  if (!svg.getAttribute('viewBox')) {
			  const w = parseFloat(svg.getAttribute('width') || '800');
			  const h = parseFloat(svg.getAttribute('height') || '600');
			  if (w && h) {
				svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
				svg.removeAttribute('width');
				svg.removeAttribute('height');
			  }
			}

		  if (!svg){ container.innerHTML = '<div class="text-red-600 text-sm">Falha a carregar mapa.</div>'; return; }
		  svg.classList.add('w-full','h-auto');
		  svg.style.display = 'block';
		  svg.setAttribute('preserveAspectRatio','xMidYMid meet');
		  const vb = svg.viewBox?.baseVal;
		  if (vb && vb.width && vb.height) {
		    const ratio = `${vb.width} / ${vb.height}`;
		    container.style.aspectRatio = ratio; // CSS nativo
		    container.style.height = 'auto';     // sobrepõe h-[...] do Tailwind
		  }
		  tagRegions(svg);
		  bindMap(act);     // já tens esta função no teu ficheiro
		  paintMap(act);    // já tens esta função no teu ficheiro
		})
		.catch(()=>{ container.innerHTML = '<div class="text-red-600 text-sm">Falha a carregar mapa.</div>'; });
	}

	// Encontra regiões no SVG (paths ou grupos) e dá-lhes data-freguesia-id/nome
	function tagRegions(svg){
		const shapes = svg.querySelectorAll('g, path, polygon, rect');

		shapes.forEach(el => {
			const rawName =
				el.getAttribute('inkscape:label') ||
				el.querySelector(':scope > title')?.textContent ||
				el.id ||
				'';

			const idStr = MAP_INDEX.get(normalizeName(rawName));
			if (!idStr) return;

			el.setAttribute('data-freguesia-id', idStr);
			el.setAttribute('data-freguesia-nome', rawName.trim());
			el.classList.add('cursor-pointer');
		});
	}

	function nf(n) { return new Intl.NumberFormat("pt-PT").format(n ?? 0); }
	function pct(num, den) { if (!den) return 0; return (num / den) * 100; }
	function pctClamp(num, den) { return Math.min(100, Math.max(0, pct(num, den))); }
	function pctStr(num, den) { return pct(num, den).toFixed(1) + " %"; }
	function fmtDate(iso) { if (!iso) return "—"; const d = new Date(iso); return d.toLocaleString("pt-PT"); }
	function N(x) { const n = Number(x); return Number.isFinite(n) ? n : 0; }

	function hexToRgba(hex, alpha = 0.08) {
		const m = String(hex).replace("#", "").match(/^([0-9a-f]{6})$/i);
		if (!m) return `rgba(0,0,0,${alpha})`;
		const int = parseInt(m[1], 16);
		const r = (int >> 16) & 255, g = (int >> 8) & 255, b = int & 255;
		return `rgba(${r},${g},${b},${alpha})`;
	}
	function applyPageWinnerTint(hexColorOrNull) {
		if (hexColorOrNull) {
		document.body.style.background = hexToRgba(hexColorOrNull, 0.5);
		document.body.style.transition = "background-color 200ms ease, background 200ms ease";
		} else {
			document.body.style.background = "";
		}
	}

	function pageWinnerColorForAct(act){
		const s = SNAPSHOT?.[act];
		if (!s) return null;

		const pf = s.por_freguesia || [];
		const tot = aggregateTotais(pf);
		const votes = {	AD: tot.ad, PS: tot.ps, CHEGA: tot.chega, CDU: tot.cdu };

		const g = s.garantidos || {};
		const seats = {	AD: Number(g.AD) || 0, PS: Number(g.PS) || 0, CHEGA: Number(g.CHEGA) || 0, CDU: Number(g.CDU) || 0 };

		let best = null;
		for (const p of PARTY_ORDER) {
			const cand = { party: p, seats: seats[p], votes: votes[p] };
			if ( !best || cand.seats > best.seats || (cand.seats === best.seats && cand.votes > best.votes)	) 
				best = cand;
		}

		if (!best || (best.seats === 0 && best.votes === 0)) return null;
		return PARTY_COLORS[best.party] || null;
	}

	function winnerFromVotes(map) {
		const entries = Object.entries(map || {});
		entries.sort((a,b)=> (b[1]||0) - (a[1]||0));
		if (!entries.length) return null;
		const [p1,v1] = entries[0];
		const v2 = entries[1]?.[1] ?? -Infinity;
		if (v1 <= 0 || v1 === v2) return null;
		return p1;
	}

	function isTabActive(id) { return !document.getElementById(id)?.classList.contains("hidden"); }
	function showError(msg){ const box=document.getElementById("errorMsg"); box.textContent=msg||"Ocorreu um erro a carregar os dados."; box.classList.remove("hidden"); }
	function hideError(){ document.getElementById("errorMsg").classList.add("hidden"); }

	function getApuracaoFor(fregId){ const ap = SNAPSHOT?.apuracao?.freguesias || []; const id = String(fregId); return ap.find(r => String(r.freguesia_id) === id) || null; }

	function apuradasAnyFromSnapshot(){
		const ap = SNAPSHOT?.apuracao?.freguesias;
		if (Array.isArray(ap) && ap.length) {
			const total = ap.length;
			const apuradas = ap.filter(r => N(r.mesas_total) > 0 && N(r.mesas_fechadas_any) >= N(r.mesas_total)).length;
			return { apuradas, total };
		}

		const map = new Map();
		const merge = (arr, keyClosed, keyTotal) => {
		(arr || []).forEach((r) => {
			const id = r.freguesia_id; const prev = map.get(id) || { total: 0, closed: 0 };
			map.set(id, { total: Math.max(prev.total, N(r[keyTotal] || r.mesas_total)), closed: Math.max(prev.closed, N(r[keyClosed] || r.mesas_apuradas)) });
		});
		};
		merge(SNAPSHOT?.camara?.por_freguesia, "mesas_apuradas", "mesas_total");
		merge(SNAPSHOT?.assembleia?.por_freguesia, "mesas_apuradas", "mesas_total");
		merge(SNAPSHOT?.juntas, "mesas_apuradas", "mesas_total");
		const list = Array.from(map.values());
		const total = list.length || ((SNAPSHOT && SNAPSHOT.freguesias && SNAPSHOT.freguesias.length) || 0);
		const apuradas = list.filter(x => x.total > 0 && x.closed >= x.total).length;
		return { apuradas, total };
	}

	function juntaSeatCountFor(row){ const nome = String(row?.freguesia_nome||"").toLowerCase(); return nome.includes("lourinh") ? 13 : 9; }

	function calcularVotosPorApurar(porFreguesia) {
		if (!Array.isArray(porFreguesia)) return 0;
		let total = 0;

		for (const r of porFreguesia) {
			// fechada se mesas_apuradas >= mesas_total (e mesas_total > 0)
			const fechado = N(r.mesas_total) > 0 && N(r.mesas_apuradas) >= N(r.mesas_total);
			if (fechado) continue;

			const inscritos = N(r.inscritos);

			// votantes_apurados preferido; se não existir, calcula: válidos + brancos + nulos
			const validos = N(r.votos_ad) + N(r.votos_ps) + N(r.votos_chega) + N(r.votos_cdu);
			const votantesCalc = validos + N(r.brancos) + N(r.nulos);
			const votantes = Number.isFinite(N(r.votantes_apurados)) && N(r.votantes_apurados) > 0
				? N(r.votantes_apurados)
				: votantesCalc;

			const resto = inscritos - votantes;
			if (resto > 0) total += resto;
		}
		return total;
	}


	// ================================
	// Estado
	// ================================
	let SNAPSHOT = null;
	let charts = {};
	let selected = { camara: { id:null }, assembleia: { id:null }, juntas: { id:null } };


	// ================================
	// Carregamento de dados
	// ================================
	async function fetchSnapshot(){
		try {
		const res = await fetch(API_BASE + "/api/snapshot", { cache: "no-store" });
		if (!res.ok) { const t = await res.text().catch(() => ""); throw new Error(`${res.status} ${res.statusText}${t ? ' — ' + t : ''}`); }
		SNAPSHOT = await res.json();

		hideError();
		renderAll();
		} catch(err){ console.error("Falha a obter snapshot:", err); return; }
	}

	function connectSSE(){
		try {
		const es = new EventSource(API_BASE + "/api/stream");
		es.onopen = () => setLive(true);
		es.onerror = () => setLive(false);
		es.onmessage = async () => { await fetchSnapshot();
};
		} catch(e){ setLive(false); }
	}

	function setLive(isLive){
		const dot = document.getElementById("liveDot");
		const txt = document.getElementById("liveText");
		if (isLive) { dot.classList.remove("bg-zinc-400"); dot.classList.add("bg-green-500"); txt.textContent = "AO VIVO"; }
		else { dot.classList.remove("bg-green-500"); dot.classList.add("bg-zinc-400"); txt.textContent = "offline"; }
	}

	function renderApuracaoCard(elId, apuradas, total){
		const el = document.getElementById(elId); if (!el) return;
		const t = Number(total)||0; const a = Math.min(Number(apuradas)||0, t);
		const done = t>0 && a>=t; const p = t>0 ? Math.min(100, (a/t)*100) : 0;
		el.className = `p-4 rounded-xl border transition-colors ${done ? 'border-green-200 bg-green-50' : 'border-zinc-200 bg-white'}`;
		el.innerHTML = done ? '<div class="text-2xl font-semibold text-green-700">Contagem terminada ✅</div>' : `
		  <div class="text-xs text-zinc-500">Freguesias apuradas</div>
		  <div class="mt-0.5 flex items-baseline justify-between gap-3">
			<div class="text-2xl font-semibold text-zinc-900">${a} / ${t}</div>
		  </div>
		  <div class="mt-2 h-2 rounded-full bg-zinc-200 overflow-hidden" aria-hidden="true">
			<div class="h-2 bg-zinc-700" style="width:${p}%;"></div>
		  </div>`;
	}

	

      // ================================
      // D'Hondt
      // ================================
    function dhondtAllocate(votesByParty, seats){
        const parties = Object.keys(votesByParty); const quotients = [];
        parties.forEach(p => { const v=N(votesByParty[p]); for (let d=1; d<=seats; d++){ quotients.push({ party:p, value:v/d, baseVotes:v }); } });
        quotients.sort((a,b)=> b.value!==a.value ? b.value-a.value : (b.baseVotes!==a.baseVotes ? b.baseVotes-a.baseVotes : a.party.localeCompare(b.party)));
        const allocation = Object.fromEntries(parties.map(p=>[p,0]));
        for (let i=0;i<seats;i++){ const q=quotients[i]; if (!q) break; allocation[q.party]+=1; }
        return allocation;
    }

	// ================================
	// Render helpers
	// ================================
	function drawBar(canvasId, label, labels, values){
		const ctx = document.getElementById(canvasId); if (!ctx) return;
		if (charts[canvasId]) charts[canvasId].destroy();
		charts[canvasId] = new Chart(ctx, {
			type: "bar",
			data: { labels, datasets: [{ label, data: values, backgroundColor: labels.map(pid => PARTY_COLORS[pid] || "#64748b") }] },
			options: { responsive:true, plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:(c)=> `${c.parsed.y.toLocaleString('pt-PT')} votos` } } }, scales:{ y:{ beginAtZero:true, ticks:{ precision:0 } } } }
		});
    }

	function aggregateTotais(pf){
		return pf.reduce((a,r)=>{ 
			a.ad+=N(r.votos_ad); 
			a.ps+=N(r.votos_ps); 
			a.chega+=N(r.votos_chega);
			a.cdu+=N(r.votos_cdu); 
			a.br+=N(r.brancos); 
			a.nu+=N(r.nulos); return a; }, 
		{ad:0,ps:0,chega:0,cdu:0,br:0,nu:0});
	}

	function paintMap(act){
		const container = document.getElementById(
			act==='camara' ? 'map-camara' :
			act==='assembleia' ? 'map-assembleia' :
			'map-juntas'
		);
		if (!container) return;

		const pf = act==='juntas'
			? (SNAPSHOT?.juntas || [])
			: (SNAPSHOT?.[act]?.por_freguesia || []);

		const index = new Map(
			pf.map(r => [normalizeName(r.freguesia_nome), r])
		);

		container.querySelectorAll('path').forEach(el => {
			const nome = el.getAttribute('inkscape:label');
			if (!nome || nome.startsWith('path')) return;

			const row = index.get(normalizeName(nome));
			if (!row) { el.style.fill = '#e2e8f0'; return; }

			const votes = {
				AD: N(row.votos_ad),
				PS: N(row.votos_ps),
				CHEGA: N(row.votos_chega),
				CDU: N(row.votos_cdu)
			};

			const winner = winnerFromVotes(votes);
			el.style.fill = winner ? PARTY_COLORS[winner] : '#e2e8f0';
		});
	}

	function bindMap(act){
		const containerId =
		act === 'camara' ? 'map-camara' :
		act === 'assembleia' ? 'map-assembleia' :
		'map-juntas';

		const container = document.getElementById(containerId);
		const svg = container?.querySelector('svg');
		if (!svg) return;

		svg.querySelectorAll('text, tspan').forEach(n => {
		n.style.pointerEvents = 'auto';
		n.style.cursor = 'pointer';
		});

		function idFromTextNode(node){
			if (!node) return null;
			const textEl = node.closest?.('text') || node;
			let raw = (textEl.textContent || '').replace(/\u00A0/g,' ').replace(/\s+/g,' ').trim();
			const n = normalizeName(raw);
			let id = MAP_INDEX.get(n) || null;
			if (id) return id;
			const BRUTE = [
				{ test: n => /miragaia/.test(n) && /marteleira/.test(n), id: 'MIRAGAIA_MARTELEIRA' },
				{ test: n => /moita/.test(n) && /ferreiros/.test(n), id: 'MOITA_DOS_FERREIROS' },
				{ test: n => /santa/.test(n), id: 'SANTA_BARBARA' },
				{ test: n => /reguengo/.test(n) && /grande/.test(n), id: 'REGUENGO_GRANDE' },
				{ test: n => /(s\.?\s*|sao\s+)?bartolomeu/.test(n) && /moledo/.test(n), id: 'SAO_BARTOLOMEU_E_MOLEDO' },
			];
			for (const r of BRUTE){ if (r.test(n)) return r.id; }
			return null;
		}

		svg.addEventListener('click', (e) => {
			let el = e.target.closest('[data-freguesia-id]');
			let fid = null, name = null;

			if (el) {
				fid  = String(el.getAttribute('data-freguesia-id') || '');
				name = el.getAttribute('data-freguesia-nome') || '';
			} else {
				const idFromText = idFromTextNode(e.target);
				if (idFromText) {
					fid = String(idFromText);
					const textEl = e.target.closest?.('text') || e.target;
					const tspans = textEl.querySelectorAll('tspan');
					name = tspans.length > 0
						? [...tspans].map(t => t.textContent.trim()).filter(Boolean).join(' ')
						: (textEl?.textContent || '').trim();
					name = name.replace(/\s+/g, ' ').trim() || fid;
					textEl?.setAttribute?.('data-freguesia-id', fid);
					textEl?.setAttribute?.('data-freguesia-nome', name);
					el = textEl;
				}
			}

			if (!fid) return;
			if (act === 'juntas') {
				selected.juntas = { id: fid };
				drawJunta(fid);        // atualiza KPIs/tabela/gráfico
				paintMap('juntas');    // destaca no mapa
				return;
			}
			selected[act] = { id: fid, name };
			renderAct(act);
			const tip = document.getElementById(act+'-map-tip');
			if (tip) tip.textContent = `A mostrar: ${name || fid} (clique em "Mostrar Totais" para voltar)`;
		});

		const resetBtnId =
			act === 'camara' ? 'camara-reset' :
			act === 'assembleia' ? 'assembleia-reset' :
			'juntas-reset';

			document.getElementById(resetBtnId)?.addEventListener('click', ()=>{
				if (act === 'juntas') {
					selected.juntas = { id: null };
					drawJuntaTotal();
					paintMap('juntas');
					return;
				}
			
			selected[act] = { id:null, name:null };
			renderAct(act);
			const tip = document.getElementById(act+'-map-tip');
			if (tip) tip.textContent = 'Clique numa freguesia para ver o detalhe.';
		});
	}

	// ================================
	// Renderização principal
	// ================================
	  
	function renderAll(){
		document.getElementById("lastUpdated").textContent = "Atualizado " + fmtDate(SNAPSHOT?.meta?.lastUpdated);
		renderAct('camara');
		renderAct('assembleia');

		const juntasAtiva = !document.getElementById('tab-juntas').classList.contains('hidden');
		if (juntasAtiva) applyPageWinnerTint(null);

		if (juntasAtiva) renderJuntas();
	}

	function renderAct(act){
		if (!SNAPSHOT) return;
		const s = SNAPSHOT;

		let pf = s[act]?.por_freguesia || [];
		if (!pf.length && Array.isArray(s.freguesias)) {
		pf = s.freguesias.map(f=>({
			freguesia_id:f.freguesia_id, freguesia_nome:f.freguesia_nome, inscritos:f.inscritos,
			votos_ad:0, votos_ps:0, votos_chega:0, votos_cdu:0, brancos:0, nulos:0,
			validos:0, mesas_apuradas:0, mesas_total:0
		}));
		}

		const totals = aggregateTotais(pf);
		const inscritosMunicipio = N(s.inscritos_municipio);
		const validosTot = totals.ad + totals.ps + totals.chega + totals.cdu;
		const votantes = validosTot + totals.br + totals.nu;
		const abst = 100 - pctClamp(votantes, inscritosMunicipio);
		const kpiCamPorApurar = calcularVotosPorApurar(SNAPSHOT?.camara?.por_freguesia || []);
		const kpiAssPorApurar = calcularVotosPorApurar(SNAPSHOT?.assembleia?.por_freguesia || []);
		document.getElementById(`kpi-${act}-inscritos`).textContent = nf(inscritosMunicipio);
		document.getElementById(`kpi-${act}-votantes`).textContent = nf(votantes);
		document.getElementById(`kpi-${act}-abst`).textContent = abst.toFixed(1) + "%";
		document.getElementById('kpi-camara-por-apurar').textContent = nf(kpiCamPorApurar);
		document.getElementById('kpi-assembleia-por-apurar').textContent = nf(kpiAssPorApurar);

		const { apuradas, total } = apuradasAnyFromSnapshot();
		renderApuracaoCard(`kpi-${act}-apuracao`, apuradas, total || pf.length || 0);

		// pinta mapa
		paintMap(act);

		// elementos do cartão (DECLARADOS AQUI!)
		const titleEl = document.getElementById(`${act}-card-title`);
		const subtitleEl = document.getElementById(`${act}-card-subtitle`);
		const areaLabel = act === "camara" ? "Câmara" : "Assembleia";

		// decidir se mostra Totais ou Freguesia
		const sel = selected[act]; // {id, name}
		let row = null;
		if (sel?.id) row = findRowByIdOrName(pf, { id: sel.id, name: sel.name });

		if (row){
			titleEl.textContent = `${areaLabel} — ${row.freguesia_nome}`;
			const inscritos = N(row.inscritos);
			const validos = N(row.votos_ad)+N(row.votos_ps)+N(row.votos_chega)+N(row.votos_cdu);
			const vot = validos + N(row.brancos) + N(row.nulos);
			const abstF = 100 - pctClamp(vot, inscritos);
			subtitleEl.textContent = `Votantes: ${nf(vot)} · Abstenção: ${abstF.toFixed(1)}%`;

			fillPartyTable(act,
				{ AD:N(row.votos_ad), PS:N(row.votos_ps), CHEGA:N(row.votos_chega), CDU:N(row.votos_cdu) },
				vot, s[act]?.garantidos);

			document.getElementById(`${act}-brancos`).textContent = nf(N(row.brancos));
			document.getElementById(`${act}-nulos`).textContent = nf(N(row.nulos));
			document.getElementById(`${act}-brancos-pct`).textContent = pctStr(N(row.brancos), vot);
			document.getElementById(`${act}-nulos-pct`).textContent = pctStr(N(row.nulos), vot);

			drawBar(`${act}-bar`, `${areaLabel} — ${row.freguesia_nome}`, PARTY_ORDER,
				[N(row.votos_ad),N(row.votos_ps),N(row.votos_chega),N(row.votos_cdu)]);
		} else {
			titleEl.textContent = `${areaLabel} — Total do Concelho`;
			subtitleEl.textContent = `Votantes: ${nf(votantes)} · Abstenção: ${(100 - pctClamp(votantes, inscritosMunicipio)).toFixed(1)}%`;

			fillPartyTable(act,
				{ AD:totals.ad, PS:totals.ps, CHEGA:totals.chega, CDU:totals.cdu },
				votantes, s[act]?.garantidos);

			document.getElementById(`${act}-brancos`).textContent = nf(totals.br);
			document.getElementById(`${act}-nulos`).textContent = nf(totals.nu);
			document.getElementById(`${act}-brancos-pct`).textContent = pctStr(totals.br, votantes);
			document.getElementById(`${act}-nulos-pct`).textContent = pctStr(totals.nu, votantes);

			drawBar(`${act}-bar`, `${areaLabel} — Concelho`, PARTY_ORDER,
				[totals.ad, totals.ps, totals.chega, totals.cdu]);
		}

		// tinte quando contagem concluída (sempre pelo vencedor TOTAL do concelho)
		const done = (apuradas > 0 && apuradas >= total);
		const active = isTabActive(`tab-${act}`);
		if (active && done) {
			const color = pageWinnerColorForAct(act); // usa 👤 e depois votos como desempate
			applyPageWinnerTint(color);
		} else if (active) {
			applyPageWinnerTint(null);
		}
		renderFregTable(act, pf);
	}

	function renderFregTable(act, pf){
		const slot = document.getElementById(`${act}-freguesias-slot`);
		if (!slot) return;

		// ordena alfabeticamente
		const rows = [...pf].sort((a,b)=> String(a.freguesia_nome).localeCompare(String(b.freguesia_nome)));

		const thead = `
		<thead class="text-left text-zinc-500 text-xs uppercase">
			<tr>
			<th class="py-2 px-3">Freguesia</th>
			<th class="py-2 px-3 text-right">AD</th>
			<th class="py-2 px-3 text-right">PS</th>
			<th class="py-2 px-3 text-right">CHEGA</th>
			<th class="py-2 px-3 text-right">CDU</th>
			<th class="py-2 px-3 text-right">Brancos</th>
			<th class="py-2 px-3 text-right">Nulos</th>
			<th class="py-2 px-3 text-right">Votantes</th>
			<th class="py-2 px-3 text-right">Abstenção</th>
			</tr>
		</thead>`;

		const tbody = `<tbody class="text-sm">
		${rows.map(r=>{
			const ad = N(r.votos_ad), ps = N(r.votos_ps), ch = N(r.votos_chega), cdu = N(r.votos_cdu);
			const br = N(r.brancos), nu = N(r.nulos), insc = N(r.inscritos);
			const validos = ad + ps + ch + cdu;
			const votantes = validos + br + nu;
			const abstPct = (100 - Math.min(100, Math.max(0, (votantes/Math.max(insc,1))*100)) ).toFixed(1) + "%";
			const winner = winnerFromVotes({AD:ad, PS:ps, CHEGA:ch, CDU:cdu});

			const nameCell = `<td class="py-2 px-3 font-medium">
			<button class="hover:underline" data-select-freg="${r.freguesia_id}">${r.freguesia_nome}</button>
			</td>`;
			const cell = (v, pid) => `<td class="py-2 px-3 text-right ${winner===pid ? 'font-semibold' : ''}">${nf(v)}</td>`;

			return `<tr class="border-b border-zinc-100">
			${nameCell}
			${cell(ad,'AD')}
			${cell(ps,'PS')}
			${cell(ch,'CHEGA')}
			${cell(cdu,'CDU')}
			<td class="py-2 px-3 text-right">${nf(br)}</td>
			<td class="py-2 px-3 text-right">${nf(nu)}</td>
			<td class="py-2 px-3 text-right">${nf(votantes)}</td>
			<td class="py-2 px-3 text-right">${abstPct}</td>
			</tr>`;
		}).join("")}
		</tbody>`;

		slot.innerHTML = `
		<div class="rounded-xl border border-zinc-200 overflow-hidden">
			<div class="overflow-x-auto">
			<table class="w-full text-sm">
				${thead}
				${tbody}
			</table>
			</div>
		</div>`;

		// clique no nome → foca a freguesia no cartão dessa aba
		slot.querySelectorAll('[data-select-freg]').forEach(btn=>{
			btn.onclick = () => {
				selected[act] = { id: String(btn.getAttribute('data-select-freg')) };
				renderAct(act);
				document.getElementById(`tab-${act}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
			};
		});
	}

	function fillPartyTable(act, votes, denominadorVotos, garantidos){
		const tbody = document.getElementById(`${act}-table`);
		const order = ["AD","PS","CHEGA","CDU"]; // mantém ordem fixa na UI
		tbody.innerHTML = order.map(pid => {
			const v = N(votes[pid]);
			const g = garantidos?.[pid] ?? 0;
			return `<tr class="border-b border-zinc-100">
			<td class="py-1 flex items-center gap-2"><span style="background:${PARTY_COLORS[pid]};" class="inline-block w-3 h-3 rounded-sm"></span>${pid}</td>
			<td>${nf(v)}</td>
			<td>${pctStr(v, denominadorVotos)}</td>
			<td class="font-semibold">${g}</td>
			</tr>`;
		}).join("");
	}

	function renderJuntas(){
		const arr = SNAPSHOT?.juntas || [];
		if (!arr.length) return;

		// cartão global: freguesias apuradas X/Y
		const { apuradas, total } = apuradasAnyFromSnapshot();
		renderApuracaoCard("kpi-junta-apuracao", apuradas, total);

		// garante seleção
		if (!selected.juntas?.id) selected.juntas = { id: String(arr[0].freguesia_id) };

		drawJunta(selected.juntas.id); // isto atualiza também o 5.º cartão
		paintMap('juntas');
		renderFregTable('juntas', SNAPSHOT?.juntas || []);
	}

	function drawJuntaTotal(){
		const arr = SNAPSHOT?.juntas || [];
		if (!arr.length) return;

		document.getElementById("juntas-card-title").textContent = "Juntas — Total do Concelho";

		const totals = aggregateTotais(arr);
		const vot = totals.ad + totals.ps + totals.chega + totals.cdu + totals.br + totals.nu;
		const inscritos = arr.reduce((a, r) => a + N(r.inscritos), 0);
		const abst = 100 - pctClamp(vot, inscritos);

		document.getElementById("kpi-junta-inscritos").textContent = nf(inscritos);
		document.getElementById("kpi-junta-votantes").textContent = nf(vot);
		document.getElementById("kpi-junta-abst").textContent = abst.toFixed(1) + " %";

		const seatsTotal = 13 + (arr.length - 1) * 9;
		const seatsAlloc = dhondtAllocate(
			{ AD: totals.ad, PS: totals.ps, CHEGA: totals.chega, CDU: totals.cdu },
			seatsTotal
		);

		const tbody = document.getElementById("junta-table");
		tbody.innerHTML = PARTY_ORDER.map(pid => {
			const votos = pid === 'AD' ? totals.ad : pid === 'PS' ? totals.ps : pid === 'CHEGA' ? totals.chega : totals.cdu;

			const mandatos = seatsAlloc[pid] ?? 0;
			return `<tr class="border-b border-zinc-100">
				<td class="py-1 flex items-center gap-2">
				<span style="background:${PARTY_COLORS[pid]};" class="inline-block w-3 h-3 rounded-sm"></span>${pid}
				</td>
				<td>${nf(votos)}</td>
				<td>${pctStr(votos, vot)}</td>
				<td class="font-semibold">${mandatos}</td>
			</tr>`;
		}).join("");

		document.getElementById("junta-brancos").textContent = nf(totals.br);
		document.getElementById("junta-nulos").textContent = nf(totals.nu);
		document.getElementById("junta-brancos-pct").textContent = pctStr(totals.br, vot);
		document.getElementById("junta-nulos-pct").textContent = pctStr(totals.nu, vot);

		drawBar("junta-bar", "Juntas — Concelho", PARTY_ORDER,
			[totals.ad, totals.ps, totals.chega, totals.cdu]);
	}

	function drawJunta(fregId){
		const r = (SNAPSHOT?.juntas || []).find(x => String(x.freguesia_id)===String(fregId)) ||
          (SNAPSHOT?.juntas || []).find(x => normalizeName(x.freguesia_nome) === normalizeName(fregId.replace(/_/g, ' ')));
		if (!r) return;

		// título
		document.getElementById("juntas-card-title").textContent = "Juntas — " + r.freguesia_nome;

		// métricas base
		const validos = N(r.votos_ad)+N(r.votos_ps)+N(r.votos_chega)+N(r.votos_cdu);
		const vot = validos + N(r.brancos) + N(r.nulos);
		const inscritos = N(r.inscritos);
		const abst = 100 - pctClamp(vot, inscritos);

		// KPIs
		document.getElementById("kpi-junta-inscritos").textContent = nf(inscritos);
		document.getElementById("kpi-junta-votantes").textContent = nf(vot);
		document.getElementById("kpi-junta-abst").textContent = abst.toFixed(1) + " %";

		// mandatos (D'Hondt)
		const seatsTotal = juntaSeatCountFor(r);
		const seatsAlloc = dhondtAllocate(
		{ AD:N(r.votos_ad), PS:N(r.votos_ps), CHEGA:N(r.votos_chega), CDU:N(r.votos_cdu) },
		seatsTotal
		);

		// tabela
		const tbody = document.getElementById("junta-table");
		tbody.innerHTML = PARTY_ORDER.map(pid => {
		const votos = N(r["votos_"+pid.toLowerCase()]);
		const mandatos = seatsAlloc[pid] ?? 0;
		return `<tr class="border-b border-zinc-100">
			<td class="py-1 flex items-center gap-2">
			<span style="background:${PARTY_COLORS[pid]};" class="inline-block w-3 h-3 rounded-sm"></span>${pid}
			</td>
			<td>${nf(votos)}</td>
			<td>${pctStr(votos, vot)}</td>
			<td class="font-semibold">${mandatos}</td>
		</tr>`;
		}).join("");

		// brancos/nulos
		document.getElementById("junta-brancos").textContent = nf(N(r.brancos));
		document.getElementById("junta-nulos").textContent = nf(N(r.nulos));
		document.getElementById("junta-brancos-pct").textContent = pctStr(N(r.brancos), vot);
		document.getElementById("junta-nulos-pct").textContent = pctStr(N(r.nulos), vot);

		// gráfico
		drawBar("junta-bar", "Junta — " + r.freguesia_nome, PARTY_ORDER,
		[N(r.votos_ad),N(r.votos_ps),N(r.votos_chega),N(r.votos_cdu)]
		);

		// --- 5.º cartão: "<freguesia> — Contagem Terminada" (condicional) ---
		(function(){
			const apSel = getApuracaoFor(fregId);
			const totalSel = apSel ? N(apSel.mesas_total) : N(r.mesas_total);
			const fechSel  = apSel ? N(apSel.mesas_fechadas_any ?? apSel.mesas_fechadas ?? apSel.mesas_apuradas)
									: N(r.mesas_apuradas);
			const finishedSelected = totalSel > 0 && fechSel >= totalSel;

			// estado global
			const { apuradas, total } = apuradasAnyFromSnapshot();
			const allFinished = total > 0 && apuradas >= total;

			const card = document.getElementById("kpi-junta-freg-finish");
			if (!card) return;

			// Se todas terminaram, esconde sempre
			if (allFinished) {
				card.classList.add("hidden");
				card.innerHTML = "";
				card.className = "p-4 rounded-xl border border-zinc-200";
				return;
			}

			// Se a selecionada terminou → cartão verde "Contagem Terminada"
			if (finishedSelected) {
				card.classList.remove("hidden");
				card.className = "p-4 rounded-xl border border-green-200 bg-green-50";
				card.innerHTML = `
					<div class="text-xs text-green-700">Estado</div>
					<div class="text-xl font-semibold text-green-700">
					${r.freguesia_nome} — Contagem Terminada ✅
					</div>
					<div class="mt-1 text-xs text-green-700/80">Mesas fechadas: ${fechSel}/${totalSel}</div>
				`;
				return;
			}

			// Caso contrário (ainda não terminou) → cartão neutro só com nome e X/Y
			card.classList.remove("hidden");
			card.className = "p-4 rounded-xl border border-zinc-200 bg-white";
			card.innerHTML = `
			<div class="text-xs text-zinc-500">Estado</div>
			<div class="text-base font-semibold text-zinc-900">
				${r.freguesia_nome}
			</div>
			<div class="mt-1 text-xs text-zinc-600">Mesas fechadas: ${fechSel}/${totalSel}</div>
			`;
		})();

		// sincroniza seleção + mapa
		selected.juntas = { id: String(fregId) };
		paintMap('juntas');
	}


	// ================================
	// Tabs & init
	// ================================
	function setupTabs(){
		const tabs = document.querySelectorAll('.tab-btn');
		const show = (name) => {
			document.getElementById('tab-camara').classList.toggle('hidden', name !== 'camara');
			document.getElementById('tab-assembleia').classList.toggle('hidden', name !== 'assembleia');
			document.getElementById('tab-juntas').classList.toggle('hidden', name !== 'juntas');
			tabs.forEach(b=>{
				const active = b.dataset.tab===name;
				b.setAttribute('aria-selected', String(active));
				b.classList.toggle('bg-zinc-900', active);
				b.classList.toggle('text-white', active);
			});

			// ← impedir tinte nas Juntas
			if (name === 'juntas') {
				applyPageWinnerTint(null);
				renderJuntas();
			} else if (name === 'camara') {
				renderAct('camara');
			} else if (name === 'assembleia') {
				renderAct('assembleia');
			}
		};
		tabs.forEach(btn => btn.onclick = () => show(btn.dataset.tab));
		show('camara');
	}


    document.addEventListener('DOMContentLoaded', ()=>{
		fetchSnapshot().then(() => {
			setupTabs();
			inlineSvgInto('map-camara', 'camara');
			inlineSvgInto('map-assembleia', 'assembleia');
			inlineSvgInto('map-juntas', 'juntas');
		});
		connectSSE();
      });