"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { commitVault, VAULT_STORAGE } from "@/lib/vault-storage";
import { db } from "@/lib/db";
import {
  createVault,
  encryptVault,
  unlockVault,
  validateEnvelope,
  type VaultEnvelope,
  type VaultEntry,
} from "@/lib/vault";
import "@/app/operations/operations.css";
const STORAGE = VAULT_STORAGE;
export default function Vault() {
  const [envelope, setEnvelope] = useState<VaultEnvelope | null>(null),
    [entries, setEntries] = useState<VaultEntry[]>([]),
    [password, setPassword] = useState(""),
    [title, setTitle] = useState(""),
    [value, setValue] = useState(""),
    [opened, setOpened] = useState(false),
    [ready, setReady] = useState(false),
    [storageError, setStorageError] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const key = useRef<CryptoKey | null>(null),
    version = useRef(0),
    timeout = useRef<ReturnType<typeof setTimeout>>();
  const lock = useCallback(() => {
    version.current++;
    key.current = null;
    setEntries([]);
    setPassword("");
    setTitle("");
    setValue("");
    setOpened(false);
  }, []);
  const activity = useCallback(() => {
    clearTimeout(timeout.current);
    if (key.current) timeout.current = setTimeout(lock, 60000);
  }, [lock]);
  useEffect(() => {
    let alive = true;
    void db.kv
      .get(STORAGE)
      .then((row) => {
        if (alive) {
          if (row?.value) setEnvelope(validateEnvelope(row.value));
          setReady(true);
        }
      })
      .catch(() => {
        if (alive) {
          setStorageError(true); setReady(true);
          setNotice("Vault storage is unavailable or corrupt. Nothing was opened or overwritten. Reload to retry; do not clear browser data without a backup.");
        }
      });
    const hidden = () => {
      if (document.hidden) lock();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      alive = false;
      clearTimeout(timeout.current);
      document.removeEventListener("visibilitychange", hidden);
      version.current++;
      key.current = null;
    };
  }, [lock]);
  async function unlock() {
    if (busy) return;
    setBusy(true);
    setNotice("");
    const generation = version.current;
    try {
      const result = envelope
        ? await unlockVault(envelope, password)
        : { ...(await createVault(password)), entries: [] };
      if (generation !== version.current) return;
      if (!envelope) await commitVault(null, result.envelope, () => generation === version.current);
      else if (JSON.stringify((await db.kv.get(STORAGE))?.value) !== JSON.stringify(envelope)) throw new Error("Vault changed in another tab. Reload before unlocking.");
      if (generation !== version.current) return;
      key.current = result.key;
      setEntries(result.entries);
      setEnvelope(result.envelope);
      setOpened(true);
      setPassword("");
      activity();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Vault could not be opened.");
    } finally {
      setBusy(false);
    }
  }
  async function save(next: VaultEntry[]) {
    if (!key.current || !envelope || busy) return;
    setBusy(true);
    setNotice("");
    const generation = version.current;
    try {
      const sealed = await encryptVault(next, key.current, envelope.salt);
      if (generation !== version.current) return;
      await commitVault(envelope, sealed, () => generation === version.current);
      if (generation !== version.current) return;
      setEnvelope(sealed);
      setEntries(next);
      setTitle("");
      setValue("");
      setNotice("Encrypted change saved locally. Nothing was uploaded.");
      activity();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Encrypted save failed.");
    } finally {
      setBusy(false);
    }
  }
  function backup() {
    if (!envelope) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(envelope)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "onebrain-encrypted-vault.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="operations" onPointerDown={activity} onKeyDown={activity}>
      <div className="ops-card">
        <p>
          This vault does not protect an unlocked page from a compromised
          device, malicious browser extension, or same-origin script compromise.
          It is not an audited password manager. Do not dictate secrets:
          verified-local-only speech entry is not supported.
        </p>
        <p>
          Locks when hidden or after 60 seconds without interaction. There is no
          password recovery. Export an encrypted backup before clearing browser
          data.
        </p>
      </div>
      {notice && (
        <p className="ops-notice" role="status">
          {notice}
        </p>
      )}
      {storageError ? (
        <button className="ops-primary" onClick={() => location.reload()}>Reload vault storage</button>
      ) : !ready ? (
        <p role="status">Opening encrypted storage…</p>
      ) : !opened ? (
        <section className="ops-card ops-auth">
          <h2>{envelope ? "Unlock your vault" : "Create a local vault"}</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void unlock();
            }}
          >
            <label>
              Master password
              <input
                type="password"
                minLength={12}
                maxLength={1024}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
                required
              />
            </label>
            <button className="ops-primary" disabled={busy}>
              {busy
                ? "Deriving encryption key…"
                : envelope
                  ? "Unlock vault"
                  : "Create encrypted vault"}
            </button>
          </form>
          {envelope && (
            <button onClick={backup}>Export encrypted backup</button>
          )}
          <label>
            Restore encrypted backup
            <input
              type="file"
              accept="application/json"
              disabled={busy}
              onChange={async (e) => {
                const input = e.currentTarget;
                const file = input.files?.[0];
                if (!file || busy) return;
                const generation = version.current;
                if (file.size > 500000) {
                  setNotice("Backup is too large.");
                  return;
                }
                setBusy(true);
                try {
                  const imported = validateEnvelope(
                    JSON.parse(await file.text()),
                  );
                  await unlockVault(imported, password);
                  if (generation !== version.current) return;
                  if (
                    !confirm(
                      "Replace this device’s encrypted vault with the verified backup? Export the existing vault first.",
                    )
                  )
                    return;
                  await commitVault(envelope, imported, () => generation === version.current);
                  if (generation !== version.current) return;
                  setEnvelope(imported);
                  setPassword("");
                  setNotice("Encrypted backup restored. Unlock to view it.");
                } catch (error) {
                  setNotice(
                    error instanceof Error ? error.message : "Restore failed.",
                  );
                } finally {
                  setBusy(false);
                  input.value = "";
                }
              }}
            />
          </label>
          <p>
            Enter the backup’s master password before selecting its file.
            Restoring replaces the current vault only after successful
            decryption and confirmation.
          </p>
        </section>
      ) : (
        <>
          <section className="ops-card">
            <h2>Add a private entry</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save([
                  ...entries,
                  {
                    id: crypto.randomUUID(),
                    title,
                    value,
                    updatedAt: Date.now(),
                  },
                ]);
              }}
            >
              <label>
                Entry title
                <input
                  maxLength={120}
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label>
                Private value
                <textarea
                  rows={4}
                  maxLength={3000}
                  required
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <button
                className="ops-primary"
                disabled={busy || entries.length >= 100}
              >
                Encrypt & save entry
              </button>
            </form>
          </section>
          {entries.map((entry) => (
            <section className="ops-card" key={entry.id}>
              <h3>{entry.title}</h3>
              <details>
                <summary>Reveal private value</summary>
                <pre>{entry.value}</pre>
              </details>
              <button
                className="ops-danger"
                disabled={busy}
                onClick={() => {
                  if (confirm("Delete this encrypted entry?"))
                    void save(entries.filter((e) => e.id !== entry.id));
                }}
              >
                Delete entry
              </button>
            </section>
          ))}
          <div className="ops-actions">
            <button onClick={backup}>Export encrypted backup</button>
            <button onClick={lock}>Lock vault</button>
            <button
              className="ops-danger"
              disabled={busy}
              onClick={async () => {
                if (
                  confirm(
                    "Permanently delete this encrypted vault? Export a backup first.",
                  )
                ) {
                  setBusy(true);
                  const generation = version.current;
                  try {
                    await commitVault(envelope, null, () => generation === version.current);
                    if (generation !== version.current) return;
                    lock();
                    setEnvelope(null);
                    setNotice("Local encrypted vault deleted.");
                  } catch (error) {
                    setNotice(error instanceof Error ? error.message : "Encrypted vault could not be deleted; nothing is claimed deleted.");
                  } finally {
                    setBusy(false);
                  }
                }
              }}
            >
              Delete vault
            </button>
          </div>
        </>
      )}
    </div>
  );
}
