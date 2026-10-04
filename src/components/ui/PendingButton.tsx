"use client";

// Button for server work: disabled and aria-busy while its action runs in a transition, so a click answers at once.
import { useTransition, type ReactNode } from "react";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./index";

export default function PendingButton({
  onAction,
  children,
  pendingLabel,
  variant = "primary",
  size = "md",
  className,
  disabled,
}: {
  onAction: () => Promise<void> | void;
  children: ReactNode;
  pendingLabel?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className={buttonClass(variant, size, className)}
      disabled={disabled || pending}
      aria-busy={pending}
      onClick={() => startTransition(async () => onAction())}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
