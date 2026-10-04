// @ts-expect-error plain ESM seed module without types
import { teardown } from "./seed.mjs";

export default function globalTeardown() {
  teardown();
}
