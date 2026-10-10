/*
 * Bike GR Calendar Embed. Put in a Squarespace code block:
 *
 *   <script src="https://calendar.bikegr.org/embed.js" data-calendar="rides" async></script>
 *   <script src="https://calendar.bikegr.org/embed.js" data-calendar="advocacy"
 *           data-filters="tag=non-drop&day=tue" async></script>
 *
 * - data-calendar: rides | advocacy | all (default rides).
 * - data-filters: a filter query in the page URL format (tag, day, q, from, to).
 * - Filter values in the host page URL replace data-filters, so a shared link works. On the host
 *   URL the keys have the prefix "bgr-" (bgr-tag, bgr-day, bgr-q, bgr-from, bgr-to), so they never
 *   clash with the host page's own keys (Squarespace uses ?q= for its search). The script maps them
 *   to the short keys for the iframe. With one Embed on the page, filter changes inside the Embed
 *   are written back to the host URL with the prefix; other host keys are never read or changed.
 *
 * The iframe sends two messages (see src/embed/protocol.ts): its height, and its filter query. This
 * script accepts a message only from the iframe's own origin and window, and checks each value.
 */
(function () {
  "use strict";

  var RESIZE = "bikegr-calendar:resize";
  var LOCATION = "bikegr-calendar:location";
  var MAX_HEIGHT = 50000;
  var MAX_SEARCH = 2000;
  var KEYS = ["tag", "day", "q", "from", "to"];
  var HOST_PREFIX = "bgr-";
  var CALENDARS = ["rides", "advocacy", "all"];
  var MOUNTED = "data-bikegr-mounted";

  function isEmbedScript(script) {
    try {
      return /\/embed\.js$/.test(new URL(script.src, window.location.href).pathname);
    } catch {
      return false;
    }
  }

  /** This script, or (when Squarespace runs the code block again) each Embed script not mounted yet. */
  function scriptsToMount() {
    var current = document.currentScript;
    if (current && !current.hasAttribute(MOUNTED)) return [current];
    var all = document.querySelectorAll("script[src]");
    var list = [];
    for (var i = 0; i < all.length; i++) {
      if (!all[i].hasAttribute(MOUNTED) && isEmbedScript(all[i])) list.push(all[i]);
    }
    return list;
  }

  /** Only the filter keys, in a new URLSearchParams. */
  function filterParams(params) {
    var out = new URLSearchParams();
    KEYS.forEach(function (key) {
      params.getAll(key).forEach(function (value) {
        out.append(key, value);
      });
    });
    return out;
  }

  /** The host URL's bgr- keys as short keys (bgr-day=tue becomes day=tue), or null if it has none. */
  function hostFilters(params) {
    var out = new URLSearchParams();
    KEYS.forEach(function (key) {
      params.getAll(HOST_PREFIX + key).forEach(function (value) {
        out.append(key, value);
      });
    });
    return out.toString() ? out : null;
  }

  function writeHostUrl(search) {
    var url = new URL(window.location.href);
    KEYS.forEach(function (key) {
      url.searchParams.delete(HOST_PREFIX + key);
    });
    filterParams(new URLSearchParams(search)).forEach(function (value, key) {
      url.searchParams.append(HOST_PREFIX + key, value);
    });
    if (url.href !== window.location.href) {
      window.history.replaceState(window.history.state, "", url.href);
    }
  }

  function mount(script) {
    script.setAttribute(MOUNTED, "");
    var origin = new URL(script.src, window.location.href).origin;

    var calendar = script.getAttribute("data-calendar") || "rides";
    if (CALENDARS.indexOf(calendar) < 0) {
      console.warn('Bike GR Calendar: unknown data-calendar "' + calendar + '"; showing "rides".');
      calendar = "rides";
    }
    var hostParams = new URLSearchParams(window.location.search);
    var filters =
      hostFilters(hostParams) || filterParams(new URLSearchParams(script.getAttribute("data-filters") || ""));
    var query = filters.toString();

    var iframe = document.createElement("iframe");
    iframe.src = origin + "/embed/" + calendar + (query ? "?" + query : "");
    iframe.title = "Bike GR Calendar";
    iframe.setAttribute("data-bikegr-embed", "");
    iframe.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms",
    );
    iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    iframe.style.width = "100%";
    iframe.style.height = "600px";
    iframe.style.border = "0";
    iframe.style.display = "block";
    script.parentNode.insertBefore(iframe, script.nextSibling);

    var loads = 0;
    window.addEventListener("message", function (event) {
      if (event.origin !== origin || event.source !== iframe.contentWindow) return;
      var data = event.data;
      if (!data || typeof data !== "object") return;

      if (data.type === RESIZE) {
        var height = data.height;
        if (typeof height !== "number" || !isFinite(height) || height < 0 || height > MAX_HEIGHT) return;
        iframe.style.height = Math.ceil(height) + "px";
      } else if (data.type === LOCATION) {
        if (typeof data.search !== "string" || data.search.length > MAX_SEARCH) return;
        loads += 1;
        // The first load is the start state: the host URL stays as it is.
        if (loads === 1) return;
        // With more than one Embed on the page, the host URL cannot hold both: no sync.
        if (document.querySelectorAll("iframe[data-bikegr-embed]").length === 1) writeHostUrl(data.search);
        // The rider applied a filter low on a long list: show the top of the Embed.
        if (iframe.getBoundingClientRect().top < 0) iframe.scrollIntoView({ block: "start" });
      }
    });
  }

  scriptsToMount().forEach(mount);
})();
