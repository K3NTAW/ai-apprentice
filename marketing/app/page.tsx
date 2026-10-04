import Landing from "@/components/landing/Landing";
import { appUrl } from "@/lib/site";

export default function Home() {
  return <Landing appUrl={appUrl()} />;
}
