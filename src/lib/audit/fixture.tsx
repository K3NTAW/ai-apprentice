// Self-test fixture for the interaction guard: controls without an action must be caught, the rest must pass.
export default function AuditFixture() {
  return (
    <div>
      <button type="button">Dead button</button>
      <a>Dead link</a>
      <div role="button">Dead role button</div>
      <button type="button" disabled>
        Disabled without reason
      </button>
      <button type="button" onClick={() => {}}>
        Live button
      </button>
      <a href="https://example.com">Live link</a>
      <button type="button" disabled title="Needs a workspace first">
        Disabled with reason
      </button>
    </div>
  );
}
