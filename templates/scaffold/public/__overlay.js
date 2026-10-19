/**
 * Visual-edit overlay, injected into every generated app's dev preview.
 *
 * It lives inside the preview frame, so it can read the DOM directly. When the
 * builder enables picking, it highlights the hovered element and posts the
 * clicked element (selector + text + markup) back to the parent window.
 *
 * Protocol
 *   parent -> frame : { type: "builder:overlay", enabled: boolean }
 *   frame  -> parent: { type: "builder:ready" }
 *                     { type: "builder:pick", selector, text, html, tag, rect }
 */
(function () {
  if (window.__builderOverlay) return;
  window.__builderOverlay = true;

  var enabled = false;
  var hovered = null;

  var box = document.createElement("div");
  box.setAttribute("data-builder-overlay", "box");
  box.style.cssText = [
    "position:fixed",
    "z-index:2147483647",
    "pointer-events:none",
    "display:none",
    "border:2px solid #0a84ff",
    "background:rgba(10,132,255,0.14)",
    "border-radius:4px",
    "transition:all 90ms cubic-bezier(0.25,0.46,0.45,0.94)",
  ].join(";");

  var label = document.createElement("div");
  label.setAttribute("data-builder-overlay", "label");
  label.style.cssText = [
    "position:fixed",
    "z-index:2147483647",
    "pointer-events:none",
    "display:none",
    "font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace",
    "background:#0a84ff",
    "color:#fff",
    "padding:2px 6px",
    "border-radius:4px",
    "white-space:nowrap",
    "max-width:60vw",
    "overflow:hidden",
    "text-overflow:ellipsis",
  ].join(";");

  function mount() {
    if (!document.body) return;
    document.body.appendChild(box);
    document.body.appendChild(label);
  }

  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return "";
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      var part = node.tagName.toLowerCase();
      if (node.id) {
        part += "#" + node.id;
        parts.unshift(part);
        break;
      }
      var cls = (node.getAttribute("class") || "")
        .split(/\s+/)
        .filter(function (c) {
          return c && !c.startsWith("builder-");
        })
        .slice(0, 2)
        .join(".");
      if (cls) part += "." + cls;
      var parent = node.parentElement;
      if (parent) {
        var sameTag = Array.prototype.filter.call(parent.children, function (c) {
          return c.tagName === node.tagName;
        });
        if (sameTag.length > 1) part += ":nth-of-type(" + (sameTag.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function draw(el) {
    if (!el || el === document.documentElement || el === document.body) {
      box.style.display = "none";
      label.style.display = "none";
      return;
    }
    var r = el.getBoundingClientRect();
    box.style.display = "block";
    box.style.left = r.left + "px";
    box.style.top = r.top + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";
    var text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 42);
    label.textContent = el.tagName.toLowerCase() + (text ? " · " + text : "");
    label.style.display = "block";
    label.style.left = r.left + "px";
    label.style.top = Math.max(0, r.top - 22) + "px";
  }

  function onMove(e) {
    if (!enabled) return;
    var el = e.target;
    if (el && el.getAttribute && el.getAttribute("data-builder-overlay")) return;
    hovered = el;
    draw(el);
  }

  function onClick(e) {
    if (!enabled) return;
    var el = e.target;
    if (!el || (el.getAttribute && el.getAttribute("data-builder-overlay"))) return;
    e.preventDefault();
    e.stopPropagation();
    var r = el.getBoundingClientRect();
    window.parent.postMessage(
      {
        type: "builder:pick",
        selector: selectorFor(el),
        text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120),
        html: el.outerHTML.slice(0, 600),
        tag: el.tagName.toLowerCase(),
        rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      },
      "*",
    );
    setEnabled(false);
  }

  function setEnabled(next) {
    enabled = !!next;
    document.documentElement.style.cursor = enabled ? "crosshair" : "";
    if (!enabled) {
      box.style.display = "none";
      label.style.display = "none";
    }
  }

  window.addEventListener("message", function (e) {
    var data = e.data;
    if (data && data.type === "builder:overlay") setEnabled(data.enabled);
  });

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && enabled) setEnabled(false);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      mount();
      window.parent.postMessage({ type: "builder:ready" }, "*");
    });
  } else {
    mount();
    window.parent.postMessage({ type: "builder:ready" }, "*");
  }
})();
