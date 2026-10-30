import type { MessageKey } from './index';

/**
 * Traduction malgache (partielle) : toute clé absente retombe sur le français.
 * Pour compléter : ajouter les clés ici, sans toucher aux écrans.
 */
export const mg: Partial<Record<MessageKey, string>> = {
  'nav.dashboard': 'Tabilao',
  'nav.bills': 'Faktiora',
  'nav.readings': 'Famakiana kaontera',
  'nav.building': 'Trano',
  'nav.logout': 'Hivoaka',
  'action.save': 'Tehirizina',
  'action.cancel': 'Foanana',
  'action.confirm': 'Hamafisina',
  'auth.login.title': 'Hiditra',
  'auth.login.submit': 'Hiditra',
  'auth.email': 'Mailaka',
  'auth.password': 'Teny miafina',
};
