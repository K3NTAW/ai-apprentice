// The only place a renderer assigns an avatar: an <img> src, after the same check as src/avatarUrl.mts.
// Never parsed as HTML. Loaded as a classic script before dock.js and overlay.js.
"use strict";
(function (root) {
  const RE = /^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}$/;
  const PREFIX = "data:image/svg+xml;base64,";
  const MAX = 100 * 1024;
  function isAvatarUrl(v) {
    return typeof v === "string" && v.length <= MAX && (v.length - PREFIX.length) % 4 === 0 && RE.test(v);
  }
  /** Set img.src to a valid avatar URL, or clear it. Returns true when set. */
  function setAvatarSrc(img, url) {
    if (!img) return false;
    if (!isAvatarUrl(url)) {
      img.removeAttribute("src");
      return false;
    }
    if (img.getAttribute("src") !== url) img.src = url;
    return true;
  }
  root.companionAvatar = Object.freeze({ isAvatarUrl, setAvatarSrc });
})(typeof window !== "undefined" ? window : globalThis);
