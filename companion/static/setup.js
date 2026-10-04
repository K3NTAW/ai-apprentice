// First-run setup screen: the URL is validated (https) and stored by main, which then loads it.
const MESSAGES = {
  app_url_missing: "Paste a URL first.",
  app_url_invalid: "That is not a valid URL.",
  app_url_scheme: "The URL must start with https://.",
  app_url_userinfo: "The URL must not contain a user name or password.",
  app_url_host: "The URL host is not valid.",
  app_url_too_long: "The URL is too long.",
};

const form = document.getElementById("form");
const input = document.getElementById("url");
const error = document.getElementById("error");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  error.textContent = "";
  if (!window.apprenticeSetup) {
    error.textContent = "Setup is not available in this window.";
    return;
  }
  const result = await window.apprenticeSetup.save(input.value);
  if (!result || !result.ok) error.textContent = MESSAGES[result && result.reason] || "The URL could not be saved.";
});
