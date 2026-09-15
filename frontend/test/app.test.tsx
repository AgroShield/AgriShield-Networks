import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '../src/App';
import { ApiError } from '../src/api/client';
import {
  ScriptedClient,
  callsTo,
  sampleHealth,
  sampleKeeper,
  sampleList,
  samplePolicy,
  samplePreview,
  sampleSettlement,
} from './helpers/api';

/**
 * The console, rendered against a scripted client.
 *
 * Results are configured before the render rather than after, because the first
 * request is made as soon as the component mounts; setting one afterwards would
 * race the effect that reads it.
 */
function renderApp(configure: (client: ScriptedClient) => void = () => {}): ScriptedClient {
  const client = new ScriptedClient();
  configure(client);
  render(<App client={client} />);
  return client;
}

function searchByFarmer(value = 'GBZX'): void {
  fireEvent.change(screen.getByLabelText('Farmer account'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
}

describe('the health panel', () => {
  it("reports the API's own condition, not merely that it answered", async () => {
    renderApp((client) => {
      client.healthResult = sampleHealth({
        status: 'degraded',
        ledger: 99,
        reason: 'the engine on chain is wired to different contracts than this API is configured with',
      });
    });

    expect(await screen.findByText('degraded')).toBeDefined();
    expect(screen.getByText('testnet')).toBeDefined();
    expect(screen.getByText('ledger 99')).toBeDefined();
    expect(screen.getByText(/wired to different contracts/)).toBeDefined();
  });

  it('shows the reason the API could not be reached at all', async () => {
    renderApp((client) => {
      client.healthResult = new ApiError({
        status: 0,
        code: 'network_unreachable',
        message: 'the API could not be reached at /api',
      });
    });

    expect(await screen.findByText('The API did not answer')).toBeDefined();
    expect(screen.getByText('the API could not be reached at /api')).toBeDefined();
  });
});

describe('looking policies up', () => {
  it('does not query until a search is submitted', async () => {
    const client = renderApp();

    expect(await screen.findByText('Search for a farmer or a region')).toBeDefined();
    fireEvent.change(screen.getByLabelText('Farmer account'), { target: { value: 'GBZX' } });

    // Half-typed identifiers are not requests: the API would answer a 400 for
    // each keystroke, and a scan of the whole book for an empty field.
    expect(callsTo(client, 'listPolicies')).toBe(0);
    expect(screen.getByText('No search yet')).toBeDefined();
  });

  it('queries with the filter and the hydration limit once submitted', async () => {
    const client = renderApp();

    searchByFarmer();

    expect(await screen.findByText('Showing the newest 1 of 1 policy')).toBeDefined();
    expect(client.queries).toEqual([{ farmer: 'GBZX', limit: 20 }]);
  });

  it('says how much of the match it is showing, and offers the rest', async () => {
    const client = renderApp((c) => {
      c.listResult = sampleList([samplePolicy({ id: '9' })], 2);
    });

    searchByFarmer();
    expect(await screen.findByText('Showing the newest 1 of 2 policies')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Hydrate 1 more' }));

    expect(client.queries[1]).toEqual({ farmer: 'GBZX', limit: 40 });
  });

  it('reports a failed lookup with the code the API gave it', async () => {
    renderApp((client) => {
      client.listResult = new ApiError({
        status: 400,
        code: 'invalid_farmer',
        message: 'farmer must be a Stellar account id (a G... strkey)',
      });
    });

    searchByFarmer('not-an-account');

    expect(await screen.findByText('Could not read the policy list')).toBeDefined();
    expect(
      screen.getByText('invalid_farmer: farmer must be a Stellar account id (a G... strkey)'),
    ).toBeDefined();
  });

  it('says so when a filter matches nothing', async () => {
    renderApp((client) => {
      client.listResult = sampleList([], 0);
    });

    searchByFarmer();

    expect(await screen.findByText('No policies matched')).toBeDefined();
  });
});

describe('one policy', () => {
  it('shows its terms and what settlement would do', async () => {
    const client = renderApp((c) => {
      c.previewResult = samplePreview({
        status: 'Paid',
        indexValue: '120',
        readingTimestamp: '1700000000',
        payoutAmount: '4000',
      });
    });

    searchByFarmer();
    fireEvent.click(await screen.findByRole('button', { name: /#7/ }));

    expect(await screen.findByText('Policy #7')).toBeDefined();
    expect(client.policyIds).toContain('7');
    expect(await screen.findByText(/breached the threshold inside the cover window/)).toBeDefined();
    expect(screen.getByText('120 at 2023-11-14 22:13:20Z')).toBeDefined();
    // A payout of 4000 base units is 0.0004 in the token's whole units.
    expect(screen.getByText('Would pay').parentElement?.textContent).toContain('0.0004');
  });

  it('describes a policy that is not due yet without promising a payout', async () => {
    renderApp((client) => {
      client.previewResult = samplePreview({ status: 'Pending' });
    });

    searchByFarmer();
    fireEvent.click(await screen.findByRole('button', { name: /#7/ }));

    expect(await screen.findByText('No payout is due yet.')).toBeDefined();
  });

  it('submits a settlement and reports what the chain did', async () => {
    const client = renderApp((c) => {
      c.settleResult = sampleSettlement();
    });

    searchByFarmer();
    fireEvent.click(await screen.findByRole('button', { name: /#7/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Submit settlement' }));

    expect(await screen.findByText('Settlement Paid')).toBeDefined();
    expect(client.settledIds).toEqual(['7']);
    expect(screen.getByText(/Paid 0.0004\. Transaction hash-7, in ledger 51\./)).toBeDefined();
    // The keeper's totals have changed too, so the panel is not left stale.
    expect(callsTo(client, 'keeperStatus')).toBe(2);
  });

  it('shows the reason a settlement was refused', async () => {
    renderApp((client) => {
      client.settleResult = new ApiError({
        status: 409,
        code: 'coverage_still_open',
        message: 'the coverage window has not closed yet',
      });
    });

    searchByFarmer();
    fireEvent.click(await screen.findByRole('button', { name: /#7/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Submit settlement' }));

    expect(await screen.findByText('Settlement was refused')).toBeDefined();
    expect(
      screen.getByText('coverage_still_open: the coverage window has not closed yet'),
    ).toBeDefined();
  });

  it('refuses to submit on a read-only deployment, and says why', async () => {
    renderApp((client) => {
      client.healthResult = sampleHealth({ keeper: { enabled: false } });
    });

    searchByFarmer();
    fireEvent.click(await screen.findByRole('button', { name: /#7/ }));

    expect(await screen.findByText('Read-only deployment')).toBeDefined();
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Submit settlement' });
    expect(submit.disabled).toBe(true);
  });

  it("does not carry one policy's settlement over to the next", async () => {
    const client = renderApp((c) => {
      c.listResult = sampleList([samplePolicy({ id: '7' }), samplePolicy({ id: '8' })]);
      c.policiesById.set('8', samplePolicy({ id: '8' }));
    });

    searchByFarmer();
    fireEvent.click(await screen.findByRole('button', { name: /#7/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Submit settlement' }));
    expect(await screen.findByText('Settlement Paid')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /#8/ }));

    expect(await screen.findByText('Policy #8')).toBeDefined();
    expect(screen.queryByText('Settlement Paid')).toBeNull();
    expect(client.settledIds).toEqual(['7']);
  });
});

describe('the keeper panel', () => {
  it('separates what it has ever done from what the last sweep did', async () => {
    renderApp((client) => {
      client.keeperResult = sampleKeeper({
        running: true,
        cursor: '4',
        lastSweep: {
          startedAt: 1_700_000_000_000,
          finishedAt: 1_700_000_000_500,
          considered: 3,
          settled: 1,
          expired: 1,
          failed: 0,
          entries: [
            {
              policyId: '1',
              action: 'skipped',
              status: null,
              transactionHash: null,
              reason: null,
            },
          ],
        },
      });
    });

    expect(await screen.findByText('sweeping')).toBeDefined();
    expect(screen.getByText('next sweep starts at #4')).toBeDefined();

    const examined = screen.getByText('Policies examined').parentElement;
    if (examined === null) throw new Error('the field wrapper is missing');
    expect(within(examined).getByText('5')).toBeDefined();
    expect(screen.getByText(/examined 3/)).toBeDefined();

    const entry = screen.getByText('#1').closest('li');
    if (entry === null) throw new Error('the sweep entry is missing');
    expect(within(entry).getByText('skipped')).toBeDefined();
  });

  it('explains a deployment that sweeps nothing at all', async () => {
    renderApp((client) => {
      client.keeperResult = sampleKeeper({ enabled: false, running: false, lastSweep: null });
    });

    expect(await screen.findByText('This deployment is read-only')).toBeDefined();
  });
});
