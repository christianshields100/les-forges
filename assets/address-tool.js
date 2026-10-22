/* What changes at my address / Ce qui change à mon adresse.
   Geocoding: IGN (data.geopf.fr). Map: Leaflet + IGN orthophotos. Geometry: assets/data/*.json.
   Language follows <html lang>: "fr" or "en". Nothing typed here is stored. */
(function () {
  const PIN = [48.060095, -1.706889], R = 6371000, D2R = Math.PI / 180;
  const CHARTER_M = 1000; // charter zone: the nearest streets, within about 1 km of the lots (about 925 dwellings in IGN BD TOPO, derived; the nearest home is about 200 m from the park lot)
  const NOISE_M = 400;    // noise anchor: 40 dB(A) designed at the nearest façade, le Bois Noir, about 400 m from the nearest building (derived)
  const PHASE1_M = 1500;  // phase 1: the first residential extension, the nearest streets within about 1.5 km of the lots (derived; the concession fixes it)
  const COMMUNES = { "35066": "Chartres-de-Bretagne", "35281": "Saint-Jacques-de-la-Lande", "35206": "Noyal-Châtillon-sur-Seiche" };
  const FR = (document.documentElement.lang || "en").slice(0, 2) === "fr";
  const toM = (lon, lat) => [(lon - PIN[1]) * D2R * R * Math.cos(PIN[0] * D2R), -(lat - PIN[0]) * D2R * R];
  const toLL = (x, y) => [PIN[0] - y / R / D2R, PIN[1] + x / (R * Math.cos(PIN[0] * D2R)) / D2R];
  const $ = (id) => document.getElementById(id);
  const form = $("af"), input = $("addr"), status = $("status"), results = $("results");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let data, map, grid, addrLayer, housing = "house", ctrl = null;

  // ---------- strings ----------
  const T = FR ? {
    looking: "Recherche de l'adresse…",
    nomatch: "Aucune correspondance à Chartres-de-Bretagne, Saint-Jacques-de-la-Lande ou Noyal-Châtillon-sur-Seiche. Essayez un nom de rue et la commune.",
    municipality: "Seule la commune a été reconnue ; les résultats valent pour son centre. Ajoutez une rue pour vos propres chiffres.",
    street: "Adresse reconnue au niveau de la rue : les chiffres valent pour le milieu de la rue, à ±300 m près. Ajoutez un numéro pour un résultat précis.",
    netfail: "Le service d'adresses n'a pas répondu. Vérifiez votre connexion et réessayez.",
    outside: (city) => `Cette adresse est à ${city}, hors des trois communes. L'outil modélise Chartres-de-Bretagne, Saint-Jacques-de-la-Lande et Noyal-Châtillon-sur-Seiche.`,
    approx: "±300 m",
    noise_v_ok: "Sous le plafond de la charte", noise_v_charter: "Le plafond de la charte s'applique",
    route_v_ok: "Hors de l'itinéraire", route_v_close: "À moins de 300 m de l'accès par la D34",
    how: "Comment c'est calculé",
    dist_k: "Distance au bâtiment le plus proche", dist_station: (d) => `${d} jusqu'à la centrale`,
    dist_how: (h) => `Distance à vol d'oiseau entre l'adresse géocodée et le bord du ${h} et de la centrale, dessinés sur les parcelles cadastrales aux emplacements du plan masse. Adresses issues de la base adresse nationale (IGN).`,
    vis_k: "La verriez-vous ?",
    vis_yes: "Oui, la ligne des toits des bâtiments",
    vis_yes_t: (a, w) => `Environ ${a}° au-dessus de l'horizon, ${w} à bout de bras, avant les arbres et les bâtiments.`,
    w_thumb: "à peu près la largeur d'un pouce", w_finger: "à peu près un bout de doigt", w_sliver: "un simple trait",
    vis_stacks: "Seulement le haut des cheminées", vis_stacks_t: "Le relief cache les bâtiments ; les deux cheminées de 25 m peuvent dépasser de l'horizon.",
    vis_no: "Non", vis_no_t: "Le relief entre vous et le campus le cache.",
    vis_na: "Non calculé", vis_na_t: "Hors de la zone modélisée.",
    vis_how: "Ligne de visée sur le modèle de terrain de l'IGN depuis la hauteur des yeux (1,6 m) vers le bord des toitures des bâtiments (20 m) et le haut des cheminées (25 m), calculée à l'avance sur une grille de 25 m. Terrain seul : les maisons, hangars et arbres intermédiaires ne sont pas modélisés, ce qui surestime ce que vous verriez. Depuis le nord, la lisière plantée masque le pied des bâtiments.",
    noise_k: "Bruit nocturne prévu du campus, à lui seul",
    route_v_check: "Près de l'accès par la D34", route_check: "Le milieu de cette rue est à moins de 600 m de l'accès par la D34. Ajoutez un numéro pour vérifier si les clauses D34 de la charte couvrent votre logement (moins de 300 m).",
    noise_charter: "À votre façade, la charte s'applique : la nuit, le campus peut ajouter au plus 3 dB(A) au fond mesuré avant le chantier, et son propre bruit ne dépasse jamais 40 dB(A), la plus stricte des deux règles s'appliquant. L'acousticien mesure la contribution du campus toutes installations en marche et la publie tous les trois mois.",
    noise_35: "Sous le plafond de 40 dB(A), qui est la valeur guide nocturne de l'OMS en extérieur, prise ici pour le campus seul.",
    noise_30: "Bien sous le plafond de 40 dB(A) ; probablement sous le bruit de fond nocturne actuel des routes et de l'aéroport.",
    noise_lo: "Pratiquement rien", noise_lo_t: (n) => `Environ ${n} dB(A) du campus seul, impossible à distinguer du bruit de fond nocturne actuel des routes et de l'aéroport.`,
    noise_none: "Rien", noise_none_t: (n) => `Environ ${n} dB(A) du campus seul, sous ce qu'une oreille peut distinguer la nuit : un chuchotement fait 30. Vous ne l'entendrez pas.`,
    noise_add: "C'est le bruit du campus seul. Ajouté au fond mesuré à votre façade avant le chantier, il peut augmenter ce que vous entendez d'au plus 3 dB(A), un écart que la plupart des gens ne remarquent pas dehors, plus strict que la limite légale de nuit de 4 dB(A).",
    noise_how: "Le plafond de conception est de 40 dB(A) pour le bruit propre du campus chez l'habitation la plus proche, au Bois Noir, à environ 400 m du bâtiment le plus proche (dérivé). Plus près que 400 m de la source la plus proche, l'outil affiche le plafond. Au-delà, on suppose une baisse de 6 dB à chaque doublement de la distance (source ponctuelle en champ libre), sans compter l'absorption de l'air, le sol ni les écrans : c'est un plafond, pas une prévision. Cible dérivée de la valeur guide de l'OMS ; un acousticien la confirme avant le permis.",
    route_k: "Trafic de chantier", route_sub: "de l'itinéraire de chantier",
    route_close: "Les camions empruntent la D34, route départementale qui longe le nord de Chartres-de-Bretagne. Votre logement est à moins de 300 m de cet accès : les clauses chantier de la charte vous couvrent. Camions de 7 h à 19 h en semaine seulement, un capteur air et bruit sur la D34 publié en direct, un interlocuteur nommé qui répond sous 48 heures.",
    route_t: "Les camions arrivent par le sud : sortie de la N137, D34, ronds-points du Pôle Sud et du Château des Marais, rue des Creuses. Jamais par la D177 ni par les rues résidentielles. L'accès par la D34 longe le nord de Chartres-de-Bretagne, où les logements à moins de 300 m sont couverts par les clauses chantier de la charte. De 7 h à 19 h en semaine, pendant 24 à 36 mois.",
    route_how: "Plus court chemin carrossable sur le réseau routier IGN entre la sortie de la N137 et les parcelles, hors D177 et hors toute route au nord des parcelles, puis distance à vol d'oiseau entre votre adresse et ce tracé. Horaires et durée sont des engagements de la charte ; la durée du chantier est la fourchette habituelle pour un campus de cette taille.",
    heat_k: "La chaleur et votre facture", heat_sub: "des parcelles",
    heat_t: (pct, sav) => `Chaleur du réseau à ${pct}. Pour un logement chauffé au gaz aujourd'hui, c'est <strong>${sav} par an</strong> <span class="muted">(dérivé)</span>.`,
    heat_note: "Les limites des phases sont indicatives tant que la concession de Rennes Métropole n'est pas tracée.",
    seg_house: "Maison, 14 MWh par an", seg_flat: "Appartement, 7 MWh", seg_aria: "Type de logement",
    heat_how: "Zone charte : les rues les plus proches, à environ 1 km des parcelles, au plus bas de 54 €/MWh ou de la moitié du prix du gaz. Phase 1 : une première extension résidentielle vers les rues les plus proches, prise ici à moins de 1,5 km des parcelles (environ 2 000 foyers, dérivé), 30 % sous la facture de gaz, dès l'ouverture. Phase 2 : le reste des trois communes, de la 3e à la 5e année, au moins 10 % sous la facture de gaz (jusqu'à 300 GWh, l'équivalent d'environ 20 000 foyers au gaz, dérivé : 300 GWh ÷ 14 MWh ; les trois communes d'abord, puis les communes voisines selon la concession). Cet outil couvre les trois communes seulement. Les économies reposent sur une maison au gaz de 14 MWh à la facture moyenne 2025 de 1 512 € pour 14 000 kWh (Effy, 108 €/MWh TTC) ; le prix moyen des réseaux 2024 est de 104,7 €/MWh HT (AMORCE), soit environ 110,5 €/MWh TTC, à peu près le niveau du gaz : la remise de la phase 2 est donc un prix fixé par la concession, pas une moyenne de marché. Un appartement est compté pour moitié. Tout est dérivé ; le contrat de concession fixe les limites et le tarif.",
    zones: { charter: "Zone charte", p1: "Phase 1, dès l'ouverture", p2: "Phase 2, 3e à 5e année" },
    sav: { charter: { house: "environ 750 €", flat: "environ 375 €", pct: "au plus bas de 54 €/MWh ou de la moitié du prix du gaz, pendant 15 ans" }, p1: { house: "environ 450 €", flat: "environ 225 €", pct: "30 % sous la facture de gaz" }, p2: { house: "environ 150 €", flat: "environ 75 €", pct: "un prix au moins 10 % sous la facture de gaz, garanti dans la concession" } },
    end_charter: "Vous êtes dans la zone charte : la <a href=\"#charter\">charte des voisins</a> est à vous de signer. En bref : au plus 3 dB(A) au-dessus du fond de ce soir et jamais plus de 40 dB(A) venant du campus ; la chaleur au plus bas de 54 €/MWh ou de la moitié du prix du gaz pendant 15 ans ; aucun camion dans votre rue ; un interlocuteur nommé sous 48 heures ; un siège au comité de suivi ; votre vue dessinée avant les travaux ; une expertise indépendante si vous vendez ; une part fondatrice de la coopérative payée par le fonds local et une voix pour son conseil. ",
    coop: "Votre foyer peut adhérer à la coopérative de chaleur à 50 € la part, avec un vote sur le prix chaque année.", coop_charter: "Votre foyer peut adhérer à la coopérative de chaleur ; une part fondatrice est payée pour vous par le fonds local.",
    park_k: "Le parc public", park_sub: "jusqu'à l'angle nord-ouest du parc", park_t: "3,7 ha de la parcelle face aux maisons les plus proches au nord deviennent un parc public, ouvert tous les jours, avec un jardin d'hiver chauffé par le campus, avant la mise en service du premier bâtiment.", park_how: "Distance à vol d'oiseau entre votre adresse et l'angle nord-ouest de la parcelle du parc, d'où un chemin mène vers la D177 ; l'accès public passe par la voie de desserte de la zone industrielle et ce chemin, sous réserve du propriétaire de l'usine et de Rennes Métropole.",
    end_render: "Il existe une <a href=\"becomes.html#views\">vue dessinée depuis votre rue</a>. ",
    end_main: "Tout ce qui précède est un engagement, listé avec sa méthode de contrôle dans <a href=\"#commitments\">les huit engagements</a>. Si quelque chose est faux pour votre logement, <a href=\"#contact\">dites-le-nous</a> : c'est à cela que servent les quatre semaines.",
    m_addr: "Votre adresse", m_station: "Centrale", m_halls: "Bâtiments 1 à 3", m_route: "Itinéraire chantier", m_hall: (n) => n.replace("Building", "Bâtiment"),
    attribution: "Photo aérienne et adresses : IGN · Carte : Leaflet",
    attribution_alt: "Photo aérienne : Esri World Imagery (IGN injoignable) · Adresses : BAN · Carte : Leaflet",
    km: (v) => v.replace(".", ","),
  } : {
    looking: "Looking up the address…",
    nomatch: "No match in Chartres-de-Bretagne, Saint-Jacques-de-la-Lande or Noyal-Châtillon-sur-Seiche. Try a street name and the commune.",
    municipality: "Only the commune matched; results are for its centre. Add a street for your own numbers.",
    street: "Matched to the street: the figures are for the street's midpoint, give or take 300 m. Add a number for a precise result.",
    netfail: "The address service did not answer. Check your connection and try again.",
    outside: (city) => `That address is in ${city}, outside the three communes. The tool models Chartres-de-Bretagne, Saint-Jacques-de-la-Lande and Noyal-Châtillon-sur-Seiche.`,
    approx: "±300 m",
    noise_v_ok: "Below the charter ceiling", noise_v_charter: "The charter ceiling applies",
    route_v_ok: "Not on the route", route_v_close: "Within 300 m of the D34 approach",
    how: "How we calculated this",
    dist_k: "Distance to the nearest building", dist_station: (d) => `${d} to the power station`,
    dist_how: (h) => `Straight-line distance from the geocoded address to the edge of ${h} and of the station, drawn on the cadastral lots at the positions in the site plan. Addresses from the IGN national address base.`,
    vis_k: "Would you see it?",
    vis_yes: "Yes, the building rooflines",
    vis_yes_t: (a, w) => `About ${a}° above the horizon, ${w} at arm's length, before trees and buildings.`,
    w_thumb: "roughly a thumb's width", w_finger: "roughly a fingertip", w_sliver: "a sliver",
    vis_stacks: "Only the stack tops", vis_stacks_t: "The ground hides the buildings; the two 25 m stacks may show above the skyline.",
    vis_no: "No", vis_no_t: "The ground between you and the campus hides it.",
    vis_na: "Not computed", vis_na_t: "Outside the modelled area.",
    vis_how: "Line of sight over the IGN terrain model from eye height (1.6 m) to the building roof edges (20 m) and the stack tops (25 m), computed in advance on a 25 m grid. Terrain only: houses, sheds and trees in between are not modelled, so this overstates what you would see. From the north, the planted edge screens the base of the buildings.",
    noise_k: "Predicted night noise from the campus, on its own",
    route_v_check: "Near the D34 approach", route_check: "The midpoint of this street is within 600 m of the D34 approach. Add a house number to check whether the charter's D34 clauses cover your home (within 300 m).",
    noise_charter: "At your façade the charter applies: at night the campus may add at most 3 dB(A) to the background measured before construction, and its own sound never exceeds 40 dB(A), whichever is stricter. The acoustician measures the campus's contribution with everything running and publishes it every three months.",
    noise_35: "Below the 40 dB(A) ceiling, which is the WHO outdoor night guideline, used here for the campus alone.",
    noise_30: "Well below the 40 dB(A) ceiling; likely below the existing night background from the roads and the airport.",
    noise_lo: "Essentially nothing", noise_lo_t: (n) => `About ${n} dB(A) from the campus alone, impossible to pick out from the existing night background of the roads and the airport.`,
    noise_none: "Nothing", noise_none_t: (n) => `About ${n} dB(A) from the campus alone, below what an ear can pick out at night: a whisper is 30. You will not hear it.`,
    noise_add: "This is the campus's sound on its own. Added to the background measured at your façade before construction, it may raise what you hear by at most 3 dB(A), a change most people would not notice outdoors and stricter than the legal night limit of 4 dB(A).",
    noise_how: "The design ceiling is 40 dB(A) for the campus's own sound at the nearest home, le Bois Noir, about 400 m from the nearest building (derived). Closer than 400 m to the nearest source, the tool shows the ceiling. Beyond that we assume sound falls by 6 dB for each doubling of distance (a point source in open air) and take no credit for air absorption, ground or barriers, so this is a ceiling, not a forecast. Target derived from the WHO night guideline; an acoustician confirms it before the permit.",
    route_k: "Construction traffic", route_sub: "from the construction route",
    route_close: "Lorries use the D34, the departmental road along the northern edge of Chartres-de-Bretagne. Your home is within 300 m of that approach, so the charter's construction clauses cover you: lorries 7:00 to 19:00 on weekdays only, an air and noise monitor on the D34 published live, a named contact who answers within 48 hours.",
    route_t: "Lorries come from the south: N137 exit, D34, the Pôle Sud and Château des Marais roundabouts, rue des Creuses. Never on the D177 and never through residential streets. The D34 approach runs along the northern edge of Chartres-de-Bretagne, where homes within 300 m are covered by the charter's construction clauses. 7:00 to 19:00 on weekdays, for 24 to 36 months.",
    route_how: "Shortest drivable path on the IGN road network from the N137 exit to the lots, excluding the D177 and every road north of the lots, then the straight-line distance from your address to that path. Hours and duration are commitments in the charter; the build length is the industry range for a campus of this size.",
    heat_k: "Heat and your bill", heat_sub: "from the lots",
    heat_t: (pct, sav) => `Heat from the network at ${pct}. For a home heated by gas today, that is <strong>${sav} a year</strong> <span class="muted">(derived)</span>.`,
    heat_note: "Phase boundaries are indicative until the Rennes Métropole concession is drawn.",
    seg_house: "House, 14 MWh a year", seg_flat: "Apartment, 7 MWh", seg_aria: "Housing type",
    heat_how: "Charter zone: the nearest streets, within about 1 km of the lots, at the lower of €54 per MWh or half the gas price. Phase 1: a first residential extension to the nearest streets, taken here as within 1.5 km of the lots (about 2,000 homes, derived), 30% below the gas bill, from opening. Phase 2: the rest of the three communes, years 3 to 5, at least 10% below the gas bill (up to 300 GWh, about 20,000 gas-heated homes' worth, derived: 300 GWh ÷ 14 MWh; the three communes first, then neighboring communes as the concession sets). This tool covers the three communes only. Savings use a 14 MWh gas-heated house at the 2025 average gas bill of €1,512 for 14,000 kWh (Effy, €108/MWh incl. VAT); the 2024 average network price is €104.7/MWh before tax (AMORCE), about €110.5 with VAT, which is level with gas, so the Phase 2 discount is a price the concession sets, not an average the market delivers. An apartment is taken as half. All derived; the concession contract fixes the boundaries and the tariff.",
    zones: { charter: "Charter zone", p1: "Phase 1, from opening", p2: "Phase 2, years 3 to 5" },
    sav: { charter: { house: "about €750", flat: "about €375", pct: "the lower of €54 per MWh or half the gas price, for 15 years" }, p1: { house: "about €450", flat: "about €225", pct: "30% below the gas bill" }, p2: { house: "about €150", flat: "about €75", pct: "a price at least 10% below the gas bill, guaranteed in the concession" } },
    end_charter: "You are in the charter zone: the <a href=\"#charter\">neighbors' charter</a> is yours to sign. In short: at most 3 dB(A) above tonight's background and never above 40 dB(A) from the campus; heat at the lower of €54/MWh or half the gas price for 15 years; no lorries on your street; a named contact within 48 hours; a seat on the monitoring committee; your view drawn before work starts; an independent valuation if you sell; a founding co-op share paid by the local benefit fund and a vote for its board. ",
    coop: "Your household can join the heat co-op at €50 a share, with a vote on each year's price.", coop_charter: "Your household can join the heat co-op; a founding share is paid for you by the local benefit fund.",
    park_k: "The public park", park_sub: "to the park's north-west corner", park_t: "3.7 ha of the lot facing the nearest houses to the north become a public park, open daily, with a winter garden heated by the campus, before the first building is switched on.", park_how: "Straight-line distance from your address to the park lot's north-west corner, where a track leads towards the D177; public access is through the industrial zone's service road and that track, subject to the factory owner and Rennes Métropole.",
    end_render: "There is a <a href=\"becomes.html#views\">pre-rendered view from your street</a>. ",
    end_main: "Everything above is a commitment, listed with how it is checked in <a href=\"#commitments\">the eight commitments</a>. If something here is wrong for your home, <a href=\"#contact\">tell us</a>: that is what the four weeks are for.",
    m_addr: "Your address", m_station: "Power station", m_halls: "Buildings 1 to 3", m_route: "Construction route", m_hall: (n) => n,
    attribution: "Aerial and addresses: IGN · Map: Leaflet",
    attribution_alt: "Aerial: Esri World Imagery (IGN unreachable) · Addresses: BAN · Map: Leaflet",
    km: (v) => v,
  };

  // ---------- geometry ----------
  function segNearest(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    return [a[0] + t * dx, a[1] + t * dy];
  }
  function nearestOnLine(p, pts) {
    let best = null, bd = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const q = segNearest(p, pts[i], pts[i + 1]), d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d < bd) { bd = d; best = q; }
    }
    return { d: bd, q: best };
  }
  function inside(p, ring) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  function nearestOnRing(p, ring) { return inside(p, ring) ? { d: 0, q: p } : nearestOnLine(p, ring); }
  const ringM = (ring) => ring.map(([lon, lat]) => toM(lon, lat));
  const ringLL = (ring) => ring.map(([lon, lat]) => [lat, lon]);

  // ---------- data ----------
  async function load() {
    const get = (f) => fetch("assets/data/" + f).then((r) => r.json());
    const [campus, lots, route, communes, vs] = await Promise.all([get("campus.json"), get("west_parcels.json"), get("route.json"), get("communes.json"), get("viewshed.json")]);
    const lotKeys = ["35066000AC0541", "35066000AC0705", "35066000AC0710"];
    data = {
      campus, route, communes, vs,
      halls: campus.halls.map((h) => ({ name: h.name, m: ringM(h.ring), ll: ringLL(h.ring) })),
      station: { m: ringM(campus.station.ring), ll: ringLL(campus.station.ring) },
      battery: { m: ringM(campus.battery.ring), ll: ringLL(campus.battery.ring) },
      buffer: { ll: ringLL(campus.buffer.ring) },
      lots: lotKeys.map((k) => ({ k, m: ringM(lots[k].geometry.coordinates[0][0]), ll: ringLL(lots[k].geometry.coordinates[0][0]) })),
      routeM: route.geometry.coordinates.map(([lon, lat]) => toM(lon, lat)),
      routeLL: route.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
      homes: campus.homes.map((h) => ({ ...h, m: toM(h.lon, h.lat) })),
      park: { m: ringM(campus.buffer.ring), entrance: toM(campus.buffer.ring[0][0], campus.buffer.ring[0][1]) },
      school: { ...campus.school, m: toM(campus.school.lon, campus.school.lat) },
    };
    grid = new Uint8Array(vs.nx * vs.ny);
    for (let i = 0, p = 0; i < vs.rle.length; i += 2) { grid.fill(vs.rle[i], p, p + vs.rle[i + 1]); p += vs.rle[i + 1]; }
  }
  function viewClass(lon, lat) {
    const [S, W, N, E] = data.vs.bbox;
    if (lat < S || lat > N || lon < W || lon > E) return -1;
    const i = Math.min(data.vs.ny - 1, Math.floor((N - lat) / ((N - S) / data.vs.ny)));
    const j = Math.min(data.vs.nx - 1, Math.floor((lon - W) / ((E - W) / data.vs.nx)));
    return grid[i * data.vs.nx + j];
  }

  // ---------- map ----------
  function buildMap() {
    const phone = matchMedia("(max-width: 480px)").matches;
    map = L.map("map", { scrollWheelZoom: false, zoomControl: true }).setView([48.0575, -1.7135], phone ? 13 : 14);
    const ign = L.tileLayer("https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&STYLE=normal&FORMAT=image/jpeg",
      { maxZoom: 19, attribution: T.attribution }).addTo(map);
    // If the IGN host cannot be reached (a failing DNS lookup on some networks, an outage),
    // fall back to Esri's world imagery so the map is never blank.
    let tilesOk = 0, tilesBad = 0;
    ign.on("tileload", () => { tilesOk++; });
    ign.on("tileerror", () => {
      if (++tilesBad < 4 || tilesOk) return;
      map.removeLayer(ign); ign.off();
      if (map.attributionControl) map.attributionControl.removeAttribution(T.attribution);
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, attribution: T.attribution_alt }).addTo(map);
    });
    const S = (o) => Object.assign({ weight: 1.5, fillOpacity: 0.18, interactive: false }, o);
    L.geoJSON(data.communes, { style: { color: "#ffffff", weight: 1, opacity: 0.55, dashArray: "4 4", fill: false, interactive: false } }).addTo(map);
    data.lots.forEach((l) => L.polygon(l.ll, S({ color: "#e9edeb", fillColor: "#e9edeb", fillOpacity: 0.12, dashArray: "3 3" })).addTo(map));
    L.polygon(data.buffer.ll, S({ color: "#6fbf7a", fillColor: "#6fbf7a", fillOpacity: 0.35 })).bindTooltip(FR ? "Parc public" : "Public park", { permanent: !phone, direction: "center", className: "lbl" }).addTo(map);
    // the three buildings sit side by side, so one label to the west of the middle one names them all
    data.halls.forEach((h, i) => {
      const p = L.polygon(h.ll, S({ color: "#4fb3a8", fillColor: "#4fb3a8", fillOpacity: 0.45 }));
      if (i === 1) p.bindTooltip(T.m_halls, { permanent: true, direction: "left", className: "lbl", offset: [-14, 0] });
      p.addTo(map);
    });
    L.polygon(data.station.ll, S({ color: "#e4863a", fillColor: "#e4863a", fillOpacity: 0.45 })).bindTooltip(T.m_station, { permanent: true, direction: "right", className: "lbl", offset: [12, 0] }).addTo(map);
    L.polygon(data.battery.ll, S({ color: "#4fb3a8", fillColor: "#4fb3a8", fillOpacity: 0.3 })).addTo(map);
    L.polyline(data.routeLL, { color: "#ffffff", weight: 3, opacity: 0.9, dashArray: "8 6", interactive: false }).bindTooltip(T.m_route, { permanent: true, direction: "right", className: "lbl", offset: [6, 0] }).addTo(map);
    const dirs = { "Rue de la Pommerais": "left", "Rue du Manoir": "right", "Le Bois Noir": "left", "Les Queniaux": "left", "La Monnerie": "right", "La Chaîne": "right" };
    data.homes.forEach((h) => L.circleMarker([h.lat, h.lon], { radius: 5, color: "#fff", weight: 1.5, fillColor: "#12181c", fillOpacity: 1, interactive: !phone }).bindTooltip((FR && h.label_fr) || h.name, { permanent: !phone, direction: dirs[h.name] || "top", className: "lbl", offset: dirs[h.name] === "left" ? [-6, 0] : [6, 0] }).addTo(map));
    L.circleMarker([data.school.lat, data.school.lon], { radius: 5, color: "#fff", weight: 1.5, fillColor: "#12181c", fillOpacity: 1, interactive: !phone }).bindTooltip("École Eugène Pottier", { permanent: !phone, direction: "left", className: "lbl", offset: [-6, 0] }).addTo(map);
    addrLayer = L.layerGroup().addTo(map);
    // the map's box changes size when results show or hide; keep Leaflet's idea of it current
    if ("ResizeObserver" in window) new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(map.getContainer());
  }

  // ---------- geocoding (IGN, restricted to the three communes) ----------
  // The national address base (BAN) is served by two hosts with the same API. IGN's is tried first;
  // if it cannot be reached or does not answer within 6 s, data.gouv.fr's answers instead, and later
  // lookups go straight there.
  const GEO = ["https://data.geopf.fr/geocodage/", "https://api-adresse.data.gouv.fr/"];
  let geoFrom = 0;
  async function geo(kind, params, signal) {
    const qs = new URLSearchParams(params).toString();
    let last;
    for (let i = geoFrom; i < GEO.length; i++) {
      const c = new AbortController();
      const stop = () => c.abort();
      signal.addEventListener("abort", stop, { once: true });
      const timer = setTimeout(stop, 6000);
      try {
        const r = await fetch(`${GEO[i]}${kind}${i ? "/" : ""}?${qs}`, { signal: c.signal });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const j = await r.json();
        geoFrom = i;
        return j;
      } catch (e) {
        if (signal.aborted) throw e; // the person started a new lookup
        last = e;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", stop);
      }
    }
    throw last || new Error("address service unreachable");
  }

  async function geocode(q, signal) {
    const ll = q.match(/^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/);
    if (ll) { // accept "lat, lon" pasted from a map
      const lat = parseFloat(ll[1].replace(",", ".")), lon = parseFloat(ll[2].replace(",", "."));
      const r = await geo("reverse", { lon, lat, limit: 1 }, signal);
      const f = r.features && r.features[0];
      if (f && COMMUNES[f.properties.citycode]) return { lon, lat, label: f.properties.label, city: f.properties.city, citycode: f.properties.citycode };
      return null;
    }
    const reqs = Object.keys(COMMUNES).map((c) => ({ q, citycode: c, limit: 1 }));
    reqs.push({ q, limit: 5 });
    const settled = await Promise.allSettled(reqs.map((p) => geo("search", p, signal)));
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    // every request failing means the service is down, not that the address does not exist
    if (settled.every((s) => s.status === "rejected")) throw settled[0].reason;
    const rs = settled.map((s) => (s.status === "fulfilled" ? s.value : { features: [] }));
    const all = rs.flatMap((r) => r.features || []);
    const feats = all.filter((f) => COMMUNES[f.properties.citycode]).sort((a, b) => b.properties.score - a.properties.score);
    const free = (rs[rs.length - 1].features || [])[0];
    const best = feats[0];
    // the unrestricted search wins when it lands outside the three communes at least as confidently
    if (free && !COMMUNES[free.properties.citycode] && (!best || free.properties.score >= best.properties.score)) return { outside: true, label: free.properties.label, city: free.properties.city };
    if (!best || best.properties.score < 0.45) return null; // a weak match is worse than none
    // never substitute a different street: the typed street must appear in the match
    const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    const typed = norm(q.split(",")[0]).replace(/^\d+\s*(bis|ter)?\s*/, "").trim();
    if (typed && !norm(best.properties.label).includes(typed)) return { outside: true, label: best.properties.label, city: free ? free.properties.city : best.properties.city };
    return { lon: best.geometry.coordinates[0], lat: best.geometry.coordinates[1], label: best.properties.label, city: best.properties.city, citycode: best.properties.citycode, type: best.properties.type };
  }

  // ---------- the calculation ----------
  function compute(a) {
    const p = toM(a.lon, a.lat);
    let hall = null;
    data.halls.forEach((h) => { const r = nearestOnRing(p, h.m); if (!hall || r.d < hall.d) hall = { ...r, name: h.name }; });
    const station = nearestOnRing(p, data.station.m);
    const lots = Math.min(...data.lots.map((l) => nearestOnRing(p, l.m).d));
    const noiseSrc = Math.min(hall.d, station.d);
    const noise = noiseSrc < NOISE_M ? 40 : 40 - 20 * Math.log10(noiseSrc / NOISE_M);
    const route = nearestOnLine(p, data.routeM);
    const vc = viewClass(a.lon, a.lat);
    const angle = Math.atan2(data.vs.hall_height_m, Math.max(hall.d, 1)) / D2R;
    const render = data.homes.find((h) => h.render && Math.hypot(p[0] - h.m[0], p[1] - h.m[1]) < 450);
    const zone = lots <= CHARTER_M ? "charter" : lots <= PHASE1_M ? "p1" : "p2";
    const park = Math.hypot(p[0] - data.park.entrance[0], p[1] - data.park.entrance[1]);
    return { p, hall, station, lots, noiseSrc, noise, route, vc, angle, render, zone, park };
  }
  const fmtM = (d) => d < 950 ? `${Math.round(d / 10) * 10} m` : `${T.km((d / 1000).toFixed(1).replace(".0", ""))} km`;
  const fmtDeg = (a) => T.km(a < 0.95 ? a.toFixed(1) : String(Math.round(a)));

  function render(a, c) {
    const vis = c.vc === 2 ? [T.vis_yes, T.vis_yes_t(fmtDeg(c.angle), c.angle >= 1.5 ? T.w_thumb : c.angle >= 0.8 ? T.w_finger : T.w_sliver)]
      : c.vc === 1 ? [T.vis_stacks, T.vis_stacks_t] : c.vc === 0 ? [T.vis_no, T.vis_no_t] : [T.vis_na, T.vis_na_t];
    const nRound = Math.round(c.noise);
    const band = (c.zone === "charter" || c.noiseSrc < NOISE_M) ? "charter" : c.noise >= 35 ? "35" : c.noise >= 30 ? "30" : c.noise >= 25 ? "lo" : "none";
    const noiseV = band === "charter" ? `${T.noise_v_charter}<small>≤ 40 dB(A)</small>` : band === "lo" ? `${T.noise_lo}<small>${FR ? "environ" : "about"} ${nRound} dB(A)</small>` : band === "none" ? `${T.noise_none}<small>${FR ? "environ" : "about"} ${nRound} dB(A)</small>` : `${T.noise_v_ok}<small>${nRound} dB(A)</small>`;
    const noiseTxt = band === "charter" ? T.noise_charter + " " + T.noise_add : band === "35" ? T.noise_35 + " " + T.noise_add : band === "30" ? T.noise_30 + " " + T.noise_add : band === "lo" ? T.noise_lo_t(nRound) : T.noise_none_t(nRound);
    const onRoute = c.route.d < 300 && !(a.type === "street" || a.type === "locality");
    const nearRoute = !onRoute && c.route.d < 600 && (a.type === "street" || a.type === "locality");
    const tier = T.sav[c.zone], sav = tier[housing];
    const approx = a.type === "street" || a.type === "locality";
    const pm = approx ? ` <span class="muted">${T.approx}</span>` : "";
    let first = true;
    const det = (txt) => { const o = first ? " open" : ""; first = false; return `<details${o}><summary>${T.how}</summary><p>${txt}</p></details>`; };
    results.innerHTML = `
      <p class="where"><strong>${esc(a.label)}</strong> · ${esc(a.city)}</p>
      <div class="r"><div class="k">${T.dist_k}</div><div class="v">${fmtM(c.hall.d)}${pm}<small>${T.dist_station(fmtM(c.station.d))}</small></div>${det(T.dist_how(c.hall.name))}</div>
      <div class="r"><div class="k">${T.vis_k}</div><div class="v">${vis[0]}</div><div class="t">${vis[1]}</div>${det(T.vis_how)}</div>
      <div class="r"><div class="k">${T.noise_k}</div><div class="v">${noiseV}</div><div class="t">${noiseTxt}</div>${det(T.noise_how)}</div>
      <div class="r"><div class="k">${T.route_k}</div><div class="v">${onRoute ? T.route_v_close : nearRoute ? T.route_v_check : T.route_v_ok}<small>${fmtM(c.route.d)} ${T.route_sub}${approx ? ", " + T.approx : ""}</small></div><div class="t">${onRoute ? T.route_close : nearRoute ? T.route_check : T.route_t}</div>${det(T.route_how)}</div>
      <div class="r"><div class="k">${T.heat_k}</div><div class="v heat">${T.zones[c.zone]}<small>${fmtM(c.lots)} ${T.heat_sub}${approx ? ", " + T.approx : ""}</small></div>
        <div class="t">${T.heat_t(tier.pct, sav)} ${T.heat_note}</div>
        ${sav ? `<div class="seg" role="group" aria-label="${T.seg_aria}"><button type="button" data-h="house" aria-pressed="${housing === "house"}">${T.seg_house}</button><button type="button" data-h="flat" aria-pressed="${housing === "flat"}">${T.seg_flat}</button></div>` : ""}
        <div class="t">${c.zone === "charter" ? T.coop_charter : T.coop}</div>
        ${det(T.heat_how)}</div>
      <div class="r"><div class="k">${T.park_k}</div><div class="v">${fmtM(c.park)}${pm}<small>${T.park_sub}</small></div><div class="t">${T.park_t}</div>${det(T.park_how)}</div>
      <p class="end">${c.zone === "charter" ? T.end_charter : ""}${T.end_main}</p>`;
    results.hidden = false;
    results.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => { housing = b.dataset.h; render(a, c); }));
    addrLayer.clearLayers();
    const here = [a.lat, a.lon], there = toLL(c.hall.q[0], c.hall.q[1]);
    L.circleMarker(here, { radius: 7, color: "#12181c", weight: 3, fillColor: "#fff", fillOpacity: 1 }).bindTooltip(T.m_addr, { permanent: true, direction: "top", className: "lbl", offset: [0, -6] }).addTo(addrLayer);
    L.polyline([here, there], { color: "#fff", weight: 2, opacity: 0.9 }).bindTooltip(fmtM(c.hall.d), { permanent: true, direction: "center", className: "dist" }).addTo(addrLayer);
    // the map moves into a narrower column once results show: measure it again before framing
    map.invalidateSize({ pan: false });
    map.fitBounds(L.latLngBounds([here, there]).extend(data.station.ll[0]).pad(0.25), { animate: !reduced, maxZoom: 16 });
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }

  // ---------- flow ----------
  async function lookup(q) {
    q = (q || "").trim();
    if (!q) { input.focus(); return; }
    if (ctrl) ctrl.abort();
    ctrl = new AbortController();
    const mine = ctrl, tool = form.closest(".tool");
    if (tool) tool.classList.add("busy");
    status.className = "status"; status.textContent = T.looking;
    results.hidden = true;
    try {
      if (!data) await load();
      if (!map) buildMap();
      const a = await geocode(q, ctrl.signal);
      if (!a) { status.className = "status err"; status.textContent = T.nomatch; return; }
      if (a.outside) { status.className = "status err"; status.textContent = T.outside(a.city || "?"); return; }
      status.textContent = a.type === "municipality" ? T.municipality : a.type === "street" || a.type === "locality" ? T.street : "";
      render(a, compute(a));
      history.replaceState(null, "", "#a=" + encodeURIComponent(q));
    } catch (e) {
      if (e.name === "AbortError") return;
      status.className = "status err"; status.textContent = T.netfail;
    } finally {
      if (tool && ctrl === mine) tool.classList.remove("busy");
    }
  }
  form.addEventListener("submit", (e) => { e.preventDefault(); lookup(input.value); });
  document.querySelectorAll(".examples button").forEach((b) => b.addEventListener("click", () => { input.value = b.dataset.q; lookup(b.dataset.q); }));
  // the language toggle keeps the address in the hash
  document.querySelectorAll(".lang a").forEach((l) => l.addEventListener("click", () => { if (location.hash) l.href = l.getAttribute("href").split("#")[0] + location.hash; }));
  load().then(buildMap).catch(() => {});
  const h = location.hash.match(/^#a=(.+)$/);
  if (h) { input.value = decodeURIComponent(h[1]); lookup(input.value); }
})();
