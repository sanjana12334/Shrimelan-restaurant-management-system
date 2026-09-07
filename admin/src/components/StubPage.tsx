/**
 * Shared "page not finished yet" placeholder so the admin app stays
 * buildable while pages are implemented one at a time. Every real page
 * (Dashboard, Orders, Payments, Tables, Menu, Staff, AuditLogs) should
 * replace its usage of this with real content — see REMAINING_WORK.md.
 */
export function StubPage({ title, note }: { title: string; note?: string }) {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          <p>Not implemented yet.</p>
        </div>
      </div>
      <div className="card empty-state">{note ?? "This page is scaffolded but not yet built. See REMAINING_WORK.md."}</div>
    </div>
  );
}
