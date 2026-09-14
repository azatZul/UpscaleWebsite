(() => {
    "use strict";

    const productionApi = "https://auralens-406817559814.us-central1.run.app";
    const localHosts = new Set(["127.0.0.1", "localhost"]);
    const apiBase = localHosts.has(window.location.hostname)
        ? `${window.location.protocol}//${window.location.hostname}:8000`
        : productionApi;

    const loadingState = document.querySelector("#loading-state");
    const resultState = document.querySelector("#result-state");
    const errorState = document.querySelector("#error-state");
    const description = document.querySelector("#page-description");
    const eyebrow = document.querySelector("#result-eyebrow");
    const frame = document.querySelector("#comparison-frame");
    const beforeImage = document.querySelector("#before-image");
    const afterImage = document.querySelector("#after-image");
    const slider = document.querySelector("#comparison-slider");

    function resultIdFromPath() {
        const match = window.location.pathname.match(
            /^\/results\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i
        );
        return match ? match[1].toLowerCase() : null;
    }

    function showError(title, message) {
        loadingState.hidden = true;
        resultState.hidden = true;
        errorState.hidden = false;
        document.querySelector("#error-title").textContent = title;
        document.querySelector("#error-message").textContent = message;
        description.textContent = "This shared result can’t be displayed.";
    }

    function readableDate(isoDate) {
        const value = new Date(isoDate);
        if (Number.isNaN(value.getTime())) return "its expiry date";
        return new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
        }).format(value);
    }

    function creativityName(value) {
        return ({
            "-2": "Conservative",
            "-1": "Careful",
            "0": "Balanced",
            "1": "Creative",
            "2": "Artistic",
        })[String(value)] || "Custom";
    }

    function updateSlider() {
        frame.style.setProperty("--position", `${slider.value}%`);
        slider.setAttribute(
            "aria-valuetext",
            `${slider.value}% original, ${100 - Number(slider.value)}% enhanced`
        );
    }

    function fitFrame(width, height) {
        const ratio = width / height;
        if (!Number.isFinite(ratio) || ratio <= 0) return;
        const available = Math.min(960, frame.parentElement.clientWidth);
        const heightLimited = window.innerHeight * 0.67 * ratio;
        const minimum = Math.min(260, available);
        frame.style.width = `${Math.min(available, Math.max(minimum, heightLimited))}px`;
        frame.style.aspectRatio = `${width} / ${height}`;
    }

    function imageReady(image) {
        if (image.decode) return image.decode();
        return new Promise((resolve, reject) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", reject, { once: true });
        });
    }

    async function loadResult() {
        const resultId = resultIdFromPath();
        if (!resultId) {
            showError("That link doesn’t look right", "Check the full result link and try again.");
            return;
        }

        let response;
        try {
            response = await fetch(`${apiBase}/public/v1/results/${resultId}`, {
                headers: { Accept: "application/json" },
                cache: "no-store",
            });
        } catch (_) {
            showError("We couldn’t reach this result", "Please check your connection and try again.");
            return;
        }

        if (response.status === 404) {
            showError("This result wasn’t found", "It may have expired, or the link may be incomplete.");
            return;
        }
        if (!response.ok) {
            showError("This result isn’t available", "Please try again in a moment.");
            return;
        }

        let data;
        try {
            data = await response.json();
            beforeImage.src = data.before.url;
            afterImage.src = data.after.url;
            await Promise.all([imageReady(beforeImage), imageReady(afterImage)]);
        } catch (_) {
            showError("The images couldn’t be loaded", "Please refresh the page and try again.");
            return;
        }

        if (data.processing.kind === "photo_restoration") {
            eyebrow.textContent = "Photo restoration result";
            document.querySelector("#creativity-detail").textContent = "Photo restoration";
            document.querySelector("#resolution-detail").textContent = `${String(data.processing.output_format).toUpperCase()} · Safety ${data.processing.safety_tolerance}`;
            description.textContent = "Slide between the original and the restored result.";
        } else {
            eyebrow.textContent = "Upscale result";
            document.querySelector("#creativity-detail").textContent = `${creativityName(data.processing.creativity)} style`;
            document.querySelector("#resolution-detail").textContent = String(data.processing.target_resolution).toUpperCase();
            description.textContent = "Slide between the original and the Upscale result.";
        }
        document.querySelector("#download-button").href = data.download_url;
        document.querySelector("#privacy-note").textContent = `These images are available until ${readableDate(data.expires_at)}.`;

        loadingState.hidden = true;
        errorState.hidden = true;
        resultState.hidden = false;
        fitFrame(data.after.width, data.after.height);
        window.addEventListener("resize", () => fitFrame(data.after.width, data.after.height));
        updateSlider();
    }

    slider.addEventListener("input", updateSlider);
    loadResult();
})();
