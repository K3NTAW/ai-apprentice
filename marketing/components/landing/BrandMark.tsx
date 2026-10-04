// The AI Apprentice mark from Main.dc.html and Login.dc.html: a 28 px accent tile with two dots.
export default function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="9" fill="var(--ac)" />
      <circle cx="11" cy="14" r="5" fill="white" />
      <circle cx="19.5" cy="17" r="3" fill="white" opacity=".7" />
    </svg>
  );
}
