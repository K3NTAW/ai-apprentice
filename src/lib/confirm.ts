// Destructive actions ask first (T-0166). The confirm is injectable for tests.
export const REMOVE_MEMBER_CONFIRM = "Remove this member from the workspace? They lose access right away.";
export const REVOKE_INVITE_CONFIRM = "Revoke this invite? The link in the email stops working.";

export async function confirmThen<T>(message: string, action: () => Promise<T>, ask: (m: string) => boolean = (m) => window.confirm(m)): Promise<T | null> {
  return ask(message) ? action() : null;
}
