import DesktopDownloads from "@/components/desktop/DesktopDownloads";
import AppShell from "@/components/shell/AppShell";

export const metadata = { title: "Get the desktop app · AI Apprentice" };

export default function DownloadPage() {
  return (
    <AppShell>
      <DesktopDownloads />
    </AppShell>
  );
}
