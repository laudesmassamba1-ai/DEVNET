# DEVNET — inventaire documentaire

> Dernière mise à jour : 2026-11-15.
> Périmètre : 63 fichiers Markdown suivis ou non suivis, hors
> `node_modules`, plus `docs/ui/ratchet.json` comme fichier de référence
> non-Markdown. Les fichiers créés par cette passe sont ajoutés au fur et
> à mesure.
>
> Statuts : `RÉFÉRENCE` (protocole de travail), `CORRIGÉ`, `CORRIGÉ PARTIEL`,
> `À AUDITER`, `À METTRE À JOUR`, `HISTORIQUE`, `HORS PÉRIMÈTRE`.
> Une case cochée signifie que la passe documentaire est terminée pour ce
> fichier, pas que toutes ses affirmations produit sont prouvées.

| Fait | Fichier | Rôle | Statut | Prochaine action |
|---|---|---|---|---|
| [ ] | `README.md` | Vitrine, installation, stack, état produit | CORRIGÉ PARTIEL | Auditer les affirmations restantes par section |
| [x] | `ROADMAP.md` | Plan produit | CORRIGÉ | Réécrit le 2026-11-15 ; dette et preuves nommées |
| [x] | `docs-technique.md` | Carte technique courte | CORRIGÉ | Liens locaux vérifiés le 2026-11-15 |
| [x] | `docs/ARCHITECTURE.md` | Architecture | CORRIGÉ | Réécrit le 2026-11-15 pour PostgreSQL et les sept modules |
| [ ] | `docs/BASELINE.md` | Référence de base | À AUDITER | Vérifier version et mesures |
| [x] | `docs/FONDATIONS.md` | Structure, couches et fondements | CORRIGÉ | Réécrit le 2026-11-15 ; chiffres mesurés |
| [ ] | `docs/MISSION.md` | Mission produit | À AUDITER | Vérifier les promesses publiées |
| [ ] | `docs/design-log.md` | Journal de design | HISTORIQUE | Vérifier qu'il ne sert pas de statut courant |
| [ ] | `docs/adr/0001-strategie-base-de-donnees.md` | Décision base | HISTORIQUE | Vérifier la mention du fournisseur actuel |
| [ ] | `docs/adr/0004-executeur-de-migrations.md` | Décision migrations | HISTORIQUE | Vérifier les chemins |
| [ ] | `docs/adr/0005-premier-port-fil.md` | Décision port du fil | HISTORIQUE | Vérifier les chemins |
| [ ] | `docs/adr/0010-modele-d-extensibilite.md` | Décision extensibilité | HISTORIQUE | Vérifier le statut des plugins |
| [ ] | `docs/adr/0011-exploitation-postgresql.md` | Décision exploitation | HISTORIQUE | Vérifier la cible Neon |
| [ ] | `docs/adr/0012-html-img-pour-medias-externes.md` | Décision médias | HISTORIQUE | Vérifier la portée |
| [ ] | `docs/engineering/DEVNET_AUDIT_BASELINE.md` | Audit de base | À AUDITER | Revalider les constats |
| [ ] | `docs/engineering/DEVNET-CONTINUOUS-EXECUTION-MASTER-SKILL.md` | Protocole d'exécution | RÉFÉRENCE | Aucune modification produit |
| [ ] | `docs/engineering/DEVNET-DOCUMENTATION-AND-CONTENT-SYNC-SKILL.md` | Protocole documentaire | RÉFÉRENCE | Suivre les phases et registres |
| [ ] | `docs/engineering/DEVNET-EXECUTION-CHECKPOINT.md` | Point de reprise global | À METTRE À JOUR | Remplacer `745903f`/`31d805d` par l'état courant |
| [ ] | `docs/engineering/DEVNET-EXECUTION-LEDGER.md` | Registre central | À METTRE À JOUR | Actualiser l'en-tête et UI-003 |
| [ ] | `docs/engineering/DEVNET-EXECUTION-LOG.md` | Journal d'exécution | À METTRE À JOUR | Ajouter la passe documentaire |
| [x] | `docs/engineering/DEVNET_MEDIA_ARCHITECTURE.md` | Architecture médias | CORRIGÉ | Audience objet `081`, chemins same-origin et preuves 26/36/47 |
| [ ] | `docs/engineering/DEVNET-NATIVE-CRAFT-UIUX-SKILL.md` | Protocole UI/UX | RÉFÉRENCE | Aucune modification produit |
| [x] | `docs/engineering/DEVNET_RELEASE_CHECKLIST.md` | Checklist de livraison | CORRIGÉ | TLS et `service_role` cochés ; bucket et RLS cible restent ouverts |
| [ ] | `docs/engineering/DEVNET_REMEDIATION_LEDGER.md` | Registre de remédiation | À AUDITER | Réconcilier avec le ledger central |
| [x] | `docs/engineering/DEVNET_SECURITY_MODEL.md` | Modèle de sécurité | CORRIGÉ | `service_role` fermé, TLS vérifié, audience média `081` |
| [x] | `docs/engineering/DEVNET_STORIES_SPEC.md` | Spécification Stories | CORRIGÉ | Audience média fermée par `081` ; test HTTP restant |
| [ ] | `docs/engineering/DEVNET-TRUST-SAFETY-ULTIMATE-SKILL.md` | Protocole Trust & Safety | RÉFÉRENCE | Aucune modification produit |
| [ ] | `docs/engineering/DEVNET_UI_QA.md` | Assurance UI | À AUDITER | Vérifier les chiffres et commandes |
| [ ] | `docs/engineering/DEVNET-ULTIMATE-SKILL.md` | Protocole général | RÉFÉRENCE | Aucune modification produit |
| [ ] | `docs/engineering/DEVNET-VALIDATION-MATRIX.md` | Matrice de validation | À METTRE À JOUR | Ajouter les preuves de cette passe |
| [ ] | `docs/engineering/TRUST-SAFETY-EXECUTION-LOG.md` | Journal Trust & Safety | À METTRE À JOUR | Vérifier la date et le déploiement |
| [ ] | `docs/engineering/TRUST-SAFETY-STATUS.md` | État Trust & Safety | À VÉRIFIER | Confronter les 81 entrées et le déploiement |
| [ ] | `docs/extensibility/events.md` | Événements | À AUDITER | Vérifier les chemins et plugins |
| [ ] | `docs/extensibility/inventory.md` | Inventaire plugins | À AUDITER | Vérifier le statut réel |
| [ ] | `docs/extensibility/plugin-sdk.md` | SDK plugins | À AUDITER | Vérifier les API exposées |
| [ ] | `docs/ops/backups.md` | Sauvegardes | À AUDITER | Vérifier Neon, GPG et R2 |
| [ ] | `docs/ops/db-capabilities.md` | Capacités PostgreSQL | À AUDITER | Revalider les mesures |
| [ ] | `docs/ops/exit-plan.md` | Plan de sortie | À AUDITER | Vérifier le fournisseur actuel |
| [ ] | `docs/ops/failover.md` | Bascule et secours | CORRIGÉ | Vérifier le reste du document |
| [ ] | `docs/ops/incidents.md` | Incidents | À AUDITER | Vérifier les procédures Systalink/Neon |
| [ ] | `docs/ops/runbook.md` | Runbook d'exploitation | À AUDITER | Vérifier les commandes |
| [ ] | `docs/ops/ticket-systalink-roles.md` | Ticket fournisseur | HISTORIQUE | Vérifier s'il est encore actionnable |
| [ ] | `docs/ui/audit/icones.md` | Audit icônes | À AUDITER | Vérifier les constats |
| [ ] | `docs/ui/code-runner.md` | Exécution de code | À AUDITER | Vérifier les limites de sécurité |
| [ ] | `docs/ui-contracts/admin-console.md` | Contrat console admin | À AUDITER | Vérifier les routes |
| [ ] | `docs/ui/coverage.md` | Couverture UI | À AUDITER | Revalider les chiffres |
| [ ] | `docs/ui/defects.md` | Registre de défauts | À AUDITER | Réconcilier avec les statuts UI |
| [ ] | `docs/ui/design-log.md` | Journal UI | HISTORIQUE | Vérifier les statuts courants |
| [ ] | `docs/ui/experience-standard.md` | Norme d'expérience | RÉFÉRENCE | Aucune modification produit |
| [ ] | `docs/ui/inventory.md` | Inventaire UI | À AUDITER | Vérifier les routes |
| [ ] | `docs/ui/motion.md` | Mouvement | À AUDITER | Vérifier les budgets |
| [ ] | `docs/ui/scale.md` | Échelle | À AUDITER | Vérifier les tailles |
| [ ] | `docs/ui/ratchet.json` | Cliquet UI | À VÉRIFIER | `ux:check` mesure 489 valeurs arbitraires, plafond 493 |
| [ ] | `docs/uiux/BASELINE.md` | Base UI/UX | À AUDITER | Vérifier les mesures |
| [ ] | `docs/uiux/DESIGN-SYSTEM.md` | Design system | À AUDITER | Vérifier les composants |
| [ ] | `docs/uiux/ISSUES.md` | Défauts UI/UX | À AUDITER | Réconcilier avec le registre |
| [ ] | `.github/pull_request_template.md` | Modèle de PR | HORS PÉRIMÈTRE | Aucune action produit |
| [ ] | `logo/README.md` | Ressources logo | HORS PÉRIMÈTRE | Aucune action produit |
| [ ] | `.perch/PERCH.md` | Outil local | HORS PÉRIMÈTRE | Aucune action produit |
| [ ] | `plugins/hello-devnet/README.md` | Plugin d'exemple | HORS PÉRIMÈTRE | Aucune action produit |
| [x] | `docs/maintenance/DEVNET-DOCS-INVENTORY.md` | Cet inventaire | À JOUR | Mettre à jour à chaque fichier audité |
| [x] | `docs/maintenance/DEVNET-CONTENT-AUDIT.md` | Audit du contenu visible | À JOUR | Poursuivre les routes non auditées |
| [x] | `docs/maintenance/DEVNET-DOCS-CHANGELOG.md` | Journal documentaire | À JOUR | Ajouter chaque lot |
| [x] | `docs/maintenance/DEVNET-DOCS-CHECKPOINT.md` | Point de reprise documentaire | À JOUR | Mettre à jour avant pause |
