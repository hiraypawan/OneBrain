"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GoogleSignIn } from "@/components/GoogleSignIn";
import { useAssistantStore } from "@/store/assistant";
import {
  ACTION_EXAMPLES,
  platformApi as api,
  type Space,
  type SharedRecord,
  type Connection,
  type Job,
} from "@/lib/platform";
import "@/app/operations/operations.css";
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([pretty(value)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const KINDS = [
  "note",
  "task",
  "idea",
  "person",
  "company",
  "project",
  "decision",
  "expense",
  "payment",
  "shopping",
  "habit",
  "mood",
  "document",
  "invoice",
];
export default function Operations() {
  const [caps, setCaps] = useState<any>(null),
    [user, setUser] = useState<any>(null),
    [checking, setChecking] = useState(true),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [spaces, setSpaces] = useState<Space[]>([]),
    [space, setSpace] = useState(""),
    [spaceName, setSpaceName] = useState(""),
    [tab, setTab] = useState("records");
  const [loadingSection, setLoadingSection] = useState(false);
  const [nextRecords, setNextRecords] = useState<string | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const currentTab = useRef(tab); currentTab.current = tab;
  const [editorRecords,setEditorRecords] = useState<SharedRecord[]>([]);
  const [records, setRecords] = useState<SharedRecord[]>([]),
    [connections, setConnections] = useState<Connection[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [receipts, setReceipts] = useState<any[]>([]),
    [members, setMembers] = useState<any[]>([]),
    [inbox, setInbox] = useState<any[]>([]),
    [audit, setAudit] = useState<any[]>([]);
  const [query, setQuery] = useState(""),
    [inviteEmail, setInviteEmail] = useState(""),
    [inviteRole, setInviteRole] = useState("viewer"),
    [invite, setInvite] = useState("");
  const [editor, setEditor] = useState<SharedRecord | null>(null),
    [newRecord, setNewRecord] = useState(false),
    [review, setReview] = useState<Job | null>(null),
    [jobEditor, setJobEditor] = useState<Job | null>(null),
    [newJob, setNewJob] = useState(false);
  const [provider, setProvider] = useState("telegram"),
    [connectionName, setConnectionName] = useState(""),
    [token, setToken] = useState(""),
    [endpoint, setEndpoint] = useState("");
  const currentSpace = useRef(space);
  currentSpace.current = space;
  const [importPreview, setImportPreview] = useState<{
    id: string;
    records: any[];
  } | null>(null);
  const epoch = useRef(0),
    activeSpace = spaces.find((s) => s.id === space),
    admin = activeSpace?.role === "owner" || activeSpace?.role === "admin",
    writer = !!activeSpace && activeSpace.role !== "viewer";
  const refresh = useCallback(async (target: string) => {
    if (currentSpace.current !== target) return;
    const generation = ++epoch.current;
    const section = currentTab.current;
    setLoadingSection(true);
    try {
      const route = section === 'actions' ? 'jobs' : section === 'team' ? 'members' : section;
      const data = await api(`/spaces/${target}/${route}${section === 'records' ? '?pageSize=100' : ''}`);
      if (generation !== epoch.current || currentSpace.current !== target) return;
      if (section === 'records') { setRecords(data.records); setNextRecords(data.nextCursor); }
      if (section === 'actions') { setJobs(data.jobs); setReceipts(data.receipts); }
      if (section === 'connections') {
        setConnections(data.connections);
        const capabilities = await api('/capabilities');
        if (generation === epoch.current) setCaps(capabilities);
      }
      if (section === 'team') setMembers(data.members);
      if (section === 'inbox') setInbox(data.notifications);
      if (section === 'audit') setAudit(data.audit);
    } finally { if (generation === epoch.current) setLoadingSection(false); }

  }, []);
  async function loadSpaces() {
    const data = await api("/spaces");
    setSpaces(data.spaces);
    setSpace((old) =>
      data.spaces.some((s: Space) => s.id === old)
        ? old
        : data.spaces[0]?.id || "",
    );
  }
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const authRevision=useAssistantStore.getState().authRevision;
        const me = await api("/bootstrap");
        if (alive && authRevision===useAssistantStore.getState().authRevision) {
          setUser(me.user);
          useAssistantStore.getState().loginBackend(me.user);
          setSpaces(me.spaces); setSpace(me.spaces[0]?.id || "");
        }
      } catch (e) {
        if (alive && !(e instanceof Error && /Sign in|Session/.test(e.message)))
          setNotice(e instanceof Error ? e.message : "Server unavailable.");
      } finally {
        if (alive) setChecking(false);
      }
    })();
    return () => {
      alive = false;
      epoch.current++;
    };
  }, []);
  useEffect(() => {
    epoch.current++;
    setImportPreview(null);
    setToken("");
    setEndpoint("");
    setConnectionName("");
    setRecords([]); setEditorRecords([]); setNextRecords(null);
    setJobs([]);
    setConnections([]);
    setMembers([]);
    setInbox([]);
    setAudit([]);
    setReview(null);
    setEditor(null);
    setNewRecord(false);
    setNewJob(false);
    setJobEditor(null);
  }, [space]);
  useEffect(() => {
    if (space) void refresh(space).catch((e) => setNotice(e.message));
  }, [space, tab, refresh]);
  useEffect(() => {
    let alive=true;
    setEditorReady(false);
    if (!(newRecord || editor || newJob || jobEditor) || !space) return;
    void (async () => {
      try {
        const memberData=await api(`/spaces/${space}/members`);
        if (!alive) return;
        setMembers(memberData.members);
        // Editors need the complete bounded relationship catalog, not just the
        // visible page. Load it only on explicit edit, never on workspace open.
        const rows=await api(`/spaces/${space}/records`);
        if (!alive) return;
        setEditorRecords(rows.records);
        if (newJob || jobEditor) {
          const [capabilities,connected]=await Promise.all([api('/capabilities'),api(`/spaces/${space}/connections`)]);
          if (!alive) return;
          setCaps(capabilities); setConnections(connected.connections);
        }
        if (alive) setEditorReady(true);
      } catch(e) { if(alive)setNotice(e instanceof Error?e.message:'Editor options could not be loaded.'); }
    })();
    return () => {alive=false;};
  }, [newRecord,editor,newJob,jobEditor,space]);
  async function perform(work: () => Promise<void>, message?: string) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await work();
      if (message) setNotice(message);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Not completed.");
    } finally {
      setBusy(false);
    }
  }
  const base = `/spaces/${space}`;
  return (
    <div className="operations">
      <p className="panel-explainer">
        Share records with your team, connect apps, and review actions before
        they run. Signing in never uploads your local notes automatically.
      </p>
      {notice && (
        <div className="ops-notice" role="status">
          {notice}
          <button
            aria-label="Dismiss operations notice"
            onClick={() => setNotice("")}
          >
            ×
          </button>
        </div>
      )}
      {checking ? (
        <p role="status">Checking server workspace…</p>
      ) : !user ? (
        <GoogleSignIn />
      ) : (
        <>
          <section className="ops-workspaces">
            <label>
              Workspace
              <select
                aria-label="Server workspace"
                disabled={busy}
                value={space}
                onChange={(e) => setSpace(e.target.value)}
              >
                <option value="">Choose a workspace</option>
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.role}
                  </option>
                ))}
              </select>
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void perform(async () => {
                  const made = await api("/spaces", "POST", {
                    name: spaceName,
                  });
                  setSpaceName("");
                  await loadSpaces();
                  setSpace(made.id);
                }, "Workspace created. It is private until you invite someone.");
              }}
            >
              <label>
                New workspace
                <input
                  required
                  maxLength={100}
                  value={spaceName}
                  onChange={(e) => setSpaceName(e.target.value)}
                  placeholder="Studio, household, personal…"
                />
              </label>
              <button disabled={busy} type="submit">
                Create workspace
              </button>
            </form>
          </section>
          <details className="ops-card">
            <summary>Accept a workspace invitation</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void perform(async () => {
                  const result = await api("/invites/accept", "POST", {
                    token: invite,
                  });
                  setInvite("");
                  await loadSpaces();
                  setSpace(result.spaceId);
                }, "Invitation accepted.");
              }}
            >
              <label>
                Single-use invitation code
                <input
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                  required
                  autoComplete="off"
                />
              </label>
              <button disabled={busy}>Join workspace</button>
            </form>
          </details>
          {space && (
            <>
              <div className="ops-actions">
                {writer && (
                  <button
                    onClick={() => {
                      localStorage.setItem(
                        "onebrain-shared-voice",
                        JSON.stringify({ spaceId: space, userId: user.id }),
                      );
                      setNotice(
                        "Workspace selected for explicit “shared task:” and “server reminder:” voice commands. Each upload still requires “save shared”. No local records were uploaded.",
                      );
                    }}
                  >
                    Use for explicit shared voice drafts
                  </button>
                )}
              </div>
              <div className="ops-toolbar">
                <nav aria-label="Operations sections">
                  {[
                    "records",
                    "actions",
                    "connections",
                    "team",
                    "inbox",
                    "audit",
                  ]
                    .filter((t) => t !== "audit" || admin)
                    .map((t) => (
                      <button
                        key={t}
                        aria-current={tab === t ? "page" : undefined}
                        onClick={() => {
                          setTab(t);

                        }}
                      >
                        {t === "actions"
                          ? "Actions & schedules"
                          : t[0].toUpperCase() + t.slice(1)}
                        {t === "inbox" && <small>{inbox.length}</small>}
                      </button>
                    ))}
                </nav>
                <button
                  disabled={busy}
                  onClick={() =>
                    perform(() => refresh(space), "Workspace refreshed.")
                  }
                >
                  Refresh
                </button>
              </div>
              {loadingSection && <p role="status">Loading this section…</p>}
              {tab === "records" && (
                <section>
                  <div className="ops-section-heading">
                    <div>
                      <span className="eyebrow">
                        SHARED, NOT SILENTLY SYNCED
                      </span>
                      <h2>{activeSpace?.name}</h2>
                    </div>
                    {writer && (
                      <button
                        className="ops-primary"
                        disabled={busy}
                        onClick={() => setNewRecord(true)}
                      >
                        New record
                      </button>
                    )}
                  </div>
                  <input
                    className="ops-search"
                    aria-label="Search shared records"
                    placeholder="Find a client, project, decision…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <div className="ops-record-grid">
                    {records
                      .filter((r) =>
                        `${r.title} ${r.kind} ${r.data.body} ${(r.data.aliases || []).join(" ")}`
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                      )
                      .map((r) => (
                        <button
                          className="ops-record"
                          key={r.id}
                          onClick={() => setEditor(r)}
                        >
                          <span className="eyebrow">
                            {r.kind} · {r.data.status}
                          </span>
                          <h3>{r.title}</h3>
                          <p>{r.data.body || "Open the context"}</p>
                          <small>
                            {r.data.assignee
                              ? members.find(
                                  (m) => m.user_id === r.data.assignee,
                                )?.display_name || "Assigned member"
                              : "Unassigned"}{" "}
                            · revision {r.revision}
                          </small>
                        </button>
                      ))}
                  </div>
                  {!loadingSection && !records.length && (
                    <div className="ops-empty">
                      <h3>A shared space, a clean start.</h3>
                      <p>
                        Create a project, assign a task, or save a decision.
                        Local canvas records stay local unless you explicitly
                        import them.
                      </p>
                    </div>
                  )}
                  {nextRecords && <div className="ops-card">
                    <p>Showing {records.length} recent records. Search and totals below cover loaded records only. Editing loads the complete relationship catalog.</p>
                    <button disabled={busy || loadingSection} onClick={() => perform(async () => {
                      const target=space, generation=epoch.current;
                      const page=await api(`${base}/records?pageSize=100&cursor=${encodeURIComponent(nextRecords)}`);
                      if (currentSpace.current!==target || generation!==epoch.current) return;
                      setRecords(old=>[...new Map([...old,...page.records].map(r=>[r.id,r])).values()]); setNextRecords(page.nextCursor);
                    })}>Load more records</button>
                  </div>}
                  <FinanceSummary records={records} />
                  {writer && (
                    <label>
                      Review a workspace JSON import · up to 100 records
                      <input
                        type="file"
                        accept="application/json"
                        disabled={busy}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          try {
                            if (file.size > 750000)
                              throw new Error("Import exceeds 750 KB.");
                            const data = JSON.parse(await file.text());
                            const rows = data.records || data.items;
                            if (
                              !Array.isArray(rows) ||
                              !rows.length ||
                              rows.length > 100
                            )
                              throw new Error(
                                "Choose an export with 1–100 records. Split larger exports into complete linked groups.",
                              );
                            setImportPreview({
                              id: crypto.randomUUID(),
                              records: rows,
                            });
                          } catch (error) {
                            setNotice(
                              error instanceof Error
                                ? error.message
                                : "Invalid import.",
                            );
                          } finally {
                            e.target.value = "";
                          }
                        }}
                      />
                    </label>
                  )}
                  <div className="ops-actions">
                    <button
                      onClick={() =>
                        perform(async () =>
                          download(
                            "onebrain-shared-export.json",
                            await api(base + "/export"),
                          ),
                        )
                      }
                    >
                      Export workspace
                    </button>
                  </div>
                </section>
              )}
              {tab === "actions" && (
                <section>
                  <div className="ops-section-heading">
                    <div>
                      <span className="eyebrow">
                        DRAFT → REVIEW → APPROVE → EVIDENCE
                      </span>
                      <h2>Actions with accountability.</h2>
                    </div>
                    <div className="ops-actions">
                      {writer && (
                        <button
                          className="ops-primary"
                          disabled={busy}
                          onClick={() => setNewJob(true)}
                        >
                          Draft action
                        </button>
                      )}
                      {admin && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            perform(async () => {
                              const result = await api(
                                base + "/run-due",
                                "POST",
                                {},
                              );
                              await refresh(space);
                              setNotice(
                                `Processed ${result.handled} due job(s). Inspect receipts below; queued is not completed.`,
                              );
                            })
                          }
                        >
                          Run due jobs
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="ops-muted">
                    Server cron processes approved schedules when deployed. “Run
                    due jobs” also works locally. An in-app notification is not
                    a background phone alert. API acknowledgement does not prove
                    recipient delivery.
                  </p>
                  {jobs.map((j) => (
                    <article className="ops-card ops-job" key={j.id}>
                      <div>
                        <span className={`ops-status status-${j.status}`}>
                          {j.status}
                        </span>
                        <h3>{j.plan.name}</h3>
                        <p>
                          {j.action} · {j.runs}/{j.plan.maxRuns} occurrences ·{" "}
                          {new Date(j.next_run).toLocaleString()}
                        </p>
                        {j.last_error && (
                          <p className="ops-error">{j.last_error}</p>
                        )}
                        <details>
                          <summary>Exact payload & schedule</summary>
                          <pre>
                            {pretty({
                              payload: j.payload,
                              plan: j.plan,
                              connection: j.connection_id,
                              revision: j.revision,
                              hash: j.plan_hash,
                            })}
                          </pre>
                        </details>
                        {receipts
                          .filter((r) => r.job_id === j.id)
                          .map((r) => (
                            <div className="ops-receipt" key={r.id}>
                              <strong>
                                {r.status} · {new Date(r.at).toLocaleString()}
                              </strong>
                              <p>
                                Destination:{" "}
                                {r.destination_id || "No confirmed destination"}
                              </p>
                              <pre>{pretty(r.evidence)}</pre>
                            </div>
                          ))}
                      </div>
                      <div className="ops-actions">
                        {admin && j.status === "draft" && (
                          <button
                            className="ops-primary"
                            onClick={() => setReview(j)}
                          >
                            Review & approve
                          </button>
                        )}
                        {writer &&
                          j.runs === 0 &&
                          ["draft", "queued", "paused"].includes(j.status) && (
                            <button onClick={() => setJobEditor(j)}>
                              Edit draft
                            </button>
                          )}
                        {admin &&
                          ["draft", "queued", "paused"].includes(j.status) && (
                            <>
                              {j.status !== "draft" && (
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    perform(async () => {
                                      await api(
                                        `${base}/jobs/${j.id}/control`,
                                        "POST",
                                        {
                                          action:
                                            j.status === "paused"
                                              ? "resume"
                                              : "pause",
                                        },
                                      );
                                      await refresh(space);
                                    })
                                  }
                                >
                                  {j.status === "paused" ? "Resume" : "Pause"}
                                </button>
                              )}
                              <button
                                disabled={busy}
                                onClick={() =>
                                  perform(async () => {
                                    await api(
                                      `${base}/jobs/${j.id}/control`,
                                      "POST",
                                      { action: "cancel" },
                                    );
                                    await refresh(space);
                                  })
                                }
                              >
                                Cancel job
                              </button>
                            </>
                          )}
                      </div>
                    </article>
                  ))}
                  {!jobs.length && (
                    <div className="ops-empty">
                      <h3>No hidden automation.</h3>
                      <p>
                        Draft a scheduled reminder or a connector action. An
                        owner/admin must review its exact payload and schedule
                        before it can run.
                      </p>
                    </div>
                  )}
                </section>
              )}
              {tab === "connections" && (
                <section>
                  <span className="eyebrow">
                    YOUR CREDENTIALS. NAMED PERMISSIONS.
                  </span>
                  <h2>Connect a destination.</h2>
                  <p className="ops-muted">
                    Tokens are encrypted on the server, not kept in browser
                    localStorage. Free providers have quotas; no paid overflow
                    is purchased. Third-party authorization and live validation
                    are still required.
                  </p>
                  <div className="ops-record-grid">
                    {connections.map((c) => (
                      <article className="ops-card" key={c.id}>
                        <span className="ops-status">{c.status}</span>
                        <h3>{c.name}</h3>
                        <p>{c.provider}</p>
                        <small>{c.config.verification}</small>
                        {admin && c.status !== "revoked" && (
                          <button
                            disabled={busy}
                            onClick={() => {
                              if (
                                confirm(
                                  "Erase this credential and cancel queued actions? Dispatched requests cannot be recalled.",
                                )
                              )
                                void perform(async () => {
                                  await api(
                                    base + "/connections/" + c.id,
                                    "DELETE",
                                    {},
                                  );
                                  await refresh(space);
                                }, "Credential erased. Revoke provider-side authorization separately if needed.");
                            }}
                          >
                            Disconnect
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                  {admin && (
                    <form
                      className="ops-card"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void perform(async () => {
                          const info = caps.providers[provider];
                          if (info.auth === "oauth") {
                            const data = await api(
                              base + "/oauth/google",
                              "POST",
                              { provider },
                            );
                            window.location.assign(data.url);
                            return;
                          }
                          await api(base + "/connections", "POST", {
                            provider,
                            name: connectionName,
                            credentials: { token, url: endpoint },
                          });
                          setToken("");
                          setEndpoint("");
                          setConnectionName("");
                          await refresh(space);
                        }, "Connection saved. No action has been executed.");
                      }}
                    >
                      <label>
                        Provider
                        <select
                          value={provider}
                          onChange={(e) => {
                            setProvider(e.target.value);
                            setToken("");
                            setEndpoint("");
                          }}
                        >
                          {Object.entries(caps?.providers || {}).map(
                            ([key, info]: any) => (
                              <option key={key} value={key}>
                                {info.label}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                      {caps?.providers?.[provider]?.auth === "oauth" ? (
                        <p>
                          Google consent uses state, PKCE and provider-specific
                          scopes. The operator must configure the OAuth client
                          first.
                        </p>
                      ) : (
                        <>
                          <label>
                            Connection name
                            <input
                              required
                              maxLength={100}
                              value={connectionName}
                              onChange={(e) =>
                                setConnectionName(e.target.value)
                              }
                            />
                          </label>
                          <label>
                            {provider === "webhook"
                              ? "HMAC shared secret"
                              : "Provider access token"}
                            <input
                              type="password"
                              required
                              autoComplete="off"
                              value={token}
                              onChange={(e) => setToken(e.target.value)}
                            />
                          </label>
                          {["home-assistant", "webhook", "mcp"].includes(
                            provider,
                          ) && (
                            <label>
                              HTTPS endpoint · operator-allowlisted host
                              <input
                                type="url"
                                required
                                value={endpoint}
                                onChange={(e) => setEndpoint(e.target.value)}
                                placeholder="https://your-host.example/endpoint"
                              />
                            </label>
                          )}
                        </>
                      )}
                      <button className="ops-primary" disabled={busy}>
                        {caps?.providers?.[provider]?.auth === "oauth"
                          ? "Authorize with Google"
                          : "Verify & save connection"}
                      </button>
                    </form>
                  )}
                </section>
              )}
              {tab === "team" && (
                <section>
                  <span className="eyebrow">
                    EXPLICIT ACCESS, NEVER A SHARED PASSWORD
                  </span>
                  <h2>The people in this space.</h2>
                  {members.map((m) => (
                    <article className="ops-card ops-member" key={m.user_id}>
                      <div>
                        <h3>{m.display_name}</h3>
                        <p>{m.email}</p>
                        <small>{m.role}</small>
                      </div>
                      {activeSpace?.role === "owner" && m.role !== "owner" && (
                        <select
                          aria-label={`Role for ${m.email}`}
                          value={m.role}
                          disabled={busy}
                          onChange={(e) => {
                            const role = e.target.value;
                            if (
                              role === "remove" &&
                              !confirm("Remove this member’s workspace access?")
                            )
                              return;
                            void perform(async () => {
                              await api(base + "/members/" + m.user_id, "PUT", {
                                role,
                              });
                              await refresh(space);
                            });
                          }}
                        >
                          <option>admin</option>
                          <option>editor</option>
                          <option>viewer</option>
                          <option value="remove">Remove access</option>
                        </select>
                      )}
                    </article>
                  ))}
                  {admin && (
                    <form
                      className="ops-card"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void perform(async () => {
                          const result = await api(base + "/invites", "POST", {
                            email: inviteEmail,
                            role: inviteRole,
                          });
                          setNotice(`${result.delivery} Code: ${result.token}`);
                          setInviteEmail("");
                        });
                      }}
                    >
                      <h3>Invite a teammate</h3>
                      <label>
                        Teammate email
                        <input
                          type="email"
                          required
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                        />
                      </label>
                      <label>
                        Permission
                        <select
                          value={inviteRole}
                          onChange={(e) => setInviteRole(e.target.value)}
                        >
                          <option value="viewer">Viewer · read only</option>
                          <option value="editor">
                            Editor · records and action drafts
                          </option>
                          {activeSpace?.role === "owner" && (
                            <option value="admin">
                              Admin · connections and approvals
                            </option>
                          )}
                        </select>
                      </label>
                      <button disabled={busy}>
                        Create single-use invitation
                      </button>
                      <p>
                        No invitation email is sent. Share the generated code
                        securely. SSO and email verification are not configured.
                      </p>
                    </form>
                  )}
                  {activeSpace?.role === "owner" && (
                    <button
                      className="ops-danger"
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            "Permanently delete this entire server workspace, credentials, records and jobs? Export first.",
                          )
                        )
                          void perform(async () => {
                            await api(base, "DELETE", { confirm: space });
                            await loadSpaces();
                          }, "Server workspace deleted.");
                      }}
                    >
                      Delete server workspace
                    </button>
                  )}
                </section>
              )}
              {tab === "inbox" && (
                <section>
                  <span className="eyebrow">DURABLE IN-APP DELIVERY</span>
                  <h2>Your follow-ups.</h2>
                  <p className="ops-muted">
                    These are server-persisted reminders. They do not claim an
                    OS notification was delivered.
                  </p>
                  {inbox.map((n) => (
                    <article className="ops-card" key={n.id}>
                      <small>{new Date(n.created_at).toLocaleString()}</small>
                      <h3>{n.title}</h3>
                      <p>{n.body}</p>
                    </article>
                  ))}
                  {!inbox.length && <p>No delivered in-app reminders yet.</p>}
                </section>
              )}
              {tab === "audit" && admin && (
                <section>
                  <h2>Workspace audit.</h2>
                  <p className="ops-muted">
                    Server mutations and job outcomes, scoped to this workspace.
                    Credential values are never included.
                  </p>
                  {audit.map((a) => (
                    <article className="ops-card" key={a.id}>
                      <small>
                        {new Date(a.at).toLocaleString()} ·{" "}
                        {members.find((m) => m.user_id === a.actor_id)?.email ||
                          a.actor_id}
                      </small>
                      <h3>{a.operation}</h3>
                      <p>{a.subject_id}</p>
                      <pre>{a.detail}</pre>
                    </article>
                  ))}
                </section>
              )}
            </>
          )}
        </>
      )}
      {(newRecord || editor || newJob || jobEditor) && !editorReady && <p role="status">Loading editor options…</p>}
      {(newRecord || editor) && editorReady && (
        <RecordEditor
          key={editor?.id || "new"}
          record={editor}
          records={editorRecords}
          members={members}
          writable={writer}
          busy={busy}
          close={() => {
            setEditor(null);
            setNewRecord(false);
          }}
          save={(value) =>
            perform(async () => {
              await api(
                base + "/records" + (editor ? "/" + editor.id : ""),
                editor ? "PUT" : "POST",
                { ...value, ...(editor ? { revision: editor.revision } : {}) },
              );
              setEditor(null);
              setNewRecord(false);
              await refresh(space);
            }, "Shared record saved on the server.")
          }
          remove={() =>
            perform(async () => {
              if (editor) {
                await api(base + "/records/" + editor.id, "DELETE", {
                  revision: editor.revision,
                });
                setEditor(null);
                await refresh(space);
              }
            }, "Record deleted.")
          }
          notice={notice}
        />
      )}
      {(newJob || jobEditor) && editorReady && (
        <JobEditor
          key={jobEditor?.id || "new-job"}
          job={jobEditor}
          connections={connections}
          caps={caps}
          records={editorRecords}
          busy={busy}
          notice={notice}
          close={() => {
            setNewJob(false);
            setJobEditor(null);
          }}
          save={(value) =>
            perform(async () => {
              await api(
                base + "/jobs" + (jobEditor ? "/" + jobEditor.id : ""),
                jobEditor ? "PUT" : "POST",
                {
                  ...value,
                  ...(jobEditor ? { revision: jobEditor.revision } : {}),
                },
              );
              setNewJob(false);
              setJobEditor(null);
              await refresh(space);
              setTab("actions");
            }, "Draft saved. Nothing executes until an owner/admin approves the reviewed version.")
          }
        />
      )}
      {importPreview && (
        <Modal
          title="Review server import"
          close={() => setImportPreview(null)}
          notice={notice}
        >
          <p>
            These records will leave this device and be stored in the selected
            server workspace, visible to its members. No credentials or
            executable jobs are imported.
          </p>
          <p>
            Destination: <strong>{activeSpace?.name}</strong> ·{" "}
            {importPreview.records.length} records
          </p>
          <ul>
            {importPreview.records.map((r, i) => (
              <li key={i}>
                {r.kind}: {r.title}
              </li>
            ))}
          </ul>
          <button
            className="ops-primary"
            disabled={busy}
            onClick={() =>
              perform(async () => {
                await api(base + "/import", "POST", {
                  importId: importPreview.id,
                  records: importPreview.records,
                });
                setImportPreview(null);
                await refresh(space);
              }, "Import committed atomically. Original local records were not deleted.")
            }
          >
            Approve upload & import
          </button>
        </Modal>
      )}
      {review && (
        <Approval
          job={review}
          connection={connections.find((c) => c.id === review.connection_id)}
          busy={busy}
          notice={notice}
          close={() => setReview(null)}
          approve={() =>
            perform(async () => {
              await api(base + "/jobs/" + review.id + "/approve", "POST", {
                revision: review.revision,
                planHash: review.plan_hash,
                confirm: true,
              });
              setReview(null);
              await refresh(space);
            }, "Approved and queued. Execution is separate; inspect the resulting receipt.")
          }
        />
      )}
    </div>
  );
}
function Modal({
  title,
  close,
  children,
  notice,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  notice?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      queueMicrotask(() => {
        if (trigger?.isConnected && !document.querySelector("dialog[open]"))
          trigger.focus();
      });
    };
  }, []);
  return (
    <dialog ref={ref} className="ops-modal" aria-label={title} onCancel={close}>
      <div className="ops-section-heading">
        <h2>{title}</h2>
        <button aria-label="Close operations dialog" onClick={close}>
          ×
        </button>
      </div>
      {notice && (
        <p className="ops-notice" role="status">
          {notice}
        </p>
      )}
      {children}
    </dialog>
  );
}
function RecordEditor({
  record,
  records,
  members,
  writable,
  busy,
  close,
  save,
  remove,
  notice,
}: {
  record: SharedRecord | null;
  records: SharedRecord[];
  members: any[];
  writable: boolean;
  busy: boolean;
  close: () => void;
  save: (v: any) => void;
  remove: () => void;
  notice: string;
}) {
  const [kind, setKind] = useState(record?.kind || "task"),
    [title, setTitle] = useState(record?.title || ""),
    [body, setBody] = useState(record?.data.body || ""),
    [data, setData] = useState<any>(
      record
        ? Object.fromEntries(
            Object.entries(record.data).filter(([k]) =>
              ["status", "due", "assignee", "links", "dependencies"].includes(
                k,
              ),
            ),
          )
        : { status: "active", links: [], dependencies: [] },
    );
  const [relationshipQuery,setRelationshipQuery] = useState("");
  const [advanced, setAdvanced] = useState(
      pretty(
        Object.fromEntries(
          Object.entries(record?.data || {}).filter(
            ([k]) =>
              ![
                "body",
                "status",
                "due",
                "assignee",
                "links",
                "dependencies",
              ].includes(k),
          ),
        ),
      ),
    ),
    [error, setError] = useState("");
  return (
    <Modal
      title={record ? "Shared record context" : "New shared record"}
      close={close}
      notice={notice || error}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const extra = JSON.parse(advanced);
            save({ kind, title, data: { ...extra, ...data, body } });
          } catch {
            setError("Advanced fields must be a valid JSON object.");
          }
        }}
      >
        <fieldset disabled={!writable || busy}>
          <div className="ops-form-grid">
            <label>
              Record type
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                value={data.status}
                onChange={(e) => setData({ ...data, status: e.target.value })}
              >
                <option>active</option>
                <option>done</option>
                <option>cancelled</option>
              </select>
            </label>
          </div>
          <label>
            Title
            <input
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Notes / source / draft
            <textarea
              rows={5}
              maxLength={6000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <div className="ops-form-grid">
            <label>
              Due date
              <input
                type="datetime-local"
                value={
                  data.due
                    ? new Date(
                        Date.parse(data.due) -
                          new Date(data.due).getTimezoneOffset() * 60000,
                      )
                        .toISOString()
                        .slice(0, 16)
                    : ""
                }
                onChange={(e) =>
                  setData({
                    ...data,
                    due: e.target.value
                      ? new Date(e.target.value).toISOString()
                      : null,
                  })
                }
              />
            </label>
            <label>
              Assigned to
              <select
                value={data.assignee || ""}
                onChange={(e) =>
                  setData({ ...data, assignee: e.target.value || null })
                }
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name} · {m.role}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {records.length>50 && <label>Find records to link
            <input value={relationshipQuery} onChange={e=>setRelationshipQuery(e.target.value)} placeholder="Search the complete catalog" />
            <small>First 50 matches plus selected records. Search to find older records.</small>
          </label>}
          {["links", "dependencies"].map((field) => (
            <fieldset className="ops-check-list" key={field}>
              <legend>
                {field === "links"
                  ? "Explicit relationships"
                  : "Must be completed first"}
              </legend>
              {[...new Map([
                ...records.filter(r=>r.id!==record?.id && r.title.toLowerCase().includes(relationshipQuery.toLowerCase())).slice(0,50),
                ...records.filter(r=>(data[field]||[]).includes(r.id)),
              ].map(r=>[r.id,r])).values()].map((r) => (
                  <label key={r.id}>
                    <input
                      type="checkbox"
                      checked={(data[field] || []).includes(r.id)}
                      onChange={(e) =>
                        setData({
                          ...data,
                          [field]: e.target.checked
                            ? [...(data[field] || []), r.id]
                            : (data[field] || []).filter(
                                (x: string) => x !== r.id,
                              ),
                        })
                      }
                    />
                    {r.title}
                  </label>
                ))}
            </fieldset>
          ))}
          <details>
            <summary>Budget, milestones, aliases & financial fields</summary>
            <p className="ops-muted">
              Supported keys: amount, currency, paid, budget, category,
              milestones (title/done), aliases, invoiceNumber, counterparty,
              frequency, energy and mood (1–5). Values are validated on the
              server.
            </p>
            <textarea
              aria-label="Additional record fields"
              rows={6}
              value={advanced}
              onChange={(e) => setAdvanced(e.target.value)}
              spellCheck={false}
            />
          </details>
          <button className="ops-primary" type="submit">
            Save shared record
          </button>
        </fieldset>
      </form>
      {record && writable && (
        <button
          className="ops-danger"
          disabled={busy}
          onClick={() => {
            if (
              confirm(
                "Delete this shared record? Unlink dependent records first.",
              )
            )
              remove();
          }}
        >
          Delete shared record
        </button>
      )}
    </Modal>
  );
}
function JobEditor({
  job,
  connections,
  caps,
  records,
  busy,
  notice,
  close,
  save,
}: {
  job: Job | null;
  connections: Connection[];
  caps: any;
  records: SharedRecord[];
  busy: boolean;
  notice: string;
  close: () => void;
  save: (v: any) => void;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [connectionId, setConnection] = useState(job?.connection_id || ""),
    [action, setAction] = useState(job?.action || "local.notify"),
    [payload, setPayload] = useState(
      pretty(job?.payload || ACTION_EXAMPLES["local.notify"]),
    ),
    [name, setName] = useState(job?.plan.name || ""),
    [when, setWhen] = useState(
      job
        ? new Date(
            job.plan.firstRun -
              new Date(job.plan.firstRun).getTimezoneOffset() * 60000,
          )
            .toISOString()
            .slice(0, 16)
        : "",
    ),
    [repeats, setRepeats] = useState(job?.plan.maxRuns || 1),
    [interval, setInterval] = useState(job?.plan.everyMinutes || 0),
    [condition, setCondition] = useState(job?.plan.whenRecordDone || ""),
    [error, setError] = useState("");
  const choices = connectionId
    ? caps.providers[connections.find((c) => c.id === connectionId)!.provider]
        .actions
    : ["local.notify"];
  return (
    <Modal title="Draft an action" close={close} notice={notice || error}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const parsed = JSON.parse(payload);
            save({
              requestId,
              connectionId: connectionId || null,
              action,
              payload: parsed,
              plan: {
                name: name || action,
                firstRun: when ? new Date(when).getTime() : Date.now(),
                maxRuns: repeats,
                everyMinutes: interval,
                whenRecordDone: condition || null,
              },
            });
          } catch {
            setError(
              "Enter valid JSON and a valid schedule. Nothing was saved.",
            );
          }
        }}
      >
        <label>
          Routine name
          <input
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Destination connection
          <select
            value={connectionId}
            onChange={(e) => {
              const value = e.target.value;
              setConnection(value);
              const next = value
                ? caps.providers[
                    connections.find((c) => c.id === value)!.provider
                  ].actions[0]
                : "local.notify";
              setAction(next);
              setPayload(pretty(ACTION_EXAMPLES[next]));
            }}
          >
            <option value="">Workspace inbox · no external provider</option>
            {connections
              .filter((c) => c.status === "connected")
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.provider}
                </option>
              ))}
          </select>
        </label>
        <label>
          Action
          <select
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPayload(pretty(ACTION_EXAMPLES[e.target.value]));
            }}
          >
            {choices.map((a: string) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label>
          Exact action fields · reviewed before execution
          <textarea
            rows={9}
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            spellCheck={false}
            required
          />
        </label>
        <div className="ops-form-grid">
          <label>
            First run · empty means when approved
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </label>
          <label>
            Occurrences · up to 30
            <input
              type="number"
              min={1}
              max={30}
              step={1}
              value={repeats}
              onChange={(e) => setRepeats(Number(e.target.value))}
            />
          </label>
          <label>
            Repeat every minutes · minimum 15
            <input
              type="number"
              min={0}
              max={525600}
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
            />
          </label>
          <label>
            Wait until this task is done
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
            >
              <option value="">No task condition</option>
              {records
                .filter((r) => r.kind === "task")
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <p className="ops-muted">
          Editing resets approval. Schedules are bounded to 90 days. Missed
          occurrences do not burst-send on recovery. Unknown delivery results
          are not automatically repeated.
        </p>
        <button className="ops-primary" disabled={busy}>
          Save action draft
        </button>
      </form>
    </Modal>
  );
}
function Approval({
  job,
  connection,
  busy,
  notice,
  close,
  approve,
}: {
  job: Job;
  connection?: Connection;
  busy: boolean;
  notice: string;
  close: () => void;
  approve: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <Modal title="Approve this exact action" close={close} notice={notice}>
      <span className="eyebrow">THIS CAN CHANGE AN EXTERNAL DESTINATION</span>
      <h3>{job.plan.name}</h3>
      <p>
        {job.action} → {connection?.name || "Workspace inbox"}
      </p>
      <pre>{pretty(job.payload)}</pre>
      <p>
        First run: {new Date(job.plan.firstRun).toLocaleString()}
        <br />
        {job.plan.maxRuns} occurrence(s)
        {job.plan.maxRuns > 1
          ? ` · every ${job.plan.everyMinutes} minutes`
          : ""}
      </p>
      {job.plan.whenRecordDone && (
        <p>Condition record: {job.plan.whenRecordDone}</p>
      )}
      <small>Revision {job.revision} · approval fingerprint</small>
      <code className="ops-hash">{job.plan_hash}</code>
      <label className="ops-consent">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        I reviewed the destination, exact fields, schedule and repetition. I
        authorize this action.
      </label>
      <button
        className="ops-primary"
        disabled={!confirmed || busy}
        onClick={approve}
      >
        Approve & queue
      </button>
      <p className="ops-muted">
        Queued is not completed. An API acknowledgement is not proof of message
        delivery. Already dispatched requests cannot be recalled.
      </p>
    </Modal>
  );
}
function FinanceSummary({ records }: { records: SharedRecord[] }) {
  const totals: Record<
    string,
    { expenses: number; payments: number; outstanding: number }
  > = Object.create(null);
  for (const r of records) {
    const d = r.data;
    if (!d.currency || !["expense", "payment", "invoice"].includes(r.kind))
      continue;
    const t = (totals[d.currency] ||= {
      expenses: 0,
      payments: 0,
      outstanding: 0,
    });
    if (r.kind === "expense") t.expenses += Math.round((d.amount || 0) * 100);
    if (r.kind === "payment") t.payments += Math.round((d.amount || 0) * 100);
    if (r.kind === "invoice")
      t.outstanding += Math.max(
        0,
        Math.round((d.amount || 0) * 100) - Math.round((d.paid || 0) * 100),
      );
  }
  return Object.keys(totals).length ? (
    <section className="ops-card">
      <h3>Recorded financial summary</h3>
      {Object.entries(totals).map(([currency, t]) => (
        <p key={currency}>
          {currency} · expenses {(t.expenses / 100).toFixed(2)} · payments{" "}
          {(t.payments / 100).toFixed(2)} · unpaid invoice amounts{" "}
          {(t.outstanding / 100).toFixed(2)}
        </p>
      ))}
      <small>
        From saved entries only. Not a bank balance or a tax calculation.
      </small>
    </section>
  ) : null;
}
