// Liste des clients à exclure de TOUS les dashboards du projet (demande
// explicite : leurs missions, lots et bulletins ne doivent apparaître nulle
// part — ni dans les agrégats, ni dans les listes/dropdowns de sélection).
// Point d'entrée unique pour cette règle métier, afin de ne pas la dupliquer
// (et risquer de l'oublier) dans chaque fichier sql-*.js.
// Client "ONG de test" : exclu de tous les dashboards SAUF /rd, /re-collecte,
// /re-mobilisation (et son détail /rd-mobilisation), qui le laissent passer via
// l'option `allowTest` (cf. isExcludedClient, missionIsExcluded dans index.js).
// Les requêtes cross-missions (excludeClientsClause) l'écartent toujours.
const TEST_CLIENT_ID = 'f17e1174-b8a3-4d73-a7ed-ea6f81cb3e3d';

const EXCLUDED_CLIENT_IDS = [
  '0990fd74-bd60-4bd9-9d28-dbf941c72567',
  '8f732ffd-ffa7-44ab-a741-f51d92a9c4a9',
  TEST_CLIENT_ID,
];

// Noms correspondants ("[Demo] Stores", "AL", "ONG de test" — comptes de
// démo/test). Utilisé pour /api/rm-missions et les cartes RH, qui s'appuient
// sur des questions Metabase déjà construites dont on ne contrôle pas le SQL :
// on ne peut filtrer qu'après coup, sur le nom affiché plutôt que sur l'id.
const EXCLUDED_CLIENT_NAMES = ['[Demo] Stores', 'AL', 'ONG de test'];

function excludedClientsSqlList() {
  return EXCLUDED_CLIENT_IDS.map((id) => `'${id}'`).join(', ');
}

// À utiliser dans une requête où un alias sur `missions` (donnant accès à
// client_id) est en scope — ex. excludeClientsClause('m') -> "AND m.client_id NOT IN (...)".
function excludeClientsClause(missionAlias) {
  // Exclut aussi les missions de type "mobilisation" (type_offre) de tous les
  // calculs cross-missions (demande explicite 14/10/2026) : seuls les
  // dashboards /re-mobilisation et /rd-mobilisation les affichent.
  return `AND ${missionAlias}.client_id NOT IN (${excludedClientsSqlList()}) AND coalesce(${missionAlias}.type_offre, '') <> 'mobilisation'`;
}

// À utiliser dans une requête où un alias sur `clients` directement est en
// scope — ex. excludeClientsDirectClause('c') -> "AND c.id NOT IN (...)".
function excludeClientsDirectClause(clientAlias) {
  return `AND ${clientAlias}.id NOT IN (${excludedClientsSqlList()})`;
}

function isExcludedClient(id_client, { allowTest = false } = {}) {
  if (!id_client) return false;
  if (allowTest && id_client === TEST_CLIENT_ID) return false;
  return EXCLUDED_CLIENT_IDS.includes(id_client);
}

// Requête minimale pour vérifier à quel client appartient une mission donnée
// (utilisée côté handler pour bloquer l'accès direct par id_mission/URL à
// une mission d'un client exclu, sur les dashboards scopés à une seule
// mission qui ne joignent pas forcément `clients` eux-mêmes).
function buildMissionClientQuery(id_mission) {
  return `select client_id, type_offre from missions where id = '${id_mission}' limit 1;`;
}

export {
  TEST_CLIENT_ID,
  EXCLUDED_CLIENT_IDS,
  EXCLUDED_CLIENT_NAMES,
  excludedClientsSqlList,
  excludeClientsClause,
  excludeClientsDirectClause,
  isExcludedClient,
  buildMissionClientQuery,
};
