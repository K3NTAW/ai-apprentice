// Animated agent avatar. The SVG comes from renderAvatarSvg (no scripts, no external refs) and is shown only via <img src>.
import { normalizeAvatar, renderAvatarSvg, toDataUrl, type AvatarState } from "@/lib/avatar/render";

export default function AgentAvatar({
  avatar,
  state = "idle",
  size = 96,
  className = "",
}: {
  avatar: unknown;
  state?: AvatarState;
  size?: number;
  className?: string;
}) {
  const src = toDataUrl(renderAvatarSvg(normalizeAvatar(avatar), state, size));
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={size} height={size} className={className} />;
}
