/**
 * Lepus Pelt Engine — Proof of Concept
 *
 * This script demonstrates the pelt system using Firefox's -moz-element()
 * CSS function. It requires Firefox/Lepus to run (other browsers do not
 * support -moz-element).
 *
 * What it does:
 * 1. Finds all <pelt> elements and hides them (they are definitions only)
 * 2. Gives each <pelt>'s inner <svg> a unique ID for -moz-element() targeting
 * 3. Finds all elements with a pelt="" attribute
 * 4. Applies the referenced SVG as a background via -moz-element()
 * 5. Handles pelt-hover, pelt-active state attributes
 *
 * In the real Lepus engine (Phase 1+), this logic is replaced by:
 * - HTMLPeltElement in dom/pelt/ (parsing)
 * - PeltRegistry in layout/pelt/ (storage)
 * - nsDisplayPelt in layout/pelt/ (display list)
 * - vello_bindings in gfx/vello_bindings/ (GPU rendering)
 */

(function () {
  "use strict";

  const PELT_SVG_PREFIX = "__pelt_svg_";
  const registry = new Map();

  function initPelts() {
    const peltElements = document.querySelectorAll("pelt");

    for (const pelt of peltElements) {
      const id = pelt.getAttribute("id");
      if (!id) continue;

      const svg = pelt.querySelector("svg");
      if (!svg) continue;

      // Give the SVG a unique ID for -moz-element() targeting.
      const svgId = PELT_SVG_PREFIX + id;
      svg.setAttribute("id", svgId);

      // Move SVG out of the <pelt> so it exists in the DOM but is hidden.
      // -moz-element() needs the element to be in the document.
      svg.style.position = "absolute";
      svg.style.width = "0";
      svg.style.height = "0";
      svg.style.overflow = "hidden";
      svg.style.pointerEvents = "none";
      document.body.appendChild(svg);

      registry.set(id, { svgId, svg });

      // Hide the <pelt> element itself.
      pelt.style.display = "none";
    }
  }

  function applyPelts() {
    const pelted = document.querySelectorAll("[pelt]");

    for (const el of pelted) {
      const peltId = el.getAttribute("pelt");
      applyPeltBackground(el, peltId);

      // Set up hover state if pelt-hover is defined.
      const hoverId = el.getAttribute("pelt-hover");
      if (hoverId) {
        el.addEventListener("mouseenter", () => {
          applyPeltBackground(el, hoverId);
        });
        el.addEventListener("mouseleave", () => {
          applyPeltBackground(el, peltId);
        });
      }

      // Set up active state if pelt-active is defined.
      const activeId = el.getAttribute("pelt-active");
      if (activeId) {
        el.addEventListener("mousedown", () => {
          applyPeltBackground(el, activeId);
        });
        el.addEventListener("mouseup", () => {
          const isHovering = el.matches(":hover");
          applyPeltBackground(el, isHovering && hoverId ? hoverId : peltId);
        });
      }
    }
  }

  function applyPeltBackground(el, peltId) {
    const def = registry.get(peltId);
    if (!def) {
      console.warn(`Pelt "${peltId}" not found in registry.`);
      return;
    }

    // -moz-element() renders a live snapshot of another DOM element as
    // a CSS background image. This is Firefox-only and is the closest
    // thing to SVG-as-styling that exists in any browser today.
    el.style.background = `-moz-element(#${def.svgId}) no-repeat`;
    el.style.backgroundSize = "100% 100%";
  }

  // Boot
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      initPelts();
      applyPelts();
    });
  } else {
    initPelts();
    applyPelts();
  }
})();
