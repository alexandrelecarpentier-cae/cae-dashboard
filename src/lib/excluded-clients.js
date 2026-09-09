// Liste des clients à exclure de TOUS les dashboards du projet (demande
// explicite : leurs missions, lots et bulletins ne doivent apparaître nulle
// part — ni dans les agrégats, ni dans les listes/dropdowns de sélection).
// Point d'entrée unique pour cette règle métier, afin de ne pas la dupliquer
// (et risquer de l'oublier) dans chaque fichier sql-*.js.
const EXCLUDED_CLIENT_IDS = [
  '0990fd74-bd60-4bd9-9d28-dbf941c72567',
  '8f732ffd-ffa7-44ab-a741-f51d92a9c4a9',
  'f17e1174-b8a3-4d73-a7ed-ea6f81cb3e3d',
];

// Noms correspondants (vérifiés en base au moment de l'implémentation :
// "[Demo] Stores", "AL", "ONG de test" — des comptes de démo/test, cohérent
// avec la demande d'exclusion). Utilisé uniquement pour /api/rm-missions,
// qui s'appuie sur une question Metabase déjà construite (carte 514) dont on
// ne contrôle pas le SQL depuis ce projet — on ne peut donc filtrer qu'après
// coup, sur le nom affiché plutôt que sur l'id.
const EXCLUDED_CLIENT_NAMES = ['[Demo] Stores', 'AL', 'ONG de test'];

function excludedClientsSqlList() {
  return EXCLUDED_CLIENT_IDS.map((id) => `'${id}'`).join(', ');
}

// À utiliser dans une requête où un alias sur `missions` (donnant accès à
// client_id) est en scope — ex. excludeClientsClause('m') -> "AND m.client_id NOT IN (...)".
function excludeClientsClause(missionAlias) {
  return `AND ${missionAlias}.client_id NOT IN (${excludedClientsSqlList()})`;
}

// À utiliser dans une requête où un alias sur `clients` directement est en
// scope — ex. excludeClientsDirectClause('c') -> "AND c.id NOT IN (...)".
function excludeClientsDirectClause(clientAlias) {
  return `AND ${clientAlias}.id NOT IN (${excludedClientsSqlList()})`;
}

function isExcludedClient(id_client) {
  return !!id_client && EXCLUDED_CLIENT_IDS.includes(id_client);
}

// Requête minimale pour vérifier à quel client appartient une mission donnée
// (utilisée côté handler pour bloquer l'accès direct par id_mission/URL à
// une mission d'un client exclu, sur les dashboards scopés à une seule
// mission qui ne joignent pas forcément `clients` eux-mêmes).
function buildMissionClientQuery(id_mission) {
  return `select client_id from missions where id = '${id_mission}' limit 1;`;
}

export {
  EXCLUDED_CLIENT_IDS,
  EXCLUDED_CLIENT_NAMES,
  excludedClientsSqlList,
  excludeClientsClause,
  excludeClientsDirectClause,
  isExcludedClient,
  buildMissionClientQuery,
};
