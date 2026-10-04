// View model for the avatar studio: the picked avatar plus the animation being previewed.
import {
  type Avatar,
  type AvatarFace,
  type AvatarShape,
  type AvatarState,
  isHexColor,
  normalizeAvatar,
  randomAvatar,
  renderAvatarSvg,
} from "@/lib/avatar/render";

export type StudioModel = { avatar: Avatar; state: AvatarState };

export type StudioAction =
  | { type: "shape"; shape: AvatarShape }
  | { type: "face"; face: AvatarFace }
  | { type: "color"; color: string }
  | { type: "accent"; accent: string }
  | { type: "play"; state: AvatarState }
  | { type: "randomize"; rand?: () => number }
  | { type: "reset"; avatar: Avatar };

export function initStudio(avatar?: unknown): StudioModel {
  return { avatar: normalizeAvatar(avatar), state: "idle" };
}

export function studioReducer(model: StudioModel, action: StudioAction): StudioModel {
  switch (action.type) {
    case "shape":
      return { ...model, avatar: normalizeAvatar({ ...model.avatar, shape: action.shape }) };
    case "face":
      return { ...model, avatar: normalizeAvatar({ ...model.avatar, face: action.face }) };
    case "color":
      return isHexColor(action.color) ? { ...model, avatar: { ...model.avatar, color: action.color.toUpperCase() } } : model;
    case "accent":
      return isHexColor(action.accent) ? { ...model, avatar: { ...model.avatar, accent: action.accent.toUpperCase() } } : model;
    case "play":
      return { ...model, state: action.state };
    case "randomize":
      return { ...model, avatar: randomAvatar(action.rand) };
    case "reset":
      return { ...model, avatar: normalizeAvatar(action.avatar) };
  }
}

export function previewSvg(model: StudioModel, size = 256): string {
  return renderAvatarSvg(model.avatar, model.state, size);
}
