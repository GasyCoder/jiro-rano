# Moteur de répartition (`BillingAllocationEngine`)

Code : [`src/shared/billing/engine.ts`](../src/shared/billing/engine.ts) — tests : [`engine.test.ts`](../src/shared/billing/engine.test.ts).

Le moteur est une fonction **pure et déterministe** : il ne lit ni la base de données, ni l'heure courante, ni
l'interface. Même entrée JSON ⇒ même résultat, au centime près. Sa version (`ENGINE_VERSION`) et son entrée
exacte (`allocations.input_snapshot`) sont enregistrées avec chaque répartition, ce qui permet de rejouer
n'importe quel calcul passé.

## 1. Principe fondamental

JIRAMA applique ses tranches (340 / 560 / 764 Ar…), la prime fixe, les redevances, les taxes et la TVA à la
consommation **globale** du compteur principal. Les recalculer logement par logement donnerait un total
différent de la facture réelle. Le moteur :

1. détermine honnêtement les kWh de chaque consommateur ;
2. en déduit sa part de la consommation totale ;
3. répartit le **montant électricité réellement facturé** au prorata de cette part.

Chaque logement paie ainsi le même **prix moyen effectif** :

```text
prix effectif (Ar/kWh) = montant électricité facture ÷ kWh facturés
```

Ce prix sert uniquement à expliquer la répartition : il ne remplace pas la tarification JIRAMA.

## 2. Unités et arithmétique

| Grandeur | Unité interne | Exemple |
| --- | --- | --- |
| Énergie | Wh entiers | 293,271 kWh → `293271` |
| Argent | centimes d'Ariary entiers | 328 798,76 Ar → `32879876` |
| Durée | secondes entières | 4 j 12 h 01 min 23 s → `388883` |

Aucun montant n'est calculé en virgule flottante. Les produits `a × b ÷ c` utilisent des entiers `BigInt`
(arrondi au plus proche, demi vers le haut). Les dates sont des dates **calendaires** (`AAAA-MM-JJ`) et des
heures locales naïves : Madagascar (UTC+3) n'a pas d'heure d'été, les durées sont donc exactes et identiques
sur le serveur et dans le navigateur.

## 3. Méthodes par consommateur

Chaque consommateur a une méthode configurée. Le moteur enregistre la **méthode appliquée** et la
**provenance** de la valeur (jamais modifiée silencieusement) :

| Méthode configurée | Méthode appliquée | Provenance | Formule |
| --- | --- | --- | --- |
| `SUB_METER` (relevés aux dates de la facture) | `SUB_METER_EXACT` | `MEASURED` | `index fin − index début` |
| `SUB_METER` (autres dates) | `SUB_METER_PRORATED` | `PRORATED` | voir §4 |
| `MANUAL_APPROXIMATION` | `MANUAL_APPROXIMATION` | `ESTIMATED` | valeur saisie par le gestionnaire |
| `DIFFERENCE` | `DIFFERENCE` | `DIFFERENCE` | `total − Σ autres` |
| `EQUAL_SHARE` | `EQUAL_SHARE` | `ESTIMATED` | `reste ÷ n` |
| `WEIGHTED_SHARE` | `WEIGHTED_SHARE` | `ESTIMATED` | `reste × coef ÷ Σ coefs` |
| (correction exceptionnelle) | `MANUAL_OVERRIDE` | `MANUAL` | valeur + justification obligatoire |

« Dates de la facture » : date du relevé de début = début de période **et** date du relevé de fin = fin de période.

Les index utilisés sont les **valeurs normalisées** des relevés : pour un sous-compteur mécanique
(`INTEGER_TRUNCATE`), seuls les chiffres entiers comptent (`48015` affiché = 4801,5 → 4801 kWh). La valeur lue
brute est conservée à côté (`meter_readings.value`).

Si le nouvel index est inférieur à l'ancien, le calcul est **refusé** (`NEGATIVE_CONSUMPTION`), sauf si la
capacité du compteur est connue (`rolloverAt`, ex. 10 000) : la consommation vaut alors
`capacité + index fin − index début`, avec un avertissement `METER_ROLLOVER`.

## 4. Proratisation (`SUB_METER_PRORATED`)

```text
consommation mesurée   = index fin − index début                      (Wh)
durée mesurée          = date/heure fin − date/heure début            (secondes exactes)
durée facture          = nombre de jours JIRAMA × 86 400              (secondes)
consommation retenue   = consommation mesurée × durée facture ÷ durée mesurée
```

ce qui équivaut à `moyenne journalière × jours facture`. La durée est **exacte** : 24/09 à 21 h 05 → 29/09 à
9 h 07 représente 4,50 jours, pas 5. Compter des jours calendaires reviendrait à inventer une demi-journée sans
consommation. Si une heure manque, la durée est comptée en jours entiers et l'avertissement
`READING_TIME_MISSING` est émis. La même règle s'applique à tous les sous-compteurs.

Avertissements de fiabilité :

- `SHORT_MEASUREMENT` : la mesure couvre moins de la moitié de la période facturée ;
- `MEASUREMENT_OUTSIDE_PERIOD` : plus de la moitié de la durée mesurée est hors de la période de la facture.

## 5. Ordre de résolution

1. **Valeurs propres** : sous-compteurs, estimations, corrections manuelles.
2. **Reste** : `reste = kWh facturés − Σ valeurs propres`.
   - `reste < 0` ⇒ erreur bloquante `SUBMETERS_EXCEED_MAIN` (les sous-compteurs dépassent le compteur principal).
3. **Répartition du reste** entre les consommateurs sans valeur propre :
   - un seul consommateur `DIFFERENCE` ⇒ il reçoit tout le reste ;
   - consommateurs `EQUAL_SHARE` / `WEIGHTED_SHARE` ⇒ partage selon les poids (part égale = poids 1) ;
   - aucun consommateur pour recevoir un reste non nul ⇒ erreur `UNALLOCATED_KWH` (ajouter par exemple un
     consommateur « Parties communes » calculé par différence).
   - Interdit : plusieurs `DIFFERENCE` (`MULTIPLE_DIFFERENCE`), ou `DIFFERENCE` mêlé à des parts égales /
     pondérées (`DIFFERENCE_WITH_SHARES`) : « le reste » serait ambigu.
4. **Contrôle** : `Σ kWh attribués = kWh facturés`, exactement (en Wh).

## 6. Électricité, arrondis et montants à payer

```text
part consommateur          = kWh consommateur ÷ kWh facturés
électricité consommateur   = part × montant électricité facture
```

Les centimes sont répartis par la **méthode du plus fort reste** (Hamilton) : chaque part reçoit la partie
entière de son quota, puis les centimes restants vont aux plus forts restes (à égalité, dans l'ordre des
consommateurs). La somme des parts est **exactement** égale au montant facturé ; tout ajustement d'un centime
est indiqué dans les étapes (`ROUNDING`).

Les **montants à payer** sont arrondis à l'Ariary par la même méthode, de sorte que leur somme soit égale au
total de la facture arrondi à l'Ariary.

## 7. Eau

| Mode | Formule |
| --- | --- |
| `EQUAL` (défaut) | `montant eau ÷ nombre de consommateurs` |
| `PROPORTIONAL` / `KWH` | au prorata des kWh attribués |
| `PROPORTIONAL` / `WEIGHT` | au prorata du coefficient d'eau de chaque consommateur (0 = exclu) |
| `MANUAL` | montants saisis ; leur somme doit égaler le montant d'eau à la tolérance près |

Mêmes règles d'arrondi au centime que pour l'électricité.

## 8. Contrôles et tolérance

| Contrôle | Résultat |
| --- | --- |
| `Σ kWh = kWh facturés` | exact, sinon erreur |
| `Σ électricité = montant électricité` | exact par construction (contrôlé) |
| `Σ totaux ≈ total facture` | écart ≤ tolérance (défaut ± 2 Ar) : avertissement ; au-delà : erreur `TOTAL_MISMATCH` |
| index principal (nouveau − ancien) ≠ kWh facturés | avertissement `MAIN_METER_MISMATCH` (la facture fait foi) |
| jours facture ≠ écart entre les dates | avertissement `BILL_DAYS_MISMATCH` (le nombre de jours JIRAMA fait foi) |

Une répartition avec au moins une erreur est enregistrée en **brouillon** (`DRAFT`) et ne peut pas être
validée. Les avertissements n'empêchent pas la validation mais restent attachés à la version.

Le service (hors moteur) ajoute `READING_NOT_VALIDATED` quand un relevé utilisé n'a pas été validé par un
gestionnaire : le calcul est possible, la validation est refusée.

## 9. Traçabilité

Chaque calcul produit des étapes lisibles « libellé : formule = résultat », enregistrées dans
`allocation_calculation_steps` et affichées par « Voir le détail du calcul ». Exemple :

```text
Facture JIRAMA : 27/08/2026 → 26/09/2026 (30 jours) = 443 kWh · électricité 328 798,76 Ar · eau 3 770,00 Ar
RDC — consommation mesurée : 4801 − 4757 (24/09/2026 21:05 → 29/09/2026 09:07, 4,5010 j) = 44 kWh
RDC — proratisation sur 30 jours (moyenne 9,776 kWh/jour) : 44 kWh ÷ 4,5010 j × 30 j = 293,27 kWh
1er étage — par différence : 443 − 293,27 − 18,43 = 131,30 kWh
Prix moyen effectif : 328 798,76 Ar ÷ 443 kWh = 742,21 Ar/kWh
RDC — électricité : 293,27 ÷ 443 × 328 798,76 Ar = 217 668,49 Ar (66,20 %)
```

## 10. Versions et validation

- Un calcul crée **toujours** une nouvelle version ; une version n'est jamais modifiée.
- Les versions non officielles précédentes passent à `SUPERSEDED`.
- `CALCULATED` → `VALIDATED` → `LOCKED`. Une seule version officielle (validée ou verrouillée) par facture
  (index unique partiel en base).
- Recalculer une facture déjà validée exige une **raison de correction** ; la nouvelle version référence la
  précédente (`correction_of_id`) et la remplace seulement lorsqu'elle est validée.
- Une version verrouillée ne peut être remplacée que par le SUPERADMIN.
- Avant validation, le serveur vérifie que la facture et les relevés utilisés n'ont **pas changé** depuis le
  calcul (comparaison avec l'instantané) et que les relevés sont validés.

## 11. Exemples de référence (couverts par les tests)

**Exemple du cahier des charges** — RDC 168 kWh et 2e 164 kWh (relevés aux dates de la facture), 1er par
différence :

| Logement | kWh | Électricité | Eau | Total | À payer |
| --- | ---: | ---: | ---: | ---: | ---: |
| RDC | 168 | 124 691,18 | 1 256,67 | 125 947,85 | 125 948 |
| 1er étage | 111 | 82 385,24 | 1 256,67 | 83 641,91 | 83 642 |
| 2e étage | 164 | 121 722,34 | 1 256,66 | 122 979,00 | 122 979 |
| **Total** | **443** | **328 798,76** | **3 770,00** | **332 568,76** | **332 569** |

**Relevés réels d'octobre 2026** — RDC 4757 (24/09 21:05:57) → 4801 (29/09 09:07:20), 2e 8073 (27/08 16:18)
→ 8092 (27/09 14:25), 1er par différence :

| Logement | kWh | Provenance | À payer |
| --- | ---: | --- | ---: |
| RDC | 293,271 | Proratisé | 218 925 |
| 1er étage | 131,295 | Calculé | 98 705 |
| 2e étage | 18,434 | Proratisé | 14 939 |

avec les avertissements `MAIN_METER_MISMATCH` (51 311 − 50 898 = 413 ≠ 443), `SHORT_MEASUREMENT` et
`MEASUREMENT_OUTSIDE_PERIOD` pour le RDC.

Les valeurs attendues des tests ont été calculées indépendamment (fractions exactes) et non recopiées depuis
le moteur.
