import { useState, type ReactElement } from 'react';

import type { ApiClient, PolicyQuery } from './api/client';
import { HealthPanel } from './components/HealthPanel';
import { KeeperPanel } from './components/KeeperPanel';
import { Notice } from './components/Notice';
import { PolicyDetail } from './components/PolicyDetail';
import { PolicyList } from './components/PolicyList';
import { SearchForm, type SearchValues } from './components/SearchForm';
import { useAsync } from './useAsync';

/** How many policies a search hydrates before anyone asks for more. */
const PAGE = 20;
/** The API's own ceiling for `?limit=`. */
const MAX_LIMIT = 100;

/**
 * The console.
 *
 * State is four things: the search that was submitted, the policy selected, and
 * the two panels that describe the deployment rather than a query. Everything
 * else is derived from those, which is why there is no store — the interesting
 * state here is what the operator asked for, not what has been fetched.
 *
 * A submitted search is held rather than the form's live value, so typing does
 * not re-query and a slow response cannot race a faster one for a different term.
 */
export function App({ client }: { readonly client: ApiClient }): ReactElement {
  const [search, setSearch] = useState<SearchValues | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const health = useAsync(() => client.health(), []);
  const keeper = useAsync(() => client.keeperStatus(), []);
  const list = useAsync(
    search === null ? null : () => client.listPolicies(toQuery(search)),
    [search],
  );
  const policy = useAsync(
    selectedId === null ? null : () => client.getPolicy(selectedId),
    [selectedId],
  );
  const preview = useAsync(
    selectedId === null ? null : () => client.settlementPreview(selectedId),
    [selectedId],
  );

  // Whether a settlement can be submitted at all is a property of the backend's
  // configuration, which `/health` reports. Until it answers, the button stays
  // enabled and the API's own 503 is what explains the refusal.
  const canSubmit = health.state.status === 'ready' ? health.state.data.keeper.enabled : null;

  const listed = list.state.status === 'ready' ? list.state.data : null;
  const canShowMore =
    listed !== null && listed.policies.length < listed.total && (search?.limit ?? 0) < MAX_LIMIT;

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1 className="app__title">AgriShield console</h1>
          <p className="muted">
            Parametric drought cover on Stellar, read through the backend API.
          </p>
        </div>
        <HealthPanel state={health.state} onRefresh={health.reload} />
      </header>

      <main className="app__main">
        <section className="panel" aria-label="Policy lookup">
          <header className="panel__header">
            <h2 className="panel__title">Policies</h2>
          </header>
          <SearchForm
            onSearch={(values) => {
              setSearch(values);
              // A different book of policies makes the previous selection
              // meaningless, and leaving it would show one policy beside a list
              // that no longer contains it.
              setSelectedId(null);
            }}
            busy={list.state.status === 'loading'}
            initialLimit={PAGE}
          />
          <PolicyList
            state={list.state}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onRefresh={list.reload}
            canShowMore={canShowMore}
            onShowMore={() => {
              if (search === null) return;
              setSearch({ ...search, limit: Math.min(MAX_LIMIT, search.limit + PAGE) });
            }}
          />
        </section>

        <section className="panel" aria-label="Policy detail">
          <header className="panel__header">
            <h2 className="panel__title">Policy</h2>
          </header>
          {selectedId === null ? (
            <Notice
              kind="empty"
              title="No policy selected"
              detail="Choose one from the list to see its terms and what settlement would do."
            />
          ) : (
            // Keyed on the policy, so a submission's outcome belongs to the
            // policy it was made for rather than following the selection.
            <PolicyDetail
              key={selectedId}
              client={client}
              policyState={policy.state}
              previewState={preview.state}
              canSubmit={canSubmit}
              onRefreshPolicy={policy.reload}
              onRefreshPreview={preview.reload}
              onSettled={() => {
                policy.reload();
                preview.reload();
                keeper.reload();
              }}
            />
          )}
        </section>
      </main>

      <KeeperPanel state={keeper.state} onRefresh={keeper.reload} />
    </div>
  );
}

function toQuery(search: SearchValues): PolicyQuery {
  return search.mode === 'farmer'
    ? { farmer: search.value, limit: search.limit }
    : { region: search.value, limit: search.limit };
}
