(function () {
    "use strict";

    var theme;
    try {
        theme = localStorage.getItem("uscale-theme");
    } catch (_) {
        // Storage can be unavailable in strict privacy modes.
    }

    if (theme !== "light" && theme !== "dark") {
        theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
            ? "light"
            : "dark";
    }

    document.documentElement.setAttribute("data-theme", theme);
    if (theme === "light") {
        var themeColor = document.querySelector('meta[name="theme-color"]');
        if (themeColor) themeColor.setAttribute("content", "#f3f6fe");
    }
})();
