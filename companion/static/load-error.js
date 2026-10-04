// Main window load error page: main passes the title and reason in the query; the buttons go back to main.
const params = new URLSearchParams(location.search);
const title = params.get("title");
const reason = params.get("reason");
if (title) document.getElementById("title").textContent = title;
document.getElementById("reason").textContent = reason || "";

for (const button of document.querySelectorAll("button[data-action]")) {
  button.addEventListener("click", () => {
    if (window.apprenticeLoadError) window.apprenticeLoadError.act(button.dataset.action);
  });
}
