// Requêtes SQL utilitaires liées à une mission unique par id/code.
//
// Ce fichier contenait auparavant aussi buildMissionPerformanceQueries et
// buildRecruteurPerformanceQueries (dashboard Metabase 15 "Suivi mission
// RE" / "Suivi par RD v3"), retirées le 9/2026 : aucune page de public/
// n'appelait plus les routes /api/mission-performance et
// /api/recruteur-performance qui les exposaient — /mission.html a pris le
// relai via sql-mission-suivi.js/sql-rd.js, avec des formules taux_transfo
// et pct_moins_25 exprimées en pourcentage (0-100) plutôt qu'en ratio
// (0-1) comme ici, ce qui aurait pu induire une confusion d'échelle si ce
// code mort avait été rebranché par erreur (cf. note méthodologique
// NOTE-INDICATEURS.md, section 4.2). Code mort supprimé plutôt que
// laissé en place, à la demande explicite de l'utilisateur.

// Résolution code_mission -> id_mission : utilisée quand mission.html est
// ouverte depuis la modale de rm.html, qui ne connaît que le code_mission
// (la question Metabase "Missions en cours" n'expose pas l'id). code_mission
// est déjà validé par RE_CODE côté appelant avant d'arriver ici.
function buildResolveMissionIdQuery(code_mission) {
  return `select id from missions where code_mission = '${code_mission}' limit 1;`;
}

function buildMissionDaysQuery(id_mission) {
  return `select distinct l.date
from lots l
join missions m on m.id = l.mission_id
where m.id = '${id_mission}' and l.date is not null and l.date <= current_date
order by 1;`;
}

export {
  buildMissionDaysQuery,
  buildResolveMissionIdQuery,
};
