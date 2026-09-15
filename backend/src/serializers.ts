/**
 * Response shapes for the HTTP API.
 *
 * On-chain integers are `u64`/`i128`: they do not fit a JavaScript number and
 * `JSON.stringify` refuses to serialise a `bigint` at all. Every one of them is
 * therefore exposed as a decimal string — exact, unambiguous about precision,
 * and parseable by any client. Wall-clock timestamps the backend produces itself
 * stay numbers, because they are not chain data and never need more range than a
 * double.
 */

import type {
  SettlementOutcome,
  TriggerEvaluation,
  Policy,
  PolicyStatus,
} from './contracts/types.js';
import type { SweepReport } from './keeper/keeper.js';

export interface PolicyResponse {
  id: string;
  farmer: string;
  /** `sha256` of the plot geometry, hex encoded. */
  plotHash: string;
  cropType: string;
  regionId: string;
  coverageStart: string;
  coverageEnd: string;
  triggerThreshold: string;
  payoutAmount: string;
  premium: string;
  status: PolicyStatus;
  createdAt: string;
  settledAt: string;
}

export interface EvaluationResponse {
  policyId: string;
  /** What a settlement submitted now would return. */
  status: string;
  indexValue: string;
  readingTimestamp: string;
  /** What would be paid; `0` unless the status is `Paid`. */
  payoutAmount: string;
}

export interface SettlementOutcomeResponse {
  policyId: string;
  status: string;
  indexValue: string;
  readingTimestamp: string;
  paidAmount: string;
}

export interface SweepEntryResponse {
  policyId: string;
  action: string;
  status: string | null;
  transactionHash: string | null;
  reason: string | null;
}

export interface SweepReportResponse {
  startedAt: number;
  finishedAt: number;
  considered: number;
  settled: number;
  expired: number;
  failed: number;
  entries: SweepEntryResponse[];
}

export function serializePolicy(policy: Policy): PolicyResponse {
  return {
    id: policy.id.toString(),
    farmer: policy.farmer,
    plotHash: policy.plotHash,
    cropType: policy.cropType,
    regionId: policy.regionId,
    coverageStart: policy.coverageStart.toString(),
    coverageEnd: policy.coverageEnd.toString(),
    triggerThreshold: policy.triggerThreshold.toString(),
    payoutAmount: policy.payoutAmount.toString(),
    premium: policy.premium.toString(),
    status: policy.status,
    createdAt: policy.createdAt.toString(),
    settledAt: policy.settledAt.toString(),
  };
}

export function serializeEvaluation(evaluation: TriggerEvaluation): EvaluationResponse {
  return {
    policyId: evaluation.policyId.toString(),
    status: evaluation.status,
    indexValue: evaluation.indexValue.toString(),
    readingTimestamp: evaluation.readingTimestamp.toString(),
    payoutAmount: evaluation.payoutAmount.toString(),
  };
}

export function serializeOutcome(outcome: SettlementOutcome): SettlementOutcomeResponse {
  return {
    policyId: outcome.policyId.toString(),
    status: outcome.status,
    indexValue: outcome.indexValue.toString(),
    readingTimestamp: outcome.readingTimestamp.toString(),
    paidAmount: outcome.paidAmount.toString(),
  };
}

export function serializeSweep(report: SweepReport): SweepReportResponse {
  return {
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    considered: report.considered,
    settled: report.settled,
    expired: report.expired,
    failed: report.failed,
    entries: report.entries.map((item) => ({
      policyId: item.policyId.toString(),
      action: item.action,
      status: item.status ?? null,
      transactionHash: item.transactionHash ?? null,
      reason: item.reason ?? null,
    })),
  };
}
