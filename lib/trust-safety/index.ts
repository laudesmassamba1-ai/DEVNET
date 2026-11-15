/**
 * Façade Trust & Safety.
 *
 * `core` garde les gestes utilisateur et administrateur déjà éprouvés
 * (blocage, sourdine, sanctions, recours). `policy`, `engine` et `cases`
 * ajoutent ce qui manquait : une politique versionnée, cinq moteurs et des
 * dossiers humains. Les réexports sont explicites pour que la surface
 * publique reste lisible.
 */
export {
  TrustSafetyError,
  effectiveRole,
  myProtection,
  getSafetySettings,
  mySafetySettings,
  setSafetySettings,
  blockUser,
  unblockUser,
  muteUser,
  unmuteUser,
  submitAppeal,
  listSanctions,
  issueSanction,
  liftSanction,
  listAppeals,
  reviewAppeal,
  setModerationRole,
  type ModerationRole,
  type SanctionKind,
  type SanctionRow,
  type AppealRow,
  type RelationRow,
  type SafetyAudience,
  type SafetySettings,
  type MyAppeal,
  type MyProtection,
} from "./core";

export {
  DEFAULT_POLICY,
  decide,
  normalizePolicy,
  type Policy,
  type PolicyCategoryRule,
  type PolicyContext,
  type PolicyDecision,
  type PolicyResult,
  type TrustCategory,
  type TrustEngine,
  type TrustFinding,
  type TrustSeverity,
} from "./policy";

export {
  activePolicy,
  analyzeMedia,
  analyzeText,
  analyzeWrittenText,
  blockedDomains,
  inspectBehavior,
  inspectText,
  invalidatePolicyCache,
  type TextAnalysis,
} from "./engine";

export { purgeExpiredTrustSafety } from "./retention";
export { hidesSensitiveMedia, isSensitiveMedia } from "./media-visibility";

export {
  addBlockedDomain,
  listBlockedDomains,
  removeBlockedDomain,
  type BlockedDomain,
} from "./domains";

export {
  TrustSafetyConflict,
  addFinding,
  assignCase,
  attachDecision,
  decideCase,
  getCase,
  listCases,
  noteCase,
  openCase,
  readOverview,
  recordEngineRun,
  type CaseDetail,
  type CaseEvent,
  type CaseFinding,
  type CasePriority,
  type CaseStatus,
  type ModerationCase,
  type TrustOverview,
} from "./cases";
