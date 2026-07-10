import { getPolicy } from './policy-registry'
import type {
  ClassificationArtifact,
  EvidenceMatrixArtifact,
  FixQueueArtifact,
  StarPomVerdictArtifact,
} from './schema'

export function buildStarPomVerdict(
  classification: ClassificationArtifact,
  evidenceMatrix: EvidenceMatrixArtifact,
  fixQueue: FixQueueArtifact,
): StarPomVerdictArtifact {
  const blockedClaims = evidenceMatrix.rows
    .filter((row) => row.blocking && row.verdict === 'blocked')
    .map((row) => row.id)

  const processFailures = blockedClaims.map((blockId) => getPolicy(blockId).processFailure)
  const requiredRepairs = blockedClaims.map((blockId) => getPolicy(blockId).repair)

  if (blockedClaims.length > 0) {
    return {
      verdict: 'blocked',
      blockedClaims,
      processFailures: [...new Set(processFailures)],
      requiredRepairs: [...new Set(requiredRepairs)],
      acceptedRisks: [],
      finalClaimAllowed: false,
      productClosureAllowed: false,
      specPackageClosureStatus: 'blocked',
      productClosureStatus: 'blocked',
    }
  }

  const finalClaimAllowed = !classification.finalClaimGateRequired || evidenceMatrix.finalVerdict === 'pass'

  return {
    verdict: finalClaimAllowed ? 'pass' : 'blocked',
    blockedClaims: finalClaimAllowed ? [] : ['missing_final_claim_evidence'],
    processFailures: finalClaimAllowed ? [] : ['final claim gate required but evidence is not complete'],
    requiredRepairs: finalClaimAllowed ? [] : ['attach final claim evidence or remove readiness claim'],
    acceptedRisks: [],
    finalClaimAllowed,
    productClosureAllowed: false,
    specPackageClosureStatus: 'ready_for_owner_review_planning_only',
    productClosureStatus: 'not_evaluated',
  }
}

export function starpomExitCode(verdict: StarPomVerdictArtifact): number {
  return verdict.verdict === 'blocked' || verdict.verdict === 'fail' ? 2 : 0
}
