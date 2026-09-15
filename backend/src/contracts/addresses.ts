/**
 * The four contract addresses this backend talks to.
 *
 * A type on its own, with no dependencies, because both the configuration
 * loader and the contract clients need to name it and neither should have to
 * import the other.
 */

export interface ContractAddresses {
  /** Source of policy terms. */
  readonly registry: string;
  /** The contract that decides and drives settlements. */
  readonly engine: string;
  /** Holder of the capital payouts come from. */
  readonly pool: string;
  /** Source of finalized weather-index readings. */
  readonly oracle: string;
}
