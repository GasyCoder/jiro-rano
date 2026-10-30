/* global PhusionPassenger */
// Fichier de démarrage pour o2switch « Setup Node.js App » (Phusion Passenger).
// Passenger charge ce fichier avec require() ; le serveur compilé est un module ES, importé dynamiquement.
// autoInstall: false → le serveur appelle lui-même listen('passenger') une fois prêt (voir src/server/index.ts).
if (typeof PhusionPassenger !== 'undefined') {
  PhusionPassenger.configure({ autoInstall: false });
}

import('./dist/server/index.js').catch((error) => {
  console.error('Démarrage impossible :', error);
  process.exit(1);
});
