// Shared layout for the app pages. Reads the request context on the server; the proxy handles sign-in redirects.
import { getRequestContext } from "@/lib/auth/context";
import ShellHeader, { type ShellUser } from "./ShellHeader";

export async function shellUser(): Promise<ShellUser | null> {
  const result = await getRequestContext();
  if (result.kind !== "ok") return null;
  const { ctx } = result;
  return { mode: ctx.mode, workspaceName: ctx.workspaceName, email: ctx.email, role: ctx.role };
}

export default async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await shellUser();
  return (
    <div className="flex min-h-screen flex-col">
      <ShellHeader user={user} />
      <div className="flex-1">{children}</div>
    </div>
  );
}
