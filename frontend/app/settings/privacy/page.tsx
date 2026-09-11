export default function Privacy() {
  return (
    <section className="py-8 space-y-5 max-w-2xl">
      <h1 className="text-3xl">Privacy & control</h1>
      <p>
        Listening starts only after you enable a microphone session. Stop ends
        that session. Browser speech recognition may send audio to the browser
        vendor; on-device recognition is not guaranteed.
      </p>
      <p>
        General AI questions can send transcripts and relevant context to
        configured providers, including Puter or the app backend. OneBrain does
        not intentionally retain raw audio in this workspace. Do not dictate
        passwords or other secrets.
      </p>
      <p>
        Structured workspace records and receipts are stored in IndexedDB on
        this browser, scoped by the current local account identifier. This is
        not encryption or protection against someone who controls the device.
        Legacy conversations and reminders need a separate account-isolation
        audit; do not use this build for shared-device confidential data.
      </p>
      <p>
        Proactive conversation is off by default. You can enable
        permission-first invitations, separately allow history topics, configure
        quiet hours, and turn it off at any time. No answer is not consent.
        Preference answers are not silently added to a personality profile.
      </p>
      <p>
        Memory off makes new workspace changes session-only. Existing saved data
        remains until deleted. Retention is controlled in Settings; a 90-day
        retention period is not automatically imposed.
      </p>
      <p>
        Workspace export and deletion are available in the workspace settings.
        Full local export/deletion is available below. Local deletion does not
        delete copies already sent to providers or an optional backend.
      </p>
      <a href="/settings/data-export" className="primary-button">
        Export & delete local data
      </a>
    </section>
  );
}
